// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryItem } from '../src/gallery-types.js'
import type { SettingsView } from '../src/shared.js'

const paint = vi.fn()
vi.mock('../src/client/api.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/client/api.js')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      paint: (...args: unknown[]) => paint(...args),
      gallery: { ...actual.api.gallery, favoritePrompts: async () => ({ prompts: [] }) },
    },
  }
})

const { PaintView } = await import('../src/client/paint-view.js')
const session = await import('../src/client/paint-session.js')
const { translator } = await import('../src/client/i18n.js')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function item(id: string, projectId = 'p1'): GalleryItem {
  return {
    id,
    attachment: { attachmentId: `att-${id}`, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
    prompt: `prompt ${id}`,
    providerId: 'ms',
    model: 'm',
    output: '1:1',
    createdAt: 1,
    projectId,
    favorite: false,
  }
}

const settings = {
  providers: [{ id: 'ms', name: 'ModelScope', protocol: 'modelscope', baseURL: 'https://x/v1', models: ['m'], defaultModel: 'm', enabled: true, proxy: { mode: 'inherit' }, keyConfigured: true }],
  activeProvider: 'ms',
} as unknown as SettingsView

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  session.resetPaintSession()
  paint.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

function render(props: { projectId?: string; history?: GalleryItem[]; onGalleryChanged?: () => void } = {}): void {
  act(() => root.render(<PaintView
    t={translator('zh')}
    settings={settings}
    projectId={props.projectId ?? 'p1'}
    history={props.history ?? []}
    onGalleryChanged={props.onGalleryChanged ?? (() => {})}
    onError={() => {}}
    toast={() => {}}
    onOpenSettings={() => {}}
    injected={null}
    sideTop={<div />}
    refreshKey={0}
  />))
}
const textarea = (): HTMLTextAreaElement => host.querySelector('.dig-composer textarea')!
const type = (value: string): void => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(textarea(), value)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const button = (label: string): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.textContent?.includes(label))!
const boardImages = (): string[] => [...host.querySelectorAll<HTMLImageElement>('.dig-board img')].map(img => img.alt)

describe('paint session', () => {
  it('keeps a running job, its result and the draft across unmount/remount', async () => {
    const pending = deferred<{ items: GalleryItem[]; failures: string[] }>()
    paint.mockReturnValue(pending.promise)
    const changed = vi.fn()
    const unsubscribe = session.onGalleryChanged(changed)
    render()
    type('a red fox')
    await act(async () => { button('生成').click() })
    expect(host.querySelector('.dig-busy')).not.toBeNull()

    // Leave the page: the component unmounts while the request keeps going.
    act(() => root.unmount())
    root = createRoot(host)
    render()
    expect(host.querySelector('.dig-busy')).not.toBeNull()
    expect(textarea().value).toBe('a red fox')
    expect(button('停止')).toBeDefined()

    act(() => root.unmount())
    await act(async () => { pending.resolve({ items: [item('new')], failures: [] }) })
    expect(changed).toHaveBeenCalledTimes(1)
    root = createRoot(host)
    render()
    expect(host.querySelector('.dig-busy')).toBeNull()
    expect(boardImages()).toEqual(['prompt new'])
    unsubscribe()
  })

  it('lands the result on the job’s own project board', async () => {
    const pending = deferred<{ items: GalleryItem[]; failures: string[] }>()
    paint.mockReturnValue(pending.promise)
    render({ projectId: 'p1' })
    type('castle')
    await act(async () => { button('生成').click() })
    render({ projectId: 'p2' })
    expect(host.querySelector('.dig-busy')).toBeNull()
    await act(async () => { pending.resolve({ items: [item('c1')], failures: [] }) })
    expect(boardImages()).toEqual([])
    render({ projectId: 'p1' })
    expect(boardImages()).toEqual(['prompt c1'])
  })

  it('stop aborts the request and leaves no error', async () => {
    paint.mockImplementation((_input: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    render()
    type('x')
    await act(async () => { button('生成').click() })
    await act(async () => { button('停止').click() })
    expect(host.querySelector('.dig-busy')).toBeNull()
    expect(host.querySelector('.dig-center .dig-error')).toBeNull()
  })

  it('新画板 empties the board and composer; clicking the selected thumb deselects', () => {
    const history = [item('h1'), item('h2')]
    render({ history })
    const thumbs = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.dig-thumb')]
    act(() => thumbs()[1]!.click())
    expect(boardImages()).toEqual(['prompt h2'])
    act(() => thumbs()[1]!.click())
    expect(boardImages()).toEqual([])
    expect(host.querySelector('.dig-board-empty')).not.toBeNull()

    act(() => thumbs()[0]!.click())
    type('keep me?')
    act(() => button('新画板').click())
    expect(boardImages()).toEqual([])
    expect(textarea().value).toBe('')
  })

  it('Esc on the board deselects the shown image', () => {
    render({ history: [item('h1')] })
    act(() => host.querySelector<HTMLElement>('.dig-thumb')!.click())
    expect(boardImages()).toEqual(['prompt h1'])
    act(() => { host.querySelector('.dig-board')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(boardImages()).toEqual([])
  })
})
