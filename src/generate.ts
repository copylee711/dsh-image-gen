/** Route one generation/edit request to the adapter for the entry's protocol. */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { editDashScopeImage, generateDashScopeImage } from './dashscope.js'
import { editGoogleImage, generateGoogleImage } from './google.js'
import { providerFetch, type FetchLike } from './http.js'
import { generateModelScopeImage } from './modelscope.js'
import { editOpenAICompatibleImage, generateOpenAICompatibleImage } from './openai-compatible.js'
import { editSeedreamImage } from './seedream.js'
import { generateSiliconFlowImage } from './siliconflow.js'
import {
  capabilitiesOf,
  effectiveModel,
  resolveSize,
  type AspectRatio,
  type GlobalProxy,
  type ImageSize,
  type ProviderEntry,
} from './shared.js'
import { xaiToolParameters } from './xai-params.js'

export interface SourceImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

export interface GenerationRequest {
  prompt: string
  model?: string | undefined
  aspectRatio?: string | undefined
  imageSize?: string | undefined
  /** Explicit wire size; wins over ratio/tier. */
  size?: string | undefined
  /** OpenAI-family quality tier. */
  quality?: string | undefined
  negativePrompt?: string | undefined
  seed?: number | undefined
  /** Non-empty → edit / image-to-image. */
  sourceImages?: SourceImage[] | undefined
}

export interface GenerationResult {
  data: Uint8Array
  mediaType: ImageMediaType
  model: string
  /** Human summary of the size actually requested. */
  output: string
}

const SEEDREAM_2K: Record<string, string> = {
  '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '16:9': '2560x1440', '9:16': '1440x2560',
  '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3024x1296',
}

/** Seedream takes pixel sizes or a bare tier (`2K`, `4K`). */
export function seedreamSize(aspectRatio?: string, imageSize?: string): string {
  const tier = imageSize === '4K' ? '4K' : '2K'
  const base = aspectRatio === undefined ? undefined : SEEDREAM_2K[aspectRatio]
  if (base === undefined) return tier
  if (tier === '2K') return base
  const [w, h] = base.split('x').map(Number)
  return `${String(w! * 2)}x${String(h! * 2)}`
}

export async function runGeneration(input: {
  entry: ProviderEntry
  apiKey: string
  globalProxy: GlobalProxy
  request: GenerationRequest
  maxBytes: number
  signal: AbortSignal
  /** Tests inject a fake fetch; production resolves the proxy. */
  fetch?: FetchLike
}): Promise<GenerationResult> {
  const { entry, apiKey, request, maxBytes, signal } = input
  const doFetch = input.fetch ?? providerFetch(entry.proxy, input.globalProxy)
  const model = effectiveModel(entry, request.model)
  if (model.length === 0) throw new Error(`Image provider "${entry.name}" has no model; add one in Settings > Plugins > 图像生成.`)
  const sources = request.sourceImages ?? []
  const caps = capabilitiesOf(entry)
  if (sources.length > 0) {
    if (caps.maxReferences === 0) throw new Error(`${entry.name} does not support image editing / reference images`)
    if (sources.length > caps.maxReferences) throw new Error(`${entry.name} accepts at most ${String(caps.maxReferences)} reference image(s); got ${String(sources.length)}`)
  }
  const sized = resolveSize(entry, request)
  const common = { apiKey, model, prompt: request.prompt, maxBytes, signal, fetch: doFetch }

  switch (entry.protocol) {
    case 'gemini': {
      const aspectRatio = (sized.aspectRatio ?? '1:1') as AspectRatio
      const imageSize = (sized.imageSize ?? '1K') as ImageSize
      const base = { ...common, endpoint: entry.baseURL, aspectRatio, imageSize }
      const image = sources.length > 0
        ? await editGoogleImage({ ...base, sourceImages: sources })
        : await generateGoogleImage(base)
      return { ...image, model, output: `${aspectRatio}, ${imageSize}` }
    }
    case 'xai': {
      const extraBody = xaiToolParameters({
        ...(sized.aspectRatio === undefined ? {} : { aspectRatio: sized.aspectRatio }),
        ...(sized.imageSize === undefined ? {} : { imageSize: sized.imageSize }),
        ...(sized.size === undefined ? {} : { size: sized.size }),
      })
      const image = sources.length > 0
        ? await editOpenAICompatibleImage({ ...common, baseURL: entry.baseURL, sourceImages: sources, editFormat: 'xaiJson', extraBody })
        : await generateOpenAICompatibleImage({ ...common, provider: 'xai', baseURL: entry.baseURL, extraBody })
      return { ...image, model, output: [extraBody.aspect_ratio ?? 'auto', extraBody.resolution].filter(Boolean).join(', ') }
    }
    case 'seedream': {
      const size = sized.size ?? seedreamSize(sized.aspectRatio, sized.imageSize)
      // Ark rejects JPEG with a transparent background (no alpha channel).
      const ark = entry.ark?.background === 'transparent' ? { ...entry.ark, outputFormat: 'png' as const } : entry.ark
      const image = sources.length > 0
        ? await editSeedreamImage({ ...common, baseURL: entry.baseURL, sourceImages: sources, size, ...(ark === undefined ? {} : { arkOptions: ark }) })
        : await generateOpenAICompatibleImage({ ...common, provider: 'seedream', baseURL: entry.baseURL, size, ...(ark === undefined ? {} : { arkOptions: ark }) })
      return { ...image, model, output: size }
    }
    case 'dashscope': {
      const size = sized.size
      const base = { ...common, endpoint: entry.baseURL, ...(size === undefined ? {} : { size }) }
      const image = sources.length > 0
        ? await editDashScopeImage({ ...base, sourceImages: sources })
        : await generateDashScopeImage(base)
      return { ...image, model, output: size ?? 'default' }
    }
    case 'modelscope': {
      const image = await generateModelScopeImage({
        ...common, baseURL: entry.baseURL, size: sized.size, negativePrompt: request.negativePrompt, seed: request.seed, sourceImages: sources,
      })
      return { ...image, model, output: sized.size ?? 'default' }
    }
    case 'siliconflow': {
      const image = await generateSiliconFlowImage({
        ...common, baseURL: entry.baseURL, size: sized.size, negativePrompt: request.negativePrompt, seed: request.seed, sourceImages: sources,
      })
      return { ...image, model, output: sized.size ?? 'default' }
    }
    case 'openai':
    case 'openai-compat':
    case 'zhipu': {
      const size = sized.size
      const quality = request.quality?.trim() || undefined
      const image = sources.length > 0
        ? await editOpenAICompatibleImage({
          ...common, baseURL: entry.baseURL, sourceImages: sources,
          ...(size === undefined ? {} : { size }),
          ...(quality === undefined ? {} : { quality }),
          ...(entry.protocol === 'openai-compat' && entry.compat?.editFormat !== undefined ? { editFormat: entry.compat.editFormat } : {}),
          ...(entry.protocol === 'openai-compat' && entry.compat?.editExtra !== undefined ? { editExtra: entry.compat.editExtra } : {}),
        })
        : await generateOpenAICompatibleImage({
          ...common, provider: entry.protocol, baseURL: entry.baseURL,
          ...(size === undefined ? {} : { size }),
          ...(quality === undefined ? {} : { quality }),
        })
      return { ...image, model, output: [size ?? 'default', quality].filter(Boolean).join(', ') }
    }
  }
}
