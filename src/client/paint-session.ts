/**
 * Paint-tab state that must outlive the component: the composer draft, each
 * project's artboard and the running generation jobs. DSH unmounts the page
 * when the user opens a conversation (and the 绘画/图库 tabs unmount each
 * other), while the request keeps running; keeping this at module level
 * lets the page pick the job back up — skeleton, stop button, result — on
 * return.
 */
import { useSyncExternalStore } from 'react'
import type { AttachmentJson, GalleryItem } from '../gallery-types.js'
import { api } from './api.js'

export type PaintRequest = Parameters<typeof api.paint>[0]
export type PaintResult = Awaited<ReturnType<typeof api.paint>>

export interface Board {
  /** Images of the last generation shown on the artboard. */
  batch: GalleryItem[]
  /** Image picked on the board or from history; null = empty canvas. */
  selectedId: string | null
  error: string | null
}

export interface PaintJob {
  projectId: string
  count: number
  prompt: string
  startedAt: number
  controller: AbortController
}

export interface PaintSession {
  draft: { prompt: string; references: AttachmentJson[] }
  boards: ReadonlyMap<string, Board>
  jobs: ReadonlyMap<string, PaintJob>
}

export const EMPTY_BOARD: Board = Object.freeze({ batch: [], selectedId: null, error: null }) as Board

const INITIAL: PaintSession = { draft: { prompt: '', references: [] }, boards: new Map(), jobs: new Map() }

let state: PaintSession = INITIAL
const listeners = new Set<() => void>()
const galleryListeners = new Set<() => void>()

function commit(next: PaintSession): void {
  state = next
  for (const listener of listeners) listener()
}

export function getPaintSession(): PaintSession {
  return state
}

export function subscribePaintSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function usePaintSession(): PaintSession {
  return useSyncExternalStore(subscribePaintSession, getPaintSession, getPaintSession)
}

/** Called whenever a job saved images, even with no page mounted to see it. */
export function onGalleryChanged(listener: () => void): () => void {
  galleryListeners.add(listener)
  return () => { galleryListeners.delete(listener) }
}

export function boardOf(session: PaintSession, projectId: string): Board {
  return session.boards.get(projectId) ?? EMPTY_BOARD
}

type Patch<T> = Partial<T> | ((current: T) => Partial<T>)

export function setDraft(patch: Patch<PaintSession['draft']>): void {
  const draft = { ...state.draft, ...(typeof patch === 'function' ? patch(state.draft) : patch) }
  commit({ ...state, draft })
}

export function updateBoard(projectId: string, patch: Patch<Board>): void {
  const current = boardOf(state, projectId)
  const boards = new Map(state.boards)
  boards.set(projectId, { ...current, ...(typeof patch === 'function' ? patch(current) : patch) })
  commit({ ...state, boards })
}

/** Clear a project's artboard back to the empty canvas. */
export function clearBoard(projectId: string): void {
  updateBoard(projectId, { batch: [], selectedId: null, error: null })
}

/**
 * Start a generation for one project (one job per project at a time). The
 * result lands on that project's board whether or not the page is mounted.
 */
export async function startJob(request: PaintRequest, options: {
  /** Text for partial failures, e.g. “2 张失败：…”. */
  describeFailures: (failures: string[]) => string
  paint?: (input: PaintRequest, signal: AbortSignal) => Promise<PaintResult>
}): Promise<void> {
  const projectId = request.projectId
  if (state.jobs.has(projectId)) return
  const controller = new AbortController()
  const job: PaintJob = { projectId, count: request.count, prompt: request.prompt, startedAt: Date.now(), controller }
  const jobs = new Map(state.jobs)
  jobs.set(projectId, job)
  commit({ ...state, jobs })
  updateBoard(projectId, { error: null })
  const paint = options.paint ?? ((input, signal) => api.paint(input, signal))
  let saved = false
  try {
    const result = await paint(request, controller.signal)
    saved = result.items.length > 0
    updateBoard(projectId, {
      batch: result.items,
      selectedId: result.items[0]?.id ?? null,
      error: result.failures.length > 0 ? options.describeFailures(result.failures) : null,
    })
  } catch (failure) {
    if (!controller.signal.aborted) updateBoard(projectId, { error: failure instanceof Error ? failure.message : String(failure) })
  } finally {
    const rest = new Map(state.jobs)
    if (rest.get(projectId) === job) rest.delete(projectId)
    commit({ ...state, jobs: rest })
    if (saved) for (const listener of galleryListeners) listener()
  }
}

export function stopJob(projectId: string): void {
  state.jobs.get(projectId)?.controller.abort()
}

/** Tests only. */
export function resetPaintSession(): void {
  for (const job of state.jobs.values()) job.controller.abort()
  state = INITIAL
  galleryListeners.clear()
  for (const listener of listeners) listener()
}
