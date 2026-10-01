// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptPicker } from '../src/client/prompt-picker.js'
import { translator } from '../src/client/i18n.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let anchor: HTMLDivElement
let root: Root
const prompts = [
  { id: 'a', text: 'a red fox in snow', addedAt: 2 },
  { id: 'b', text: 'cyberpunk cat, neon rain', addedAt: 1 },
]

beforeEach(() => {
  host = document.createElement('div')
  anchor = document.createElement('div')
  document.body.append(anchor, host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function render(prompt: string, handlers: { onUse?: (text: string, mode: string) => void; onClose?: () => void } = {}): void {
  act(() => root.render(<PromptPicker
    t={translator('zh')}
    anchor={anchor}
    prompt={prompt}
    prompts={prompts}
    onReload={() => {}}
    onUse={handlers.onUse ?? (() => {})}
    onClose={handlers.onClose ?? (() => {})}
    onError={() => {}}
  />))
}
const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const key = (name: string, extra: KeyboardEventInit = {}): void => {
  act(() => { document.querySelector('.dig-prompt-pop')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, ...extra })) })
}

describe('PromptPicker', () => {
  it('lists saved prompts and replaces on click / appends via the + button', () => {
    const used: Array<[string, string]> = []
    render('', { onUse: (text, mode) => used.push([text, mode]) })
    expect(options().map(option => option.querySelector('.dig-prompt-item-text')?.textContent)).toEqual(['a red fox in snow', 'cyberpunk cat, neon rain'])
    act(() => options()[1]!.click())
    act(() => (options()[0]!.querySelector('[aria-label="追加到当前 Prompt"]') as HTMLElement).click())
    expect(used).toEqual([['cyberpunk cat, neon rain', 'replace'], ['a red fox in snow', 'append']])
  })
  it('filters by search and supports arrows, Enter, Shift+Enter and Escape', () => {
    const used: Array<[string, string]> = []
    const onClose = vi.fn()
    render('', { onUse: (text, mode) => used.push([text, mode]), onClose })
    const input = document.querySelector<HTMLInputElement>('.dig-prompt-pop input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'neon'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(options()).toHaveLength(1)
    key('Enter')
    act(() => { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
    key('ArrowDown')
    key('Enter', { shiftKey: true })
    key('Escape')
    expect(used).toEqual([['cyberpunk cat, neon rain', 'replace'], ['cyberpunk cat, neon rain', 'append']])
    expect(onClose).toHaveBeenCalled()
  })
  it('shows whether the current prompt is already saved', () => {
    render('a red fox in snow')
    expect(document.querySelector('.dig-prompt-save')?.textContent).toContain('已收藏')
    render('')
    expect((document.querySelector('.dig-prompt-save') as HTMLButtonElement).disabled).toBe(true)
  })
})
