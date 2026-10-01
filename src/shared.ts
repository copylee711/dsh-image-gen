/**
 * Constants and types shared by the Host bundle and the browser bundle.
 *
 * Nothing here may import a Node-only module: the client bundle pulls this
 * file in for route paths, protocol capabilities and the provider presets.
 */

/** npm package name; DSH's module loader and plugin loader key the plugin by it. */
export const PACKAGE_NAME = '@copylee/dsh-image-gen'
/**
 * Internal slug: route prefix, credential record scope, storage folder and
 * browser storage prefix. Distinct from shanliuling/dsh-image-gen's
 * `dsh-image-gen` so both plugins can be installed side by side.
 */
export const PLUGIN_SLUG = 'copylee-image-gen'

const ROUTE_BASE = `/plugins/${PLUGIN_SLUG}`
/** Serve one durable attachment image to the browser. */
export const IMAGE_ROUTE = `${ROUTE_BASE}/image`
/** Turn browser-picked files into durable attachments. */
export const IMPORT_ROUTE = `${ROUTE_BASE}/import`
/** Read/write plugin settings (providers, proxy, storage); never returns keys. */
export const SETTINGS_ROUTE = `${ROUTE_BASE}/settings`
/** Set or clear one provider's API key. */
export const KEY_ROUTE = `${ROUTE_BASE}/key`
/** Probe one provider (or the proxy) for reachability. */
export const TEST_ROUTE = `${ROUTE_BASE}/test`
/** List a provider's models through its `/models` endpoint. */
export const MODELS_ROUTE = `${ROUTE_BASE}/models`
/** Generate from the paintings page. */
export const PAINT_ROUTE = `${ROUTE_BASE}/paint`
/** Detected system proxy for the settings page. */
export const PROXY_STATUS_ROUTE = `${ROUTE_BASE}/proxy-status`
/** Global gallery (projects, items, favorite prompts). Prefix route. */
export const GALLERY_ROUTE = `${ROUTE_BASE}/gallery`

/** Wire protocols a provider entry can speak. Each maps to one adapter. */
export const PROVIDER_PROTOCOLS = [
  'gemini',
  'openai',
  'openai-compat',
  'modelscope',
  'siliconflow',
  'seedream',
  'dashscope',
  'xai',
  'zhipu',
] as const
export type ProviderProtocol = typeof PROVIDER_PROTOCOLS[number]

/** Human names for the protocol picker. */
export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI Images',
  'openai-compat': 'OpenAI 兼容',
  modelscope: 'ModelScope 魔搭',
  siliconflow: 'SiliconFlow 硅基流动',
  seedream: '火山方舟 Seedream',
  dashscope: '阿里云百炼 DashScope',
  xai: 'xAI Grok Imagine',
  zhipu: '智谱 GLM-Image',
}

/** How one provider entry reaches the network. */
export type ProxyMode = 'inherit' | 'direct' | 'system' | 'custom'

/** Plugin-wide proxy mode. */
export type GlobalProxyMode = 'off' | 'system' | 'custom'

export interface ProviderProxy {
  mode: ProxyMode
  /** Only read when `mode` is `custom`: `http://`, `https://`, `socks5://` or `socks5h://`. */
  url?: string
}

/** OpenAI-compatible relay quirks (edit body shape and size table). */
export interface CompatOptions {
  editFormat?: 'multipart' | 'jsonImageUrlArray' | 'formReferenceImages'
  editExtra?: Record<string, unknown>
  /** `ratio → tier → exact size`, e.g. `{ "16:9": { "2K": "2048x1152" } }`. */
  sizes?: Record<string, Record<string, string>>
}

/** One configured image provider: a preset or a user-added endpoint. */
export interface ProviderEntry {
  /** Stable id; also the credential record id. `[a-z0-9-]`, ≤ 48 chars. */
  id: string
  name: string
  protocol: ProviderProtocol
  /** Base URL (or the full endpoint for `gemini`). */
  baseURL: string
  /** Models offered in the pickers; the first one is used when `defaultModel` is blank. */
  models: string[]
  defaultModel: string
  enabled: boolean
  proxy: ProviderProxy
  /** True for shipped presets: editable and disableable but not deletable. */
  preset?: boolean
  compat?: CompatOptions
  /** Ark (Seedream) output controls. */
  ark?: ArkOutputOptions
}

/** Plugin-wide proxy. */
export interface GlobalProxy {
  /** off = direct, system = OS/env proxy (auto-detected), custom = `url`. */
  mode: GlobalProxyMode
  /** Derived from `mode` (kept for settings written by older versions). */
  enabled: boolean
  url: string
  /** Hosts that bypass the proxy: exact host, `.suffix`, `*.suffix`, or `*`. */
  noProxy: string[]
}

/** Every persisted setting except API keys. */
export interface PluginSettings {
  version: 1
  providers: ProviderEntry[]
  /** Provider used by the Agent tools when a call names none. */
  activeProvider: string
  proxy: GlobalProxy
  /** Also write images generated in a conversation under that session's workspace. */
  saveToWorkspace: boolean
  workspaceFolder: string
  /** Folder for readable gallery image copies; '' = `<dataDir>/images`. */
  imageDir: string
}

/** Provider entry as the browser sees it: adds key state, never the key. */
export interface ProviderView extends ProviderEntry {
  keyConfigured: boolean
}

export interface SettingsView extends Omit<PluginSettings, 'providers'> {
  providers: ProviderView[]
  /** Folder actually used for image copies (resolved default when imageDir is empty). */
  effectiveImageDir: string
  /** Host upload limits, so the browser can shrink images before uploading. */
  imageLimits?: { maxImageBytes: number; maxImageDimension?: number; mediaTypes: string[] }
}

export const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9'] as const
export const IMAGE_SIZES = ['1K', '2K', '4K'] as const
export type AspectRatio = typeof ASPECT_RATIOS[number]
export type ImageSize = typeof IMAGE_SIZES[number]

/** Ark (Seedream) output controls; every default reproduces Ark's own default. */
export interface ArkOutputOptions {
  outputFormat?: 'png' | 'jpeg'
  watermark?: boolean
  background?: 'opaque' | 'transparent'
}

/**
 * Map the Ark output controls onto request-body fields. `background` is
 * opt-in per call site: Ark accepts `transparent` only on the edit path.
 */
export function arkOutputBody(
  options: ArkOutputOptions | undefined,
  { background = true }: { background?: boolean } = {},
): Record<string, unknown> {
  if (options === undefined) return {}
  const body: Record<string, unknown> = {}
  if (options.outputFormat !== undefined) body.output_format = options.outputFormat
  if (options.watermark !== undefined) body.watermark = options.watermark
  if (background && options.background === 'transparent') body.background = 'transparent'
  return body
}

/** Shipped provider presets. Ids are stable: keys and settings refer to them. */
export const PRESET_PROVIDERS: readonly ProviderEntry[] = [
  {
    id: 'modelscope', name: 'ModelScope 魔搭', protocol: 'modelscope',
    baseURL: 'https://api-inference.modelscope.cn/v1',
    models: ['Qwen/Qwen-Image', 'Qwen/Qwen-Image-Edit', 'black-forest-labs/FLUX.1-Krea-dev', 'MusePublic/489_ckpt_FLUX_1'],
    defaultModel: 'Qwen/Qwen-Image', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'google', name: 'Google Gemini', protocol: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/interactions',
    models: ['gemini-3.1-flash-image', 'gemini-3-pro-image'],
    defaultModel: 'gemini-3.1-flash-image', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'openai', name: 'OpenAI', protocol: 'openai',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-image-2', 'gpt-image-1'],
    defaultModel: 'gpt-image-2', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'siliconflow', name: '硅基流动 SiliconFlow', protocol: 'siliconflow',
    baseURL: 'https://api.siliconflow.cn/v1',
    models: ['Kwai-Kolors/Kolors', 'Qwen/Qwen-Image', 'Qwen/Qwen-Image-Edit'],
    defaultModel: 'Kwai-Kolors/Kolors', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'seedream', name: '火山方舟 Seedream', protocol: 'seedream',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seedream-5-0-260128', 'doubao-seedream-4-0-250828'],
    defaultModel: 'doubao-seedream-5-0-260128', enabled: true, proxy: { mode: 'inherit' }, preset: true,
    ark: { outputFormat: 'jpeg', watermark: true, background: 'opaque' },
  },
  {
    id: 'dashscope', name: '阿里云百炼 DashScope', protocol: 'dashscope',
    baseURL: 'https://dashscope.aliyuncs.com/api/v1',
    models: ['qwen-image-3.0', 'qwen-image-edit'],
    defaultModel: 'qwen-image-3.0', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'xai', name: 'xAI Grok Imagine', protocol: 'xai',
    baseURL: 'https://api.x.ai/v1',
    models: ['grok-imagine-image'],
    defaultModel: 'grok-imagine-image', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'zhipu', name: '智谱 GLM-Image', protocol: 'zhipu',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-image', 'cogview-4'],
    defaultModel: 'glm-image', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'together', name: 'Together AI', protocol: 'openai-compat',
    baseURL: 'https://api.together.xyz/v1',
    models: ['black-forest-labs/FLUX.1-schnell', 'black-forest-labs/FLUX.1.1-pro'],
    defaultModel: 'black-forest-labs/FLUX.1-schnell', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
  {
    id: 'openai-compat', name: 'OpenAI 兼容（中转站）', protocol: 'openai-compat',
    baseURL: '', models: [], defaultModel: '', enabled: true, proxy: { mode: 'inherit' }, preset: true,
  },
]

/** Default settings for a fresh install. */
export function defaultSettings(): PluginSettings {
  return {
    version: 1,
    providers: PRESET_PROVIDERS.map(entry => structuredClone(entry)),
    activeProvider: 'modelscope',
    proxy: { mode: 'off', enabled: false, url: '', noProxy: ['localhost', '127.0.0.1', '::1'] },
    saveToWorkspace: true,
    workspaceFolder: PLUGIN_SLUG,
    imageDir: '',
  }
}

/** The model a call should use: an explicit override, the default, then the first listed. */
export function effectiveModel(entry: ProviderEntry, override?: string): string {
  const requested = override?.trim()
  if (requested !== undefined && requested.length > 0) return requested
  const fallback = entry.defaultModel.trim() || entry.models[0]?.trim() || ''
  return fallback
}

/** One choice in a size picker. */
export interface SizeOption {
  /** Wire value (`1024x1024`, `2K`, ...). */
  value: string
  label: string
}

/** What the paintings page can ask a protocol for. */
export interface ProtocolCapabilities {
  /** Aspect ratios; empty when the protocol takes pixel sizes only. */
  ratios: readonly string[]
  /** Resolution tiers (Gemini/xAI); empty when the protocol has none. */
  tiers: readonly string[]
  /** Pixel or tier sizes keyed by ratio (OpenAI family, ModelScope...). */
  sizes?: Readonly<Record<string, string>>
  /** Max reference images for editing; 0 = no editing. */
  maxReferences: number
  /** Max images per request the paintings page may ask for. */
  maxCount: number
  /** Explicit `WxH` sizes the protocol accepts; absent = ratio/tier only. */
  customSize?: SizeRange
}

/** Pixel bounds and alignment for explicit `WxH` sizes. */
export interface SizeRange {
  min: number
  max: number
  step: number
}

/** Long-side presets offered next to the standard size. */
export const RESOLUTION_PRESETS = [
  { id: '1k', label: '1K', longSide: 1024 },
  { id: '1.5k', label: '1.5K', longSide: 1536 },
  { id: '2k', label: '2K', longSide: 2048 },
] as const

/** Clamp one dimension into the range and onto the step grid. */
export function clampDimension(value: number, range: SizeRange): number {
  const safe = Number.isFinite(value) ? value : range.min
  const stepped = Math.round(safe / range.step) * range.step
  return Math.min(Math.floor(range.max / range.step) * range.step, Math.max(Math.ceil(range.min / range.step) * range.step, stepped))
}

/**
 * `WxH` for an aspect ratio and a long side, both dimensions aligned to
 * `step` (and clamped into `range` when given): 16:9 @ 2048 / 16 → 2048x1152.
 */
export function sizeForRatio(ratio: string, longSide: number, step: number, range?: SizeRange): { width: number; height: number } {
  const [rw, rh] = ratio.split(':').map(Number)
  const w = rw !== undefined && rw > 0 ? rw : 1
  const h = rh !== undefined && rh > 0 ? rh : 1
  const scale = longSide / Math.max(w, h)
  const align = (value: number): number => {
    const aligned = Math.max(step, Math.round(value / step) * step)
    return range === undefined ? aligned : clampDimension(aligned, range)
  }
  return { width: align(w * scale), height: align(h * scale) }
}

/** Parse `WxH` / `W*H`; undefined when malformed. */
export function parseSize(value: string | undefined): { width: number; height: number } | undefined {
  const match = /^\s*(\d{2,5})\s*[x*×]\s*(\d{2,5})\s*$/i.exec(value ?? '')
  return match === null ? undefined : { width: Number(match[1]), height: Number(match[2]) }
}

const OPENAI_SIZES: Record<string, string> = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' }
const SQUARE_FAMILY_SIZES: Record<string, string> = {
  '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152', '3:2': '1248x832', '2:3': '832x1248', '16:9': '1280x720', '9:16': '720x1280',
}

export const PROTOCOL_CAPABILITIES: Record<ProviderProtocol, ProtocolCapabilities> = {
  gemini: { ratios: ASPECT_RATIOS, tiers: IMAGE_SIZES, maxReferences: 14, maxCount: 4 },
  openai: { ratios: Object.keys(OPENAI_SIZES), tiers: [], sizes: OPENAI_SIZES, maxReferences: 16, maxCount: 4, customSize: { min: 256, max: 4096, step: 16 } },
  'openai-compat': { ratios: Object.keys(OPENAI_SIZES), tiers: [], sizes: OPENAI_SIZES, maxReferences: 16, maxCount: 4, customSize: { min: 256, max: 4096, step: 16 } },
  modelscope: { ratios: Object.keys(SQUARE_FAMILY_SIZES), tiers: [], sizes: SQUARE_FAMILY_SIZES, maxReferences: 1, maxCount: 4, customSize: { min: 64, max: 2048, step: 16 } },
  siliconflow: { ratios: Object.keys(SQUARE_FAMILY_SIZES), tiers: [], sizes: SQUARE_FAMILY_SIZES, maxReferences: 1, maxCount: 4, customSize: { min: 256, max: 2048, step: 32 } },
  seedream: {
    ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], tiers: ['2K', '4K'],
    maxReferences: 10, maxCount: 4, customSize: { min: 1024, max: 4096, step: 16 },
  },
  dashscope: {
    ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'], tiers: [],
    sizes: { '1:1': '1328*1328', '4:3': '1472*1104', '3:4': '1104*1472', '16:9': '1664*928', '9:16': '928*1664' },
    maxReferences: 3, maxCount: 4, customSize: { min: 512, max: 2048, step: 16 },
  },
  xai: { ratios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'], tiers: ['1K', '2K'], maxReferences: 5, maxCount: 4 },
  zhipu: {
    ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'], tiers: [],
    sizes: { '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152', '16:9': '1344x768', '9:16': '768x1344' },
    maxReferences: 0, maxCount: 4, customSize: { min: 512, max: 2048, step: 32 },
  },
}

/** Capabilities of one entry, honouring an OpenAI-compatible relay's own size table. */
export function capabilitiesOf(entry: Pick<ProviderEntry, 'protocol' | 'compat'>): ProtocolCapabilities {
  const base = PROTOCOL_CAPABILITIES[entry.protocol]
  const table = entry.compat?.sizes
  if (entry.protocol !== 'openai-compat' || table === undefined || Object.keys(table).length === 0) return base
  const ratios = Object.keys(table)
  const tiers = [...new Set(ratios.flatMap(ratio => Object.keys(table[ratio] ?? {})))]
  return { ...base, ratios, tiers, sizes: undefined as never }
}

/**
 * Resolve the wire size for one request. Returns `{ size }` for pixel-size
 * protocols, `{ aspectRatio, imageSize }` for tier protocols.
 */
export function resolveSize(
  entry: Pick<ProviderEntry, 'protocol' | 'compat'>,
  request: { aspectRatio?: string | undefined; imageSize?: string | undefined; size?: string | undefined },
): { size?: string; aspectRatio?: string; imageSize?: string } {
  if (request.size !== undefined && request.size.trim().length > 0) {
    return { size: request.size.trim() }
  }
  const caps = capabilitiesOf(entry)
  const ratio = request.aspectRatio !== undefined && caps.ratios.includes(request.aspectRatio) ? request.aspectRatio : undefined
  const table = entry.protocol === 'openai-compat' ? entry.compat?.sizes : undefined
  if (table !== undefined && Object.keys(table).length > 0) {
    const row = table[ratio ?? Object.keys(table)[0]!] ?? {}
    const tier = request.imageSize !== undefined && row[request.imageSize] !== undefined ? request.imageSize : Object.keys(row)[0]
    const size = tier === undefined ? undefined : row[tier]
    return size === undefined ? {} : { size }
  }
  if (caps.sizes !== undefined) {
    const size = caps.sizes[ratio ?? caps.ratios[0] ?? '1:1']
    return size === undefined ? {} : { size }
  }
  const tier = request.imageSize !== undefined && caps.tiers.includes(request.imageSize) ? request.imageSize : undefined
  return {
    ...(ratio === undefined ? {} : { aspectRatio: ratio }),
    ...(tier === undefined ? {} : { imageSize: tier }),
  }
}
