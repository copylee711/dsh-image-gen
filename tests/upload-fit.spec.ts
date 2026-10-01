// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeUploadError, fitImage } from '../src/client/api.js'

const limits = { maxImageBytes: 1000, maxImageDimension: 2048, mediaTypes: ['image/png', 'image/jpeg', 'image/webp'] }

function stubCanvas(sizes: number[]): Array<{ width: number; height: number; type: string; quality: number }> {
  const calls: Array<{ width: number; height: number; type: string; quality: number }> = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
    calls.push({ width: this.width, height: this.height, type: type ?? '', quality: Number(quality) })
    callback(new Blob([new Uint8Array(sizes[calls.length - 1] ?? 10)], { type }))
  })
  return calls
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fitImage', () => {
  it('leaves images within the limits untouched', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1024, height: 1024, close: () => {} }))
    const file = new Blob([new Uint8Array(500)], { type: 'image/png' })
    expect(await fitImage(file, limits)).toBe(file)
  })

  it('re-encodes oversized images as WebP and shrinks until they fit', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4096, height: 2048, close: () => {} }))
    const calls = stubCanvas([5000, 800])
    const out = await fitImage(new Blob([new Uint8Array(9000)], { type: 'image/png' }), limits)
    expect(out.type).toBe('image/webp')
    expect(out.size).toBe(800)
    expect(calls[0]).toMatchObject({ width: 2048, height: 1024, quality: 0.9 })
    expect(calls[1]!.width).toBeLessThan(2048)
  })

  it('converts unaccepted types', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10, close: () => {} }))
    stubCanvas([100])
    const out = await fitImage(new Blob([new Uint8Array(100)], { type: 'image/bmp' }), limits)
    expect(out.type).toBe('image/webp')
  })
})

describe('describeUploadError', () => {
  it('turns route codes into readable text', () => {
    expect(describeUploadError('size-out-of-range (max 20971520 bytes)', { ...limits, maxImageBytes: 20 * 1024 * 1024 })).toBe('图片过大（上限 20 MB）')
    expect(describeUploadError('unsupported-media-type: image/bmp')).toBe('不支持的图片格式（image/bmp）')
  })
})
