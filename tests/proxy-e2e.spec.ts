/**
 * End to end: providerFetch really routes through an HTTP proxy and a SOCKS5
 * proxy (both local), and goes direct when told to.
 */
import { createServer, request as httpRequest, type Server } from 'node:http'
import { createServer as createTcpServer, connect, type AddressInfo, type Server as TcpServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { providerFetch } from '../src/http.js'

let target: Server
let httpProxy: Server
let socksProxy: TcpServer
const seen = { http: 0, socks: 0 }
const port = (server: Server | TcpServer): number => (server.address() as AddressInfo).port

beforeAll(async () => {
  target = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += String(chunk) })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ path: req.url, method: req.method, body, contentType: req.headers['content-type'] ?? null }))
    })
  })
  // Forwarding HTTP proxy (absolute-form requests and CONNECT tunnels).
  httpProxy = createServer((req, res) => {
    seen.http++
    const url = new URL(req.url ?? '')
    const upstream = httpRequest({ host: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method, headers: req.headers }, answer => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    req.pipe(upstream)
  })
  httpProxy.on('connect', (req, socket, head) => {
    seen.http++
    const [host, p] = (req.url ?? '').split(':')
    const upstream = connect(Number(p), host!, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
  })
  // Minimal SOCKS5 (no auth, CONNECT, IPv4/domain).
  socksProxy = createTcpServer(socket => {
    socket.once('data', () => {
      socket.write(Buffer.from([5, 0]))
      socket.once('data', request => {
        seen.socks++
        let host: string
        let offset: number
        if (request[3] === 1) {
          host = [...request.subarray(4, 8)].join('.')
          offset = 8
        } else {
          const length = request[4]!
          host = request.subarray(5, 5 + length).toString()
          offset = 5 + length
        }
        const destinationPort = request.readUInt16BE(offset)
        const upstream = connect(destinationPort, host, () => {
          socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          upstream.pipe(socket)
          socket.pipe(upstream)
        })
        upstream.on('error', () => socket.destroy())
      })
    })
  })
  await Promise.all([target, httpProxy, socksProxy].map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))))
})

afterAll(async () => {
  for (const server of [target, httpProxy, socksProxy]) {
    (server as Server).closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

describe('providerFetch through real proxies', () => {
  it('goes direct when no proxy applies', async () => {
    const before = { ...seen }
    const response = await providerFetch({ mode: 'direct' }, { enabled: true, url: `http://127.0.0.1:${String(port(httpProxy))}`, noProxy: [] })(`http://127.0.0.1:${String(port(target))}/direct`)
    expect((await response.json() as { path: string }).path).toBe('/direct')
    expect(seen).toEqual(before)
  })

  it('routes through the inherited global HTTP proxy, JSON body intact', async () => {
    const before = seen.http
    const fetcher = providerFetch({ mode: 'inherit' }, { enabled: true, url: `http://127.0.0.1:${String(port(httpProxy))}`, noProxy: [] })
    const response = await fetcher(`http://127.0.0.1:${String(port(target))}/v1/images/generations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x' }),
    })
    const echoed = await response.json() as { path: string; body: string; method: string }
    expect(echoed).toMatchObject({ path: '/v1/images/generations', method: 'POST', body: '{"prompt":"x"}' })
    expect(seen.http).toBeGreaterThan(before)
  })

  it('routes multipart FormData bodies through a provider SOCKS5 proxy', async () => {
    const before = seen.socks
    const fetcher = providerFetch({ mode: 'custom', url: `socks5://127.0.0.1:${String(port(socksProxy))}` }, { enabled: false, url: '', noProxy: [] })
    const form = new FormData()
    form.append('prompt', 'hello')
    form.append('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'a.png')
    const response = await fetcher(`http://127.0.0.1:${String(port(target))}/v1/images/edits`, { method: 'POST', body: form })
    const echoed = await response.json() as { path: string; body: string; contentType: string }
    expect(echoed.path).toBe('/v1/images/edits')
    expect(echoed.contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(echoed.body).toContain('hello')
    expect(seen.socks).toBeGreaterThan(before)
  })

  it('system mode routes through the proxy found in HTTPS_PROXY', async () => {
    const { resetSystemProxyCache } = await import('../src/system-proxy.js')
    const saved = { HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy }
    // `localhost` (not 127.0.0.1) so a fresh dispatcher opens a new tunnel instead of reusing the earlier test's.
    process.env.HTTPS_PROXY = `http://localhost:${String(port(httpProxy))}`
    delete process.env.NO_PROXY
    delete process.env.no_proxy
    resetSystemProxyCache()
    try {
      const before = seen.http
      const fetcher = providerFetch({ mode: 'system' }, { mode: 'off', enabled: false, url: '', noProxy: [] })
      const echoed = await (await fetcher(`http://127.0.0.1:${String(port(target))}/via-system`)).json() as { path: string }
      expect(echoed.path).toBe('/via-system')
      expect(seen.http).toBeGreaterThan(before)
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      resetSystemProxyCache()
    }
  })

  it('bypasses the global proxy for no-proxy hosts', async () => {
    const before = seen.http
    const fetcher = providerFetch(undefined, { enabled: true, url: `http://127.0.0.1:${String(port(httpProxy))}`, noProxy: ['127.0.0.1'] })
    await (await fetcher(`http://127.0.0.1:${String(port(target))}/np`)).text()
    expect(seen.http).toBe(before)
  })
})
