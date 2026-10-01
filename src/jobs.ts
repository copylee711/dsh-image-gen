/**
 * Image jobs: every Agent generation gets a job id the model can embed in its
 * reply as `![caption](genimg:<id>)`. A renderer (dsh-better-display) polls
 * the job route and swaps its placeholder for the image once the job is done,
 * so a background job may finish after the reply itself.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GalleryDb } from './gallery-db.js'
import type { AttachmentJson } from './gallery-types.js'
import { parseImageAttachmentRef } from './reference-image.js'
import { sendJson } from './route-util.js'
import type { PluginServices } from './services.js'
import { parseSize } from './shared.js'

/** Markdown image scheme of the cross-plugin contract: `![alt](genimg:<job id>)`. */
export const GENIMG_SCHEME = 'genimg:'

export type JobState = 'pending' | 'done' | 'failed'

/** What the job route answers. `width`/`height` are the expected ratio while pending. */
export interface JobStatus {
  id: string
  status: JobState
  width: number
  height: number
  error?: string
  /** Where the finished image is on disk (workspace copy, else the gallery copy), for "open file". */
  path?: string
}

interface Job extends JobStatus {
  attachment?: AttachmentJson
  controller?: AbortController
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Finished jobs kept in memory; older ones are answered from the gallery. */
const MAX_FINISHED = 200

export function isJobId(value: string): boolean {
  return JOB_ID.test(value)
}

/** Ratio the placeholder should reserve before the provider answers. */
export function expectedRatio(args: { size?: string | undefined; aspect_ratio?: string | undefined }): { width: number; height: number } {
  const size = parseSize(args.size)
  if (size !== undefined) return size
  const [w, h] = (args.aspect_ratio ?? '').split(':').map(Number)
  return w !== undefined && h !== undefined && w > 0 && h > 0 ? { width: w, height: h } : { width: 1, height: 1 }
}

export class JobRegistry {
  private readonly jobs = new Map<string, Job>()
  private disposed = false

  /** True after {@link dispose}: jobs failing now were stopped, not broken. */
  get stopped(): boolean {
    return this.disposed
  }

  constructor(private readonly gallery: GalleryDb) {}

  /** Register a pending job; `run` starts it. */
  create(ratio: { width: number; height: number }): JobStatus {
    const job: Job = { id: randomUUID(), status: 'pending', width: ratio.width, height: ratio.height }
    this.jobs.set(job.id, job)
    return publicStatus(job)
  }

  /**
   * Run the work under the job's own abort controller (never the tool call's
   * signal: a background job outlives its call; a blocking caller passes that
   * signal as `parent`). Settles the job; rejects with
   * the work's error so a blocking caller can report it.
   */
  async run<T extends { attachment: AttachmentJson; path?: string | undefined }>(id: string, work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
    const job = this.jobs.get(id)
    if (job === undefined) throw new Error(`unknown image job ${id}`)
    const controller = new AbortController()
    job.controller = controller
    if (this.disposed) controller.abort(new Error('image generation plugin stopped'))
    // A blocking call still stops when its turn is cancelled.
    const abort = (): void => controller.abort(parent?.reason)
    if (parent?.aborted === true) abort()
    parent?.addEventListener('abort', abort, { once: true })
    try {
      const value = await work(controller.signal)
      Object.assign(job, { status: 'done', attachment: value.attachment, width: value.attachment.width, height: value.attachment.height, ...(value.path === undefined ? {} : { path: value.path }) })
      return value
    } catch (error) {
      Object.assign(job, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      parent?.removeEventListener('abort', abort)
      delete job.controller
      this.prune()
    }
  }

  /** Current status; finished jobs no longer in memory come from the gallery. */
  async status(id: string): Promise<(JobStatus & { attachment?: AttachmentJson }) | undefined> {
    const job = this.jobs.get(id)
    if (job !== undefined) return { ...publicStatus(job), ...(job.attachment === undefined ? {} : { attachment: job.attachment }) }
    const item = await this.gallery.findByJobId(id)
    if (item === undefined) return undefined
    const path = item.savedTo ?? item.filePath
    return { id, status: 'done', width: item.attachment.width, height: item.attachment.height, attachment: item.attachment, ...(path === undefined ? {} : { path }) }
  }

  /** Abort running jobs (plugin unload); they settle as failed. */
  dispose(): void {
    this.disposed = true
    for (const job of this.jobs.values()) job.controller?.abort(new Error('image generation plugin stopped'))
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter(job => job.status !== 'pending')
    for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) this.jobs.delete(job.id)
  }
}

function publicStatus(job: Job): JobStatus {
  return {
    id: job.id, status: job.status, width: job.width, height: job.height,
    ...(job.error === undefined ? {} : { error: job.error }),
    ...(job.path === undefined ? {} : { path: job.path }),
  }
}

/**
 * Prefix route under `/jobs`: `GET <base>/<id>` → status JSON,
 * `GET <base>/<id>/image` → image bytes once done. Unknown ids (e.g. a pending
 * job lost to a restart) answer `failed`, so a placeholder never spins forever.
 */
export function jobsRoute(services: PluginServices, jobs: JobRegistry, base: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { error: 'cross-site' })
    const path = new URL(req.url ?? '/', 'http://local').pathname
    const match = /^\/([^/]+)(\/image)?\/?$/.exec(path.startsWith(base) ? path.slice(base.length) : '')
    const id = match?.[1]
    if (id === undefined || !isJobId(id)) return sendJson(res, 404, { error: 'unknown-job' })
    const status = await jobs.status(id).catch(() => undefined)
    if (match?.[2] === undefined) {
      if (status === undefined) return sendJson(res, 200, { id, status: 'failed', width: 1, height: 1, error: 'expired' } satisfies JobStatus)
      const { attachment: _attachment, ...body } = status
      return sendJson(res, 200, body)
    }
    const ref = parseImageAttachmentRef(status?.attachment)
    if (ref === undefined) return sendJson(res, status?.status === 'pending' ? 409 : 404, { error: status?.status === 'pending' ? 'pending' : 'image-unavailable' })
    try {
      const stored = await services.attachments.readImage(ref)
      res.writeHead(200, {
        'content-type': stored.ref.mediaType,
        'content-length': String(stored.data.byteLength),
        // A job's image never changes once done.
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      })
      res.end(stored.data)
    } catch {
      sendJson(res, 404, { error: 'image-unavailable' })
    }
  }
}
