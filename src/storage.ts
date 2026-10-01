/** Plugin-owned JSON storage under the DSH home, independent of any workspace. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PLUGIN_SLUG } from './shared.js'

/**
 * Directory holding this plugin's settings and gallery. Precedence: explicit
 * config, `COPYLEE_IMAGE_GEN_HOME`, `$DSH_HOME/storages/copylee-image-gen`, then
 * `~/.dsh/storages/copylee-image-gen` (next to DSH's own `workspace.json`).
 */
export function resolveDataDir(configured?: string): string {
  const explicit = configured?.trim() || process.env.COPYLEE_IMAGE_GEN_HOME?.trim()
  if (explicit) return explicit
  const dshHome = process.env.DSH_HOME?.trim() || join(process.env.USERPROFILE || process.env.HOME || homedir(), '.dsh')
  return join(dshHome, 'storages', PLUGIN_SLUG)
}

/** Read and parse one JSON file; `undefined` when it does not exist. */
export async function readJson(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Keep the unreadable copy for manual recovery instead of overwriting it.
    await rename(path, `${path}.corrupt-${String(Date.now())}`).catch(() => {})
    return undefined
  }
}

/** Atomically replace one JSON file (write a sibling, then rename). */
export async function writeJson(path: string, value: unknown, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const staging = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? 'utf8' : { encoding: 'utf8', mode })
    await rename(staging, path)
  } catch (error) {
    await unlink(staging).catch(() => {})
    throw error
  }
}

/** Serialize async read-modify-write operations on one resource. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task)
    this.tail = next.catch(() => {})
    return next
  }
}
