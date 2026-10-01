import { describe, expect, it } from 'vitest'
import { generateModelScopeImage } from '../src/modelscope.js'
import { bodyOf, headersOf, json, png, PNG, scriptedFetch } from './helpers.js'

const base = { apiKey: 'ms-secret-key-123', baseURL: 'https://api-inference.modelscope.cn/v1', model: 'Qwen/Qwen-Image', prompt: 'a cat', maxBytes: 1_000_000, pollIntervalMs: 1 }

describe('ModelScope adapter', () => {
  it('submits an async task, polls it and downloads the image', async () => {
    const net = scriptedFetch((url, _init, index) => {
      if (index === 0) return json({ task_id: 't-1', request_id: 'r' })
      if (url.endsWith('/tasks/t-1') && index === 1) return json({ task_status: 'RUNNING' })
      if (url.endsWith('/tasks/t-1')) return json({ task_status: 'SUCCEED', output_images: ['https://cdn.example/a.png'] })
      return png()
    })
    const image = await generateModelScopeImage({ ...base, size: '1024x1024', negativePrompt: 'blurry', seed: 7, signal: AbortSignal.timeout(5000), fetch: net.fetch })
    expect(image.mediaType).toBe('image/png')
    expect(image.data).toEqual(PNG)
    expect(net.calls[0]?.url).toBe('https://api-inference.modelscope.cn/v1/images/generations')
    expect(headersOf(net.calls[0])).toMatchObject({ authorization: 'Bearer ms-secret-key-123', 'x-modelscope-async-mode': 'true' })
    expect(bodyOf(net.calls[0])).toEqual({ model: 'Qwen/Qwen-Image', prompt: 'a cat', size: '1024x1024', negative_prompt: 'blurry', seed: 7 })
    expect(headersOf(net.calls[1])['x-modelscope-task-type']).toBe('image_generation')
    expect(net.calls.at(-1)?.url).toBe('https://cdn.example/a.png')
  })

  it('sends reference images as image_url for edit models', async () => {
    const net = scriptedFetch((_url, _init, index) => index === 0 ? json({ images: [{ url: 'https://cdn.example/b.png' }] }) : png())
    await generateModelScopeImage({ ...base, model: 'Qwen/Qwen-Image-Edit', sourceImages: [{ data: PNG, mediaType: 'image/png' }], signal: AbortSignal.timeout(5000), fetch: net.fetch })
    const body = bodyOf(net.calls[0])
    expect(Array.isArray(body.image_url)).toBe(true)
    expect(String((body.image_url as string[])[0])).toMatch(/^data:image\/png;base64,/)
  })

  it('reports failed tasks and HTTP errors without leaking the key', async () => {
    const failed = scriptedFetch((_url, _init, index) => index === 0 ? json({ task_id: 't' }) : json({ task_status: 'FAILED', errors: { message: 'nsfw' } }))
    await expect(generateModelScopeImage({ ...base, signal: AbortSignal.timeout(5000), fetch: failed.fetch })).rejects.toThrow(/failed.*nsfw/)
    const denied = scriptedFetch(() => json({ error: 'bad key ms-secret-key-123' }, 401))
    const error = await generateModelScopeImage({ ...base, signal: AbortSignal.timeout(5000), fetch: denied.fetch }).catch((caught: unknown) => caught as Error)
    expect(error.message).toMatch(/401/)
    expect(error.message).not.toContain('ms-secret-key-123')
  })

  it('times out a task that never finishes and honours abort', async () => {
    const pending = scriptedFetch((_url, _init, index) => index === 0 ? json({ task_id: 't' }) : json({ task_status: 'PENDING' }))
    await expect(generateModelScopeImage({ ...base, timeoutMs: 5, signal: AbortSignal.timeout(5000), fetch: pending.fetch })).rejects.toThrow(/did not finish/)
    const controller = new AbortController()
    const slow = scriptedFetch(() => json({ task_id: 't' }))
    const run = generateModelScopeImage({ ...base, pollIntervalMs: 10_000, signal: controller.signal, fetch: slow.fetch })
    setTimeout(() => controller.abort(new Error('stop')), 5)
    await expect(run).rejects.toThrow(/stop/)
  })
})
