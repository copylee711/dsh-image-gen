/** Shared response helpers for the adapters written for this plugin. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { FetchLike } from './http.js'
import { detectImageMediaType } from './reference-image.js'

/** Image bytes returned before Attachment persistence. */
export interface FetchedImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

/** Read a response body, failing once it exceeds `maxBytes`. */
export async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) throw new Error(`Image response exceeded the ${String(maxBytes)} byte limit`)
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(response, maxBytes))
}

export function imageMediaType(value: string | null | undefined): ImageMediaType | undefined {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif' ? mediaType : undefined
}

export function toDataUrl(image: { data: Uint8Array; mediaType: ImageMediaType }): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
}

/** Download (or decode a data URL of) one generated image. */
export async function downloadImage(
  url: string,
  options: { fetch: FetchLike; maxBytes: number; signal: AbortSignal; label: string },
): Promise<FetchedImage> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(url.trim())
    if (match?.[2] === undefined) throw new Error(`${options.label} returned an invalid data URL`)
    const data = new Uint8Array(Buffer.from(match[2].replace(/\s+/g, ''), 'base64'))
    if (data.byteLength === 0) throw new Error(`${options.label} returned empty image data`)
    if (data.byteLength > options.maxBytes) throw new Error(`${options.label} exceeded the ${String(options.maxBytes)} byte image limit`)
    const mediaType = detectImageMediaType(data) ?? imageMediaType(match[1])
    if (mediaType === undefined) throw new Error(`${options.label} returned an unsupported image type`)
    return { data, mediaType }
  }
  const response = await options.fetch(url, { redirect: 'follow', signal: options.signal })
  if (!response.ok) throw new Error(`${options.label} image download failed (${String(response.status)})`)
  const data = await readBoundedBytes(response, options.maxBytes)
  const mediaType = detectImageMediaType(data) ?? imageMediaType(response.headers.get('content-type'))
  if (mediaType === undefined) throw new Error(`${options.label} image download returned an unsupported content type`)
  return { data, mediaType }
}

/** Join a base URL and a relative path without dropping the base path. */
export function joinURL(baseURL: string, path: string): string {
  try {
    return new URL(path, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString()
  } catch {
    throw new Error('Provider base URL must be an absolute URL')
  }
}

/** Sleep that rejects as soon as the signal aborts. */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
