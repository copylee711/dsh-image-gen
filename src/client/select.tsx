/**
 * Dropdown in DSH's Menu style (ported from the dsh-free-search Select):
 * input-like trigger with a rotating chevron, a fixed-position floating card
 * (34px rows, trailing check on the selected row, optional group labels and
 * right-hand detail), keyboard navigation, and upward placement when the
 * space below runs out. `editable` adds a filter box that also accepts a
 * free-form value (model ids).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Portal } from './widgets.js'

export interface SelectOption {
  value: string
  label: string
  group?: string
  detail?: string
}

interface Position {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

const ROW = 34

function CheckIcon() {
  return <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function ChevronIcon() {
  return <svg className="dig-select-chevron" viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function Select(props: {
  options: readonly SelectOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Accessible name of the trigger. */
  label?: string
  id?: string
  /** Shrink to content (toolbars) instead of filling the row. */
  compact?: boolean
  /** Show a filter box that also commits free text on Enter. */
  editable?: boolean
  /** Placeholder for the editable filter box. */
  editablePlaceholder?: string
  /** Shown on the trigger when the value matches no option. */
  placeholder?: string
  /** Extra node on the trigger before the chevron. */
  adornment?: ReactNode
}) {
  const { options, value, disabled, editable } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<Position | null>(null)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const baseId = useId()

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle.length === 0 ? options : options.filter(option => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle))
  }, [options, query])
  const selected = options.find(option => option.value === value)
  const selectedIndex = visible.findIndex(option => option.value === value)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const margin = 12
    const below = window.innerHeight - rect.bottom - margin
    const above = rect.top - margin
    const want = Math.min(360, options.length * ROW + (editable === true ? 52 : 12))
    const up = below < Math.min(want, 220) && above > below
    const maxHeight = Math.max(120, Math.min(360, up ? above - 4 : below - 4))
    const width = Math.max(Math.min(rect.width, 440), props.compact === true ? 200 : 0)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPos(up ? { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight } : { left, width, top: rect.bottom + 4, maxHeight })
  }, [options.length, props.compact, editable])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setQuery('')
    if (refocus) triggerRef.current?.focus()
  }, [])
  const openMenu = (): void => {
    if (disabled === true) return
    place()
    setActive(Math.max(0, options.findIndex(option => option.value === value)))
    setOpen(true)
  }
  const commit = (next: string): void => {
    close(true)
    if (next !== value) props.onChange(next)
  }
  const choose = (index: number): void => {
    const option = visible[index]
    if (option !== undefined) commit(option.value)
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node
      if (listRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true) return
      close(false)
    }
    const onScroll = (event: Event): void => {
      if (listRef.current?.contains(event.target as Node) === true) return
      place()
    }
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    if (editable === true) requestAnimationFrame(() => filterRef.current?.focus())
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place, close, editable])

  useEffect(() => {
    if (!open || active < 0 || listRef.current === null) return
    const row = listRef.current.querySelector(`[data-index="${String(active)}"]`)
    if (row !== null && typeof (row as HTMLElement).scrollIntoView === 'function') (row as HTMLElement).scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (disabled === true) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (visible.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(index => (index + step + visible.length) % visible.length)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : visible.length - 1)
    } else if (event.key === 'Enter' || (event.key === ' ' && editable !== true)) {
      event.preventDefault()
      if (active >= 0 && active < visible.length) choose(active)
      else if (editable === true && query.trim().length > 0) commit(query.trim())
    }
  }

  const listId = `${baseId}-list`
  const rows: ReactNode[] = []
  let lastGroup: string | undefined
  visible.forEach((option, index) => {
    if (option.group !== undefined && option.group !== lastGroup) {
      rows.push(<div key={`g-${option.group}`} className="dig-menu-label" role="presentation">{option.group}</div>)
    }
    lastGroup = option.group
    const isSelected = option.value === value
    rows.push(<div
      key={option.value}
      id={`${baseId}-${String(index)}`}
      role="option"
      aria-selected={isSelected}
      data-index={index}
      className={index === active ? 'dig-menu-item dig-menu-item-active' : 'dig-menu-item'}
      onPointerMove={() => setActive(index)}
      onPointerDown={event => event.preventDefault()}
      onClick={() => choose(index)}
    >
      <span className="dig-menu-item-label" title={option.label}>{option.label}</span>
      {option.detail !== undefined && <span className="dig-menu-detail">{option.detail}</span>}
      <span className="dig-menu-check">{isSelected ? <CheckIcon /> : null}</span>
    </div>)
  })
  const freeText = editable === true ? query.trim() : ''
  const offerFree = freeText.length > 0 && !options.some(option => option.value === freeText)

  return <div className={props.compact === true ? 'dig-select-wrap dig-select-compact' : 'dig-select-wrap'}>
    <button
      ref={triggerRef}
      id={props.id}
      type="button"
      className={open ? 'dig-select dig-select-open' : 'dig-select'}
      disabled={disabled}
      aria-label={props.label}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 && editable !== true ? `${baseId}-${String(active)}` : undefined}
      onClick={() => (open ? close(false) : openMenu())}
      onKeyDown={onKeyDown}
    >
      <span className={selected === undefined && value.length === 0 ? 'dig-select-value dig-select-placeholder' : 'dig-select-value'}>
        {selected?.label ?? (value.length > 0 ? value : props.placeholder ?? '')}
      </span>
      {props.adornment}
      <ChevronIcon />
    </button>
    {open && pos !== null && <Portal>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={props.label}
        className="dig-menu-pop"
        style={{ left: pos.left, width: pos.width, maxHeight: pos.maxHeight, ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }) }}
      >
        {editable === true && <div className="dig-menu-filter">
          <input
            ref={filterRef}
            className="dig-input"
            value={query}
            placeholder={props.editablePlaceholder}
            aria-label={props.editablePlaceholder ?? props.label}
            aria-activedescendant={active >= 0 ? `${baseId}-${String(active)}` : undefined}
            onChange={event => { setQuery(event.target.value); setActive(0) }}
            onKeyDown={onKeyDown}
          />
        </div>}
        {offerFree && <div
          className={active === -1 || visible.length === 0 ? 'dig-menu-item dig-menu-item-active' : 'dig-menu-item'}
          role="option"
          aria-selected={false}
          onPointerDown={event => event.preventDefault()}
          onClick={() => commit(freeText)}
        >
          <span className="dig-menu-item-label">“{freeText}”</span>
          <span className="dig-menu-detail">↵</span>
        </div>}
        {rows}
        {rows.length === 0 && !offerFree && <div className="dig-menu-empty">—</div>}
      </div>
    </Portal>}
  </div>
}
