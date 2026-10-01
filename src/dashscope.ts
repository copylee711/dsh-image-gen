/** DashScope Qwen Image generation and editing adapter. */
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { redactSecrets } from './redact.js'
import { detectImageMediaType } from './reference-image.js'
import type { FetchLike } from './http.js'

export interface DashScopeImageOptions {
  apiKey: string
  endpoint: string
  model: string
  prompt: string
  size?: string
  maxBytes: number
  signal?: AbortSignal
  /** Proxy-aware fetch; defaults to the global one. */
  fetch?: FetchLike
}

export interface DashScopeEditOptions extends DashScopeImageOptions {
  sourceImages: Array<{ data: Uint8Array; mediaType: ImageMediaType }>
}

interface DashScopeChoiceMessageContent {
  text?: string
  image?: string
  image_url?: string
  url?: string
}

interface DashScopeResponse {
  output?: {
    choices?: Array<{ message?: { content?: DashScopeChoiceMessageContent[] } }>
  }
  message?: string
  code?: string
}

export async function generateDashScopeImage(options: DashScopeImageOptions): Promise<{
  data: Uint8Array
  mediaType: ImageAttachmentRef['mediaType']
}> {
  assertQwenImageModel(options.model)
  const formattedSize = formatSize(options.size)
  return requestQwenImage({
    ...options,
    requestBody: {
      model: options.model,
      input: {
        messages: [{ role: 'user', content: [{ text: options.prompt }] }],
      },
      parameters: {
        ...(formattedSize === undefined ? {} : { size: formattedSize }),
      },
    },
    operation: 'generation',
  })
}

export async function editDashScopeImage(options: DashScopeEditOptions): Promise<{
  data: Uint8Array
  mediaType: ImageAttachmentRef['mediaType']
}> {
  if (options.sourceImages.length > 3) throw new Error(`DashScope image editing supports at most 3 reference images; this selection resolved ${options.sourceImages.length}. Select fewer images or choose a provider that supports more references. No images were omitted.`)
  assertQwenImageModel(options.model)
  const formattedSize = formatSize(options.size)
  return requestQwenImage({
    ...options,
    requestBody: {
      model: options.model,
      input: {
        messages: [{
          role: 'user',
          content: [
            ...options.sourceImages.map(sourceImage => ({ image: toDataUrl(sourceImage) })),
            { text: options.prompt },
          ],
        }],
      },
      parameters: {
        prompt_extend: true,
        ...(formattedSize === undefined ? {} : { size: formattedSize }),
      },
    },
    operation: 'editing',
  })
}

function assertQwenImageModel(model: string): void {
  if (!model.toLowerCase().startsWith('qwen-image')) {
    throw new Error(`Unsupported DashScope image model ${model}. Configure a qwen-image model.`)
  }
}

function formatSize(size: string | undefined): string | undefined {
  if (size === undefined || size.length === 0) return undefined
  return size.replace('x', '*')
}

function toDataUrl(image: { data: Uint8Array; mediaType: ImageMediaType }): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
}

async function requestQwenImage(options: DashScopeImageOptions & {
  requestBody: unknown
  operation: 'generation' | 'editing'
}): Promise<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }> {
  const base = options.endpoint.replace(/\/+$/, '')
  const response = await (options.fetch ?? fetch)(`${base}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    ...(options.signal ? { signal: options.signal } : {}),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(options.requestBody),
  })

  if (!response.ok) {
    const errorText = redactSecrets(await response.text(), options.apiKey)
    throw new Error(`DashScope image ${options.operation} failed (${String(response.status)}): ${errorText}`)
  }

  const payload = (await response.json()) as DashScopeResponse
  const imageUrl = extractImageUrl(payload)
  if (imageUrl === undefined) {
    throw new Error(`DashScope image ${options.operation} returned no image URL: ${redactSecrets(payload.message ?? JSON.stringify(payload), options.apiKey)}`)
  }
  return downloadImageBlob(imageUrl, options)
}

function extractImageUrl(response: DashScopeResponse): string | undefined {
  const contents = response.output?.choices?.[0]?.message?.content
  if (!Array.isArray(contents)) return undefined
  for (const item of contents) {
    if (item.image !== undefined && item.image.length > 0) return item.image
    if (item.image_url !== undefined && item.image_url.length > 0) return item.image_url
    if (item.url !== undefined && item.url.length > 0) return item.url
  }
  return undefined
}

async function downloadImageBlob(
  imageUrl: string,
  options: DashScopeImageOptions,
): Promise<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }> {
  const imageResponse = await (options.fetch ?? fetch)(imageUrl, {
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch DashScope image from URL (${String(imageResponse.status)})`)
  }
  const buffer = await imageResponse.arrayBuffer()
  if (buffer.byteLength > options.maxBytes) {
    throw new Error(`DashScope generated image (${String(buffer.byteLength)} bytes) exceeds the ${String(options.maxBytes)} byte limit`)
  }
  // Sniff first: the OSS CDN can answer a generic content-type (or none) while
  // the bytes stay PNG/WebP, and a mis-declared type fails the host attachment
  // service with IMAGE_TYPE_MISMATCH (#61).
  const data = new Uint8Array(buffer)
  const mediaType = detectImageMediaType(data) ?? imageMediaType(imageResponse.headers.get('content-type'))
  if (mediaType === undefined) {
    throw new Error(`DashScope image download returned an unsupported content type: ${imageResponse.headers.get('content-type') ?? 'none'}`)
  }
  return { data, mediaType }
}

function imageMediaType(value: string | null | undefined): ImageMediaType | undefined {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif' ? mediaType : undefined
}
