/**
 * Proxy-aware fetch for provider requests.
 *
 * Every provider call goes through {@link providerFetch}, which resolves the
 * effective proxy for that provider (its own override, else the plugin-wide
 * proxy) and hands undici a matching dispatcher. Only this plugin's image
 * traffic is affected; the rest of DSH keeps its own networking.
 */
import { connect as tlsConnect } from 'node:tls'
import type { Socket } from 'node:net'
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { SocksClient } from 'socks'
import type { GlobalProxy, ProviderProxy } from './shared.js'

/** Minimal fetch signature the adapters depend on. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** The proxy a request should use, or `undefined` for a direct connection. */
export function resolveProxyUrl(
  target: string,
  proxy: ProviderProxy | undefined,
  global: GlobalProxy,
): string | undefined {
  const mode = proxy?.mode ?? 'inherit'
  if (mode === 'direct') return undefined
  if (mode === 'custom') {
    const url = proxy?.url?.trim() ?? ''
    return url.length > 0 ? url : undefined
  }
  if (!global.enabled) return undefined
  const url = global.url.trim()
  if (url.length === 0) return undefined
  if (bypassesProxy(target, global.noProxy)) return undefined
  return url
}

/** Whether a target host matches one of the no-proxy patterns. */
export function bypassesProxy(target: string, patterns: readonly string[]): boolean {
  let host: string
  try {
    host = new URL(target).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase()
    if (pattern.length === 0) continue
    if (pattern === '*') return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      if (host.endsWith(suffix) || host === pattern.slice(2)) return true
      continue
    }
    if (pattern.startsWith('.')) {
      if (host.endsWith(pattern) || host === pattern.slice(1)) return true
      continue
    }
    if (host === pattern) return true
  }
  return false
}

/** Validate a proxy URL; returns an error message or `undefined` when usable. */
export function validateProxyUrl(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return '代理地址不是合法的 URL'
  }
  if (!['http:', 'https:', 'socks:', 'socks5:', 'socks5h:', 'socks4:'].includes(url.protocol)) {
    return '代理协议仅支持 http、https、socks5、socks5h、socks4'
  }
  if (url.hostname.length === 0) return '代理地址缺少主机名'
  return undefined
}

const dispatchers = new Map<string, Dispatcher>()

/** One cached dispatcher per proxy URL. */
export function dispatcherFor(proxyUrl: string): Dispatcher {
  const cached = dispatchers.get(proxyUrl)
  if (cached !== undefined) return cached
  const problem = validateProxyUrl(proxyUrl)
  if (problem !== undefined) throw new Error(problem)
  const url = new URL(proxyUrl)
  const dispatcher = url.protocol.startsWith('socks') ? socksAgent(url) : new ProxyAgent(proxyUrl)
  dispatchers.set(proxyUrl, dispatcher)
  return dispatcher
}

/** Drop cached dispatchers (after settings change). */
export function resetDispatchers(): void {
  for (const dispatcher of dispatchers.values()) void dispatcher.close().catch(() => {})
  dispatchers.clear()
}

function socksAgent(proxy: URL): Agent {
  const type = proxy.protocol === 'socks4:' ? 4 : 5
  const user = decodeURIComponent(proxy.username)
  const password = decodeURIComponent(proxy.password)
  return new Agent({
    connect(options, callback) {
      const host = options.hostname
      const port = Number(options.port) || (options.protocol === 'https:' ? 443 : 80)
      SocksClient.createConnection({
        proxy: {
          host: proxy.hostname,
          port: Number(proxy.port) || 1080,
          type,
          ...(user.length > 0 ? { userId: user } : {}),
          ...(password.length > 0 ? { password } : {}),
        },
        command: 'connect',
        destination: { host, port },
      }).then(({ socket }) => {
        if (options.protocol !== 'https:') {
          callback(null, socket)
          return
        }
        const secure = tlsConnect({
          socket,
          servername: options.servername ?? host,
          ALPNProtocols: ['http/1.1'],
        })
        secure.once('secureConnect', () => callback(null, secure as unknown as Socket))
        secure.once('error', error => callback(error, null))
      }, (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null))
    },
  })
}

/**
 * Build the fetch one provider's requests go through. Direct requests use the
 * runtime's global fetch; proxied requests use undici's fetch with the proxy
 * dispatcher (the global fetch may embed a different undici build).
 */
export function providerFetch(proxy: ProviderProxy | undefined, global: GlobalProxy): FetchLike {
  return async (url, init) => {
    const proxyUrl = resolveProxyUrl(url, proxy, global)
    if (proxyUrl === undefined) return fetch(url, init)
    const dispatcher = dispatcherFor(proxyUrl)
    let request: RequestInit = init ?? {}
    // The global FormData belongs to the runtime's bundled undici; serialize
    // it here so the userland undici never has to recognize a foreign class.
    if (request.body instanceof FormData) {
      const encoded = new Response(request.body)
      const headers = new Headers(request.headers)
      headers.set('content-type', encoded.headers.get('content-type') ?? 'multipart/form-data')
      request = { ...request, headers, body: new Uint8Array(await encoded.arrayBuffer()) }
    }
    const headers = request.headers === undefined ? undefined : Object.fromEntries(new Headers(request.headers).entries())
    const response = await undiciFetch(url, {
      ...(request as object),
      ...(headers === undefined ? {} : { headers }),
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])
    return response as unknown as Response
  }
}
