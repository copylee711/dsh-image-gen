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
