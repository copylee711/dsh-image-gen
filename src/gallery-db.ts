/**
 * Global gallery: projects, generated images and favorite prompts.
 *
 * Deliberately independent of DSH workspaces — the gallery has its own
 * project grouping, and every conversation's generations land in the
 * built-in “对话” project. Image bytes stay in the DSH attachment store; this
 * file keeps the metadata only.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Mutex, readJson, writeJson } from './storage.js'
import type { GalleryData, GalleryItem, GalleryProject, GalleryQuery, GalleryPage, FavoritePrompt, NewGalleryItem } from './gallery-types.js'
import { CONVERSATION_PROJECT_ID, DEFAULT_PROJECT_ID } from './gallery-types.js'

export * from './gallery-types.js'

function builtinProjects(now: number): GalleryProject[] {
  return [
    { id: DEFAULT_PROJECT_ID, name: '默认画板', createdAt: now, order: 0, builtin: true },
    { id: CONVERSATION_PROJECT_ID, name: '对话', createdAt: now, order: 1, builtin: true },
  ]
}

/** Coerce untrusted stored data into a valid gallery. */
export function normalizeGallery(raw: unknown, now = Date.now()): GalleryData {
  const input = typeof raw === 'object' && raw !== null ? raw as Partial<Record<keyof GalleryData, unknown>> : {}
  const projects: GalleryProject[] = []
  const ids = new Set<string>()
  if (Array.isArray(input.projects)) {
    for (const candidate of input.projects) {
      const project = candidate as Partial<GalleryProject>
      if (typeof project.id !== 'string' || ids.has(project.id) || typeof project.name !== 'string') continue
      ids.add(project.id)
      projects.push({
        id: project.id,
        name: project.name,
        createdAt: typeof project.createdAt === 'number' ? project.createdAt : now,
        order: typeof project.order === 'number' ? project.order : projects.length,
        ...(project.builtin === true ? { builtin: true } : {}),
      })
    }
  }
  for (const builtin of builtinProjects(now)) {
    const existing = projects.find(project => project.id === builtin.id)
    if (existing === undefined) projects.push(builtin)
    else existing.builtin = true
  }
  projects.sort((a, b) => a.order - b.order)
  const items: GalleryItem[] = []
  if (Array.isArray(input.items)) {
    const seen = new Set<string>()
    for (const candidate of input.items) {
      const item = candidate as Partial<GalleryItem>
      if (typeof item.id !== 'string' || seen.has(item.id)) continue
      if (typeof item.attachment !== 'object' || item.attachment === null || typeof (item.attachment as { attachmentId?: unknown }).attachmentId !== 'string') continue
      seen.add(item.id)
      items.push({
        ...(item as GalleryItem),
        projectId: typeof item.projectId === 'string' && ids.has(item.projectId) || item.projectId === DEFAULT_PROJECT_ID || item.projectId === CONVERSATION_PROJECT_ID
          ? item.projectId!
          : DEFAULT_PROJECT_ID,
        prompt: typeof item.prompt === 'string' ? item.prompt : '',
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
        favorite: item.favorite === true,
      })
    }
  }
  const favoritePrompts: FavoritePrompt[] = Array.isArray(input.favoritePrompts)
    ? (input.favoritePrompts as Partial<FavoritePrompt>[]).filter((entry): entry is FavoritePrompt => typeof entry.id === 'string' && typeof entry.text === 'string')
    : []
  return { version: 1, projects, items, favoritePrompts }
}

/** Stable id for a prompt text; identical prompts dedupe. */
function promptId(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `p${hash.toString(36)}${String(text.length)}`
}

export class GalleryDb {
  private data: GalleryData | undefined
  private readonly mutex = new Mutex()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly dir: string) {}

  get path(): string {
    return join(this.dir, 'gallery.json')
  }

  private async load(): Promise<GalleryData> {
    if (this.data === undefined) this.data = normalizeGallery(await readJson(this.path))
    return this.data
  }

  /** Run one mutation under the lock and persist it. */
  private mutate<T>(change: (data: GalleryData) => T): Promise<T> {
    return this.mutex.run(async () => {
      const data = await this.load()
      const result = change(data)
      await writeJson(this.path, data)
      for (const listener of this.listeners) listener()
      return result
    })
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async projects(): Promise<Array<GalleryProject & { count: number; cover?: GalleryItem['attachment'] }>> {
    const data = await this.load()
    return data.projects.map(project => {
      const members = data.items.filter(item => item.projectId === project.id)
      const latest = members.reduce<GalleryItem | undefined>((best, item) => best === undefined || item.createdAt > best.createdAt ? item : best, undefined)
      return { ...project, count: members.length, ...(latest === undefined ? {} : { cover: latest.attachment }) }
    })
  }

  async list(query: GalleryQuery = {}): Promise<GalleryPage> {
    const data = await this.load()
    const needle = query.query?.trim().toLowerCase() ?? ''
    let items = data.items.filter(item =>
      (query.projectId === undefined || item.projectId === query.projectId)
      && (query.favorite !== true || item.favorite)
      && (query.providerId === undefined || item.providerId === query.providerId)
      && (query.sessionId === undefined || item.sessionId === query.sessionId)
      && (needle.length === 0 || item.prompt.toLowerCase().includes(needle) || item.model.toLowerCase().includes(needle) || (item.providerName ?? '').toLowerCase().includes(needle)))
    items = items.sort((a, b) => query.order === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
    const offset = Math.max(0, query.offset ?? 0)
    const limit = Math.min(500, Math.max(1, query.limit ?? 100))
    return { total: items.length, items: items.slice(offset, offset + limit) }
  }

  addItems(entries: readonly NewGalleryItem[]): Promise<GalleryItem[]> {
    return this.mutate(data => {
      const now = Date.now()
      const created = entries.map((entry, index): GalleryItem => ({
        ...entry,
        id: randomUUID(),
        createdAt: entry.createdAt ?? now + index,
        projectId: data.projects.some(project => project.id === entry.projectId) ? entry.projectId : DEFAULT_PROJECT_ID,
        favorite: entry.favorite === true,
      }))
      data.items.push(...created)
      return created
    })
  }

  updateItems(ids: readonly string[], patch: { favorite?: boolean; projectId?: string; tags?: string[] }): Promise<number> {
    return this.mutate(data => {
      if (patch.projectId !== undefined && !data.projects.some(project => project.id === patch.projectId)) throw new Error('目标项目不存在')
      const wanted = new Set(ids)
      let changed = 0
      for (const item of data.items) {
        if (!wanted.has(item.id)) continue
        if (patch.favorite !== undefined) item.favorite = patch.favorite
        if (patch.projectId !== undefined) item.projectId = patch.projectId
        if (patch.tags !== undefined) item.tags = patch.tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0)
        changed++
      }
      return changed
    })
  }

  /** Remove items; returns the removed records (callers clean up their files). */
  removeItems(ids: readonly string[]): Promise<GalleryItem[]> {
    return this.mutate(data => {
      const wanted = new Set(ids)
      const removed = data.items.filter(item => wanted.has(item.id))
      data.items = data.items.filter(item => !wanted.has(item.id))
      return removed
    })
  }

  async get(id: string): Promise<GalleryItem | undefined> {
    return (await this.load()).items.find(item => item.id === id)
  }

  /** Whether any item still points at this file. */
  async fileInUse(path: string): Promise<boolean> {
    return (await this.load()).items.some(item => item.filePath === path)
  }

  setFilePath(id: string, filePath: string): Promise<void> {
    return this.mutate(data => {
      const item = data.items.find(entry => entry.id === id)
      if (item !== undefined) item.filePath = filePath
    })
  }

  createProject(name: string): Promise<GalleryProject> {
    const trimmed = name.trim().slice(0, 64)
    if (trimmed.length === 0) return Promise.reject(new Error('项目名称不能为空'))
    return this.mutate(data => {
      const project: GalleryProject = {
        id: randomUUID(),
        name: trimmed,
        createdAt: Date.now(),
        order: Math.max(0, ...data.projects.map(entry => entry.order)) + 1,
      }
      data.projects.push(project)
      return project
    })
  }

  renameProject(id: string, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 64)
    if (trimmed.length === 0) return Promise.reject(new Error('项目名称不能为空'))
    return this.mutate(data => {
      const project = data.projects.find(entry => entry.id === id)
      if (project === undefined) throw new Error('项目不存在')
      project.name = trimmed
    })
  }

  /** Delete a project; its images move to the default board unless `deleteItems`. */
  deleteProject(id: string, deleteItems = false): Promise<void> {
    return this.mutate(data => {
      const project = data.projects.find(entry => entry.id === id)
      if (project === undefined) throw new Error('项目不存在')
      if (project.builtin === true) throw new Error('内置项目不能删除')
      data.projects = data.projects.filter(entry => entry.id !== id)
      data.items = deleteItems
        ? data.items.filter(item => item.projectId !== id)
        : data.items.map(item => item.projectId === id ? { ...item, projectId: DEFAULT_PROJECT_ID } : item)
    })
  }

  reorderProjects(ids: readonly string[]): Promise<void> {
    return this.mutate(data => {
      const position = new Map(ids.map((id, index) => [id, index]))
      for (const project of data.projects) project.order = position.get(project.id) ?? ids.length + project.order
      data.projects.sort((a, b) => a.order - b.order)
      data.projects.forEach((project, index) => { project.order = index })
    })
  }

  async favoritePrompts(): Promise<FavoritePrompt[]> {
    return [...(await this.load()).favoritePrompts].sort((a, b) => b.addedAt - a.addedAt)
  }

  addFavoritePrompt(text: string): Promise<FavoritePrompt> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return Promise.reject(new Error('Prompt 为空'))
    return this.mutate(data => {
      const id = promptId(trimmed)
      const existing = data.favoritePrompts.find(entry => entry.id === id)
      if (existing !== undefined) return existing
      const entry = { id, text: trimmed, addedAt: Date.now() }
      data.favoritePrompts.push(entry)
      return entry
    })
  }

  /** Rewrite a saved prompt; merges into an existing entry with the same text. */
  updateFavoritePrompt(id: string, text: string): Promise<FavoritePrompt> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return Promise.reject(new Error('Prompt 为空'))
    return this.mutate(data => {
      const current = data.favoritePrompts.find(entry => entry.id === id)
      if (current === undefined) throw new Error('收藏的 Prompt 不存在')
      const nextId = promptId(trimmed)
      const duplicate = data.favoritePrompts.find(entry => entry.id === nextId && entry.id !== id)
      if (duplicate !== undefined) {
        data.favoritePrompts = data.favoritePrompts.filter(entry => entry.id !== id)
        return duplicate
      }
      current.id = nextId
      current.text = trimmed
      return current
    })
  }

  removeFavoritePrompt(id: string): Promise<void> {
    return this.mutate(data => {
      data.favoritePrompts = data.favoritePrompts.filter(entry => entry.id !== id)
    })
  }
}
