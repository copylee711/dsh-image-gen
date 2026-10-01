// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModelPicker } from '../src/client/model-list.js'
import { translator } from '../src/client/i18n.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

const fetched = {
  models: ['gpt-4o', 'gpt-image-1', 'gpt-image-2', 'o3-mini', 'dall-e-3'],
  imageModels: ['gpt-image-1', 'gpt-image-2', 'dall-e-3'],
}
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.dig-pick-row')]

describe('ModelPicker', () => {
  it('shows totals, defaults to image models, keeps added ones visible but disabled', () => {
    let confirmed: string[] = []
    act(() => root.render(<ModelPicker t={translator('zh')} fetched={fetched} existing={['gpt-image-2']} onClose={() => {}} onConfirm={ids => { confirmed = ids }} />))
    expect(document.body.textContent).toContain('共 5 个模型 · 识别为生图模型 3 个 · 已添加 1 个')
    expect(rows().map(row => row.querySelector('.dig-model-id')?.textContent)).toEqual(['gpt-image-1', 'gpt-image-2', 'dall-e-3'])
    const added = rows()[1]!.querySelector('input')!
    expect(added.disabled).toBe(true)
    expect(rows()[1]!.textContent).toContain('已添加')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('全部'))!.click())
    expect(rows()).toHaveLength(5)
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '全选')!.click())
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '添加所选')!.click())
    expect(confirmed).toEqual(['gpt-4o', 'gpt-image-1', 'o3-mini', 'dall-e-3'])
  })
  it('starts on “all” when nothing looks like an image model', () => {
    act(() => root.render(<ModelPicker t={translator('zh')} fetched={{ models: ['a', 'b'], imageModels: [] }} existing={[]} onClose={() => {}} onConfirm={() => {}} />))
    expect(rows()).toHaveLength(2)
  })
})
