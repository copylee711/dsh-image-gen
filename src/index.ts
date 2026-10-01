/**
 * dsh-image-gen Host bundle: Agent image tools, the paintings/gallery/settings
 * routes, and the conversation context line telling the model it can draw.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from './system-prompt-service.js'
import { credentialKeyStore, fileKeyStore, hasRecordApi, layeredKeyStore } from './credentials.js'
import { GalleryDb } from './gallery-db.js'
import { CONVERSATION_PROJECT_ID } from './gallery-types.js'
import { serveImport } from './import-route.js'
import { parseImageAttachmentRef, resolveReferenceImages } from './reference-image.js'
import { galleryRoute, imageRoute, keyRoute, modelsRoute, paintRoute, settingsRoute, testRoute } from './routes.js'
import { generateAndStore, toAttachmentJson, type PluginServices } from './services.js'
import { SettingsStore } from './settings-store.js'
import {
  ASPECT_RATIOS,
  GALLERY_ROUTE,
  IMAGE_ROUTE,
  IMPORT_ROUTE,
  KEY_ROUTE,
  MODELS_ROUTE,
  PAINT_ROUTE,
  PLUGIN_NAME,
  SETTINGS_ROUTE,
  TEST_ROUTE,
  capabilitiesOf,
  effectiveModel,
  type PluginSettings,
} from './shared.js'
import { resolveDataDir } from './storage.js'
import { saveImageToWorkspace } from './workspace-save.js'

export const name = PLUGIN_NAME
export const inject = ['tools', 'attachments', 'credentials', 'webServer']

export interface Config {
  /** Override the folder holding settings.json / gallery.json. */
  dataDir?: string
}

export const Config: z<Config> = z.object({
  dataDir: z.string().description('设置与画廊数据目录；留空使用 ~/.dsh/storages/dsh-image-gen'),
}) as z<Config>

interface GeneratedValue {
  attachment: ImageAttachmentRef
  provider: string
  model: string
  output: string
  savedTo?: string
  saveError?: string
}

interface BatchGeneratedValue {
  images: (GeneratedValue & { prompt: string })[]
  failures: { index: number; prompt: string; error: string }[]
}

interface ExecLike {
  agent?: { session: { header: { id?: unknown; cwd?: string }; deriveMessages(): readonly unknown[] } } | undefined
  signal: AbortSignal
}

interface ImageArgs {
  prompt: string
  provider?: string | undefined
  model?: string | undefined
  aspect_ratio?: string | undefined
  image_size?: string | undefined
  size?: string | undefined
  negative_prompt?: string | undefined
}

/** One line per enabled provider for the model's context and errors. */
export function providerDigest(settings: PluginSettings, keyed: ReadonlySet<string>): string {
  const rows = settings.providers
    .filter(entry => entry.enabled && entry.baseURL.length > 0 && keyed.has(entry.id))
    .map(entry => {
      const caps = capabilitiesOf(entry)
      const model = effectiveModel(entry)
      const edit = caps.maxReferences > 0 ? `edit≤${String(caps.maxReferences)}` : 'no-edit'
      return `- ${entry.id}${entry.id === settings.activeProvider ? ' (default)' : ''}: ${entry.name}, model ${model || '?'}, ${edit}`
    })
  if (rows.length === 0) {
    return 'Image generation tools (generate_image, edit_image) are installed but no image provider has an API key yet; if the user asks for an image, tell them to configure one in Settings > Plugins > 图像生成.'
  }
  return [
    'You can create images with generate_image / generate_images and modify images with edit_image whenever a picture would genuinely help the user (they ask for an image, illustration, poster, logo, diagram-like visual, or edits to an attached image). Do not generate images unprompted for plain text questions.',
    'Configured image providers (pass the id as `provider` only when the user asks for a specific one):',
    ...rows,
  ].join('\n')
}

export function apply(ctx: Context, config: Config = {}): void {
  const dataDir = resolveDataDir(config.dataDir)
  const settings = new SettingsStore(dataDir)
  const credentialsService = ctx.get('credentials') as unknown
  const keys = layeredKeyStore(
    hasRecordApi(credentialsService) ? credentialKeyStore(credentialsService) : undefined,
    fileKeyStore(dataDir),
  )
  const gallery = new GalleryDb(dataDir)
  const services: PluginServices = { settings, keys, gallery, attachments: ctx.attachments }

  const route = (kind: 'exact' | 'prefix', path: string, handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>): void => {
    ctx.effect(() => ctx.webServer.register({ kind, path, handler }), `${PLUGIN_NAME}: ${path}`)
  }
  route('exact', IMAGE_ROUTE, imageRoute(services))
  route('exact', IMPORT_ROUTE, (req, res) => serveImport(req, res, {
    saveImage: image => ctx.attachments.saveImage(image),
    maxImageBytes: ctx.attachments.imageLimits.maxImageBytes,
    mediaTypes: ctx.attachments.imageLimits.mediaTypes,
  }))
  route('exact', SETTINGS_ROUTE, settingsRoute(services))
  route('exact', KEY_ROUTE, keyRoute(services))
  route('exact', TEST_ROUTE, testRoute(services))
  route('exact', MODELS_ROUTE, modelsRoute(services))
  route('exact', PAINT_ROUTE, paintRoute(services))
  route('exact', GALLERY_ROUTE, galleryRoute(services))

  // Context line: which providers the model may name. Cached and refreshed on
  // settings/key changes so prompt assembly never waits on disk.
  let digest = ''
  const refreshDigest = async (): Promise<void> => {
    const current = await settings.get()
    const keyed = new Set<string>()
    await Promise.all(current.providers.map(async entry => {
      if (await keys.get(entry.id).catch(() => undefined) !== undefined) keyed.add(entry.id)
    }))
    digest = providerDigest(current, keyed)
  }
  void refreshDigest().catch(() => {})
  ctx.effect(() => settings.onChange(() => { void refreshDigest().catch(() => {}) }), `${PLUGIN_NAME}: digest refresh`)
  ctx.on('credentials/record-updated' as never, (() => { void refreshDigest().catch(() => {}) }) as never)
  ctx.inject(['systemPrompt'], (promptCtx: Context) => {
    promptCtx.systemPrompt.context({ name: `${PLUGIN_NAME}:providers`, order: 60, text: () => digest })
  })

  /** Generate one image for a tool call and mirror it into the gallery. */
  const generateForTool = async (args: ImageArgs, exec: ExecLike, sourceImages: Array<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }>, sourceIds: string[]): Promise<GeneratedValue> => {
    const { entry, result, attachment } = await generateAndStore(services, args.provider, {
      prompt: args.prompt,
      model: args.model,
      aspectRatio: args.aspect_ratio,
      imageSize: args.image_size,
      size: args.size,
      negativePrompt: args.negative_prompt,
      sourceImages,
    }, exec.signal)
    const value: GeneratedValue = { attachment, provider: entry.id, model: result.model, output: result.output }
    const current = await settings.get()
    const workspaceRoot = exec.agent?.session.header.cwd
    if (current.saveToWorkspace && workspaceRoot !== undefined) {
      try {
        value.savedTo = await saveImageToWorkspace({ workspaceRoot, folder: current.workspaceFolder, attachmentId: attachment.attachmentId, mediaType: result.mediaType, data: result.data, signal: exec.signal })
      } catch (error) {
        exec.signal.throwIfAborted()
        value.saveError = error instanceof Error ? error.message : String(error)
      }
    }
    const sessionId = exec.agent?.session.header.id
    await gallery.addItems([{
      attachment: toAttachmentJson(attachment),
      prompt: args.prompt,
      ...(args.negative_prompt === undefined ? {} : { negativePrompt: args.negative_prompt }),
      providerId: entry.id,
      providerName: entry.name,
      model: result.model,
      output: result.output,
      projectId: CONVERSATION_PROJECT_ID,
      operation: sourceImages.length > 0 ? 'edit' : 'generate',
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      ...(value.savedTo === undefined ? {} : { savedTo: value.savedTo }),
      ...(sourceIds.length > 0 ? { sourceAttachmentIds: sourceIds } : {}),
    }]).catch((error: unknown) => {
      ctx.logger.warn(`${PLUGIN_NAME}: failed to record gallery item: ${error instanceof Error ? error.message : String(error)}`)
    })
    return value
  }

  const providerParam = { type: 'string', description: 'Optional image provider id for this call only (see the configured providers in context); omit to use the default provider.' } as const
  const sizeParams = {
    aspect_ratio: { type: 'string', enum: [...ASPECT_RATIOS], description: 'Optional aspect ratio; mapped to the closest size the provider supports.' },
    image_size: { type: 'string', enum: ['1K', '2K', '4K'], description: 'Optional resolution tier for providers that have tiers (Gemini, Seedream, xAI).' },
    size: { type: 'string', description: 'Optional exact WIDTHxHEIGHT size; overrides aspect_ratio/image_size.' },
    negative_prompt: { type: 'string', description: 'Optional things to avoid (ModelScope / SiliconFlow).' },
  } as const

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Create a new image from a text prompt with the configured image provider. Call it on your own whenever the user wants a picture — an illustration, photo, poster, logo, icon, wallpaper, concept art, or a visual to accompany your answer — not only when they say "generate". Use edit_image instead to change an existing image. Write a complete visual prompt: subject, composition, style, lighting, colors, and any exact text to render. The image is attached to the conversation and saved to the gallery; do not search for it afterwards.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image.' },
      provider: providerParam,
      model: { type: 'string', description: 'Optional model id for this call only.' },
      ...sizeParams,
    },
    output: imageOutput('Generated'),
    async execute(args, exec): Promise<GeneratedValue> {
      return generateForTool(args as ImageArgs, exec as ExecLike, [], [])
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  ctx.tools.register(defineTool({
    name: 'generate_images',
    description: 'Generate several images in one call, one per prompt, in order (variations, a set of illustrations, storyboards). Prefer generate_image for a single image. A failed item is reported and does not stop the rest.',
    parameters: {
      prompts: { type: 'array', items: { type: 'string' }, required: true, description: 'Ordered complete prompts, 1–8.' },
      provider: providerParam,
      model: { type: 'string', description: 'Optional model id applied to every item.' },
      ...sizeParams,
    },
    output: batchOutput(),
    async execute(args, exec): Promise<BatchGeneratedValue> {
      const input = args as Omit<ImageArgs, 'prompt'> & { prompts: string[] }
      if (input.prompts.length === 0) throw new Error('generate_images requires at least one prompt')
      if (input.prompts.length > 8) throw new Error('generate_images accepts at most 8 prompts per call; split larger batches')
      const images: BatchGeneratedValue['images'] = []
      const failures: BatchGeneratedValue['failures'] = []
      for (const [index, prompt] of input.prompts.entries()) {
        if ((exec as ExecLike).signal.aborted) {
          failures.push({ index, prompt, error: 'aborted' })
          continue
        }
        try {
          images.push({ ...await generateForTool({ ...input, prompt }, exec as ExecLike, [], []), prompt })
        } catch (error) {
          failures.push({ index, prompt, error: error instanceof Error ? error.message : String(error) })
        }
      }
      if (images.length === 0 && failures.length > 0) throw new Error(failures.map(failure => failure.error).join('\n'))
      return { images, failures }
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  ctx.tools.register(defineTool({
    name: 'edit_image',
    description: 'Edit, combine or restyle existing images with the configured provider. Images attached to the latest user message are already available: call edit_image right away with just a prompt — never search the disk or invent paths for them. For an older image in this conversation pass source_attachment_id(s); for a workspace file the user names pass source_path(s). Provide at most one selector. When the user wants a person/object kept identical, say so explicitly in the prompt (keep the same subject, change only …).',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What to change, and what must stay the same.' },
      provider: providerParam,
      model: { type: 'string', description: 'Optional model id for this call only (e.g. an edit model such as Qwen/Qwen-Image-Edit).' },
      source_attachment_id: { type: 'string', description: 'Attachment id of one earlier image in this conversation.' },
      source_attachment_ids: { type: 'array', items: { type: 'string' }, description: 'Ordered attachment ids of several images; "image 1/2" in the prompt follow this order.' },
      source_path: { type: 'string', description: 'Absolute or workspace-relative path of an image file in the session workspace.' },
      source_paths: { type: 'array', items: { type: 'string' }, description: 'Ordered image file paths in the session workspace.' },
      ...sizeParams,
    },
    output: imageOutput('Edited'),
    async execute(args, exec): Promise<GeneratedValue> {
      const input = args as ImageArgs & { source_attachment_id?: string; source_attachment_ids?: string[]; source_path?: string; source_paths?: string[] }
      const run = exec as ExecLike
      const sources = await resolveReferenceImages({
        ...(run.agent === undefined ? {} : { agent: run.agent as never }),
        attachments: ctx.attachments,
        ...(typeof input.source_attachment_id === 'string' ? { sourceAttachmentId: input.source_attachment_id } : {}),
        ...(Array.isArray(input.source_attachment_ids) ? { sourceAttachmentIds: input.source_attachment_ids } : {}),
        ...(typeof input.source_path === 'string' ? { sourcePath: input.source_path } : {}),
        ...(Array.isArray(input.source_paths) ? { sourcePaths: input.source_paths } : {}),
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        signal: run.signal,
      })
      if (sources.length === 0) throw new Error('edit_image found no reference image; attach one or pass source_attachment_id')
      const ids = [input.source_attachment_id, ...(input.source_attachment_ids ?? [])].filter((id): id is string => typeof id === 'string')
      return generateForTool(input, run, sources, ids)
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))
}

function attachmentSchema() {
  return {
    type: 'object', required: true, additionalProperties: false, properties: {
      attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' },
      originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
    },
  } as const
}

function imageOutput(verb: 'Generated' | 'Edited') {
  return {
    schema: {
      type: 'object', additionalProperties: false, properties: {
        attachment: attachmentSchema(),
        provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true }, savedTo: { type: 'string' }, saveError: { type: 'string' },
      },
    },
    render: (_args: unknown, value: GeneratedValue) => {
      const saved = typeof value.savedTo === 'string' ? ` Also saved to the workspace as ${value.savedTo}.` : typeof value.saveError === 'string' ? ` Saving to the workspace failed: ${value.saveError}.` : ''
      return [
        { type: 'text' as const, text: `${verb} one image with ${value.provider}/${value.model} (${value.output}). Attachment ID: ${String(value.attachment.attachmentId)}. It is attached to the conversation and stored in the gallery.${saved} Reply to the user without reading or searching for the image.` },
        { type: 'image' as const, attachment: value.attachment },
      ]
    },
    presentationMeta: (args: unknown, value: GeneratedValue) => ({
      kind: 'dsh-image-gen',
      attachment: toAttachmentJson(value.attachment),
      provider: value.provider,
      model: value.model,
      output: value.output,
      ...(verb === 'Edited' ? { operation: 'edit' } : {}),
      ...(typeof value.savedTo === 'string' ? { savedTo: value.savedTo } : {}),
      prompt: (args as { prompt: string }).prompt,
    }),
  } as const
}

function batchOutput() {
  const single = imageOutput('Generated')
  return {
    schema: {
      type: 'object', additionalProperties: false, properties: {
        images: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          attachment: attachmentSchema(),
          provider: { type: 'string', required: true }, model: { type: 'string', required: true }, output: { type: 'string', required: true }, savedTo: { type: 'string' }, saveError: { type: 'string' }, prompt: { type: 'string', required: true },
        } } },
        failures: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          index: { type: 'integer', required: true }, prompt: { type: 'string', required: true }, error: { type: 'string', required: true },
        } } },
      },
    },
    render: (_args: unknown, value: BatchGeneratedValue) => [
      {
        type: 'text' as const,
        text: `Generated ${String(value.images.length)} of ${String(value.images.length + value.failures.length)} images.${value.failures.map(failure => `\n#${String(failure.index + 1)} failed: ${failure.error}`).join('')}`,
      },
      ...value.images.flatMap(image => single.render({}, image).map(block =>
        block.type === 'text' ? { ...block, text: `${block.text}\nImage prompt: ${image.prompt}` } : block)),
    ],
    presentationMeta: (_args: unknown, value: BatchGeneratedValue) => ({
      kind: 'dsh-image-gen-batch',
      images: value.images.map(image => single.presentationMeta({ prompt: image.prompt }, image)),
    }),
  } as const
}

/** Recover the attachment from a tool result's presentation meta. */
export function imageAttachmentFromMeta(meta: unknown): ImageAttachmentRef | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const value = meta as { kind?: unknown; attachment?: unknown }
  return value.kind === 'dsh-image-gen' ? parseImageAttachmentRef(value.attachment) : undefined
}

function imagePresentation(result: ToolResult) {
  const meta = result.meta as { kind?: unknown; images?: unknown } | undefined
  if (meta !== undefined && meta !== null && meta.kind === 'dsh-image-gen-batch' && Array.isArray(meta.images)) {
    const content = meta.images.flatMap(image => {
      const attachment = imageAttachmentFromMeta(image)
      return attachment === undefined ? [] : [{ type: 'image' as const, attachment }]
    })
    return content.length === 0 ? undefined : { card: 'generic' as const, title: 'Generated images', content }
  }
  const attachment = imageAttachmentFromMeta(result.meta)
  return attachment === undefined ? undefined : { card: 'generic' as const, title: 'Generated image', content: [{ type: 'image' as const, attachment }] }
}
