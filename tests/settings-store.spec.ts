import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore, normalizeSettings, requireProvider, validateSettings } from '../src/settings-store.js'
import { PRESET_PROVIDERS, defaultSettings } from '../src/shared.js'

let dir: string | undefined
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('normalizeSettings', () => {
  it('ships every preset, ModelScope first and default', () => {
    const settings = normalizeSettings(undefined)
    expect(settings.providers.map(entry => entry.id)).toEqual(PRESET_PROVIDERS.map(entry => entry.id))
    expect(settings.providers[0]?.id).toBe('modelscope')
    expect(settings.providers[0]?.baseURL).toBe('https://api-inference.modelscope.cn/v1')
    expect(settings.activeProvider).toBe('modelscope')
  })
  it('keeps user edits to presets and custom providers', () => {
    const settings = normalizeSettings({
      providers: [
        { id: 'openai', protocol: 'openai', name: 'My OpenAI', baseURL: 'https://relay.example/v1', models: ['a', ' ', 'a', 'b'], defaultModel: 'b', enabled: false, proxy: { mode: 'direct' } },
        { id: 'custom-1', protocol: 'openai-compat', name: 'Relay', baseURL: 'https://r.example/v1', models: ['flux'], defaultModel: '', proxy: { mode: 'custom', url: 'socks5://h:1' }, compat: { editFormat: 'jsonImageUrlArray', sizes: { '1:1': { '1K': '1024x1024', bad: 3 } } } },
      ],
      activeProvider: 'custom-1',
    })
    const openai = settings.providers.find(entry => entry.id === 'openai')!
    expect(openai).toMatchObject({ name: 'My OpenAI', baseURL: 'https://relay.example/v1', models: ['a', 'b'], enabled: false, proxy: { mode: 'direct' }, preset: true })
    const custom = settings.providers.find(entry => entry.id === 'custom-1')!
    expect(custom.compat).toEqual({ editFormat: 'jsonImageUrlArray', sizes: { '1:1': { '1K': '1024x1024' } } })
    expect(custom.proxy).toEqual({ mode: 'custom', url: 'socks5://h:1' })
    expect(settings.activeProvider).toBe('custom-1')
  })
  it('drops invalid entries and pins preset protocols', () => {
    const settings = normalizeSettings({
      providers: [
        { id: 'Bad Id!', protocol: 'openai' },
        { id: 'x', protocol: 'nope' },
        { id: 'modelscope', protocol: 'openai', name: 'MS' },
      ],
      activeProvider: 'missing',
    })
    expect(settings.providers.some(entry => entry.id === 'x')).toBe(false)
    expect(settings.providers.find(entry => entry.id === 'modelscope')?.protocol).toBe('modelscope')
    expect(settings.activeProvider).toBe('modelscope')
  })
})

describe('validateSettings', () => {
  it('flags unusable proxies and endpoints', () => {
    const settings = defaultSettings()
    settings.proxy = { mode: 'custom', enabled: true, url: '', noProxy: [] }
    settings.providers[0] = { ...settings.providers[0]!, proxy: { mode: 'custom', url: 'ftp://x' }, baseURL: 'nope' }
    expect(validateSettings(settings)).toHaveLength(3)
    expect(validateSettings(defaultSettings())).toEqual([])
  })
})

describe('SettingsStore', () => {
  it('persists atomically and notifies listeners', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dig-settings-'))
    const store = new SettingsStore(dir)
    let notified = 0
    store.onChange(() => { notified++ })
    const next = defaultSettings()
    next.proxy = { enabled: true, url: 'http://127.0.0.1:7890', noProxy: [] }
    await store.save(next)
    expect(notified).toBe(1)
    const fresh = new SettingsStore(dir)
    expect((await fresh.get()).proxy.url).toBe('http://127.0.0.1:7890')
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).version).toBe(1)
  })
  it('rejects invalid settings without writing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dig-settings-'))
    const store = new SettingsStore(dir)
    await expect(store.save({ proxy: { enabled: true, url: 'bogus' } })).rejects.toThrow(/代理/)
    await expect(readFile(join(dir, 'settings.json'))).rejects.toThrow()
  })
})

describe('requireProvider', () => {
  it('resolves by id or name and explains failures', () => {
    const settings = defaultSettings()
    expect(requireProvider(settings).id).toBe('modelscope')
    expect(requireProvider(settings, 'Google Gemini').id).toBe('google')
    expect(() => requireProvider(settings, 'nope')).toThrow(/Unknown image provider/)
    expect(() => requireProvider(settings, 'openai-compat')).toThrow(/no endpoint/)
    settings.providers[1]!.enabled = false
    expect(() => requireProvider(settings, 'google')).toThrow(/disabled/)
  })
})
