/**
 * Saved-prompt popover anchored to the composer: save/unsave the current
 * prompt, search, click to replace, “追加” to append, delete — without
 * leaving the paint tab. Opened by the bookmark button, `/` in an empty
 * prompt box, or Ctrl/⌘+K.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Bookmark, BookmarkCheck, Plus, Search, X } from 'lucide-react'
import type { FavoritePrompt } from '../gallery-types.js'
import { api } from './api.js'
import type { Translate } from './i18n.js'
import { Portal } from './widgets.js'

export function PromptPicker({ t, anchor, prompt, prompts, onReload, onUse, onClose, onError }: {
  t: Translate
  /** Element the popover opens above (the composer). */
  anchor: HTMLElement
  prompt: string
  prompts: readonly FavoritePrompt[]
  onReload: () => void
  onUse: (text: string, mode: 'replace' | 'append') => void
  onClose: () => void
  onError: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; width: number; bottom: number; maxHeight: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const current = prompt.trim()
  const saved = prompts.find(entry => entry.text === current)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle.length === 0 ? prompts : prompts.filter(entry => entry.text.toLowerCase().includes(needle))
  }, [prompts, query])

  useLayoutEffect(() => {
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(rect.width, 560)
      setPos({ left: rect.left, width, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(200, Math.min(440, rect.top - 16)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])
  useEffect(() => {
    searchRef.current?.focus()
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (ref.current?.contains(target) !== true && !anchor.contains(target)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [anchor, onClose])
  useEffect(() => {
    ref.current?.querySelector(`[data-index="${String(active)}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const toggleSaved = (): void => {
    const action = saved === undefined ? api.gallery.addFavoritePrompt(current) : api.gallery.removeFavoritePrompt(saved.id)
    void action.then(onReload, (error: unknown) => onError(error instanceof Error ? error.message : String(error)))
  }
  const remove = (id: string): void => {
    void api.gallery.removeFavoritePrompt(id).then(onReload, (error: unknown) => onError(error instanceof Error ? error.message : String(error)))
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (visible.length === 0) return
      setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length)
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      const entry = visible[active]
      if (entry !== undefined) onUse(entry.text, event.shiftKey ? 'append' : 'replace')
    }
  }

  if (pos === null) return null
  return <Portal>
    <div ref={ref} className="dig-menu-pop dig-prompt-pop" role="dialog" aria-label={t('tabPrompts')} style={{ left: pos.left, width: pos.width, bottom: pos.bottom, maxHeight: pos.maxHeight }} onKeyDown={onKeyDown}>
      <button type="button" className="dig-menu-item dig-prompt-save" disabled={current.length === 0} onClick={toggleSaved}>
        {saved === undefined ? <Bookmark size={15} /> : <BookmarkCheck size={15} />}
        <span className="dig-menu-item-label">{current.length === 0 ? t('savePromptEmpty') : saved === undefined ? t('savePrompt') : t('promptSavedToggle')}</span>
      </button>
      <div className="dig-menu-filter dig-search" style={{ maxWidth: 'none' }}>
        <Search size={14} />
        <input ref={searchRef} className="dig-input" value={query} placeholder={t('searchPrompts')} aria-label={t('searchPrompts')} onChange={event => { setQuery(event.target.value); setActive(0) }} />
      </div>
      <div className="dig-prompt-list" role="listbox" aria-label={t('tabPrompts')}>
        {visible.map((entry, index) => <div
          key={entry.id}
          role="option"
          aria-selected={index === active}
          data-index={index}
          className={index === active ? 'dig-menu-item dig-menu-item-active dig-prompt-item' : 'dig-menu-item dig-prompt-item'}
          title={entry.text}
          onPointerMove={() => setActive(index)}
          onClick={() => onUse(entry.text, 'replace')}
        >
          <span className="dig-prompt-item-text">{entry.text}</span>
          <button type="button" className="dig-icon-btn" title={t('appendPrompt')} aria-label={t('appendPrompt')} onClick={event => { event.stopPropagation(); onUse(entry.text, 'append') }}><Plus size={14} /></button>
          <button type="button" className="dig-icon-btn" title={t('delete')} aria-label={t('delete')} onClick={event => { event.stopPropagation(); remove(entry.id) }}><X size={14} /></button>
        </div>)}
        {prompts.length === 0 && <div className="dig-menu-empty">{t('noPromptsHint')}</div>}
        {prompts.length > 0 && visible.length === 0 && <div className="dig-menu-empty">—</div>}
      </div>
      <div className="dig-prompt-foot">{t('promptPickerKeys')}</div>
    </div>
  </Portal>
}
