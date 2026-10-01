/** Same-origin JSON routes backing the paintings page, gallery and settings. */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { CONVERSATION_PROJECT_ID, DEFAULT_PROJECT_ID, type AttachmentJson, type GalleryItem } from './gallery-types.js'
import { SYSTEM_PROXY_MISSING, providerFetch, resetDispatchers, validateProxyUrl, type FetchLike } from './http.js'
import { detectSystemProxy, resetSystemProxyCache } from './system-proxy.js'
import { parseImageAttachmentRef } from './reference-image.js'
import { ensureVersionedBase } from './download.js'
import { RouteError, jsonRoute, readJsonBody, requestSignal, sendJson, str, stringArray } from './route-util.js'
import { fileExists, openFolder, removeImageCopy, revealInFileManager } from './image-files.js'
import { generateAndStore, imageDir, saveImageCopy, settingsView, toAttachmentJson, type PluginServices } from './services.js'
import { normalizeSettings, requireProvider } from './settings-store.js'
import { capabilitiesOf, effectiveModel, type GlobalProxy, type ProviderEntry } from './shared.js'
import { redactSecrets } from './redact.js'

const SMALL_BODY = 256 * 1024
const PROXY_PROBE_URL = 'https://www.gstatic.com/generate_204'

/** `GET ?ref=<json>` → image bytes. Cross-site embeds are refused. */
export function imageRoute(services: PluginServices) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { error: 'cross-site' })
    let raw: unknown
    try {
      if (req.method === 'GET') {
        const param = new URL(req.url ?? '/', 'http://local').searchParams.get('ref')
        raw = param === null ? undefined : JSON.parse(param)
      } else {
        raw = (await readJsonBody(req, SMALL_BODY)).attachment
      }
    } catch {
      return sendJson(res, 400, { error: 'invalid-request' })
    }
    const ref = parseImageAttachmentRef(raw)
    if (ref === undefined) return sendJson(res, 400, { error: 'invalid-attachment' })
    try {
      const stored = await services.attachments.readImage(ref)
      res.writeHead(200, {
        'content-type': stored.ref.mediaType,
        'content-length': String(stored.data.byteLength),
        // Content-addressed: the bytes behind one ref never change.
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      })
      res.end(stored.data)
    } catch {
      sendJson(res, 404, { error: 'image-unavailable' })
    }
  }
}

/** GET → settings view; POST `{ settings }` → save, answer the new view. */
export function settingsRoute(services: PluginServices) {
  return jsonRoute(['GET', 'POST'], async req => {
    if (req.method === 'POST') {
      const body = await readJsonBody(req, SMALL_BODY)
      try {
        await services.settings.save(body.settings)
      } catch (error) {
        throw new RouteError(400, error instanceof Error ? error.message : String(error))
      }
      resetDispatchers()
      resetSystemProxyCache()
    }
    return settingsView(services)
  })
}

/** POST `{ providerId, key }`; a blank/null key clears it. */
export function keyRoute(services: PluginServices) {
  return jsonRoute(['POST'], async req => {
    const body = await readJsonBody(req, SMALL_BODY)
    const providerId = str(body.providerId)?.trim() ?? ''
    const settings = await services.settings.get()
    if (!settings.providers.some(entry => entry.id === providerId)) throw new RouteError(404, 'unknown-provider')
    const key = str(body.key)?.trim() ?? ''
    if (key.length === 0) await services.keys.unset(providerId)
    else await services.keys.set(providerId, key)
    return { ok: true, keyConfigured: key.length > 0 }
  })
}

/** Where a protocol lists its models (also the connection probe). */
export function modelsURL(entry: Pick<ProviderEntry, 'protocol' | 'baseURL'>): string | undefined {
  try {
    if (entry.protocol === 'gemini') {
      const url = new URL(entry.baseURL)
      const version = /\/(v1(?:beta|alpha)?)\b/.exec(url.pathname)?.[1] ?? 'v1beta'
      return `${url.origin}/${version}/models`
    }
    if (entry.protocol === 'dashscope') {
      // DashScope has no model listing on the native API; use its compatible mode.
      const url = new URL(entry.baseURL)
      return `${url.origin}/compatible-mode/v1/models`
    }
    const raw = entry.protocol === 'modelscope' || entry.protocol === 'siliconflow' ? ensureVersionedBase(entry.baseURL) : entry.baseURL
    const base = raw.endsWith('/') ? raw : `${raw}/`
    return new URL('models', base).toString()
  } catch {
    return undefined
  }
}

function authHeaders(entry: Pick<ProviderEntry, 'protocol'>, key: string | undefined): Record<string, string> {
  if (key === undefined) return {}
  return entry.protocol === 'gemini' ? { 'x-goog-api-key': key } : { authorization: `Bearer ${key}` }
}

/** Pull model ids out of OpenAI-style `{ data: [{ id }] }` or Gemini `{ models: [{ name }] }`. */
export function modelIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return []
  const record = payload as { data?: unknown; models?: unknown }
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : []
  const ids = list.map(item => {
    if (typeof item === 'string') return item
    const entry = item as { id?: unknown; name?: unknown }
    const raw = typeof entry.id === 'string' ? entry.id : typeof entry.name === 'string' ? entry.name : ''
    return raw.replace(/^models\//, '')
  })
  return [...new Set(ids.filter(id => id.length > 0))].sort()
}

/** Heuristic for “looks like an image-generation model”. */
export const IMAGE_MODEL_HINT = /image|imagen|nano-banana|dall-?e|seedream|seededit|flux|kolors|cogview|wanx|wan-?2|hunyuan-?image|kandinsky|majicflus|sd-?xl|sd3|stable-diffusion|diffusion|midjourney|hidream|playground|recraft|ideogram|grok-imagine/i

/** Split a model list into all ids and the image-like subset. */
export function classifyModels(ids: readonly string[]): { models: string[]; imageModels: string[] } {
  return { models: [...ids], imageModels: ids.filter(id => IMAGE_MODEL_HINT.test(id)) }
}

/** Merge a draft entry from the browser over the stored one (test before save). */
async function draftEntry(services: PluginServices, body: Record<string, unknown>): Promise<{ entry: ProviderEntry; proxy: GlobalProxy; key: string | undefined }> {
  const settings = await services.settings.get()
  const providerId = str(body.providerId)?.trim() ?? ''
  const stored = settings.providers.find(entry => entry.id === providerId)
  let entry = stored
  if (body.entry !== undefined) {
    const merged = normalizeSettings({ providers: [body.entry] }).providers.find(candidate => candidate.id === (body.entry as { id?: unknown }).id)
    if (merged !== undefined) entry = merged
  }
  if (entry === undefined) throw new RouteError(404, 'unknown-provider')
  const proxy = body.proxy === undefined ? settings.proxy : normalizeSettings({ proxy: body.proxy }).proxy
  const draftKey = str(body.key)?.trim()
  const key = draftKey !== undefined && draftKey.length > 0 ? draftKey : await services.keys.get(entry.id)
  return { entry, proxy, key }
}

async function listModels(fetcher: FetchLike, entry: ProviderEntry, key: string | undefined, signal: AbortSignal): Promise<{ status: number; ids: string[]; text: string }> {
  const url = modelsURL(entry)
  if (url === undefined) throw new RouteError(400, '端点不是合法的 URL')
  const response = await fetcher(url, { method: 'GET', redirect: 'follow', signal, headers: authHeaders(entry, key) })
  const text = await response.text()
  let ids: string[] = []
  try {
    ids = modelIds(JSON.parse(text))
  } catch {
    // non-JSON answers just carry no ids
  }
  return { status: response.status, ids, text: redactSecrets(text, key).slice(0, 400) }
}

/**
 * POST `{ providerId, entry?, key?, proxy? }` → connectivity verdict, or
 * `{ proxyUrl }` → probe the proxy itself.
 */
export function testRoute(services: PluginServices) {
  return jsonRoute(['POST'], async req => {
    const body = await readJsonBody(req, SMALL_BODY)
    const signal = AbortSignal.timeout(20_000)
    const started = Date.now()
    let proxyUrl = str(body.proxyUrl)?.trim()
    if (proxyUrl === 'system') {
      const system = await detectSystemProxy({ refresh: true })
      if (system === null) return { ok: false, message: SYSTEM_PROXY_MISSING }
      proxyUrl = system.url
    }
    if (proxyUrl !== undefined) {
      const problem = validateProxyUrl(proxyUrl)
      if (problem !== undefined) return { ok: false, message: problem }
      const fetcher = services.fetch ?? providerFetch({ mode: 'custom', url: proxyUrl }, { mode: 'off', enabled: false, url: '', noProxy: [] })
      try {
        const response = await fetcher(PROXY_PROBE_URL, { method: 'GET', signal })
        return { ok: response.status < 500, status: response.status, latencyMs: Date.now() - started, message: `代理可用（HTTP ${String(response.status)}）` }
      } catch (error) {
        return { ok: false, message: `代理不可用：${error instanceof Error ? error.message : String(error)}` }
      }
    }
    const { entry, proxy, key } = await draftEntry(services, body)
    if (entry.baseURL.length === 0) return { ok: false, message: '尚未填写端点 Base URL' }
    if (key === undefined) return { ok: false, message: '尚未配置 API Key' }
    const fetcher = services.fetch ?? providerFetch(entry.proxy, proxy)
    try {
      const listed = await listModels(fetcher, entry, key, signal)
      const latencyMs = Date.now() - started
      if (listed.status === 401 || listed.status === 403) return { ok: false, status: listed.status, latencyMs, message: `API Key 无效或无权限（HTTP ${String(listed.status)}）` }
      if (listed.status >= 200 && listed.status < 300) return { ok: true, status: listed.status, latencyMs, message: `连接成功：共 ${String(listed.ids.length)} 个模型，其中 ${String(classifyModels(listed.ids).imageModels.length)} 个识别为生图模型` }
      // Some image endpoints have no /models; reaching the host still proves the network path.
      if (listed.status === 404 || listed.status === 405) return { ok: true, status: listed.status, latencyMs, message: '端点可达（该服务不提供模型列表，未校验 Key）' }
      return { ok: false, status: listed.status, latencyMs, message: `HTTP ${String(listed.status)}：${listed.text}` }
    } catch (error) {
      if (error instanceof RouteError) throw error
      return { ok: false, message: `网络错误：${error instanceof Error ? error.message : String(error)}` }
    }
  })
}

/** GET → the detected system proxy (always re-detected). */
export function proxyStatusRoute() {
  return jsonRoute(['GET', 'POST'], async () => ({ system: await detectSystemProxy({ refresh: true }) }))
}

/** POST `{ providerId, entry?, key? }` → every model id plus the image-like subset. */
export function modelsRoute(services: PluginServices) {
  return jsonRoute(['POST'], async req => {
    const body = await readJsonBody(req, SMALL_BODY)
    const { entry, proxy, key } = await draftEntry(services, body)
    const fetcher = services.fetch ?? providerFetch(entry.proxy, proxy)
    const listed = await listModels(fetcher, entry, key, AbortSignal.timeout(20_000))
    if (listed.status < 200 || listed.status >= 300) throw new RouteError(502, `拉取模型失败（HTTP ${String(listed.status)}）：${listed.text}`)
    return { ...classifyModels(listed.ids), total: listed.ids.length }
  })
}

/** POST a paintings-page request: N images, saved straight into the gallery. */
export function paintRoute(services: PluginServices) {
  return jsonRoute(['POST'], async (req, res) => {
    const body = await readJsonBody(req, 8 * 1024 * 1024)
    const signal = requestSignal(req, res)
    const prompt = str(body.prompt)?.trim() ?? ''
    if (prompt.length === 0) throw new RouteError(400, 'Prompt 不能为空')
    const settings = await services.settings.get()
    let entry: ProviderEntry
    try {
      entry = requireProvider(settings, str(body.providerId))
    } catch (error) {
      throw new RouteError(400, error instanceof Error ? error.message : String(error))
    }
    const caps = capabilitiesOf(entry)
    const count = Math.min(caps.maxCount, Math.max(1, Math.trunc(Number(body.count) || 1)))
    const refs = (Array.isArray(body.references) ? body.references : []).map(parseImageAttachmentRef)
    if (refs.some(ref => ref === undefined)) throw new RouteError(400, 'invalid-reference')
    const sourceImages = await Promise.all((refs as ImageAttachmentRef[]).map(async ref => {
      const stored = await services.attachments.readImage(ref, signal)
      return { data: stored.data, mediaType: stored.ref.mediaType }
    }))
    const seedValue = Number(body.seed)
    const request = {
      prompt,
      model: str(body.model),
      aspectRatio: str(body.aspectRatio),
      imageSize: str(body.imageSize),
      size: str(body.size),
      quality: str(body.quality),
      negativePrompt: str(body.negativePrompt),
      ...(Number.isSafeInteger(seedValue) && seedValue >= 0 && body.seed !== null && body.seed !== '' ? { seed: seedValue } : {}),
      sourceImages,
    }
    const projectId = str(body.projectId) ?? DEFAULT_PROJECT_ID
    const batchId = randomUUID()
    const outcomes = await Promise.allSettled(Array.from({ length: count }, () => generateAndStore(services, entry.id, request, signal)))
    const done = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : [])
    const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)] : [])
    const copies = await Promise.all(done.map(({ attachment, result }) => saveImageCopy(services, toAttachmentJson(attachment), result.data, prompt)))
    const items = done.length === 0 ? [] : await services.gallery.addItems(done.map(({ attachment, result }, index) => ({
      attachment: toAttachmentJson(attachment),
      ...(copies[index] === undefined ? {} : { filePath: copies[index] }),
      prompt,
      ...(request.negativePrompt === undefined || request.negativePrompt.length === 0 ? {} : { negativePrompt: request.negativePrompt }),
      providerId: entry.id,
      providerName: entry.name,
      model: result.model || effectiveModel(entry, request.model),
      output: result.output,
      projectId,
      batchId,
      operation: sourceImages.length > 0 ? 'edit' as const : 'generate' as const,
      ...(sourceImages.length > 0 ? { sourceAttachmentIds: (refs as ImageAttachmentRef[]).map(ref => String(ref.attachmentId)) } : {}),
    })))
    if (items.length === 0 && failures.length > 0) throw new RouteError(502, failures[0]!)
    return { items, failures }
  })
}

/**
 * Path of the item's readable copy, writing it now for items that predate
 * copies or whose file was moved away.
 */
async function ensureCopy(services: PluginServices, item: GalleryItem): Promise<string> {
  if (item.filePath !== undefined && await fileExists(item.filePath)) return item.filePath
  const ref = parseImageAttachmentRef(item.attachment)
  if (ref === undefined) throw new RouteError(404, '图片引用无效')
  const stored = await services.attachments.readImage(ref)
  const path = await saveImageCopy(services, item.attachment, stored.data, item.prompt)
  if (path === undefined) throw new RouteError(500, '无法写入图片文件，请检查「图片保存目录」')
  await services.gallery.setFilePath(item.id, path)
  return path
}

function attachmentList(value: unknown): AttachmentJson[] {
  if (!Array.isArray(value)) return []
  return value.map(parseImageAttachmentRef).filter((ref): ref is ImageAttachmentRef => ref !== undefined).map(toAttachmentJson)
}

/** POST `{ op, ... }` — every gallery read and write. */
export function galleryRoute(services: PluginServices) {
  let revision = 0
  services.gallery.onChange(() => { revision++ })
  return jsonRoute(['POST'], async req => {
    const body = await readJsonBody(req, 2 * 1024 * 1024)
    const gallery = services.gallery
    const ids = stringArray(body.ids)
    try {
      switch (body.op) {
        case 'revision': return { revision }
        case 'projects': return { revision, projects: await gallery.projects() }
        case 'list': return {
          revision,
          ...(await gallery.list({
            projectId: str(body.projectId),
            favorite: body.favorite === true ? true : undefined,
            providerId: str(body.providerId),
            sessionId: str(body.sessionId),
            query: str(body.query),
            order: body.order === 'asc' ? 'asc' : 'desc',
            offset: typeof body.offset === 'number' ? body.offset : undefined,
            limit: typeof body.limit === 'number' ? body.limit : undefined,
          })),
        }
        case 'update': return {
          changed: await gallery.updateItems(ids, {
            ...(typeof body.favorite === 'boolean' ? { favorite: body.favorite } : {}),
            ...(typeof body.projectId === 'string' ? { projectId: body.projectId } : {}),
            ...(Array.isArray(body.tags) ? { tags: stringArray(body.tags) } : {}),
          }),
        }
        case 'remove': {
          const removed = await gallery.removeItems(ids)
          const dir = await imageDir(services)
          for (const item of removed) {
            if (item.filePath !== undefined && !(await gallery.fileInUse(item.filePath))) await removeImageCopy(dir, item.filePath)
          }
          return { removed: removed.length }
        }
        case 'reveal': {
          const item = await gallery.get(str(body.id) ?? '')
          if (item === undefined) throw new RouteError(404, '图片不存在')
          const path = await ensureCopy(services, item)
          revealInFileManager(path, services.launch)
          return { path }
        }
        case 'openFolder': {
          const dir = await imageDir(services)
          await openFolder(dir, services.launch)
          return { path: dir }
        }
        case 'createProject': return { project: await gallery.createProject(str(body.name) ?? '') }
        case 'renameProject': return gallery.renameProject(str(body.id) ?? '', str(body.name) ?? '')
        case 'deleteProject': return gallery.deleteProject(str(body.id) ?? '', body.deleteItems === true)
        case 'reorderProjects': return gallery.reorderProjects(ids)
        case 'favoritePrompts': return { prompts: await gallery.favoritePrompts() }
        case 'addFavoritePrompt': return { prompt: await gallery.addFavoritePrompt(str(body.text) ?? '') }
        case 'updateFavoritePrompt': return { prompt: await gallery.updateFavoritePrompt(str(body.id) ?? '', str(body.text) ?? '') }
        case 'removeFavoritePrompt': return gallery.removeFavoritePrompt(str(body.id) ?? '')
        case 'import': {
          const attachments = attachmentList(body.attachments)
          if (attachments.length === 0) throw new RouteError(400, 'no-attachments')
          const copies = await Promise.all(attachments.map(async attachment => {
            const stored = await services.attachments.readImage(attachment as unknown as ImageAttachmentRef).catch(() => undefined)
            return stored === undefined ? undefined : saveImageCopy(services, attachment, stored.data, attachment.name ?? 'import')
          }))
          const items: GalleryItem[] = await gallery.addItems(attachments.map((attachment, index) => ({
            attachment,
            ...(copies[index] === undefined ? {} : { filePath: copies[index] }),
            prompt: str(body.prompt) ?? '',
            providerId: 'import',
            providerName: '导入',
            model: '',
            output: `${String(attachment.width)}x${String(attachment.height)}`,
            projectId: str(body.projectId) ?? DEFAULT_PROJECT_ID,
            operation: 'import' as const,
          })))
          return { items }
        }
        default: throw new RouteError(400, 'unknown-op')
      }
    } catch (error) {
      if (error instanceof RouteError) throw error
      throw new RouteError(400, error instanceof Error ? error.message : String(error))
    }
  })
}

export { CONVERSATION_PROJECT_ID }
