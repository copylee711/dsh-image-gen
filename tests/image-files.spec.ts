import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyName, isInside, openFolder, promptSlug, removeImageCopy, resolveImageDir, revealInFileManager, writeImageCopy } from '../src/image-files.js'

const attachment = { attachmentId: 'sha256:abcdef0123456789', mediaType: 'image/jpeg' as const, bytes: 3, width: 1, height: 1 }
let dir: string | undefined
afterEach(async () => { if (dir !== undefined) await rm(dir, { recursive: true, force: true }) })

describe('image files', () => {
  it('builds readable, file-system-safe names', () => {
    expect(promptSlug('A cat: on/the "roof"?')).toBe('A-cat-on-the-roof')
    expect(promptSlug('雨夜霓虹街头的赛博朋克猫咪，电影感光线')).toBe('雨夜霓虹街头的赛博朋克猫咪-电影感光线')
    expect(promptSlug('   ')).toBe('image')
    const name = copyName(attachment, 'hello world', new Date(2026, 9, 1, 13, 5, 9).getTime())
    expect(name).toBe(join('2026-10', '20261001-130509-hello-world-abcdef01.jpg'))
  })
  it('resolves the folder and writes / removes copies only inside it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dig-files-'))
    expect(resolveImageDir('', dir)).toBe(join(dir, 'images'))
    expect(resolveImageDir('relative', dir)).toBe(join(dir, 'images'))
    expect(resolveImageDir('/abs/pics', dir)).toBe('/abs/pics')
    const images = resolveImageDir('', dir)
    const path = await writeImageCopy(images, attachment, new Uint8Array([1, 2, 3]), 'x')
    expect([...await readFile(path)]).toEqual([1, 2, 3])
    expect(isInside(images, path)).toBe(true)
    expect(isInside(images, join(dir, 'settings.json'))).toBe(false)
    await removeImageCopy(images, join(dir, 'settings.json'))
    await removeImageCopy(images, path)
    await expect(readFile(path)).rejects.toThrow()
  })
  it('opens the right file manager per platform', async () => {
    const calls: Array<[string, string[], object]> = []
    const launch = (command: string, args: string[], options: object): void => { calls.push([command, args, options]) }
    revealInFileManager('C:\\Pics\\a b.png', launch, 'win32')
    revealInFileManager('/Users/me/a.png', launch, 'darwin')
    revealInFileManager('/home/me/pics/a.png', launch, 'linux')
    expect(calls[0]).toEqual(['explorer.exe', ['/select,"C:\\Pics\\a b.png"'], { windowsVerbatimArguments: true }])
    expect(calls[1]).toEqual(['open', ['-R', '/Users/me/a.png'], {}])
    expect(calls[2]).toEqual(['xdg-open', ['/home/me/pics'], {}])
    dir = await mkdtemp(join(tmpdir(), 'dig-files-'))
    await openFolder(join(dir, 'new'), launch, 'linux')
    expect(calls[3]).toEqual(['xdg-open', [join(dir, 'new')], {}])
  })
})
