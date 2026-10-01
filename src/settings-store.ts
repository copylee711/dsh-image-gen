/** Persisted plugin settings: providers, proxy and workspace saving. */
import { join } from 'node:path'
import {
  PRESET_PROVIDERS,
  PROVIDER_PROTOCOLS,
  defaultSettings,
  type CompatOptions,
  type GlobalProxyMode,
  type PluginSettings,
  type ProviderEntry,
  type ProviderProtocol,
  type ProxyMode,
} from './shared.js'
import { validateProxyUrl } from './http.js'
import { Mutex, readJson, writeJson } from './storage.js'

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,47}$/

/** Coerce untrusted JSON (disk or browser) into valid settings. Unknown fields drop. */
export function normalizeSettings(raw: unknown): PluginSettings {
  const base = defaultSettings()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base
  const input = raw as Record<string, unknown>
  const seen = new Set<string>()
  const providers: ProviderEntry[] = []
  if (Array.isArray(input.providers)) {
    for (const candidate of input.providers) {
      const entry = normalizeProvider(candidate)
      if (entry === undefined || seen.has(entry.id)) continue
      seen.add(entry.id)
      providers.push(entry)
    }
  }
  // Presets always exist: a newly shipped preset appears for old installs,
  // and a stored preset keeps the user's edits but regains its preset flag.
  for (const preset of PRESET_PROVIDERS) {
    const index = providers.findIndex(entry => entry.id === preset.id)
    if (index === -1) providers.push(structuredClone(preset))
    else providers[index] = { ...providers[index]!, preset: true }
  }
  const proxyRaw = typeof input.proxy === 'object' && input.proxy !== null ? input.proxy as Record<string, unknown> : {}
  const activeProvider = typeof input.activeProvider === 'string' && providers.some(entry => entry.id === input.activeProvider)
    ? input.activeProvider
    : base.activeProvider
  return {
    version: 1,
    providers,
    activeProvider,
    proxy: {
      ...globalProxyMode(proxyRaw),
      url: typeof proxyRaw.url === 'string' ? proxyRaw.url.trim() : '',
      noProxy: Array.isArray(proxyRaw.noProxy)
        ? proxyRaw.noProxy.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item.length > 0)
        : base.proxy.noProxy,
    },
    chatTools: typeof input.chatTools === 'boolean' ? input.chatTools : base.chatTools,
    saveToWorkspace: typeof input.saveToWorkspace === 'boolean' ? input.saveToWorkspace : base.saveToWorkspace,
    workspaceFolder: typeof input.workspaceFolder === 'string' ? input.workspaceFolder.trim() : base.workspaceFolder,
    imageDir: typeof input.imageDir === 'string' ? input.imageDir.trim() : base.imageDir,
  }
}

function normalizeProvider(raw: unknown): ProviderEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const input = raw as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : ''
  if (!PROVIDER_ID.test(id)) return undefined
  const protocol = typeof input.protocol === 'string' && (PROVIDER_PROTOCOLS as readonly string[]).includes(input.protocol)
    ? input.protocol as ProviderProtocol
    : undefined
  if (protocol === undefined) return undefined
  const preset = PRESET_PROVIDERS.find(entry => entry.id === id)
  // A preset's protocol is fixed: its id names that protocol's wire format.
  const effectiveProtocol = preset?.protocol ?? protocol
  const models = Array.isArray(input.models)
    ? [...new Set(input.models.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item.length > 0))]
    : []
  const proxyRaw = typeof input.proxy === 'object' && input.proxy !== null ? input.proxy as Record<string, unknown> : {}
  const mode: ProxyMode = proxyRaw.mode === 'direct' || proxyRaw.mode === 'custom' || proxyRaw.mode === 'system' ? proxyRaw.mode : 'inherit'
  const proxyUrl = typeof proxyRaw.url === 'string' ? proxyRaw.url.trim() : ''
  const entry: ProviderEntry = {
    id,
    name: typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim().slice(0, 64) : preset?.name ?? id,
    protocol: effectiveProtocol,
    baseURL: typeof input.baseURL === 'string' ? input.baseURL.trim() : preset?.baseURL ?? '',
    models,
    defaultModel: typeof input.defaultModel === 'string' ? input.defaultModel.trim() : '',
    enabled: input.enabled !== false,
    proxy: mode === 'custom' ? { mode, url: proxyUrl } : { mode },
  }
  const compat = normalizeCompat(input.compat)
  if (compat !== undefined && effectiveProtocol === 'openai-compat') entry.compat = compat
  if (effectiveProtocol === 'seedream' && typeof input.ark === 'object' && input.ark !== null) {
    const ark = input.ark as Record<string, unknown>
    entry.ark = {
      ...(ark.outputFormat === 'png' || ark.outputFormat === 'jpeg' ? { outputFormat: ark.outputFormat } : {}),
      ...(typeof ark.watermark === 'boolean' ? { watermark: ark.watermark } : {}),
      ...(ark.background === 'opaque' || ark.background === 'transparent' ? { background: ark.background } : {}),
    }
  }
  return entry
}

function normalizeCompat(raw: unknown): CompatOptions | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const input = raw as Record<string, unknown>
  const out: CompatOptions = {}
  if (input.editFormat === 'multipart' || input.editFormat === 'jsonImageUrlArray' || input.editFormat === 'formReferenceImages') out.editFormat = input.editFormat
  if (typeof input.editExtra === 'object' && input.editExtra !== null && !Array.isArray(input.editExtra)) out.editExtra = input.editExtra as Record<string, unknown>
  if (typeof input.sizes === 'object' && input.sizes !== null && !Array.isArray(input.sizes)) {
    const sizes: Record<string, Record<string, string>> = {}
    for (const [ratio, row] of Object.entries(input.sizes as Record<string, unknown>)) {
      if (typeof row !== 'object' || row === null) continue
      const tiers: Record<string, string> = {}
      for (const [tier, size] of Object.entries(row as Record<string, unknown>)) {
        if (typeof size === 'string' && size.trim().length > 0) tiers[tier] = size.trim()
      }
      if (Object.keys(tiers).length > 0) sizes[ratio] = tiers
    }
    out.sizes = sizes
  }
  return out
}

/**
 * Global proxy mode with migration: settings from ≤0.1.2 only had
 * `enabled` (+ url), which meant a custom proxy when on.
 */
function globalProxyMode(raw: Record<string, unknown>): { mode: GlobalProxyMode; enabled: boolean } {
  const mode: GlobalProxyMode = raw.mode === 'off' || raw.mode === 'system' || raw.mode === 'custom'
    ? raw.mode
    : raw.enabled === true ? 'custom' : 'off'
  return { mode, enabled: mode !== 'off' }
}

/** Validation problems that should block a save (shown in the settings UI). */
export function validateSettings(settings: PluginSettings): string[] {
  const problems: string[] = []
  if (settings.proxy.mode === 'custom') {
    const problem = settings.proxy.url.length === 0 ? '已选择自定义代理但未填写代理地址' : validateProxyUrl(settings.proxy.url)
    if (problem !== undefined) problems.push(`全局代理：${problem}`)
  }
  for (const entry of settings.providers) {
    if (entry.proxy.mode === 'custom') {
      const problem = (entry.proxy.url ?? '').length === 0 ? '选择了自定义代理但未填写地址' : validateProxyUrl(entry.proxy.url ?? '')
      if (problem !== undefined) problems.push(`${entry.name}：${problem}`)
    }
    if (entry.baseURL.length > 0) {
      try {
        const url = new URL(entry.baseURL)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') problems.push(`${entry.name}：端点必须是 http(s) 地址`)
      } catch {
        problems.push(`${entry.name}：端点不是合法的 URL`)
      }
    }
  }
  if (settings.imageDir.length > 0 && !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(settings.imageDir)) {
    problems.push('图片保存目录必须是绝对路径')
  }
  return problems
}

/** Settings file owner. Reads are cached; writes are serialized and atomic. */
export class SettingsStore {
  private cached: PluginSettings | undefined
  private readonly mutex = new Mutex()
  private readonly listeners = new Set<(settings: PluginSettings) => void>()

  constructor(private readonly dir: string) {}

  get path(): string {
    return join(this.dir, 'settings.json')
  }

  async get(): Promise<PluginSettings> {
    if (this.cached !== undefined) return this.cached
    this.cached = normalizeSettings(await readJson(this.path))
    return this.cached
  }

  /** Replace settings with a normalized copy of `next`; throws on validation errors. */
  save(next: unknown): Promise<PluginSettings> {
    return this.mutex.run(async () => {
      const settings = normalizeSettings(next)
      const problems = validateSettings(settings)
      if (problems.length > 0) throw new Error(problems.join('；'))
      await writeJson(this.path, settings)
      this.cached = settings
      for (const listener of this.listeners) listener(settings)
      return settings
    })
  }

  onChange(listener: (settings: PluginSettings) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** Look up one enabled provider, or throw an Agent-readable error. */
export function requireProvider(settings: PluginSettings, id?: string): ProviderEntry {
  const wanted = id?.trim() || settings.activeProvider
  const entry = settings.providers.find(candidate => candidate.id === wanted)
    ?? settings.providers.find(candidate => candidate.name.toLowerCase() === wanted.toLowerCase())
  if (entry === undefined) {
    const known = settings.providers.filter(candidate => candidate.enabled).map(candidate => candidate.id).join(', ')
    throw new Error(`Unknown image provider "${wanted}". Configured providers: ${known}.`)
  }
  if (!entry.enabled) throw new Error(`Image provider "${entry.name}" is disabled in Settings > Plugins > 图像生成.`)
  if (entry.baseURL.length === 0) throw new Error(`Image provider "${entry.name}" has no endpoint; set its Base URL in Settings > Plugins > 图像生成.`)
  return entry
}
