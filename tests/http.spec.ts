import { describe, expect, it } from 'vitest'
import { bypassesProxy, dispatcherFor, resolveProxyUrl, validateProxyUrl } from '../src/http.js'

const global = { enabled: true, url: 'http://127.0.0.1:7890', noProxy: ['localhost', '.internal.example', '*.corp.example'] }

describe('resolveProxyUrl', () => {
  it('inherits the global proxy by default', () => {
    expect(resolveProxyUrl('https://api.openai.com/v1', undefined, global)).toBe('http://127.0.0.1:7890')
    expect(resolveProxyUrl('https://api.openai.com/v1', { mode: 'inherit' }, global)).toBe('http://127.0.0.1:7890')
  })
  it('goes direct when the global proxy is off or blank', () => {
    expect(resolveProxyUrl('https://a.example', { mode: 'inherit' }, { ...global, enabled: false })).toBeUndefined()
    expect(resolveProxyUrl('https://a.example', { mode: 'inherit' }, { ...global, url: ' ' })).toBeUndefined()
  })
  it('lets a provider force a direct connection', () => {
    expect(resolveProxyUrl('https://api.openai.com/v1', { mode: 'direct' }, global)).toBeUndefined()
  })
  it('uses a provider-specific proxy even when the global one is off', () => {
    expect(resolveProxyUrl('https://x.example', { mode: 'custom', url: 'socks5://10.0.0.1:1080' }, { ...global, enabled: false })).toBe('socks5://10.0.0.1:1080')
    expect(resolveProxyUrl('https://x.example', { mode: 'custom', url: '' }, global)).toBeUndefined()
  })
  it('honours no-proxy hosts for the inherited proxy only', () => {
    expect(resolveProxyUrl('http://localhost:8188/x', undefined, global)).toBeUndefined()
    expect(resolveProxyUrl('https://img.internal.example/x', undefined, global)).toBeUndefined()
    expect(resolveProxyUrl('https://a.corp.example/x', undefined, global)).toBeUndefined()
    expect(resolveProxyUrl('http://localhost:8188/x', { mode: 'custom', url: 'http://p:1' }, global)).toBe('http://p:1')
  })
})

describe('bypassesProxy', () => {
  it('matches exact, suffix and wildcard patterns', () => {
    expect(bypassesProxy('https://internal.example/', ['.internal.example'])).toBe(true)
    expect(bypassesProxy('https://notinternal.example/', ['.internal.example'])).toBe(false)
    expect(bypassesProxy('https://anything/', ['*'])).toBe(true)
    expect(bypassesProxy('http://[::1]:80/', ['::1'])).toBe(true)
    expect(bypassesProxy('not a url', ['*'])).toBe(false)
  })
})

describe('validateProxyUrl', () => {
  it('accepts http(s) and socks proxies', () => {
    for (const url of ['http://127.0.0.1:7890', 'https://user:pw@proxy:443', 'socks5://127.0.0.1:1080', 'socks5h://h:1', 'socks4://h:1']) {
      expect(validateProxyUrl(url)).toBeUndefined()
    }
  })
  it('rejects other schemes and garbage', () => {
    expect(validateProxyUrl('ftp://x')).toBeDefined()
    expect(validateProxyUrl('127.0.0.1:7890')).toBeDefined()
  })
  it('builds and caches dispatchers', () => {
    const first = dispatcherFor('http://127.0.0.1:9')
    expect(dispatcherFor('http://127.0.0.1:9')).toBe(first)
    expect(dispatcherFor('socks5://127.0.0.1:9')).not.toBe(first)
    expect(() => dispatcherFor('ftp://x')).toThrow()
  })
})

describe('system proxy mode', () => {
  const system = { url: 'http://127.0.0.1:7897', source: 'test', bypass: ['<local>', '10.*'] }
  const off = { mode: 'off' as const, enabled: false, url: '', noProxy: ['localhost'] }
  const sys = { ...off, mode: 'system' as const, enabled: true }
  it('uses the detected proxy for system and inherited-system modes', () => {
    expect(resolveProxyUrl('https://api.openai.com/v1', { mode: 'system' }, off, system)).toBe(system.url)
    expect(resolveProxyUrl('https://api.openai.com/v1', { mode: 'inherit' }, sys, system)).toBe(system.url)
    expect(resolveProxyUrl('https://api.openai.com/v1', { mode: 'direct' }, sys, system)).toBeUndefined()
    expect(resolveProxyUrl('https://api.openai.com/v1', { mode: 'inherit' }, off, system)).toBeUndefined()
  })
  it('honours system bypass (<local>, globs) plus the global no-proxy list', () => {
    expect(resolveProxyUrl('http://intranet/x', { mode: 'system' }, off, system)).toBeUndefined()
    expect(resolveProxyUrl('http://10.1.2.3/x', { mode: 'system' }, off, system)).toBeUndefined()
    expect(resolveProxyUrl('http://localhost:8188/x', { mode: 'system' }, off, system)).toBeUndefined()
  })
  it('fails loudly when the system proxy is selected but missing', () => {
    expect(() => resolveProxyUrl('https://api.openai.com/v1', { mode: 'system' }, off, null)).toThrow(/未检测到系统代理/)
    expect(() => resolveProxyUrl('https://api.openai.com/v1', undefined, sys, undefined)).toThrow(/未检测到系统代理/)
  })
  it('migrates pre-0.1.3 global proxy settings', async () => {
    const { normalizeSettings } = await import('../src/settings-store.js')
    expect(normalizeSettings({ proxy: { enabled: true, url: 'http://p:1' } }).proxy).toMatchObject({ mode: 'custom', enabled: true })
    expect(normalizeSettings({ proxy: { enabled: false } }).proxy).toMatchObject({ mode: 'off', enabled: false })
    expect(normalizeSettings({ proxy: { mode: 'system' } }).proxy).toMatchObject({ mode: 'system', enabled: true })
    expect(normalizeSettings({ providers: [{ id: 'openai', protocol: 'openai', proxy: { mode: 'system' } }] }).providers.find(entry => entry.id === 'openai')?.proxy).toEqual({ mode: 'system' })
  })
})
