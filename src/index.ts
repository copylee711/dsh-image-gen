/**
 * @copylee/dsh-image-gen Host bundle: Agent image tools, the paintings/gallery/settings
 * routes, and the conversation context line telling the model it can draw.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from './system-prompt-service.js'
import { credentialKeyStore, fileKeyStore, hasRecordApi, layeredKeyStore } from './credentials.js'
import { GalleryDb } from './gallery-db.js'
import { CONVERSATION_PROJECT_ID } from './gallery-types.js'
import { serveImport } from './import-route.js'
import { GENIMG_SCHEME, JobRegistry, expectedRatio, jobsRoute } from './jobs.js'
import { parseImageAttachmentRef, resolveReferenceImages } from './reference-image.js'
import { galleryRoute, imageRoute, proxyStatusRoute, keyRoute, modelsRoute, paintRoute, settingsRoute, testRoute } from './routes.js'
import { generateAndStore, saveImageCopy, toAttachmentJson, type PluginServices } from './services.js'
import { SettingsStore } from './settings-store.js'
import {
  ASPECT_RATIOS,
  GALLERY_ROUTE,
  IMAGE_ROUTE,
  IMPORT_ROUTE,
  JOBS_ROUTE,
  KEY_ROUTE,
  MODELS_ROUTE,
  PAINT_ROUTE,
  PROXY_STATUS_ROUTE,
  PACKAGE_NAME,
  PLUGIN_SLUG,
  SETTINGS_ROUTE,
  TEST_ROUTE,
  capabilitiesOf,
  effectiveModel,
  type PluginSettings,
} from './shared.js'
import { resolveDataDir } from './storage.js'
import { saveImageToWorkspace } from './workspace-save.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Background image job notices (finished / failed after the call returned). */
    'copylee-image-gen': { kind: 'copylee-image-gen' } & ContextFormed
  }
}

export const name = PACKAGE_NAME
export const inject = ['tools', 'attachments', 'credentials', 'webServer']

export interface Config {
  /** Override the folder holding settings.json / gallery.json. */
  dataDir?: string
}

export const Config: z<Config> = z.object({
  dataDir: z.string().description('设置与画廊数据目录；留空使用 ~/.dsh/storages/copylee-image-gen'),
}) as z<Config>

interface GeneratedValue {
  /** Job id; the reply embeds the image as `genimg:<jobId>`. */
  jobId: string
  attachment: ImageAttachmentRef
  provider: string
  model: string
  output: string
  savedTo?: string
  saveError?: string
}

/** A `background: true` call: the image is still being generated. */
interface PendingValue {
  jobId: string
  pending: true
}

type ImageValue = GeneratedValue | PendingValue

function isPending(value: ImageValue): value is PendingValue {
  return 'pending' in value
}

type SourceImages = Array<{ data: Uint8Array; mediaType: ImageAttachmentRef['mediaType'] }>

interface BatchGeneratedValue {
  images: (ImageValue & { prompt: string })[]
  failures: { index: number; prompt: string; error: string }[]
}

interface ExecLike {
  agent?: {
    session: { header: { id?: unknown; cwd?: string }; deriveMessages(): readonly unknown[] }
    status?: 'idle' | 'running'
    followup?(message: UserMessage): void
    inject?(message: UserMessage): void
  } | undefined
  signal: AbortSignal
}

/**
 * Tell the calling Agent how a background job ended, as a collapsed notice row.
 * A failure wakes an idle Agent so it can retry or explain; a success is only
 * queued as context for its next step (the image already shows in the reply).
 */
export function notifyBackgroundJob(exec: ExecLike, outcome: { jobId: string; prompt: string; error?: string }): void {
  const agent = exec.agent
  if (agent === undefined) return
  const failed = outcome.error !== undefined
  const subject = outcome.prompt.length > 60 ? `${outcome.prompt.slice(0, 57)}...` : outcome.prompt
  const message = createUserMessage({
    content: [{
      type: 'text',
      text: failed
        ? `Background image job ${outcome.jobId} failed: ${String(outcome.error)}\nImage prompt: ${outcome.prompt}\nIts placeholder in your earlier reply now shows the failure. Tell the user briefly, and retry with paint_image (background: true) if a fix is obvious (another provider, a simpler prompt); otherwise explain what they can change.`
        : `Background image job ${outcome.jobId} finished; genimg:${outcome.jobId} now shows the image in your reply. No action needed.`,
    }],
    source: { kind: 'copylee-image-gen', form: 'notice', summary: `${failed ? 'Image generation failed' : 'Image generated'}: ${subject}`.slice(0, 120) },
  })
  try {
    if (failed && agent.status === 'idle' && agent.followup !== undefined) agent.followup(message)
    else agent.inject?.(message)
  } catch {
    // The Agent was disposed (conversation closed); the placeholder still shows the outcome.
  }
}

interface ImageArgs {
  prompt: string
  provider?: string | undefined
  model?: string | undefined
  aspect_ratio?: string | undefined
  image_size?: string | undefined
  size?: string | undefined
  negative_prompt?: string | undefined
  background?: boolean | undefined
}

/** One line per enabled provider for the model's context and errors. */
export function providerDigest(settings: PluginSettings, keyed: ReadonlySet<string>): string {
  if (!settings.chatTools) return ''
  const rows = settings.providers
    .filter(entry => entry.enabled && entry.baseURL.length > 0 && keyed.has(entry.id))
    .map(entry => {
      const caps = capabilitiesOf(entry)
      const model = effectiveModel(entry)
      const edit = caps.maxReferences > 0 ? `edit≤${String(caps.maxReferences)}` : 'no-edit'
      const size = caps.customSize === undefined
        ? `sizes via aspect_ratio${caps.tiers.length > 0 ? ` + image_size ${caps.tiers.join('/')}` : ''}`
        : `size ${String(caps.customSize.min)}–${String(caps.customSize.max)}px per side`
      return `- ${entry.id}${entry.id === settings.activeProvider ? ' (default)' : ''}: ${entry.name}, model ${model || '?'}, ${edit}, ${size}`
    })
  if (rows.length === 0) {
    return 'Image generation tools (paint_image, edit_painting) are installed but no image provider has an API key yet; if the user asks for an image, tell them to configure one in Settings > Plugins > 图像生成.'
  }
  return [
    'You can create images with paint_image / paint_images and modify images with edit_painting whenever a picture would genuinely help the user (they ask for an image, illustration, poster, logo, diagram-like visual, or edits to an attached image). Do not generate images unprompted for plain text questions.',
    'Pass `background: true` for an illustration that accompanies an explanation (a diagram for a lesson, a picture beside the text): the tool returns at once and you keep writing while the image renders. Keep the default blocking call when the image itself is the deliverable or your next words depend on it.',
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
  const services: PluginServices = { settings, keys, gallery, attachments: ctx.attachments, dataDir }
  const jobs = new JobRegistry(gallery)
  ctx.effect(() => () => jobs.dispose(), `${PLUGIN_SLUG}: image jobs`)

  const route = (kind: 'exact' | 'prefix', path: string, handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>): void => {
    // Never let a throw reach the host server: it answers a bare, body-less 400.
    const safe = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
      try {
        await handler(req, res)
      } catch (error) {
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    }
    ctx.effect(() => ctx.webServer.register({ kind, path, handler: safe }), `${PLUGIN_SLUG}: ${path}`)
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
  route('exact', PROXY_STATUS_ROUTE, proxyStatusRoute())
  route('prefix', JOBS_ROUTE, jobsRoute(services, jobs, JOBS_ROUTE))

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
  ctx.effect(() => settings.onChange(() => { void refreshDigest().catch(() => {}) }), `${PLUGIN_SLUG}: digest refresh`)
  ctx.on('credentials/record-updated' as never, (() => { void refreshDigest().catch(() => {}) }) as never)
  ctx.inject(['systemPrompt'], (promptCtx: Context) => {
    promptCtx.systemPrompt.context({ name: `${PLUGIN_SLUG}:providers`, order: 60, text: () => digest })
  })

  /** Generate one image under a job and mirror it into the gallery. */
  const generateImage = async (jobId: string, args: ImageArgs, exec: ExecLike, sourceImages: SourceImages, sourceIds: string[], signal: AbortSignal): Promise<GeneratedValue> => {
    const { entry, result, attachment } = await generateAndStore(services, args.provider, {
      prompt: args.prompt,
      model: args.model,
      aspectRatio: args.aspect_ratio,
      imageSize: args.image_size,
      size: args.size,
      negativePrompt: args.negative_prompt,
      sourceImages,
    }, signal)
    const value: GeneratedValue = { jobId, attachment, provider: entry.id, model: result.model, output: result.output }
    const current = await settings.get()
    const workspaceRoot = exec.agent?.session.header.cwd
    if (current.saveToWorkspace && workspaceRoot !== undefined) {
      try {
        value.savedTo = await saveImageToWorkspace({ workspaceRoot, folder: current.workspaceFolder, attachmentId: attachment.attachmentId, mediaType: result.mediaType, data: result.data, signal })
      } catch (error) {
        signal.throwIfAborted()
        value.saveError = error instanceof Error ? error.message : String(error)
      }
    }
    const sessionId = exec.agent?.session.header.id
    const filePath = await saveImageCopy(services, toAttachmentJson(attachment), result.data, args.prompt)
    await gallery.addItems([{
      attachment: toAttachmentJson(attachment),
      ...(filePath === undefined ? {} : { filePath }),
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
      jobId,
    }]).catch((error: unknown) => {
      ctx.logger.warn(`${PLUGIN_SLUG}: failed to record gallery item: ${error instanceof Error ? error.message : String(error)}`)
    })
    return value
  }

  /** Run one job; settles it with the finished attachment. */
  const runJob = (jobId: string, args: ImageArgs, exec: ExecLike, sourceImages: SourceImages, sourceIds: string[], parent?: AbortSignal): Promise<GeneratedValue> =>
    jobs.run(jobId, async signal => {
      const value = await generateImage(jobId, args, exec, sourceImages, sourceIds, signal)
      return { attachment: toAttachmentJson(value.attachment), path: value.savedTo, value }
    }, parent).then(settled => settled.value)

  /** Background job: failures are logged (the placeholder shows them) and reported to the Agent. */
  const startBackground = (jobId: string, args: ImageArgs, exec: ExecLike, sourceImages: SourceImages, sourceIds: string[]): Promise<void> =>
    runJob(jobId, args, exec, sourceImages, sourceIds).then(() => {
      notifyBackgroundJob(exec, { jobId, prompt: args.prompt })
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`${PLUGIN_SLUG}: background image ${jobId} failed: ${message}`)
      if (!jobs.stopped) notifyBackgroundJob(exec, { jobId, prompt: args.prompt, error: message })
    })

  /** One generation as a job; `background` returns the pending job at once. */
  const generateForTool = async (args: ImageArgs, exec: ExecLike, sourceImages: SourceImages, sourceIds: string[]): Promise<ImageValue> => {
    const job = jobs.create(expectedRatio(args))
    if (args.background !== true) return runJob(job.id, args, exec, sourceImages, sourceIds, exec.signal)
    void startBackground(job.id, args, exec, sourceImages, sourceIds)
    return { jobId: job.id, pending: true }
  }

  /** The conversation tools; registered only while settings.chatTools is on. */
  const toolDefinitions: Array<Parameters<typeof ctx.tools.register>[0]> = []

  const providerParam = { type: 'string', description: 'Optional image provider id for this call only (see the configured providers in context); omit to use the default provider.' } as const
  const sizeParams = {
    aspect_ratio: { type: 'string', enum: [...ASPECT_RATIOS], description: 'Optional aspect ratio; mapped to the closest size the provider supports.' },
    image_size: { type: 'string', enum: ['1K', '2K', '4K'], description: 'Optional resolution tier for providers that have tiers (Gemini, Seedream, xAI).' },
    size: { type: 'string', description: 'Optional exact WIDTHxHEIGHT size such as 1536x1024 or 2048x1152; overrides aspect_ratio/image_size. Use it when the user asks for a resolution; each provider\'s allowed range is listed in context.' },
    negative_prompt: { type: 'string', description: 'Optional things to avoid (ModelScope / SiliconFlow).' },
    background: { type: 'boolean', description: 'true: return immediately and finish the image in the background while you keep answering (best for an illustration inside an explanation; embed its genimg reference where it belongs and do not wait for it). Default false: wait for the finished image.' },
  } as const

  toolDefinitions.push(defineTool({
    name: 'paint_image',
    description: 'Create a new image from a text prompt with the configured image provider. Call it on your own whenever the user wants a picture — an illustration, photo, poster, logo, icon, wallpaper, concept art, or a visual to accompany your answer — not only when they say "generate". Use edit_painting instead to change an existing image. Write a complete visual prompt: subject, composition, style, lighting, colors, and any exact text to render. The image is attached to the conversation and saved to the gallery; do not search for it afterwards.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete description of the image.' },
      provider: providerParam,
      model: { type: 'string', description: 'Optional model id for this call only.' },
      ...sizeParams,
    },
    output: imageOutput('Generated'),
    async execute(args, exec): Promise<ImageValue> {
      return generateForTool(args as ImageArgs, exec as ExecLike, [], [])
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  toolDefinitions.push(defineTool({
    name: 'paint_images',
    description: 'Generate several images in one call, one per prompt, in order (variations, a set of illustrations, storyboards). Prefer paint_image for a single image. A failed item is reported and does not stop the rest.',
    parameters: {
      prompts: { type: 'array', items: { type: 'string' }, required: true, description: 'Ordered complete prompts, 1–8.' },
      provider: providerParam,
      model: { type: 'string', description: 'Optional model id applied to every item.' },
      ...sizeParams,
    },
    output: batchOutput(),
    async execute(args, exec): Promise<BatchGeneratedValue> {
      const input = args as Omit<ImageArgs, 'prompt'> & { prompts: string[] }
      if (input.prompts.length === 0) throw new Error('paint_images requires at least one prompt')
      if (input.prompts.length > 8) throw new Error('paint_images accepts at most 8 prompts per call; split larger batches')
      if (input.background === true) {
        // One pending job per prompt, generated one after another in the background.
        const queued = input.prompts.map(prompt => ({ prompt, job: jobs.create(expectedRatio(input)) }))
        void (async () => {
          for (const { prompt, job } of queued) await startBackground(job.id, { ...input, prompt }, exec as ExecLike, [], [])
        })()
        return { images: queued.map(({ prompt, job }) => ({ jobId: job.id, pending: true as const, prompt })), failures: [] }
      }
      const images: BatchGeneratedValue['images'] = []
      const failures: BatchGeneratedValue['failures'] = []
      for (const [index, prompt] of input.prompts.entries()) {
        if ((exec as ExecLike).signal.aborted) {
          failures.push({ index, prompt, error: 'aborted' })
          continue
        }
        try {
          images.push({ ...await generateForTool({ ...input, prompt, background: false }, exec as ExecLike, [], []), prompt })
        } catch (error) {
          failures.push({ index, prompt, error: error instanceof Error ? error.message : String(error) })
        }
      }
      if (images.length === 0 && failures.length > 0) throw new Error(failures.map(failure => failure.error).join('\n'))
      return { images, failures }
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  toolDefinitions.push(defineTool({
    name: 'edit_painting',
    description: 'Edit, combine or restyle existing images with the configured provider. Images attached to the latest user message are already available: call edit_painting right away with just a prompt — never search the disk or invent paths for them. For an older image in this conversation pass source_attachment_id(s); for a workspace file the user names pass source_path(s). Provide at most one selector. When the user wants a person/object kept identical, say so explicitly in the prompt (keep the same subject, change only …).',
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
    async execute(args, exec): Promise<ImageValue> {
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
      if (sources.length === 0) throw new Error('edit_painting found no reference image; attach one or pass source_attachment_id')
      const ids = [input.source_attachment_id, ...(input.source_attachment_ids ?? [])].filter((id): id is string => typeof id === 'string')
      return generateForTool(input, run, sources, ids)
    },
    presentResult: (_args, result) => imagePresentation(result),
  }))

  // Settings > 对话 > chatTools switches the tools on and off without a restart.
  let unregisterTools: (() => void) | undefined
  let disposed = false
  const syncTools = async (): Promise<void> => {
    const enabled = (await settings.get()).chatTools
    if (disposed) return
    if (enabled && unregisterTools === undefined) {
      const disposers = toolDefinitions.map(definition => ctx.tools.register(definition))
      unregisterTools = () => { for (const dispose of disposers) dispose() }
    } else if (!enabled && unregisterTools !== undefined) {
      unregisterTools()
      unregisterTools = undefined
    }
  }
  void syncTools().catch(error => ctx.logger.warn(`${PLUGIN_SLUG}: failed to register tools: ${String(error)}`))
  ctx.effect(() => settings.onChange(() => { void syncTools().catch(() => {}) }), `${PLUGIN_SLUG}: tool switch`)
  ctx.effect(() => () => {
    disposed = true
    unregisterTools?.()
    unregisterTools = undefined
  }, `${PLUGIN_SLUG}: tools`)
}

function attachmentSchema() {
  return {
    type: 'object', additionalProperties: false, properties: {
      attachmentId: { type: 'string', required: true }, mediaType: { type: 'string', required: true }, bytes: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true }, name: { type: 'string' },
      originalDimensions: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } } },
    },
  } as const
}

/** Fields of one image value: finished (attachment, provider…) or pending. */
function imageValueProperties() {
  return {
    jobId: { type: 'string', required: true }, pending: { type: 'boolean' },
    attachment: attachmentSchema(),
    provider: { type: 'string' }, model: { type: 'string' }, output: { type: 'string' }, savedTo: { type: 'string' }, saveError: { type: 'string' },
  } as const
}

/** The inline reference a renderer (dsh-better-display) turns into the image or its placeholder. */
function inlineReference(jobId: string): string {
  return `Inline image reference: ${GENIMG_SCHEME}${jobId}`
}

function imageOutput(verb: 'Generated' | 'Edited') {
  return {
    schema: { type: 'object', additionalProperties: false, properties: imageValueProperties() },
    render: (_args: unknown, value: ImageValue) => {
      if (isPending(value)) {
        return [{ type: 'text' as const, text: `Image job ${value.jobId} is running in the background. ${inlineReference(value.jobId)}. Keep answering: do not wait for, poll or search for the image. You will be notified only if it fails.` }]
      }
      const saved = typeof value.savedTo === 'string' ? ` Also saved to the workspace as ${value.savedTo}.` : typeof value.saveError === 'string' ? ` Saving to the workspace failed: ${value.saveError}.` : ''
      return [
        { type: 'text' as const, text: `${verb} one image with ${value.provider}/${value.model} (${value.output}). Attachment ID: ${String(value.attachment.attachmentId)}. ${inlineReference(value.jobId)}. It is attached to the conversation and stored in the gallery.${saved} Reply to the user without reading or searching for the image.` },
        { type: 'image' as const, attachment: value.attachment },
      ]
    },
    presentationMeta: (args: unknown, value: ImageValue) => {
      const prompt = (args as { prompt: string }).prompt
      if (isPending(value)) return { kind: 'copylee-image-gen', jobId: value.jobId, pending: true, prompt }
      return {
        kind: 'copylee-image-gen',
        jobId: value.jobId,
        attachment: toAttachmentJson(value.attachment),
        provider: value.provider,
        model: value.model,
        output: value.output,
        ...(verb === 'Edited' ? { operation: 'edit' } : {}),
        ...(typeof value.savedTo === 'string' ? { savedTo: value.savedTo } : {}),
        prompt,
      }
    },
  } as const
}

function batchOutput() {
  const single = imageOutput('Generated')
  return {
    schema: {
      type: 'object', additionalProperties: false, properties: {
        images: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { ...imageValueProperties(), prompt: { type: 'string', required: true } } } },
        failures: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          index: { type: 'integer', required: true }, prompt: { type: 'string', required: true }, error: { type: 'string', required: true },
        } } },
      },
    },
    render: (_args: unknown, value: BatchGeneratedValue) => {
      const pending = value.images.filter(isPending).length
      const head = pending === value.images.length && pending > 0
        ? `Started ${String(pending)} background image jobs (generated one after another).`
        : `Generated ${String(value.images.length)} of ${String(value.images.length + value.failures.length)} images.`
      return [
        { type: 'text' as const, text: `${head}${value.failures.map(failure => `\n#${String(failure.index + 1)} failed: ${failure.error}`).join('')}` },
        ...value.images.flatMap(image => single.render({}, image).map(block =>
          block.type === 'text' ? { ...block, text: `${block.text}\nImage prompt: ${image.prompt}` } : block)),
      ]
    },
    presentationMeta: (_args: unknown, value: BatchGeneratedValue) => ({
      kind: 'copylee-image-gen-batch',
      images: value.images.map(image => single.presentationMeta({ prompt: image.prompt }, image)),
    }),
  } as const
}

/** Recover the attachment from a tool result's presentation meta. */
export function imageAttachmentFromMeta(meta: unknown): ImageAttachmentRef | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const value = meta as { kind?: unknown; attachment?: unknown }
  return value.kind === 'copylee-image-gen' ? parseImageAttachmentRef(value.attachment) : undefined
}

function imagePresentation(result: ToolResult) {
  const meta = result.meta as { kind?: unknown; images?: unknown } | undefined
  if (meta !== undefined && meta !== null && meta.kind === 'copylee-image-gen-batch' && Array.isArray(meta.images)) {
    const content = meta.images.flatMap(image => {
      const attachment = imageAttachmentFromMeta(image)
      return attachment === undefined ? [] : [{ type: 'image' as const, attachment }]
    })
    return content.length === 0 ? undefined : { card: 'generic' as const, title: 'Generated images', content }
  }
  const attachment = imageAttachmentFromMeta(result.meta)
  return attachment === undefined ? undefined : { card: 'generic' as const, title: 'Generated image', content: [{ type: 'image' as const, attachment }] }
}
