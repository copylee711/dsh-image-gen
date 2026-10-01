/** The Host-side services the routes and tools share. */
import type { ImageAttachmentRef, ImageMediaType, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { KeyStore } from './credentials.js'
import type { GalleryDb } from './gallery-db.js'
import type { AttachmentJson } from './gallery-types.js'
import { resolveImageDir, writeImageCopy, type Launcher } from './image-files.js'
import { runGeneration, type GenerationRequest, type GenerationResult } from './generate.js'
import type { FetchLike } from './http.js'
import type { SettingsStore } from './settings-store.js'
import { requireProvider } from './settings-store.js'
import type { ProviderEntry, SettingsView } from './shared.js'

export interface AttachmentService {
  readonly imageLimits: { maxImageBytes: number; maxImageDimension?: number; mediaTypes: readonly string[] }
  saveImage(input: { data: Uint8Array; mediaType: ImageMediaType; name?: string }): Promise<ImageAttachmentRef>
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

export interface PluginServices {
  settings: SettingsStore
  keys: KeyStore
  gallery: GalleryDb
  attachments: AttachmentService
  /** Tests inject a fake network. */
  fetch?: FetchLike
  /** Plugin data folder (settings, gallery, default image folder). */
  dataDir: string
  /** Opens the OS file manager; tests inject a recorder. */
  launch?: Launcher
}

/** Settings as the browser may see them: key presence instead of keys. */
export async function settingsView(services: PluginServices): Promise<SettingsView> {
  const settings = await services.settings.get()
  const providers = await Promise.all(settings.providers.map(async entry => ({
    ...entry,
    keyConfigured: await services.keys.get(entry.id).then(value => value !== undefined, () => false),
  })))
  const limits = services.attachments.imageLimits
  return {
    ...settings,
    providers,
    effectiveImageDir: resolveImageDir(settings.imageDir, services.dataDir),
    imageLimits: {
      maxImageBytes: limits.maxImageBytes,
      ...(limits.maxImageDimension === undefined ? {} : { maxImageDimension: limits.maxImageDimension }),
      mediaTypes: [...limits.mediaTypes],
    },
  }
}

/** The folder image copies currently go to. */
export async function imageDir(services: PluginServices): Promise<string> {
  return resolveImageDir((await services.settings.get()).imageDir, services.dataDir)
}

/**
 * Write the readable copy for one gallery image. Never fails the caller:
 * a disk problem just leaves the item without `filePath`.
 */
export async function saveImageCopy(services: PluginServices, attachment: AttachmentJson, data: Uint8Array, prompt: string): Promise<string | undefined> {
  try {
    return await writeImageCopy(await imageDir(services), attachment, data, prompt)
  } catch {
    return undefined
  }
}

export async function requireKey(services: PluginServices, entry: ProviderEntry): Promise<string> {
  const key = await services.keys.get(entry.id)
  if (key === undefined) throw new Error(`${entry.name} 尚未配置 API Key，请到 设置 > 插件 > 图像生成 填写。(${entry.name} has no API key; set it in Settings > Plugins > Image generation.)`)
  return key
}

export function toAttachmentJson(ref: ImageAttachmentRef): AttachmentJson {
  return {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
    ...(ref.originalDimensions === undefined ? {} : { originalDimensions: { width: ref.originalDimensions.width, height: ref.originalDimensions.height } }),
  }
}

/** Generate one image with a provider and persist it as an attachment. */
export async function generateAndStore(
  services: PluginServices,
  providerId: string | undefined,
  request: GenerationRequest,
  signal: AbortSignal,
): Promise<{ entry: ProviderEntry; result: GenerationResult; attachment: ImageAttachmentRef }> {
  const settings = await services.settings.get()
  const entry = requireProvider(settings, providerId)
  const apiKey = await requireKey(services, entry)
  const result = await runGeneration({
    entry,
    apiKey,
    globalProxy: settings.proxy,
    request,
    maxBytes: services.attachments.imageLimits.maxImageBytes,
    signal,
    ...(services.fetch === undefined ? {} : { fetch: services.fetch }),
  })
  if (!services.attachments.imageLimits.mediaTypes.includes(result.mediaType)) {
    throw new Error(`This DSH deployment does not accept ${result.mediaType} images`)
  }
  const attachment = await services.attachments.saveImage({ data: result.data, mediaType: result.mediaType, name: 'generated-image' })
  return { entry, result, attachment }
}
