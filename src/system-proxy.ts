/**
 * Detect the OS / environment proxy (the “系统代理（自动检测）” mode).
 *
 * Order: environment variables → Windows Internet Settings (registry) →
 * macOS `scutil --proxy` → GNOME `gsettings`. Results are cached for 30 s.
 * Ported from dsh-free-search, extended with SOCKS and bypass lists.
 */
import { execFile } from 'node:child_process'

export interface SystemProxy {
  /** Proxy URL with scheme, e.g. `http://127.0.0.1:7890`. */
  url: string
  /** Human-readable origin, e.g. `Windows 系统代理`. */
  source: string
  /** Hosts that bypass the proxy (from ProxyOverride / exceptions). */
  bypass: string[]
}

/** Runs a command and resolves its stdout ('' on any failure). */
export type CommandRunner = (file: string, args: string[]) => Promise<string>

export const defaultRunner: CommandRunner = (file, args) => new Promise(resolve => {
  execFile(file, args, { timeout: 3000, windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout)))
})

const ENV_NAMES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
const CACHE_MS = 30_000

/** Add a scheme to bare `host:port`; keep explicit http/https/socks schemes. */
export function normalizeProxyAddress(raw: string, defaultScheme = 'http'): string | undefined {
  const value = raw.trim()
  if (value.length === 0) return undefined
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `${defaultScheme}://${value}`
  try {
    const url = new URL(withScheme)
    if (!['http:', 'https:', 'socks:', 'socks4:', 'socks5:', 'socks5h:'].includes(url.protocol) || url.hostname.length === 0) return undefined
    return withScheme.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

/** Pick from Windows `ProxyServer`: `host:port` or `http=..;https=..;socks=..`. */
export function pickWindowsProxy(server: string): string | undefined {
  const value = server.trim()
  if (value.length === 0) return undefined
  if (!value.includes('=')) return normalizeProxyAddress(value)
  const parts = Object.fromEntries(value.split(';')
    .map(part => part.split('=').map(piece => piece.trim()))
    .filter((pair): pair is [string, string] => pair.length === 2 && pair[1]!.length > 0)
    .map(([key, address]) => [key.toLowerCase(), address]))
  if (parts.https !== undefined) return normalizeProxyAddress(parts.https)
  if (parts.http !== undefined) return normalizeProxyAddress(parts.http)
  if (parts.socks !== undefined) return normalizeProxyAddress(parts.socks, 'socks5')
  return undefined
}

/** Windows `ProxyOverride` → no-proxy patterns (`<local>` = dotless hosts, kept as-is). */
export function parseProxyOverride(value: string): string[] {
  return value.split(';').map(item => item.trim()).filter(item => item.length > 0)
}

export async function detectFromEnv(env: NodeJS.ProcessEnv): Promise<SystemProxy | null> {
  for (const name of ENV_NAMES) {
    const raw = env[name]
    if (raw === undefined || raw.trim().length === 0) continue
    const url = normalizeProxyAddress(raw)
    if (url === undefined) continue
    const noProxy = env.NO_PROXY ?? env.no_proxy ?? ''
    return { url, source: `环境变量 ${name}`, bypass: noProxy.split(/[,\s]+/).filter(item => item.length > 0) }
  }
  return null
}

export async function detectWindows(run: CommandRunner): Promise<SystemProxy | null> {
  const out = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'])
  if (!/ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(out)) return null
  const server = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(out)?.[1] ?? ''
  const url = pickWindowsProxy(server)
  if (url === undefined) return null
  const override = /ProxyOverride\s+REG_SZ\s+(.+)/i.exec(out)?.[1] ?? ''
  return { url, source: 'Windows 系统代理', bypass: parseProxyOverride(override) }
}

export async function detectMac(run: CommandRunner): Promise<SystemProxy | null> {
  const out = await run('scutil', ['--proxy'])
  const field = (key: string): string | undefined => new RegExp(`\\b${key}\\s*:\\s*(\\S+)`).exec(out)?.[1]
  const bypass = [...out.matchAll(/^\s*\d+\s*:\s*(\S+)\s*$/gm)].map(match => match[1]!).filter(item => !/^\d+$/.test(item))
  for (const [kind, scheme] of [['HTTPS', 'http'], ['HTTP', 'http'], ['SOCKS', 'socks5']] as const) {
    if (field(`${kind}Enable`) === '1' && field(`${kind}Proxy`) !== undefined) {
      const url = normalizeProxyAddress(`${field(`${kind}Proxy`)!}:${field(`${kind}Port`) ?? '80'}`, scheme)
      if (url !== undefined) return { url, source: 'macOS 系统代理', bypass }
    }
  }
  return null
}

export async function detectGnome(run: CommandRunner): Promise<SystemProxy | null> {
  const mode = (await run('gsettings', ['get', 'org.gnome.system.proxy', 'mode'])).trim()
  if (mode !== "'manual'") return null
  const read = async (schema: string, key: string): Promise<string> => (await run('gsettings', ['get', `org.gnome.system.proxy.${schema}`, key])).trim().replace(/^'|'$/g, '')
  for (const [schema, scheme] of [['https', 'http'], ['http', 'http'], ['socks', 'socks5']] as const) {
    const host = await read(schema, 'host')
    const port = await read(schema, 'port')
    if (host.length > 0 && port !== '0' && port.length > 0) {
      const url = normalizeProxyAddress(`${host}:${port}`, scheme)
      if (url !== undefined) return { url, source: 'GNOME 系统代理', bypass: [] }
    }
  }
  return null
}

let cache: { at: number; value: SystemProxy | null } | undefined

/** Detect the system proxy; `refresh` skips the 30 s cache. */
export async function detectSystemProxy(options: {
  refresh?: boolean
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  run?: CommandRunner
} = {}): Promise<SystemProxy | null> {
  const injected = options.env !== undefined || options.platform !== undefined || options.run !== undefined
  if (!injected && options.refresh !== true && cache !== undefined && Date.now() - cache.at < CACHE_MS) return cache.value
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const run = options.run ?? defaultRunner
  let found = await detectFromEnv(env)
  if (found === null && platform === 'win32') found = await detectWindows(run)
  if (found === null && platform === 'darwin') found = await detectMac(run)
  if (found === null && platform === 'linux') found = await detectGnome(run)
  if (!injected) cache = { at: Date.now(), value: found }
  return found
}

/** Drop the cache (tests, settings changes). */
export function resetSystemProxyCache(): void {
  cache = undefined
}
