/** Persist one generated image as a file under the session workspace. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** File extension for each supported image media type. */
const EXTENSION: Record<ImageAttachmentRef['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Build the deterministic file name for a generated image:
 * `image-<digest-prefix>.<ext>`. The digest prefix comes from the
 * content-addressed attachment id, so the same image bytes always map to the
 * same file name regardless of when they were generated, and re-saving simply
 * overwrites the previous copy in place.
 * @param attachmentId - durable attachment id (`sha256:<hex>`).
 * @param mediaType - verified image media type.
 * @returns the file name (no directory).
 */
export function workspaceImageName(
  attachmentId: string,
  mediaType: ImageAttachmentRef['mediaType'],
): string {
  const digest = attachmentId.startsWith('sha256:') ? attachmentId.slice('sha256:'.length) : attachmentId
  const prefix = digest.slice(0, 8).padEnd(8, '0')
  return `image-${prefix}.${EXTENSION[mediaType]}`
}

/**
 * Resolve the configured image folder inside the session workspace. The
 * folder may nest, but must stay inside the workspace: absolute paths and
 * parent-traversal segments are rejected for both separator styles.
 *
 * This lexical pass is necessary but not sufficient: `saveImageToWorkspace`
 * additionally verifies the on-disk resolution so symlinked folders cannot
 * escape the workspace.
 * @param workspaceRoot - the session workspace directory.
 * @param folder - configured subfolder; empty/blank means the workspace root.
 * @returns the absolute image directory.
 * @throws when the folder would escape the workspace root.
 */
export function workspaceImageDir(workspaceRoot: string, folder: string | undefined): string {
  const trimmed = (folder ?? '').trim()
  const root = resolve(workspaceRoot)
  // An absolute folder resolves to itself and is rejected by the containment check below.
  const dir = trimmed === '' ? root : resolve(root, trimmed)
  if (!containsPath(root, dir)) {
    throw new Error(`image workspace folder '${folder}' must stay inside the session workspace`)
  }
  return dir
}

/** True when `child` equals `parent` or lives underneath it (lexically). */
function containsPath(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Real path of the closest existing ancestor of `dir` (inclusive). Walking up
 * lets us validate symlinked folder segments before creating anything under
 * them.
 */
async function nearestExistingRealPath(dir: string): Promise<string> {
  let probe = dir
  for (;;) {
    try {
      return await realpath(probe)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      const parent = dirname(probe)
      if (parent === probe) throw error // reached the filesystem root
      probe = parent
    }
  }
}

/** Reject a directory whose on-disk resolution lands outside the workspace. */
function assertInsideWorkspace(realRoot: string, candidate: string, folder: string | undefined): void {
  if (containsPath(realRoot, candidate)) return
  throw new Error(`image workspace folder '${folder ?? ''}' must stay inside the session workspace (${candidate} resolves outside ${realRoot})`)
}

/**
 * Write one generated image durably under the session workspace.
 *
 * Containment is enforced twice: lexically by `workspaceImageDir`, then
 * against real paths, so a configured folder (or any intermediate segment)
 * that is a symlink pointing outside the workspace is rejected before and
 * after anything is created.
 *
 * The bytes are written to a same-directory staging file and renamed onto the
 * target, so a crash never leaves a half-written image under its final name.
 * Re-saving identical bytes rewrites the same file (the name is content-
 * addressed), which keeps repeated generations idempotent. A cancellation is
 * honoured up to and including the final rename: an aborted save never
 * resolves successfully and never leaves the image behind under its final
 * name.
 * @param options - workspace root, configured folder, attachment identity, and image bytes.
 * @returns the absolute path of the written file.
 */
export async function saveImageToWorkspace(options: {
  workspaceRoot: string
  folder?: string | undefined
  attachmentId: string
  mediaType: ImageAttachmentRef['mediaType']
  data: Uint8Array
  signal?: AbortSignal
}): Promise<string> {
  const dir = workspaceImageDir(options.workspaceRoot, options.folder)
  options.signal?.throwIfAborted()
  const realRoot = await realpath(resolve(options.workspaceRoot))
  assertInsideWorkspace(realRoot, await nearestExistingRealPath(dir), options.folder)
  const name = workspaceImageName(options.attachmentId, options.mediaType)
  const target = join(dir, name)
  const staging = join(dir, `.${name}.${process.pid}-${randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true })
  // Re-validate the finished directory: creating it may have traversed a
  // symlink, and links can be swapped in between the checks above.
  assertInsideWorkspace(realRoot, await realpath(dir), options.folder)
  try {
    await writeFile(staging, options.data, { flag: 'wx', signal: options.signal })
    options.signal?.throwIfAborted()
    await rename(staging, target)
  } catch (error) {
    await unlink(staging).catch(() => {})
    throw error
  }
  // Final gate: a cancellation landing during the last write/rename step must
  // not be reported as a successful save, and the already-renamed file is
  // removed so no orphan image outlives the cancelled call.
  try {
    options.signal?.throwIfAborted()
  } catch (error) {
    await unlink(target).catch(() => {})
    throw error
  }
  return target
}

/** Regex pattern strictly matching generated image file names (e.g. image-01234567.png). */
const GENERATED_IMAGE_NAME_REGEX = /^image-[0-9a-f]{8,}\.(png|jpg|jpeg|webp|gif)$/i

