import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { fileKeyStore } from '../src/credentials.js'
import { GalleryDb } from '../src/gallery-db.js'
import { galleryRoute, keyRoute, modelIds, modelsRoute, modelsURL, paintRoute, settingsRoute, testRoute } from '../src/routes.js'
import type { PluginServices } from '../src/services.js'
import { SettingsStore } from '../src/settings-store.js'
import { providerDigest } from '../src/index.js'
import { defaultSettings } from '../src/shared.js'
import { json, png, PNG, scriptedFetch } from './helpers.js'

let dir: string
let server: Server
let base: string
let services: PluginServices
let net: ReturnType<typeof scriptedFetch>
let saved = 0
let launched: string[][] = []

function fakeAttachments(): PluginServices['attachments'] {
  const store = new Map<string, Uint8Array>()
  return {
    imageLimits: { maxImageBytes: 1_000_000, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    async saveImage(input) {
      saved++
      const id = `sha256:${String(saved).padStart(64, '0')}`
      store.set(id, input.data)
      return { attachmentId: id, mediaType: input.mediaType, bytes: input.data.byteLength, width: 4, height: 3 } as unknown as ImageAttachmentRef
    },
    async readImage(ref) {
      const data = store.get(String(ref.attachmentId))
      if (data === undefined) throw new Error('missing')
      return { ref, data } as never
    },
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dig-routes-'))
  net = scriptedFetch(url => {
    if (url.endsWith('/models')) return json({ data: [{ id: 'Qwen/Qwen-Image' }, { id: 'Qwen/Qwen3-8B' }, { id: 'black-forest-labs/FLUX.1-dev' }] })
    if (url.endsWith('/images/generations')) return json({ images: [{ url: 'https://cdn.example/x.png' }] })
    return png()
  })
  launched = []
  services = { settings: new SettingsStore(dir), keys: fileKeyStore(dir), gallery: new GalleryDb(dir), attachments: fakeAttachments(), fetch: net.fetch, dataDir: dir, launch: (command, args) => { launched.push([command, ...args]) } }
  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
    '/settings': settingsRoute(services), '/key': keyRoute(services), '/test': testRoute(services),
    '/models': modelsRoute(services), '/paint': paintRoute(services), '/gallery': galleryRoute(services),
  }
  server = createServer((req, res) => { void routes[req.url ?? '']?.(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
})

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

describe('routes', () => {
  it('settings never expose keys, only key presence', async () => {
    expect((await post('/key', { providerId: 'modelscope', key: 'ms-key-123456' })).status).toBe(200)
    const view = await (await fetch(base + '/settings')).json() as { providers: Array<{ id: string; keyConfigured: boolean }> }
    expect(view.providers.find(entry => entry.id === 'modelscope')?.keyConfigured).toBe(true)
    expect(JSON.stringify(view)).not.toContain('ms-key-123456')
    expect((await post('/key', { providerId: 'nope', key: 'x' })).status).toBe(404)
  })

  it('saves settings and rejects invalid ones', async () => {
    const next = defaultSettings()
    next.providers.push({ id: 'custom-1', name: 'My relay', protocol: 'openai-compat', baseURL: 'https://relay.example/v1', models: ['m'], defaultModel: 'm', enabled: true, proxy: { mode: 'custom', url: 'socks5://127.0.0.1:1080' } })
    const ok = await post('/settings', { settings: next })
    expect(ok.status).toBe(200)
    expect(ok.body.providers.some((entry: { id: string }) => entry.id === 'custom-1')).toBe(true)
    const bad = await post('/settings', { settings: { ...next, proxy: { enabled: true, url: 'nonsense' } } })
    expect(bad.status).toBe(400)
  })

  it('rejects cross-origin writes', async () => {
    const response = await post('/key', { providerId: 'modelscope', key: 'k' }, { origin: 'https://evil.example' })
    expect(response.status).toBe(403)
  })

  it('tests connections and fetches image models', async () => {
    expect((await post('/test', { providerId: 'modelscope' })).body).toMatchObject({ ok: false })
    await post('/key', { providerId: 'modelscope', key: 'ms-key-123456' })
    const result = await post('/test', { providerId: 'modelscope' })
    expect(result.body).toMatchObject({ ok: true })
    const models = await post('/models', { providerId: 'modelscope' })
    expect(models.body.models).toEqual(['Qwen/Qwen-Image', 'black-forest-labs/FLUX.1-dev'])
    expect((await post('/models', { providerId: 'modelscope', all: true })).body.total).toBe(3)
  })

  it('paints N images into the chosen gallery project', async () => {
    await post('/key', { providerId: 'modelscope', key: 'ms-key-123456' })
    const project = (await post('/gallery', { op: 'createProject', name: '海报' })).body.project
    const result = await post('/paint', { providerId: 'modelscope', prompt: 'a cat', aspectRatio: '1:1', count: 2, references: [], projectId: project.id })
    expect(result.status).toBe(200)
    expect(result.body.items).toHaveLength(2)
    expect(result.body.items[0]).toMatchObject({ prompt: 'a cat', providerId: 'modelscope', projectId: project.id, output: '1024x1024' })
    const listed = await post('/gallery', { op: 'list', projectId: project.id })
    expect(listed.body.total).toBe(2)
    expect((await post('/paint', { providerId: 'modelscope', prompt: ' ', count: 1 })).status).toBe(400)
  })

  it('reports a provider without a key as a readable failure', async () => {
    const result = await post('/paint', { providerId: 'modelscope', prompt: 'a cat', count: 1, references: [] })
    expect(result.status).toBe(502)
    expect(result.body.error).toMatch(/API Key/)
  })

  it('keeps readable image copies, reveals them and cleans them up', async () => {
    await post('/key', { providerId: 'modelscope', key: 'ms-key-123456' })
    const result = await post('/paint', { providerId: 'modelscope', prompt: '草莓 ice cream!', count: 1, references: [] })
    const item = result.body.items[0]
    expect(item.filePath).toMatch(new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\]images[/\\\\]\\d{4}-\\d{2}[/\\\\]\\d{8}-\\d{6}-草莓-ice-cream-0{8}\\.png$`))
    expect(existsSync(item.filePath)).toBe(true)
    const revealed = await post('/gallery', { op: 'reveal', id: item.id })
    expect(revealed.body.path).toBe(item.filePath)
    expect(launched.at(-1)?.join(' ')).toContain(process.platform === 'darwin' ? item.filePath : dirname(item.filePath))
    const folder = await post('/gallery', { op: 'openFolder' })
    expect(folder.body.path).toBe(join(dir, 'images'))
    // A copy deleted on disk is rewritten on reveal.
    rmSync(item.filePath)
    await post('/gallery', { op: 'reveal', id: item.id })
    expect(existsSync(item.filePath)).toBe(true)
    await post('/gallery', { op: 'remove', ids: [item.id] })
    expect(existsSync(item.filePath)).toBe(false)
    expect((await post('/gallery', { op: 'reveal', id: 'missing' })).status).toBe(404)
  })

  it('reports the effective image folder and validates custom ones', async () => {
    const view = await (await fetch(base + '/settings')).json() as { effectiveImageDir: string }
    expect(view.effectiveImageDir).toBe(join(dir, 'images'))
    const next = { ...defaultSettings(), imageDir: 'relative/path' }
    expect((await post('/settings', { settings: next })).status).toBe(400)
    const custom = join(dir, 'pictures')
    const saved = await post('/settings', { settings: { ...defaultSettings(), imageDir: custom } })
    expect(saved.body.effectiveImageDir).toBe(custom)
  })

  it('serves the gallery revision counter', async () => {
    const first = (await post('/gallery', { op: 'revision' })).body.revision
    await post('/gallery', { op: 'addFavoritePrompt', text: 'x' })
    expect((await post('/gallery', { op: 'revision' })).body.revision).toBe(first + 1)
    expect((await post('/gallery', { op: 'bogus' })).status).toBe(400)
  })
})

describe('model listing helpers', () => {
  it('derives model list URLs per protocol', () => {
    expect(modelsURL({ protocol: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/interactions' })).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(modelsURL({ protocol: 'modelscope', baseURL: 'https://api-inference.modelscope.cn/v1' })).toBe('https://api-inference.modelscope.cn/v1/models')
    expect(modelsURL({ protocol: 'modelscope', baseURL: 'https://api-inference.modelscope.cn' })).toBe('https://api-inference.modelscope.cn/v1/models')
    expect(modelsURL({ protocol: 'siliconflow', baseURL: 'https://api.siliconflow.cn/' })).toBe('https://api.siliconflow.cn/v1/models')
    expect(modelsURL({ protocol: 'openai-compat', baseURL: 'https://relay.example' })).toBe('https://relay.example/models')
    expect(modelsURL({ protocol: 'dashscope', baseURL: 'https://dashscope.aliyuncs.com/api/v1' })).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/models')
    expect(modelsURL({ protocol: 'openai', baseURL: 'not a url' })).toBeUndefined()
  })
  it('reads OpenAI and Gemini model lists', () => {
    expect(modelIds({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })).toEqual(['a', 'b'])
    expect(modelIds({ models: [{ name: 'models/gemini-3.1-flash-image' }] })).toEqual(['gemini-3.1-flash-image'])
    expect(modelIds(null)).toEqual([])
  })
})

describe('providerDigest', () => {
  it('lists keyed providers for the model and nudges configuration otherwise', () => {
    const settings = defaultSettings()
    expect(providerDigest(settings, new Set())).toMatch(/no image provider has an API key/)
    const text = providerDigest(settings, new Set(['modelscope', 'zhipu']))
    expect(text).toMatch(/paint_image/)
    expect(text).toMatch(/- modelscope \(default\): ModelScope 魔搭, model Qwen\/Qwen-Image, edit≤1/)
    expect(text).toMatch(/- zhipu: .*no-edit/)
    expect(text).not.toMatch(/- google/)
  })
})

void PNG
