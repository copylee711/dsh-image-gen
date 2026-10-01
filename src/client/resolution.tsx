/**
 * Resolution row for pixel-size protocols: 标准 (the provider's table size),
 * long-side presets (1K / 1.5K / 2K) that fit the provider's range, and a
 * custom W × H pair with an aspect lock.
 */
import { Link2, Link2Off } from 'lucide-react'
import {
  RESOLUTION_PRESETS,
  clampDimension,
  sizeForRatio,
  type ProtocolCapabilities,
  type SizeRange,
} from '../shared.js'
import type { Translate } from './i18n.js'

export type ResolutionMode = 'std' | '1k' | '1.5k' | '2k' | 'custom'

export interface ResolutionState {
  res: ResolutionMode
  w: number
  h: number
  /** Keep W:H on the selected ratio while editing custom sizes. */
  lock: boolean
}

export const DEFAULT_RESOLUTION: ResolutionState = { res: 'std', w: 1024, h: 1024, lock: true }

/** Presets whose size fits the range without clamping either side. */
export function presetsFor(range: SizeRange, ratio: string): Array<{ id: ResolutionMode; label: string; width: number; height: number }> {
  return RESOLUTION_PRESETS.flatMap(preset => {
    const size = sizeForRatio(ratio, preset.longSide, range.step)
    const fits = size.width >= range.min && size.height >= range.min && size.width <= range.max && size.height <= range.max
    return fits ? [{ id: preset.id, label: preset.label, ...size }] : []
  })
}

/**
 * The explicit `WxH` the request should carry, or undefined for the
 * provider's standard size (ratio table / tier).
 */
export function explicitSize(caps: ProtocolCapabilities | undefined, ratio: string, state: ResolutionState): string | undefined {
  const range = caps?.customSize
  if (range === undefined || state.res === 'std') return undefined
  if (state.res === 'custom') {
    return `${String(clampDimension(state.w, range))}x${String(clampDimension(state.h, range))}`
  }
  const preset = presetsFor(range, ratio).find(entry => entry.id === state.res)
  return preset === undefined ? undefined : `${String(preset.width)}x${String(preset.height)}`
}

/** Height that keeps `width` on `ratio`. */
function lockedHeight(width: number, ratio: string, range: SizeRange): number {
  const [rw, rh] = ratio.split(':').map(Number)
  if (rw === undefined || rh === undefined || rw <= 0 || rh <= 0) return width
  return clampDimension((width * rh) / rw, range)
}

export function ResolutionPicker({ t, caps, ratio, value, onChange }: {
  t: Translate
  caps: ProtocolCapabilities
  ratio: string
  value: ResolutionState
  onChange: (next: ResolutionState) => void
}) {
  const range = caps.customSize
  if (range === undefined) return null
  const presets = presetsFor(range, ratio)
  const mode: ResolutionMode = value.res === 'custom' || value.res === 'std' || presets.some(preset => preset.id === value.res) ? value.res : 'std'
  const standard = caps.sizes?.[ratio]?.replace('*', '×').replace('x', '×') ?? (caps.tiers.length > 0 ? caps.tiers.join(' / ') : '')
  const caption = mode === 'std'
    ? standard
    : mode === 'custom'
      ? `${String(clampDimension(value.w, range))}×${String(clampDimension(value.h, range))}`
      : (() => { const preset = presets.find(entry => entry.id === mode); return preset === undefined ? '' : `${String(preset.width)}×${String(preset.height)}` })()

  const startCustom = (): void => {
    // Seed the custom fields from whatever is selected now.
    const current = caption.match(/(\d+)×(\d+)/)
    const w = current === null ? value.w : Number(current[1])
    const h = current === null ? value.h : Number(current[2])
    onChange({ ...value, res: 'custom', w: clampDimension(w, range), h: clampDimension(h, range) })
  }
  const setWidth = (raw: string, commit: boolean): void => {
    const w = Number(raw.replace(/\D/g, '')) || 0
    const width = commit ? clampDimension(w, range) : w
    onChange({ ...value, w: width, ...(value.lock ? { h: lockedHeight(Math.max(width, range.min), ratio, range) } : {}) })
  }
  const setHeight = (raw: string, commit: boolean): void => {
    const h = Number(raw.replace(/\D/g, '')) || 0
    const height = commit ? clampDimension(h, range) : h
    if (!value.lock) {
      onChange({ ...value, h: height })
      return
    }
    const [rw, rh] = ratio.split(':').map(Number)
    const width = rw !== undefined && rh !== undefined && rw > 0 && rh > 0 ? clampDimension((Math.max(height, range.min) * rw) / rh, range) : height
    onChange({ ...value, h: height, w: width })
  }

  return <div className="dig-field">
    <span className="dig-label">{t('pixelSize')}<span className="dig-hint">{caption}</span></span>
    <div className="dig-chips" role="group" aria-label={t('pixelSize')}>
      <button type="button" className="dig-chip" aria-pressed={mode === 'std'} onClick={() => onChange({ ...value, res: 'std' })}>{t('standardSize')}</button>
      {presets.map(preset => <button key={preset.id} type="button" className="dig-chip" title={`${String(preset.width)}×${String(preset.height)}`} aria-pressed={mode === preset.id} onClick={() => onChange({ ...value, res: preset.id })}>{preset.label}</button>)}
      <button type="button" className="dig-chip" aria-pressed={mode === 'custom'} onClick={startCustom}>{t('customSize')}</button>
    </div>
    {mode === 'custom' && <div className="dig-size-row">
      <input
        className="dig-input"
        inputMode="numeric"
        aria-label={t('width')}
        value={value.w === 0 ? '' : String(value.w)}
        onChange={event => setWidth(event.target.value, false)}
        onBlur={event => setWidth(event.target.value, true)}
      />
      <button
        type="button"
        className="dig-icon-btn"
        aria-pressed={value.lock}
        title={value.lock ? t('unlockRatio') : t('lockRatio')}
        aria-label={value.lock ? t('unlockRatio') : t('lockRatio')}
        onClick={() => onChange({ ...value, lock: !value.lock, ...(!value.lock ? { h: lockedHeight(clampDimension(value.w, range), ratio, range) } : {}) })}
      >{value.lock ? <Link2 size={15} /> : <Link2Off size={15} />}</button>
      <input
        className="dig-input"
        inputMode="numeric"
        aria-label={t('height')}
        value={value.h === 0 ? '' : String(value.h)}
        onChange={event => setHeight(event.target.value, false)}
        onBlur={event => setHeight(event.target.value, true)}
      />
    </div>}
    {mode === 'custom' && <span className="dig-hint">{t('sizeRangeHint', { min: range.min, max: range.max, step: range.step })}</span>}
    {mode !== 'std' && <span className="dig-hint">{t('sizeSupportHint')}</span>}
  </div>
}
