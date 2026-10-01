/**
 * ModelScope API-Inference image adapter.
 *
 * ModelScope runs image generation as an asynchronous task: the submit call
 * (with `X-ModelScope-Async-Mode: true`) answers a `task_id`, and the task
 * endpoint is polled until it reports `SUCCEED` with `output_images` URLs.
 * A synchronous `images: [{ url }]` answer is accepted too, so a gateway that
 * flattens the flow keeps working.
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { abortableDelay, downloadImage, ensureVersionedBase, joinURL, readBoundedText, toDataUrl, type FetchedImage } from './download.js'
import type { FetchLike } from './http.js'
import { redactSecrets } from './redact.js'

const ERROR_LIMIT = 4096
const RESPONSE_LIMIT = 1024 * 1024
/** Default overall budget for one task, polling included. */
export const MODELSCOPE_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export interface ModelScopeInput {
  apiKey: string
  baseURL: string
  model: string
  prompt: string
  /** `WIDTHxHEIGHT`. */
  size?: string | undefined
  negativePrompt?: string | undefined
  seed?: number | undefined
  /** Reference images for edit models such as `Qwen/Qwen-Image-Edit`. */
  sourceImages?: Array<{ data: Uint8Array; mediaType: ImageMediaType }> | undefined
  maxBytes: number
  signal: AbortSignal
  fetch?: FetchLike | undefined
  /** Poll interval; tests shorten it. */
  pollIntervalMs?: number | undefined
  timeoutMs?: number | undefined
}

/** Generate (or edit, when `sourceImages` is non-empty) one image. */
export async function generateModelScopeImage(input: ModelScopeInput): Promise<FetchedImage> {
  const doFetch = input.fetch ?? fetch
  const label = 'ModelScope'
  const headers = {
    authorization: `Bearer ${input.apiKey}`,
    'content-type': 'application/json',
    'x-modelscope-async-mode': 'true',
  }
  const references = (input.sourceImages ?? []).map(toDataUrl)
  const base = ensureVersionedBase(input.baseURL)
  const submitURL = joinURL(base, 'images/generations')
  const submit = await doFetch(submitURL, {
    method: 'POST',
    redirect: 'error',
    signal: input.signal,
    headers,
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      ...(input.size === undefined || input.size.length === 0 ? {} : { size: input.size }),
      ...(input.negativePrompt === undefined || input.negativePrompt.length === 0 ? {} : { negative_prompt: input.negativePrompt }),
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(references.length === 0 ? {} : { image_url: references }),
    }),
  })
  const submitText = await readBoundedText(submit, RESPONSE_LIMIT)
  if (!submit.ok) throw new Error(`${label} image request failed (${String(submit.status)}) POST ${submitURL}: ${redactSecrets(submitText, input.apiKey).slice(0, ERROR_LIMIT)}`)
  const submitted = parseJson(submitText, label)
  const direct = imageUrlOf(submitted)
  if (direct !== undefined) return downloadImage(direct, { fetch: doFetch, maxBytes: input.maxBytes, signal: input.signal, label })
  const taskId = typeof submitted.task_id === 'string' ? submitted.task_id : undefined
  if (taskId === undefined) throw new Error(`${label} image request returned no task id: ${redactSecrets(submitText, input.apiKey).slice(0, ERROR_LIMIT)}`)

  const deadline = Date.now() + (input.timeoutMs ?? MODELSCOPE_DEFAULT_TIMEOUT_MS)
  const interval = input.pollIntervalMs ?? 3000
  const taskURL = joinURL(base, `tasks/${encodeURIComponent(taskId)}`)
  for (;;) {
    await abortableDelay(interval, input.signal)
    const poll = await doFetch(taskURL, {
      method: 'GET',
      redirect: 'error',
      signal: input.signal,
      headers: { authorization: `Bearer ${input.apiKey}`, 'x-modelscope-task-type': 'image_generation' },
    })
    const pollText = await readBoundedText(poll, RESPONSE_LIMIT)
    if (!poll.ok) throw new Error(`${label} task query failed (${String(poll.status)}) GET ${taskURL}: ${redactSecrets(pollText, input.apiKey).slice(0, ERROR_LIMIT)}`)
    const task = parseJson(pollText, label)
    const status = typeof task.task_status === 'string' ? task.task_status.toUpperCase() : ''
    if (status === 'SUCCEED' || status === 'SUCCEEDED') {
      const url = imageUrlOf(task)
      if (url === undefined) throw new Error(`${label} task succeeded without an image`)
      return downloadImage(url, { fetch: doFetch, maxBytes: input.maxBytes, signal: input.signal, label })
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
      throw new Error(`${label} task ${status.toLowerCase()}: ${redactSecrets(JSON.stringify(task.errors ?? task.message ?? task), input.apiKey).slice(0, ERROR_LIMIT)}`)
    }
    if (Date.now() > deadline) throw new Error(`${label} task ${taskId} did not finish in time`)
  }
}

function parseJson(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} returned an unexpected payload`)
  return value as Record<string, unknown>
}

function imageUrlOf(payload: Record<string, unknown>): string | undefined {
  const outputs = payload.output_images
  if (Array.isArray(outputs) && typeof outputs[0] === 'string' && outputs[0].length > 0) return outputs[0]
  const images = Array.isArray(payload.images) ? payload.images : Array.isArray(payload.data) ? payload.data : undefined
  const first = images?.[0]
  if (typeof first === 'object' && first !== null) {
    const record = first as { url?: unknown; b64_json?: unknown }
    if (typeof record.url === 'string' && record.url.length > 0) return record.url
    if (typeof record.b64_json === 'string' && record.b64_json.length > 0) return `data:image/png;base64,${record.b64_json}`
  }
  return undefined
}
