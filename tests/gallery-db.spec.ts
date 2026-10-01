import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONVERSATION_PROJECT_ID, DEFAULT_PROJECT_ID, GalleryDb, normalizeGallery, type NewGalleryItem } from '../src/gallery-db.js'

let dir: string
let db: GalleryDb
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dig-gallery-'))
  db = new GalleryDb(dir)
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function item(prompt: string, projectId = DEFAULT_PROJECT_ID, providerId = 'modelscope'): NewGalleryItem {
  return {
    attachment: { attachmentId: `sha256:${prompt.padEnd(8, '0')}`, mediaType: 'image/png', bytes: 10, width: 1, height: 1 },
    prompt, providerId, model: 'm', output: '1024x1024', projectId,
  }
}

describe('GalleryDb', () => {
  it('starts with the built-in default and conversation projects', async () => {
    const projects = await db.projects()
    expect(projects.map(project => project.id)).toEqual([DEFAULT_PROJECT_ID, CONVERSATION_PROJECT_ID])
    expect(projects.every(project => project.builtin === true && project.count === 0)).toBe(true)
  })

  it('adds, lists, filters and persists items independent of workspaces', async () => {
    const [a] = await db.addItems([item('a cat'), item('a dog', CONVERSATION_PROJECT_ID, 'google')])
    await db.updateItems([a!.id], { favorite: true })
    expect((await db.list()).total).toBe(2)
    expect((await db.list({ projectId: CONVERSATION_PROJECT_ID })).items.map(entry => entry.prompt)).toEqual(['a dog'])
    expect((await db.list({ favorite: true })).items.map(entry => entry.prompt)).toEqual(['a cat'])
    expect((await db.list({ query: 'DOG' })).total).toBe(1)
    expect((await db.list({ providerId: 'google' })).total).toBe(1)
    const reopened = new GalleryDb(dir)
    expect((await reopened.list()).total).toBe(2)
    expect((await reopened.projects()).find(project => project.id === DEFAULT_PROJECT_ID)?.count).toBe(1)
  })

  it('creates, renames, reorders and deletes projects', async () => {
    const project = await db.createProject('  海报  ')
    expect(project.name).toBe('海报')
    await db.addItems([item('x', project.id), item('y', project.id)])
    await db.renameProject(project.id, '海报设计')
    await db.reorderProjects([project.id, DEFAULT_PROJECT_ID, CONVERSATION_PROJECT_ID])
    expect((await db.projects())[0]?.name).toBe('海报设计')
    await db.deleteProject(project.id)
    expect((await db.list({ projectId: DEFAULT_PROJECT_ID })).total).toBe(2)
    await expect(db.deleteProject(DEFAULT_PROJECT_ID)).rejects.toThrow(/内置/)
    await expect(db.createProject('  ')).rejects.toThrow()
  })

  it('can delete a project together with its images', async () => {
    const project = await db.createProject('tmp')
    await db.addItems([item('x', project.id)])
    await db.deleteProject(project.id, true)
    expect((await db.list()).total).toBe(0)
  })

  it('moves and removes items, rejecting unknown targets', async () => {
    const [a, b] = await db.addItems([item('a'), item('b')])
    await db.updateItems([a!.id], { projectId: CONVERSATION_PROJECT_ID })
    await expect(db.updateItems([a!.id], { projectId: 'missing' })).rejects.toThrow()
    expect((await db.removeItems([b!.id, 'nope'])).map(item => item.id)).toEqual([b!.id])
    expect((await db.list()).items.map(entry => entry.projectId)).toEqual([CONVERSATION_PROJECT_ID])
  })

  it('edits favorite prompts and merges duplicates', async () => {
    const aId = (await db.addFavoritePrompt('a cat')).id
    const b = await db.addFavoritePrompt('a dog')
    const edited = await db.updateFavoritePrompt(aId, '  a tiger  ')
    expect(edited.text).toBe('a tiger')
    expect(edited.id).not.toBe(aId)
    const merged = await db.updateFavoritePrompt(edited.id, 'a dog')
    expect(merged.id).toBe(b.id)
    expect((await db.favoritePrompts()).map(entry => entry.text)).toEqual(['a dog'])
    await expect(db.updateFavoritePrompt('missing', 'x')).rejects.toThrow()
  })

  it('tracks file paths for items', async () => {
    const [a] = await db.addItems([item('a')])
    await db.setFilePath(a!.id, '/tmp/x.png')
    expect((await db.get(a!.id))?.filePath).toBe('/tmp/x.png')
    expect(await db.fileInUse('/tmp/x.png')).toBe(true)
    expect(await db.fileInUse('/tmp/y.png')).toBe(false)
  })

  it('dedupes favorite prompts', async () => {
    const first = await db.addFavoritePrompt('a red fox')
    const again = await db.addFavoritePrompt(' a red fox ')
    expect(again.id).toBe(first.id)
    expect(await db.favoritePrompts()).toHaveLength(1)
    await db.removeFavoritePrompt(first.id)
    expect(await db.favoritePrompts()).toHaveLength(0)
  })

  it('notifies change listeners', async () => {
    let changes = 0
    db.onChange(() => { changes++ })
    await db.addItems([item('a')])
    await db.createProject('p')
    expect(changes).toBe(2)
  })
})

describe('normalizeGallery', () => {
  it('repairs malformed data', () => {
    const data = normalizeGallery({
      projects: [{ id: 'p', name: 'P', order: 5 }, { id: 'p', name: 'dup' }, { nope: 1 }],
      items: [{ id: 'i', attachment: { attachmentId: 'sha256:1' }, projectId: 'gone', prompt: 3 }, { id: 'j' }],
      favoritePrompts: [{ id: 'f', text: 't', addedAt: 1 }, { text: 'no id' }],
    })
    expect(data.projects.map(project => project.id).sort()).toEqual([CONVERSATION_PROJECT_ID, DEFAULT_PROJECT_ID, 'p'].sort())
    expect(data.items).toHaveLength(1)
    expect(data.items[0]).toMatchObject({ projectId: DEFAULT_PROJECT_ID, prompt: '', favorite: false })
    expect(data.favoritePrompts).toHaveLength(1)
  })
})
