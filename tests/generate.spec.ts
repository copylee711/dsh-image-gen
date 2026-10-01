import { describe, expect, it } from 'vitest'
import { runGeneration, seedreamSize } from '../src/generate.js'
import { PRESET_PROVIDERS, capabilitiesOf, resolveSize, type ProviderEntry } from '../src/shared.js'
import { bodyOf, headersOf, json, png, PNG, scriptedFetch } from './helpers.js'

const preset = (id: string): ProviderEntry => structuredClone(PRESET_PROVIDERS.find(entry => entry.id === id)!)
const global = { enabled: false, url: '', noProxy: [] }
const b64 = Buffer.from(PNG).toString('base64')

async function run(entry: ProviderEntry, request: Parameters<typeof runGeneration>[0]['request'], respond: (url: string, index: number) => Response) {
  const net = scriptedFetch((url, _init, index) => respond(url, index))
  const result = await runGeneration({ entry, apiKey: 'key-12345678', globalProxy: global, request, maxBytes: 1_000_000, signal: AbortSignal.timeout(5000), fetch: net.fetch })
  return { result, calls: net.calls }
}

describe('runGeneration dispatch', () => {
  it('OpenAI: maps ratio to size and sends quality', async () => {
    const { result, calls } = await run(preset('openai'), { prompt: 'p', aspectRatio: '3:2', quality: 'high' }, () => json({ data: [{ b64_json: b64 }] }))
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/images/generations')
    expect(bodyOf(calls[0])).toMatchObject({ model: 'gpt-image-2', size: '1536x1024', quality: 'high' })
    expect(result.output).toBe('1536x1024, high')
  })
  it('custom OpenAI-compatible endpoint with its own size table and model override', async () => {
    const entry: ProviderEntry = { id: 'custom-1', name: 'Relay', protocol: 'openai-compat', baseURL: 'https://relay.example/api/v1', models: ['flux-dev'], defaultModel: '', enabled: true, proxy: { mode: 'inherit' }, compat: { sizes: { '16:9': { '2K': '2048x1152', '1K': '1024x576' } } } }
    expect(capabilitiesOf(entry).ratios).toEqual(['16:9'])
    const { calls, result } = await run(entry, { prompt: 'p', aspectRatio: '16:9', imageSize: '1K', model: 'flux-pro' }, () => json({ data: [{ url: 'data:image/png;base64,' + b64 }] }))
    expect(calls[0]?.url).toBe('https://relay.example/api/v1/images/generations')
    expect(bodyOf(calls[0])).toMatchObject({ model: 'flux-pro', size: '1024x576' })
    expect(result.model).toBe('flux-pro')
  })
  it('Gemini: sends ratio/tier with the Google key header', async () => {
    const { calls, result } = await run(preset('google'), { prompt: 'p', aspectRatio: '16:9', imageSize: '2K' }, () => json({ output_image: { data: b64, mime_type: 'image/png' } }))
    expect(headersOf(calls[0])['x-goog-api-key']).toBe('key-12345678')
    expect(bodyOf(calls[0]).response_format).toMatchObject({ aspect_ratio: '16:9', image_size: '2K' })
    expect(result.output).toBe('16:9, 2K')
  })
  it('Seedream: derives pixel sizes and forces PNG for transparency', async () => {
    expect(seedreamSize('16:9', '2K')).toBe('2560x1440')
    expect(seedreamSize('16:9', '4K')).toBe('5120x2880')
    expect(seedreamSize(undefined, '4K')).toBe('4K')
    const entry = { ...preset('seedream'), ark: { background: 'transparent' as const, outputFormat: 'jpeg' as const } }
    const { calls } = await run(entry, { prompt: 'p', aspectRatio: '1:1', sourceImages: [{ data: PNG, mediaType: 'image/png' }] }, () => json({ data: [{ b64_json: b64 }] }))
    expect(bodyOf(calls[0])).toMatchObject({ size: '2048x2048', output_format: 'png', background: 'transparent' })
  })
  it('ModelScope and SiliconFlow use their own adapters', async () => {
    const ms = await run(preset('modelscope'), { prompt: 'p', aspectRatio: '16:9' }, (_url, index) => index === 0 ? json({ images: [{ url: 'https://cdn/x.png' }] }) : png())
    expect(bodyOf(ms.calls[0])).toMatchObject({ model: 'Qwen/Qwen-Image', size: '1280x720' })
    const sf = await run(preset('siliconflow'), { prompt: 'p', aspectRatio: '1:1' }, (_url, index) => index === 0 ? json({ images: [{ url: 'https://cdn/x.png' }] }) : png())
    expect(bodyOf(sf.calls[0])).toMatchObject({ model: 'Kwai-Kolors/Kolors', image_size: '1024x1024' })
  })
  it('refuses references the protocol cannot take', async () => {
    await expect(run(preset('zhipu'), { prompt: 'p', sourceImages: [{ data: PNG, mediaType: 'image/png' }] }, () => json({}))).rejects.toThrow(/does not support image editing/)
    await expect(run(preset('modelscope'), { prompt: 'p', sourceImages: [{ data: PNG, mediaType: 'image/png' }, { data: PNG, mediaType: 'image/png' }] }, () => json({}))).rejects.toThrow(/at most 1/)
  })
  it('requires a model', async () => {
    await expect(run({ ...preset('openai-compat'), baseURL: 'https://x.example/v1' }, { prompt: 'p' }, () => json({}))).rejects.toThrow(/no model/)
  })
})

describe('resolveSize', () => {
  it('prefers an explicit size and falls back to the first ratio', () => {
    expect(resolveSize(preset('openai'), { size: '512x512', aspectRatio: '1:1' })).toEqual({ size: '512x512' })
    expect(resolveSize(preset('openai'), { aspectRatio: '21:9' })).toEqual({ size: '1024x1024' })
    expect(resolveSize(preset('google'), { aspectRatio: '21:9', imageSize: '8K' })).toEqual({ aspectRatio: '21:9' })
  })
})

describe('size helpers', () => {
  it('derives aligned sizes from ratio and long side', async () => {
    const { sizeForRatio, clampDimension, parseSize } = await import('../src/shared.js')
    expect(sizeForRatio('16:9', 2048, 16)).toEqual({ width: 2048, height: 1152 })
    expect(sizeForRatio('2:3', 1536, 32)).toEqual({ width: 1024, height: 1536 })
    expect(sizeForRatio('1:1', 4096, 16, { min: 64, max: 2048, step: 16 })).toEqual({ width: 2048, height: 2048 })
    expect(clampDimension(1000, { min: 256, max: 2048, step: 32 })).toBe(992)
    expect(clampDimension(10, { min: 256, max: 2048, step: 32 })).toBe(256)
    expect(parseSize('1536x1024')).toEqual({ width: 1536, height: 1024 })
    expect(parseSize('1328*1328')).toEqual({ width: 1328, height: 1328 })
    expect(parseSize('big')).toBeUndefined()
  })
  it('sends an explicit size to ModelScope and converts it for DashScope', async () => {
    const ms = await run(preset('modelscope'), { prompt: 'p', aspectRatio: '1:1', size: '2048x1152' }, (_url, index) => index === 0 ? json({ images: [{ url: 'https://cdn/x.png' }] }) : png())
    expect(bodyOf(ms.calls[0])).toMatchObject({ size: '2048x1152' })
    const ds = await run(preset('dashscope'), { prompt: 'p', size: '1536x1024' }, (_url, index) => index === 0 ? json({ output: { choices: [{ message: { content: [{ image: 'https://cdn/y.png' }] } }] } }) : png())
    expect((bodyOf(ds.calls[0]).parameters as { size: string }).size).toBe('1536*1024')
  })
})
