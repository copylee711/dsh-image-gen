import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { GalleryDb } from '../src/gallery-db.js'
import type { AttachmentJson } from '../src/gallery-types.js'
import { notifyBackgroundJob } from '../src/index.js'
import { JobRegistry, expectedRatio, jobsRoute } from '../src/jobs.js'
import type { PluginServices } from '../src/services.js'
import { PNG } from './helpers.js'

const ATTACHMENT: AttachmentJson = { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: PNG.byteLength, width: 1600, height: 900 }
const BASE = '/plugins/copylee-image-gen/jobs'

let dir: string
let gallery: GalleryDb

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dig-jobs-'))
  gallery = new GalleryDb(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('expectedRatio', () => {
  it('prefers an exact size, then the aspect ratio, then square', () => {
    expect(expectedRatio({ size: '1536x1024', aspect_ratio: '9:16' })).toEqual({ width: 1536, height: 1024 })
    expect(expectedRatio({ aspect_ratio: '16:9' })).toEqual({ width: 16, height: 9 })
    expect(expectedRatio({})).toEqual({ width: 1, height: 1 })
    expect(expectedRatio({ aspect_ratio: 'wide' })).toEqual({ width: 1, height: 1 })
  })
})

describe('JobRegistry', () => {
  it('settles pending → done with the real dimensions', async () => {
    const jobs = new JobRegistry(gallery)
    const job = jobs.create({ width: 16, height: 9 })
    expect(await jobs.status(job.id)).toMatchObject({ status: 'pending', width: 16, height: 9 })
    await jobs.run(job.id, async () => ({ attachment: ATTACHMENT }))
    expect(await jobs.status(job.id)).toMatchObject({ status: 'done', width: 1600, height: 900, attachment: ATTACHMENT })
  })

  it('records a failure and rethrows it to a blocking caller', async () => {
    const jobs = new JobRegistry(gallery)
    const job = jobs.create({ width: 1, height: 1 })
    await expect(jobs.run(job.id, async () => { throw new Error('quota exceeded') })).rejects.toThrow('quota exceeded')
    expect(await jobs.status(job.id)).toMatchObject({ status: 'failed', error: 'quota exceeded' })
  })

  it('runs under its own signal, aborted only by the parent signal or dispose', async () => {
    const jobs = new JobRegistry(gallery)
    const background = jobs.create({ width: 1, height: 1 })
    let seen: AbortSignal | undefined
    let finish!: () => void
    const running = jobs.run(background.id, signal => {
      seen = signal
      return new Promise<{ attachment: AttachmentJson }>(resolve => { finish = () => resolve({ attachment: ATTACHMENT }) })
    })
    expect(seen?.aborted).toBe(false)
    finish()
    await running

    const parent = new AbortController()
    const blocking = jobs.create({ width: 1, height: 1 })
    const run = jobs.run(blocking.id, signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }), parent.signal)
    parent.abort()
    await expect(run).rejects.toThrow('aborted')

    const stopped = jobs.create({ width: 1, height: 1 })
    const pending = jobs.run(stopped.id, signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
    }))
    jobs.dispose()
    await expect(pending).rejects.toThrow('stopped')
    expect(jobs.stopped).toBe(true)
  })

  it('answers finished jobs from the gallery after a restart', async () => {
    await gallery.addItems([{ attachment: ATTACHMENT, prompt: 'p', providerId: 'x', model: 'm', output: '16:9', projectId: 'conversation', jobId: '11111111-2222-4333-8444-555555555555' }])
    const fresh = new JobRegistry(gallery)
    expect(await fresh.status('11111111-2222-4333-8444-555555555555')).toMatchObject({ status: 'done', width: 1600, height: 900 })
    expect(await fresh.status('99999999-2222-4333-8444-555555555555')).toBeUndefined()
  })
})

describe('jobsRoute', () => {
  let server: Server
  let base: string
  let jobs: JobRegistry

  beforeEach(async () => {
    jobs = new JobRegistry(gallery)
    const services = {
      attachments: {
        imageLimits: { maxImageBytes: 1_000_000, mediaTypes: ['image/png'] },
        saveImage: async () => { throw new Error('unused') },
        readImage: async (ref: ImageAttachmentRef) => ({ ref, data: PNG }),
      },
    } as unknown as PluginServices
    const route = jobsRoute(services, jobs, BASE)
    server = createServer((req, res) => { void route(req, res) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}${BASE}`
  })

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  it('serves status, then the image once done', async () => {
    const job = jobs.create({ width: 4, height: 3 })
    expect(await (await fetch(`${base}/${job.id}`)).json()).toEqual({ id: job.id, status: 'pending', width: 4, height: 3 })
    expect((await fetch(`${base}/${job.id}/image`)).status).toBe(409)
    await jobs.run(job.id, async () => ({ attachment: ATTACHMENT }))
    const status = await (await fetch(`${base}/${job.id}`)).json() as Record<string, unknown>
    expect(status).toEqual({ id: job.id, status: 'done', width: 1600, height: 900 })
    const image = await fetch(`${base}/${job.id}/image`)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG)
  })

  it('reports unknown jobs as expired failures and rejects bad ids', async () => {
    expect(await (await fetch(`${base}/99999999-2222-4333-8444-555555555555`)).json()).toMatchObject({ status: 'failed', error: 'expired' })
    expect((await fetch(`${base}/not-a-job`)).status).toBe(404)
    expect((await fetch(`${base}/99999999-2222-4333-8444-555555555555`, { method: 'POST' })).status).toBe(405)
  })
})

describe('notifyBackgroundJob', () => {
  function agent(status: 'idle' | 'running') {
    return { session: { header: {}, deriveMessages: () => [] }, status, followup: vi.fn(), inject: vi.fn() }
  }

  it('wakes an idle Agent on failure with a notice row', () => {
    const owner = agent('idle')
    notifyBackgroundJob({ agent: owner, signal: new AbortController().signal }, { jobId: 'j1', prompt: 'Gauss law diagram', error: 'quota exceeded' })
    expect(owner.inject).not.toHaveBeenCalled()
    const message = owner.followup.mock.calls[0]?.[0] as { content: Array<{ text: string }>; source: Record<string, unknown> }
    expect(message.content[0]?.text).toContain('quota exceeded')
    expect(message.source).toMatchObject({ kind: 'copylee-image-gen', form: 'notice' })
    expect(String(message.source.summary)).toContain('Gauss law diagram')
  })

  it('only queues context on success or while the Agent is busy', () => {
    const idle = agent('idle')
    notifyBackgroundJob({ agent: idle, signal: new AbortController().signal }, { jobId: 'j1', prompt: 'p' })
    expect(idle.followup).not.toHaveBeenCalled()
    expect(idle.inject).toHaveBeenCalledOnce()
    const busy = agent('running')
    notifyBackgroundJob({ agent: busy, signal: new AbortController().signal }, { jobId: 'j2', prompt: 'p', error: 'boom' })
    expect(busy.followup).not.toHaveBeenCalled()
    expect(busy.inject).toHaveBeenCalledOnce()
  })
})
