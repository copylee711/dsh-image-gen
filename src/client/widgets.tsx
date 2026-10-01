/** Small UI primitives styled with the plugin's DSH-aligned stylesheet. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className="dig-switch"
    onClick={() => onChange(!checked)}
  />
}

/** Portal everything into a `.dig-root` so tokens apply outside the page tree. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(<div className="dig-root" style={{ background: 'transparent' }}>{children}</div>, document.body)
}

export function Modal({ title, children, onClose, actions, wide }: { title: string; children?: ReactNode; onClose: () => void; actions: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <Portal>
    <div className="dig-modal-wrap" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={wide === true ? 'dig-modal dig-modal-wide' : 'dig-modal'} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="dig-modal-actions">{actions}</div>
      </div>
    </div>
  </Portal>
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** Anchored popup menu; closes on outside click, Escape, or selection. */
export function Menu({ anchor, items, onClose }: { anchor: HTMLElement; items: readonly MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect()
    const menu = ref.current
    const width = menu?.offsetWidth ?? 180
    const height = menu?.offsetHeight ?? 200
    let left = rect.right - width
    if (left < 8) left = Math.min(rect.left, window.innerWidth - width - 8)
    let top = rect.bottom + 4
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4)
    setPosition({ top, left: Math.max(8, left) })
  }, [anchor])
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node) !== true && !anchor.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])
  return <Portal>
    <div ref={ref} className="dig-menu" role="menu" style={{ top: position.top, left: position.left }}>
      {items.map((item, index) => <button
        key={index}
        type="button"
        role="menuitem"
        className={item.danger === true ? 'dig-danger' : undefined}
        onClick={() => {
          onClose()
          item.onSelect()
        }}
      >{item.icon}{item.label}</button>)}
    </div>
  </Portal>
}

/** Menu trigger state: `[anchor, open(event), close]`. */
export function useMenu(): [HTMLElement | null, (event: { currentTarget: HTMLElement; stopPropagation(): void }) => void, () => void] {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = useCallback((event: { currentTarget: HTMLElement; stopPropagation(): void }) => {
    event.stopPropagation()
    const target = event.currentTarget
    setAnchor(current => current === target ? null : target)
  }, [])
  const close = useCallback(() => setAnchor(null), [])
  return [anchor, open, close]
}

/** Transient message at the bottom of the screen. */
export function useToast(): [ReactNode, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 2200)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [message === null ? null : <Portal><div className="dig-toast" role="status">{message}</div></Portal>, show]
}

/** A glyph of the aspect ratio for ratio chips. */
export function RatioGlyph({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return null
  const scale = 12 / Math.max(w, h)
  return <span className="dig-ratio-glyph" style={{ width: Math.max(4, Math.round(w * scale)), height: Math.max(4, Math.round(h * scale)) }} />
}
