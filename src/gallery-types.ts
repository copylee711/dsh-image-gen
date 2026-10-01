/** Gallery wire types shared by the Host store and the browser client. */

/** Durable attachment reference as JSON (mirrors `ImageAttachmentRef`). */
// A type alias (not an interface) so it stays assignable to JSON index signatures.
export type AttachmentJson = {
  attachmentId: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: { width: number; height: number }
}

export const DEFAULT_PROJECT_ID = 'default'
export const CONVERSATION_PROJECT_ID = 'conversation'

export interface GalleryProject {
  id: string
  name: string
  createdAt: number
  order: number
  /** Built-in projects cannot be deleted. */
  builtin?: boolean
}

export interface GalleryItem {
  id: string
  attachment: AttachmentJson
  prompt: string
  negativePrompt?: string
  providerId: string
  providerName?: string
  model: string
  /** Size / ratio summary, e.g. `1024x1024` or `16:9, 2K`. */
  output: string
  createdAt: number
  projectId: string
  favorite: boolean
  tags?: string[]
  /** Conversation that produced the image (Agent tools). */
  sessionId?: string
  /** Workspace file written alongside, when enabled. */
  savedTo?: string
  /** Readable copy under the plugin's image folder. */
  filePath?: string
  /** Reference images used for an edit. */
  sourceAttachmentIds?: string[]
  /** Images from one paintings-page request share a batch id. */
  batchId?: string
  /** Agent image job (`genimg:<jobId>` in replies). */
  jobId?: string
  /** `generate`, `edit` or `import`. */
  operation?: 'generate' | 'edit' | 'import'
}

export type NewGalleryItem = Omit<GalleryItem, 'id' | 'createdAt' | 'favorite'> & { createdAt?: number; favorite?: boolean }

export interface FavoritePrompt {
  id: string
  text: string
  addedAt: number
}

export interface GalleryData {
  version: 1
  projects: GalleryProject[]
  items: GalleryItem[]
  favoritePrompts: FavoritePrompt[]
}

export interface GalleryQuery {
  projectId?: string | undefined
  favorite?: boolean | undefined
  providerId?: string | undefined
  sessionId?: string | undefined
  query?: string | undefined
  order?: 'asc' | 'desc' | undefined
  offset?: number | undefined
  limit?: number | undefined
}

export interface GalleryPage {
  total: number
  items: GalleryItem[]
}
