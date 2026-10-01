/** SiliconFlow `images/generations` adapter (Kolors, Qwen-Image, FLUX ...). */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { downloadImage, ensureVersionedBase, joinURL, readBoundedText, toDataUrl, type FetchedImage } from './download.js'
import type { FetchLike } from './http.js'
import { providerErrorDetail, redactSecrets } from './redact.js'

const ERROR_LIMIT = 4096
const RESPONSE_LIMIT = 1024 * 1024

export interface SiliconFlowInput {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  /** `WIDTHxHEIGHT`. */
  size?: string | undefined
  negativePrompt?: string | undefined
  seed?: number | undefined
  /** At most one reference image (edit / image-to-image models). */
  sourceImages?: Array<{ data: Uint8Array; mediaType: ImageMediaType }> | undefined
  maxBytes: number
  signal: AbortSignal
  fetch?: FetchLike | undefined
}

export async function generateSiliconFlowImage(input: SiliconFlowInput): Promise<FetchedImage> {
  const doFetch = input.fetch ?? fetch
  const label = 'SiliconFlow'
  const sources = input.sourceImages ?? []
  if (sources.length > 1) throw new Error(`${label} accepts one reference image per request; got ${String(sources.length)}`)
  const endpoint = joinURL(ensureVersionedBase(input.baseURL), 'images/generations')
  const response = await doFetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: input.signal,
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      batch_size: 1,
      ...(input.size === undefined || input.size.length === 0 ? {} : { image_size: input.size }),
      ...(input.negativePrompt === undefined || input.negativePrompt.length === 0 ? {} : { negative_prompt: input.negativePrompt }),
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(sources[0] === undefined ? {} : { image: toDataUrl(sources[0]) }),
    }),
  })
  const text = await readBoundedText(response, RESPONSE_LIMIT)
  if (!response.ok) throw new Error(`${label} image request failed (${String(response.status)}) POST ${endpoint}: ${providerErrorDetail(text, input.apiKey)}`)
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as { images?: unknown; data?: unknown }
  const list = Array.isArray(record.images) ? record.images : Array.isArray(record.data) ? record.data : []
  const first = list[0] as { url?: unknown; b64_json?: unknown } | undefined
  const url = typeof first?.url === 'string' && first.url.length > 0
    ? first.url
    : typeof first?.b64_json === 'string' && first.b64_json.length > 0 ? `data:image/png;base64,${first.b64_json}` : undefined
  if (url === undefined) throw new Error(`${label} returned no image: ${redactSecrets(text, input.apiKey).slice(0, ERROR_LIMIT)}`)
  return downloadImage(url, { fetch: doFetch, maxBytes: input.maxBytes, signal: input.signal, label })
}
