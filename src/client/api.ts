/** Browser wrappers for the plugin's Host routes. */
import type { AttachmentJson, FavoritePrompt, GalleryItem, GalleryPage, GalleryProject, GalleryQuery } from '../gallery-types.js'
import {
  GALLERY_ROUTE,
  IMAGE_ROUTE,
  IMPORT_ROUTE,
  KEY_ROUTE,
  MODELS_ROUTE,
  PAINT_ROUTE,
  PROXY_STATUS_ROUTE,
  SETTINGS_ROUTE,
  TEST_ROUTE,
  type GlobalProxy,
  type PluginSettings,
  type ProviderEntry,
  type SettingsView,
} from '../shared.js'

export type ProjectSummary = GalleryProject & { count: number; cover?: AttachmentJson }

async function call<T>(url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    ...init,
  })
  const text = await response.text()
  let payload: unknown
  try {
    payload = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    // A reverse proxy cut or HTML error page: surface a readable message.
    throw new Error(response.status === 504 ? '请求超时（反向代理中断），请重试' : `请求失败（HTTP ${String(response.status)}）`)
  }
  if (!response.ok) {
    const message = (payload as { error?: unknown }).error
    throw new Error(typeof message === 'string' ? message : `请求失败（HTTP ${String(response.status)}）`)
  }
  return payload as T
}

/** `<img src>` for one durable attachment. */
export function imageUrl(attachment: AttachmentJson): string {
  return `${IMAGE_ROUTE}?ref=${encodeURIComponent(JSON.stringify(attachment))}`
}

export const api = {
  settings: () => call<SettingsView>(SETTINGS_ROUTE),
  saveSettings: (settings: PluginSettings) => call<SettingsView>(SETTINGS_ROUTE, { settings }),
  setKey: (providerId: string, key: string) => call<{ ok: boolean; keyConfigured: boolean }>(KEY_ROUTE, { providerId, key }),
  test: (input: { providerId: string; entry?: ProviderEntry; key?: string; proxy?: GlobalProxy }) =>
    call<{ ok: boolean; message: string; latencyMs?: number }>(TEST_ROUTE, input),
  testProxy: (proxyUrl: string) => call<{ ok: boolean; message: string; latencyMs?: number }>(TEST_ROUTE, { proxyUrl }),
  models: (input: { providerId: string; entry?: ProviderEntry; key?: string }) =>
    call<{ models: string[]; imageModels: string[]; total: number }>(MODELS_ROUTE, input),
  proxyStatus: () => call<{ system: { url: string; source: string; bypass: string[] } | null }>(PROXY_STATUS_ROUTE),
  paint: (input: {
    providerId: string
    model?: string
    prompt: string
    negativePrompt?: string
    aspectRatio?: string
    imageSize?: string
    /** Explicit `WxH`; wins over ratio / tier. */
    size?: string
    quality?: string
    seed?: number
    count: number
    references: AttachmentJson[]
    projectId: string
  }, signal?: AbortSignal) => call<{ items: GalleryItem[]; failures: string[] }>(PAINT_ROUTE, input, signal === undefined ? {} : { signal }),
  importImages: (images: Array<{ data: string; mediaType: string; name?: string }>) =>
    call<{ images: Array<{ attachment: AttachmentJson }>; failures: Array<{ index: number; error: string }> }>(IMPORT_ROUTE, { images }),
  gallery: {
    revision: () => call<{ revision: number }>(GALLERY_ROUTE, { op: 'revision' }),
    projects: () => call<{ revision: number; projects: ProjectSummary[] }>(GALLERY_ROUTE, { op: 'projects' }),
    list: (query: GalleryQuery) => call<GalleryPage & { revision: number }>(GALLERY_ROUTE, { op: 'list', ...query }),
    update: (ids: string[], patch: { favorite?: boolean; projectId?: string }) => call<{ changed: number }>(GALLERY_ROUTE, { op: 'update', ids, ...patch }),
    remove: (ids: string[]) => call<{ removed: number }>(GALLERY_ROUTE, { op: 'remove', ids }),
    createProject: (name: string) => call<{ project: GalleryProject }>(GALLERY_ROUTE, { op: 'createProject', name }),
    renameProject: (id: string, name: string) => call<unknown>(GALLERY_ROUTE, { op: 'renameProject', id, name }),
    deleteProject: (id: string, deleteItems: boolean) => call<unknown>(GALLERY_ROUTE, { op: 'deleteProject', id, deleteItems }),
    reorderProjects: (ids: string[]) => call<unknown>(GALLERY_ROUTE, { op: 'reorderProjects', ids }),
    favoritePrompts: () => call<{ prompts: FavoritePrompt[] }>(GALLERY_ROUTE, { op: 'favoritePrompts' }),
    addFavoritePrompt: (text: string) => call<{ prompt: FavoritePrompt }>(GALLERY_ROUTE, { op: 'addFavoritePrompt', text }),
    updateFavoritePrompt: (id: string, text: string) => call<{ prompt: FavoritePrompt }>(GALLERY_ROUTE, { op: 'updateFavoritePrompt', id, text }),
    reveal: (id: string) => call<{ path: string }>(GALLERY_ROUTE, { op: 'reveal', id }),
    openFolder: () => call<{ path: string }>(GALLERY_ROUTE, { op: 'openFolder' }),
    removeFavoritePrompt: (id: string) => call<unknown>(GALLERY_ROUTE, { op: 'removeFavoritePrompt', id }),
    importAttachments: (attachments: AttachmentJson[], projectId: string) => call<{ items: GalleryItem[] }>(GALLERY_ROUTE, { op: 'import', attachments, projectId }),
  },
}

/** Read a picked file as base64 (no data: prefix). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** Host upload limits as the settings view reports them. */
export interface UploadLimits {
  maxImageBytes: number
  maxImageDimension?: number
  mediaTypes: readonly string[]
}

/** Load a blob into a canvas-drawable bitmap (null when the browser cannot decode it). */
async function decode(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

/**
 * Make one picked/pasted image fit the host's upload limits: an accepted
 * type, at most `maxImageDimension` per side and `maxImageBytes` in size.
 * Images that already fit are uploaded untouched; others are redrawn and
 * re-encoded (WebP when accepted, keeping transparency, else JPEG), shrinking
 * further until they fit.
 */
export async function fitImage(file: Blob, limits: UploadLimits | undefined): Promise<Blob> {
  if (limits === undefined) return file
  const typeOk = limits.mediaTypes.includes(file.type)
  const bytesOk = file.size <= limits.maxImageBytes
  const maxSide = limits.maxImageDimension
  const bitmap = typeOk && bytesOk && maxSide === undefined ? null : await decode(file)
  if (bitmap === null) return file
  const dimsOk = maxSide === undefined || (bitmap.width <= maxSide && bitmap.height <= maxSide)
  if (typeOk && bytesOk && dimsOk) {
    bitmap.close?.()
    return file
  }
  const target = limits.mediaTypes.includes('image/webp') ? 'image/webp' : limits.mediaTypes.includes('image/jpeg') ? 'image/jpeg' : 'image/png'
  let scale = maxSide === undefined ? 1 : Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  let quality = 0.9
  let best: Blob = file
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await encode(canvas, target, quality)
    if (blob === null) break
    best = blob
    if (blob.size <= limits.maxImageBytes) break
    scale *= 0.8
    quality = 0.82
  }
  bitmap.close?.()
  return best
}

/** Human-readable text for the import route's per-image error codes. */
export function describeUploadError(code: string, limits?: UploadLimits): string {
  if (code.startsWith('size-out-of-range')) {
    return limits === undefined ? '图片过大' : `图片过大（上限 ${(limits.maxImageBytes / 1024 / 1024).toFixed(0)} MB）`
  }
  if (code.startsWith('unsupported-media-type')) return `不支持的图片格式${code.includes(':') ? `（${code.split(':')[1]!.trim()}）` : ''}`
  if (code === 'invalid-base64' || code === 'invalid-item') return '图片数据无效'
  if (code === 'save-failed') return '图片保存失败'
  return code
}

/** Upload picked files as durable attachments, shrinking them to the host limits first. */
export async function uploadFiles(files: readonly File[], limits?: UploadLimits): Promise<AttachmentJson[]> {
  const images = await Promise.all(files.map(async file => {
    const blob = await fitImage(file, limits)
    return { data: await fileToBase64(blob), mediaType: blob.type || 'image/png', name: file.name }
  }))
  let result: Awaited<ReturnType<typeof api.importImages>>
  try {
    result = await api.importImages(images)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`上传失败：${describeUploadError(message, limits)}`)
  }
  if (result.images.length === 0 && result.failures.length > 0) {
    throw new Error(`上传失败：${[...new Set(result.failures.map(failure => describeUploadError(failure.error, limits)))].join('，')}`)
  }
  return result.images.map(image => image.attachment)
}

/** Save an image to the user's disk. */
export async function downloadImage(attachment: AttachmentJson, baseName = 'image'): Promise<void> {
  const response = await fetch(imageUrl(attachment), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${String(response.status)}）`)
  const blob = await response.blob()
  const ext = attachment.mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${baseName}.${ext}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Copy an image to the clipboard as PNG (the format browsers accept). */
export async function copyImage(attachment: AttachmentJson): Promise<void> {
  const response = await fetch(imageUrl(attachment), { credentials: 'same-origin' })
  let blob = await response.blob()
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value === null ? reject(new Error('encode failed')) : resolve(value), 'image/png'))
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
