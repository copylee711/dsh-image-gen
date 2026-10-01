import { describe, expect, it } from 'vitest'
import { detectSystemProxy, normalizeProxyAddress, parseProxyOverride, pickWindowsProxy } from '../src/system-proxy.js'

const run = (outputs: Record<string, string>) => async (file: string, args: string[]): Promise<string> => outputs[[file, ...args].join(' ')] ?? ''

const REG = 'reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

describe('system proxy detection', () => {
  it('prefers environment variables (SOCKS kept) and their NO_PROXY', async () => {
    expect(await detectSystemProxy({ env: { HTTPS_PROXY: '127.0.0.1:7890', NO_PROXY: 'localhost,.corp' }, platform: 'linux', run: run({}) }))
      .toEqual({ url: 'http://127.0.0.1:7890', source: '环境变量 HTTPS_PROXY', bypass: ['localhost', '.corp'] })
    expect((await detectSystemProxy({ env: { all_proxy: 'socks5://127.0.0.1:1080' }, platform: 'linux', run: run({}) }))?.url).toBe('socks5://127.0.0.1:1080')
  })

  it('reads the Windows Internet Settings registry', async () => {
    const out = `
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7897
    ProxyOverride    REG_SZ    localhost;127.*;10.*;<local>
`
    expect(await detectSystemProxy({ env: {}, platform: 'win32', run: run({ [REG]: out }) }))
      .toEqual({ url: 'http://127.0.0.1:7897', source: 'Windows 系统代理', bypass: ['localhost', '127.*', '10.*', '<local>'] })
    expect(await detectSystemProxy({ env: {}, platform: 'win32', run: run({ [REG]: out.replace('0x1', '0x0') }) })).toBeNull()
  })

  it('handles per-protocol Windows ProxyServer values', () => {
    expect(pickWindowsProxy('http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080')).toBe('http://127.0.0.1:8443')
    expect(pickWindowsProxy('http=10.0.0.1:3128')).toBe('http://10.0.0.1:3128')
    expect(pickWindowsProxy('socks=127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080')
    expect(pickWindowsProxy('')).toBeUndefined()
    expect(parseProxyOverride('a;;b ; <local>')).toEqual(['a', 'b', '<local>'])
  })

  it('parses macOS scutil output', async () => {
    const out = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
}`
    expect(await detectSystemProxy({ env: {}, platform: 'darwin', run: run({ 'scutil --proxy': out }) }))
      .toEqual({ url: 'http://127.0.0.1:7890', source: 'macOS 系统代理', bypass: ['*.local', '169.254/16'] })
  })

  it('reads GNOME manual proxies and returns null when nothing is set', async () => {
    const gnome = run({
      'gsettings get org.gnome.system.proxy mode': "'manual'\n",
      'gsettings get org.gnome.system.proxy.https host': "'proxy.lan'\n",
      'gsettings get org.gnome.system.proxy.https port': '3128\n',
    })
    expect((await detectSystemProxy({ env: {}, platform: 'linux', run: gnome }))?.url).toBe('http://proxy.lan:3128')
    expect(await detectSystemProxy({ env: {}, platform: 'linux', run: run({}) })).toBeNull()
  })

  it('normalizes addresses', () => {
    expect(normalizeProxyAddress('127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(normalizeProxyAddress('ftp://x:1')).toBeUndefined()
    expect(normalizeProxyAddress(' ')).toBeUndefined()
  })
})
