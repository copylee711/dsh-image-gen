import { describe, expect, it } from 'vitest'
import { apply, PANEL_ID } from '../src/client/index.js'
import { imageResults } from '../src/client/image-card.js'

function fakeContext() {
  const registrations: Array<{ seat: string; options: Record<string, unknown> }> = []
  let pending = ''
  const ctx = {
    get: () => undefined,
    effect: () => {},
    slots: {
      inject(seat: string, factory: () => () => void) { pending = seat; factory() },
      register(options: Record<string, unknown>) { registrations.push({ seat: pending, options }); return () => {} },
    },
  }
  return { ctx, registrations }
}

describe('client entry', () => {
  it('puts the gallery in the left sidebar + main seat, never in a conversation view', () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx as never)
    const seats = registrations.map(entry => entry.seat)
    expect(seats).toContain('sidebar.panellist')
    expect(seats).toContain('main')
    expect(seats).not.toContain('conversation.view')
    expect(seats).not.toContain('sidebar.right.pane.tab')
    expect(registrations.find(entry => entry.seat === 'sidebar.panellist')?.options.id).toBe(PANEL_ID)
    expect(registrations.find(entry => entry.seat === 'main')?.options.key).toBe(PANEL_ID)
    expect(registrations.filter(entry => entry.seat === 'tool.call.toolview').map(entry => entry.options.key)).toEqual(['paint_image', 'paint_images', 'edit_painting'])
    expect(seats).toContain('settings.plugins.tab')
  })
})

describe('imageResults', () => {
  const attachment = { attachmentId: 'sha256:1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
  it('reads single and batch presentation meta', () => {
    expect(imageResults({ kind: 'result', meta: { kind: 'copylee-image-gen', attachment, prompt: 'p', provider: 'modelscope', model: 'm', output: 'o' } })).toHaveLength(1)
    expect(imageResults({ kind: 'result', resultView: { meta: { kind: 'copylee-image-gen-batch', images: [{ kind: 'copylee-image-gen', attachment }, { kind: 'copylee-image-gen', attachment }] } } })).toHaveLength(2)
  })
  it('falls back to image content blocks', () => {
    expect(imageResults({ kind: 'result', content: [{ type: 'text', text: 'x' }, { type: 'image', attachment: attachment as never }] })).toHaveLength(1)
    expect(imageResults(undefined)).toEqual([])
  })
})
