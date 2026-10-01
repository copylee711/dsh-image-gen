/**
 * Readable image copies on disk and “show in file manager”.
 *
 * DSH's attachment store names objects by content hash without extensions,
 * which is useless in a file manager. Every gallery image therefore also
 * gets a copy under one folder (default `<dataDir>/images`, configurable):
 * `<dir>/<YYYY-MM>/<YYYYMMDD-HHmmss>-<prompt-slug>-<digest8>.<ext>`.
 */
import { spawn } from 'node:child_process'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import type { AttachmentJson } from './gallery-types.js'

const EXTENSIONS: Record<AttachmentJson['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** The folder image copies go to. */
export function resolveImageDir(configured: string | undefined, dataDir: string): string {
  const value = configured?.trim() ?? ''
  return value.length > 0 && isAbsolute(value) ? value : join(dataDir, 'images')
}

/** File-system-safe short slug of a prompt (keeps CJK letters). */
export function promptSlug(prompt: string, max = 32): string {
  const slug = prompt
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'image'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Relative path of the copy for one image. */
export function copyName(attachment: AttachmentJson, prompt: string, createdAt: number): string {
  const date = new Date(createdAt)
  const month = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}`
  const stamp = `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const digest = attachment.attachmentId.replace(/^sha256:/, '').slice(0, 8) || 'img'
  return join(month, `${stamp}-${promptSlug(prompt)}-${digest}.${EXTENSIONS[attachment.mediaType]}`)
}

/** Write the copy; returns its absolute path. */
export async function writeImageCopy(dir: string, attachment: AttachmentJson, data: Uint8Array, prompt: string, createdAt = Date.now()): Promise<string> {
  const target = join(dir, copyName(attachment, prompt, createdAt))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, data)
  return target
}

/** Whether `child` lies inside `parent`. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..')
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Delete a copy, but only one living inside the images folder. */
export async function removeImageCopy(dir: string, path: string | undefined): Promise<void> {
  if (path === undefined || !isInside(dir, path)) return
  await unlink(path).catch(() => {})
}

/** How the OS file manager is launched; injectable for tests. */
export type Launcher = (command: string, args: string[], options: { windowsVerbatimArguments?: boolean }) => void

export const defaultLauncher: Launcher = (command, args, options) => {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', ...options })
  child.on('error', () => {})
  child.unref()
}

/** Select one file in Explorer / Finder; other platforms open its folder. */
export function revealInFileManager(path: string, launch: Launcher = defaultLauncher, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    launch('explorer.exe', [`/select,"${path}"`], { windowsVerbatimArguments: true })
  } else if (platform === 'darwin') {
    launch('open', ['-R', path], {})
  } else {
    launch('xdg-open', [dirname(path)], {})
  }
}

/** Open a folder in the OS file manager (created first if missing). */
export async function openFolder(dir: string, launch: Launcher = defaultLauncher, platform: NodeJS.Platform = process.platform): Promise<void> {
  await mkdir(dir, { recursive: true })
  if (platform === 'win32') launch('explorer.exe', [`"${dir}"`], { windowsVerbatimArguments: true })
  else if (platform === 'darwin') launch('open', [dir], {})
  else launch('xdg-open', [dir], {})
}
