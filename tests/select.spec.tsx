// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Select } from '../src/client/select.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let changes: string[]

const options = [
  { value: 'modelscope', label: 'ModelScope 魔搭', detail: 'ModelScope' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
]

function render(props: Partial<Parameters<typeof Select>[0]> = {}): void {
  act(() => root.render(<Select options={options} value="google" label="provider" onChange={value => changes.push(value)} {...props} />))
}
const trigger = (): HTMLButtonElement => host.querySelector('button.dig-select')!
const list = (): HTMLElement | null => document.querySelector('[role="listbox"]')
const key = (target: Element, name: string): void => {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })) })
}

beforeEach(() => {
  changes = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('Select', () => {
  it('renders the selected label and opens a DSH-style listbox with a check on the selection', () => {
    render()
    expect(trigger().textContent).toContain('Google Gemini')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    act(() => trigger().click())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    const rows = [...list()!.querySelectorAll('[role="option"]')]
    expect(rows.map(row => row.querySelector('.dig-menu-item-label')?.textContent)).toEqual(['ModelScope 魔搭', 'Google Gemini', 'OpenAI'])
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true')
    expect(rows[1]?.querySelector('svg')).not.toBeNull()
    expect(rows[0]?.querySelector('.dig-menu-detail')?.textContent).toBe('ModelScope')
  })

  it('supports arrow keys, Enter and Escape', () => {
    render()
    key(trigger(), 'ArrowDown')
    expect(list()).not.toBeNull()
    key(trigger(), 'ArrowDown')
    key(trigger(), 'Enter')
    expect(changes).toEqual(['openai'])
    expect(list()).toBeNull()
    key(trigger(), 'Enter')
    key(trigger(), 'Home')
    key(trigger(), 'Escape')
    expect(list()).toBeNull()
    expect(changes).toEqual(['openai'])
  })

  it('selects by click and closes on outside pointerdown', () => {
    render()
    act(() => trigger().click())
    act(() => (list()!.querySelectorAll('[role="option"]')[0] as HTMLElement).click())
    expect(changes).toEqual(['modelscope'])
    act(() => trigger().click())
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(list()).toBeNull()
  })

  it('editable mode filters options and commits a custom value', () => {
    render({ editable: true, value: 'Qwen/Qwen-Image', options: [{ value: 'Qwen/Qwen-Image', label: 'Qwen/Qwen-Image' }, { value: 'Qwen/Qwen-Image-Edit', label: 'Qwen/Qwen-Image-Edit' }] })
    act(() => trigger().click())
    const input = list()!.querySelector('input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'edit'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect([...list()!.querySelectorAll('.dig-menu-item-label')].map(node => node.textContent)).toContain('Qwen/Qwen-Image-Edit')
    act(() => { setter.call(input, 'Qwen/Qwen-Image-2.1'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    key(input, 'Enter')
    expect(changes).toEqual(['Qwen/Qwen-Image-2.1'])
  })

  it('stays closed when disabled', () => {
    render({ disabled: true })
    act(() => trigger().click())
    expect(list()).toBeNull()
  })
})
