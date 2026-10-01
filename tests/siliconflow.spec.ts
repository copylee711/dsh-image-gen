import { describe, expect, it } from 'vitest'
import { generateSiliconFlowImage } from '../src/siliconflow.js'
import { bodyOf, json, png, PNG, scriptedFetch } from './helpers.js'

const base = { apiKey: 'sf-key-abcdefgh', baseURL: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors', prompt: 'a cat', maxBytes: 1_000_000 }

describe('SiliconFlow adapter', () => {
  it('posts images/generations and downloads images[0].url', async () => {
    const net = scriptedFetch((_url, _init, index) => index === 0 ? json({ images: [{ url: 'https://cdn.example/x.png' }], seed: 1 }) : png())
    const image = await generateSiliconFlowImage({ ...base, size: '1024x1024', seed: 3, signal: AbortSignal.timeout(5000), fetch: net.fetch })
    expect(image.data).toEqual(PNG)
    expect(net.calls[0]?.url).toBe('https://api.siliconflow.cn/v1/images/generations')
    expect(bodyOf(net.calls[0])).toEqual({ model: 'Kwai-Kolors/Kolors', prompt: 'a cat', batch_size: 1, image_size: '1024x1024', seed: 3 })
  })
  it('passes one reference image and rejects more', async () => {
    const net = scriptedFetch((_url, _init, index) => index === 0 ? json({ images: [{ url: 'https://cdn.example/x.png' }] }) : png())
    await generateSiliconFlowImage({ ...base, sourceImages: [{ data: PNG, mediaType: 'image/png' }], signal: AbortSignal.timeout(5000), fetch: net.fetch })
    expect(String(bodyOf(net.calls[0]).image)).toMatch(/^data:image\/png;base64,/)
    await expect(generateSiliconFlowImage({ ...base, sourceImages: [{ data: PNG, mediaType: 'image/png' }, { data: PNG, mediaType: 'image/png' }], signal: AbortSignal.timeout(5000), fetch: net.fetch })).rejects.toThrow(/one reference/)
  })
  it('surfaces API errors', async () => {
    const net = scriptedFetch(() => json({ message: 'quota' }, 429))
    await expect(generateSiliconFlowImage({ ...base, signal: AbortSignal.timeout(5000), fetch: net.fetch })).rejects.toThrow(/429.*quota/)
  })
})
