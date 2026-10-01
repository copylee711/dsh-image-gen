/**
 * The “绘画” tab: parameters on the left, artboard + prompt composer in the
 * middle, the current project's history on the right (Cherry Studio layout).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Bookmark, Copy, Download, Eraser, FolderOpen, ImagePlus, LoaderCircle, Maximize2, Palette, Plus, Sparkles, Square, Star, Trash2, X } from 'lucide-react'
import type { AttachmentJson, FavoritePrompt, GalleryItem } from '../gallery-types.js'
import { PROTOCOL_LABELS, capabilitiesOf, effectiveModel, sizeForRatio, type ProviderView, type SettingsView } from '../shared.js'
import { api, copyImage, downloadImage, imageUrl, uploadFiles } from './api.js'
import type { Translate } from './i18n.js'
import { Lightbox } from './lightbox.js'
import { DEFAULT_RESOLUTION, ResolutionPicker, explicitSize, type ResolutionState } from './resolution.js'
import { PromptPicker } from './prompt-picker.js'
import { boardOf, clearBoard, setDraft, startJob, stopJob, updateBoard, usePaintSession } from './paint-session.js'
import { Select } from './select.js'
import { RatioGlyph } from './widgets.js'

const PARAMS_KEY = 'copylee-image-gen.paint.v1'
const COMPOSER_KEY = 'copylee-image-gen.composer.h'
const COMPOSER_MIN = 72

/** Default cap for the auto-growing prompt box: 40% of the viewport. */
function defaultComposerCap(): number {
  return Math.round(window.innerHeight * 0.4)
}

function loadComposerCap(): number | null {
  try {
    const value = Number(localStorage.getItem(COMPOSER_KEY))
    return Number.isFinite(value) && value >= COMPOSER_MIN ? value : null
  } catch {
    return null
  }
}

function saveComposerCap(value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(COMPOSER_KEY)
    else localStorage.setItem(COMPOSER_KEY, String(Math.round(value)))
  } catch {
    // storage unavailable: the height simply resets next time
  }
}
const QUALITIES = ['auto', 'low', 'medium', 'high'] as const

interface ParamState {
  providerId: string
  model: string
  ratio: string
  tier: string
  quality: string
  count: number
  seed: string
  negative: string
  /** Resolution choice per provider id. */
  sizes: Record<string, ResolutionState>
}

function loadParams(): Partial<ParamState> {
  try {
    const raw = localStorage.getItem(PARAMS_KEY)
    return raw === null ? {} : JSON.parse(raw) as Partial<ParamState>
  } catch {
    return {}
  }
}

function saveParams(state: ParamState): void {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(state))
  } catch {
    // storage may be unavailable (private mode); parameters just reset
  }
}

/** Providers the paintings page can use right now. */
export function readyProviders(settings: SettingsView | null): ProviderView[] {
  return (settings?.providers ?? []).filter(entry => entry.enabled && entry.keyConfigured && entry.baseURL.length > 0)
}

export function PaintView(props: {
  t: Translate
  settings: SettingsView | null
  projectId: string
  /** History of the current project (newest first). */
  history: readonly GalleryItem[]
  /** Re-read gallery data after a change. */
  onGalleryChanged: () => void
  onError: (message: string) => void
  toast: (message: string) => void
  onOpenSettings: () => void
  /** Prompt / reference handed over from another tab. */
  injected: { text?: string; reference?: AttachmentJson; nonce: number } | null
  sideTop: JSX.Element
  /** Bumps when gallery data (incl. saved prompts) changes elsewhere. */
  refreshKey: number
}) {
  const { t, settings, history } = props
  const providers = useMemo(() => readyProviders(settings), [settings])
  const initial = useMemo(loadParams, [])
  const [params, setParams] = useState<ParamState>(() => ({
    providerId: initial.providerId ?? '',
    model: initial.model ?? '',
    ratio: initial.ratio ?? '1:1',
    tier: initial.tier ?? '',
    quality: initial.quality ?? 'auto',
    count: initial.count ?? 1,
    seed: '',
    negative: initial.negative ?? '',
    sizes: typeof initial.sizes === 'object' && initial.sizes !== null ? initial.sizes : {},
  }))
  // Draft, artboard and running job live in the session store so they
  // survive this view unmounting (leaving the page or switching tabs).
  const session = usePaintSession()
  const projectId = props.projectId
  const board = boardOf(session, projectId)
  const busy = session.jobs.get(projectId) ?? null
  const prompt = session.draft.prompt
  const references = session.draft.references
  const error = board.error
  const currentBatch = board.batch
  const selectedId = board.selectedId
  const setPrompt = (next: string | ((current: string) => string)): void => setDraft(draft => ({ prompt: typeof next === 'function' ? next(draft.prompt) : next }))
  const setReferences = (next: (current: AttachmentJson[]) => AttachmentJson[]): void => setDraft(draft => ({ references: next(draft.references) }))
  const setCurrentBatch = (next: GalleryItem[] | ((current: GalleryItem[]) => GalleryItem[])): void => updateBoard(projectId, current => ({ batch: typeof next === 'function' ? next(current.batch) : next }))
  const setSelectedId = (id: string | null): void => updateBoard(projectId, { selectedId: id })
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (busy === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])
  const [lightbox, setLightbox] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [savedPrompts, setSavedPrompts] = useState<FavoritePrompt[]>([])
  const reloadPrompts = useCallback(() => {
    api.gallery.favoritePrompts().then(result => setSavedPrompts(result.prompts), () => {})
  }, [])
  useEffect(reloadPrompts, [reloadPrompts, props.refreshKey])
  const promptSaved = prompt.trim().length > 0 && savedPrompts.some(entry => entry.text === prompt.trim())
  const usePrompt = (text: string, mode: 'replace' | 'append'): void => {
    setPrompt(current => mode === 'append' && current.trim().length > 0 ? `${current.replace(/\s+$/, '')}\n${text}` : text)
    setPickerOpen(false)
    requestAnimationFrame(() => {
      const area = promptRef.current
      if (area === null) return
      area.focus()
      area.setSelectionRange(area.value.length, area.value.length)
    })
  }
  // Height fixed by dragging the grip; null = auto-grow.
  const [composerCap, setComposerCap] = useState<number | null>(loadComposerCap)

  // Default: grow with the content up to 40vh, then scroll inside.
  // After a drag the box keeps the dragged height (double-click the grip to go back to auto).
  useLayoutEffect(() => {
    const area = promptRef.current
    if (area === null) return
    const max = Math.round(window.innerHeight * 0.7)
    if (composerCap !== null) {
      area.style.height = `${String(Math.min(Math.max(composerCap, COMPOSER_MIN), max))}px`
      return
    }
    area.style.height = 'auto'
    area.style.height = `${String(Math.min(Math.max(area.scrollHeight, COMPOSER_MIN), defaultComposerCap()))}px`
  }, [prompt, composerCap])

  /** Drag the grip above the prompt box to change its height cap. */
  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const area = promptRef.current
    if (area === null) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = area.getBoundingClientRect().height
    const max = Math.round(window.innerHeight * 0.7)
    let next = startHeight
    const onMove = (move: PointerEvent): void => {
      next = Math.min(max, Math.max(COMPOSER_MIN, startHeight + (startY - move.clientY)))
      area.style.height = `${String(next)}px`
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setComposerCap(next)
      saveComposerCap(next)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Fall back to a ready provider when the remembered one is not usable.
  const provider = providers.find(entry => entry.id === params.providerId)
    ?? providers.find(entry => entry.id === settings?.activeProvider)
    ?? providers[0]
  const caps = provider === undefined ? undefined : capabilitiesOf(provider)
  const resolution: ResolutionState = { ...DEFAULT_RESOLUTION, ...(provider === undefined ? {} : params.sizes[provider.id]) }
  const setResolution = (next: ResolutionState): void => {
    if (provider === undefined) return
    setParams(current => ({ ...current, sizes: { ...current.sizes, [provider.id]: next } }))
  }
  const freeRatio = resolution.res === 'custom' && !resolution.lock && caps?.customSize !== undefined
  const model = provider === undefined ? '' : params.providerId === provider.id && params.model.length > 0 ? params.model : effectiveModel(provider)

  useEffect(() => { saveParams(params) }, [params])
  useEffect(() => {
    const injected = props.injected
    if (injected === null) return
    if (injected.text !== undefined) setPrompt(injected.text)
    if (injected.reference !== undefined) addReference(injected.reference)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.injected])

  const update = (patch: Partial<ParamState>): void => setParams(current => ({ ...current, ...patch }))
  const selectProvider = (id: string): void => {
    const next = providers.find(entry => entry.id === id)
    update({ providerId: id, model: next === undefined ? '' : effectiveModel(next), tier: '' })
  }

  const boardItems = currentBatch.length > 0 ? currentBatch : history.filter(item => item.id === selectedId)
  const selected = boardItems.find(item => item.id === selectedId) ?? boardItems[0]

  const addReferenceFiles = async (files: File[]): Promise<void> => {
    const images = files.filter(file => file.type.startsWith('image/'))
    if (images.length === 0) return
    if (caps === undefined || caps.maxReferences === 0) {
      props.onError(t('referencesUnsupported'))
      return
    }
    try {
      const uploaded = await uploadFiles(images, settings?.imageLimits)
      setReferences(current => [...current, ...uploaded].slice(-caps.maxReferences))
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const addReference = (attachment: AttachmentJson): void => {
    if (caps === undefined || caps.maxReferences === 0) {
      props.onError(t('referencesUnsupported'))
      return
    }
    setReferences(current => [...current.filter(ref => ref.attachmentId !== attachment.attachmentId), attachment].slice(-caps.maxReferences))
  }

  const generate = async (): Promise<void> => {
    const text = prompt.trim()
    if (text.length === 0 || provider === undefined || busy !== null) return
    const count = Math.min(params.count, caps?.maxCount ?? 1)
    const tier = caps?.tiers.includes(params.tier) === true ? params.tier : caps?.tiers[0]
    const seed = Number(params.seed)
    const size = explicitSize(caps, params.ratio, resolution)
    await startJob({
      providerId: provider.id,
      ...(model.length > 0 ? { model } : {}),
      prompt: text,
      ...(params.negative.trim().length > 0 ? { negativePrompt: params.negative.trim() } : {}),
      ...(caps !== undefined && caps.ratios.includes(params.ratio) ? { aspectRatio: params.ratio } : {}),
      ...(tier === undefined ? {} : { imageSize: tier }),
      ...(size === undefined ? {} : { size }),
      ...((provider.protocol === 'openai' || provider.protocol === 'openai-compat') && params.quality !== 'auto' ? { quality: params.quality } : {}),
      ...(params.seed.trim().length > 0 && Number.isSafeInteger(seed) ? { seed } : {}),
      count,
      references,
      projectId,
    }, { describeFailures: failures => t('failedN', { n: failures.length, error: failures[0] ?? '' }) })
  }

  /** Back to an empty canvas with a fresh composer (the running job, if any, keeps going). */
  const newCanvas = (): void => {
    clearBoard(projectId)
    setDraft({ prompt: '', references: [] })
    setLightbox(null)
    promptRef.current?.focus()
  }
  /** Deselect: empty canvas, keep the draft. */
  const deselect = (): void => updateBoard(projectId, { batch: [], selectedId: null })

  const act = {
    download: (item: GalleryItem) => { void downloadImage(item.attachment, `copylee-image-${item.id.slice(0, 8)}`).catch((failure: unknown) => props.onError(String(failure))) },
    copy: (item: GalleryItem) => { void copyImage(item.attachment).then(() => props.toast(t('copied')), (failure: unknown) => props.onError(failure instanceof Error ? failure.message : String(failure))) },
    favorite: (item: GalleryItem) => {
      void api.gallery.update([item.id], { favorite: !item.favorite }).then(() => {
        setCurrentBatch(batch => batch.map(entry => entry.id === item.id ? { ...entry, favorite: !item.favorite } : entry))
        props.onGalleryChanged()
      })
    },
    reveal: (item: GalleryItem) => {
      void api.gallery.reveal(item.id).then(result => props.toast(t('revealedAt', { path: result.path })), (failure: unknown) => props.onError(failure instanceof Error ? failure.message : String(failure)))
    },
    remove: (item: GalleryItem) => {
      void api.gallery.remove([item.id]).then(() => {
        setCurrentBatch(batch => batch.filter(entry => entry.id !== item.id))
        if (selectedId === item.id) setSelectedId(null)
        props.onGalleryChanged()
      })
    },
  }

  const lightboxItems = currentBatch.length > 0 ? currentBatch : [...history]
  /** Show a history image; clicking the one already shown deselects it. */
  const pickHistory = (id: string): void => {
    if (busy === null && selected?.id === id) deselect()
    else updateBoard(projectId, { batch: [], selectedId: id })
  }

  return <>
    <aside className="dig-side">
      {props.sideTop}
      <div className="dig-params dig-scroll">
        {providers.length === 0
          ? <div className="dig-notice">
            <p style={{ margin: '0 0 8px' }}>{t('noProviders')}</p>
            <button type="button" className="dig-btn dig-btn-sm" onClick={props.onOpenSettings}>{t('openSettings')}</button>
          </div>
          : <>
            <div className="dig-field">
              <label className="dig-label" htmlFor="dig-provider">{t('provider')}</label>
              <Select
                id="dig-provider"
                label={t('provider')}
                value={provider?.id ?? ''}
                options={providers.map(entry => ({ value: entry.id, label: entry.name, ...(entry.preset === true ? {} : { detail: PROTOCOL_LABELS[entry.protocol] }) }))}
                onChange={selectProvider}
              />
            </div>
            <div className="dig-field">
              <label className="dig-label" htmlFor="dig-model">{t('model')}</label>
              <Select
                id="dig-model"
                label={t('model')}
                editable
                editablePlaceholder={t('modelFilter')}
                value={model}
                options={(provider === undefined ? [] : provider.models.includes(model) || model.length === 0 ? provider.models : [model, ...provider.models]).map(id => ({ value: id, label: id }))}
                onChange={next => update({ providerId: provider?.id ?? '', model: next })}
              />
            </div>
            {caps !== undefined && caps.ratios.length > 0 && <div className="dig-field">
              <span className="dig-label">{t('ratio')}</span>
              <div className="dig-chips" role="group" aria-label={t('ratio')}>
                {caps.ratios.map(ratio => <button key={ratio} type="button" className="dig-chip" aria-pressed={!freeRatio && params.ratio === ratio} onClick={() => {
                  update({ ratio })
                  if (resolution.res === 'custom' && caps.customSize !== undefined) {
                    const fitted = sizeForRatio(ratio, Math.max(resolution.w, resolution.h), caps.customSize.step, caps.customSize)
                    setResolution({ ...resolution, lock: true, w: fitted.width, h: fitted.height })
                  }
                }}>
                  <RatioGlyph ratio={ratio} />{ratio}
                </button>)}
              </div>
            </div>}
            {caps !== undefined && caps.tiers.length > 0 && <div className="dig-field">
              <span className="dig-label">{t('resolution')}</span>
              <div className="dig-chips" role="group" aria-label={t('resolution')}>
                {caps.tiers.map(tier => <button key={tier} type="button" className="dig-chip" aria-pressed={(caps.tiers.includes(params.tier) ? params.tier : caps.tiers[0]) === tier} onClick={() => update({ tier })}>{tier}</button>)}
              </div>
            </div>}
            {caps?.customSize !== undefined && <ResolutionPicker t={t} caps={caps} ratio={caps.ratios.includes(params.ratio) ? params.ratio : caps.ratios[0] ?? '1:1'} value={resolution} onChange={setResolution} />}
            {(provider?.protocol === 'openai' || provider?.protocol === 'openai-compat') && <div className="dig-field">
              <span className="dig-label">{t('quality')}</span>
              <div className="dig-chips" role="group" aria-label={t('quality')}>
                {QUALITIES.map(quality => <button key={quality} type="button" className="dig-chip" aria-pressed={params.quality === quality} onClick={() => update({ quality })}>{quality}</button>)}
              </div>
            </div>}
            <div className="dig-field">
              <span className="dig-label">{t('count')}</span>
              <div className="dig-chips" role="group" aria-label={t('count')}>
                {Array.from({ length: caps?.maxCount ?? 1 }, (_, index) => index + 1).map(count => <button key={count} type="button" className="dig-chip" aria-pressed={params.count === count} onClick={() => update({ count })}>{count}</button>)}
              </div>
            </div>
            {(provider?.protocol === 'modelscope' || provider?.protocol === 'siliconflow') && <>
              <div className="dig-field">
                <label className="dig-label" htmlFor="dig-negative">{t('negativePrompt')}</label>
                <textarea id="dig-negative" className="dig-textarea" rows={2} value={params.negative} onChange={event => update({ negative: event.target.value })} />
              </div>
              <div className="dig-field">
                <label className="dig-label" htmlFor="dig-seed">{t('seed')}</label>
                <input id="dig-seed" className="dig-input" inputMode="numeric" placeholder={t('seedHint')} value={params.seed} onChange={event => update({ seed: event.target.value.replace(/[^0-9]/g, '') })} />
              </div>
            </>}
            <div className="dig-field">
              <span className="dig-label">{t('references')}{caps !== undefined && caps.maxReferences > 0 ? <span className="dig-hint">≤ {caps.maxReferences}</span> : null}</span>
              {caps !== undefined && caps.maxReferences === 0
                ? <span className="dig-hint">{t('referencesUnsupported')}</span>
                : <div className="dig-refs">
                  {references.map(ref => <div key={ref.attachmentId} className="dig-ref">
                    <img src={imageUrl(ref)} alt="" />
                    <button type="button" aria-label={t('delete')} onClick={() => setReferences(current => current.filter(entry => entry.attachmentId !== ref.attachmentId))}><X size={12} /></button>
                  </div>)}
                  <button type="button" className="dig-ref" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--dig-fg3)' }} title={t('addReference')} aria-label={t('addReference')} onClick={() => fileInput.current?.click()}><ImagePlus size={18} /></button>
                  <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    void addReferenceFiles([...(event.target.files ?? [])])
                    event.target.value = ''
                  }} />
                </div>}
            </div>
          </>}
      </div>
    </aside>

    <section
      className="dig-center"
      onDragOver={(event: DragEvent) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={(event: DragEvent) => {
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        void addReferenceFiles([...event.dataTransfer.files])
      }}
    >
      <div
        className="dig-board"
        tabIndex={-1}
        onKeyDown={event => {
          if (event.key === 'Escape' && lightbox === null && !pickerOpen && selected !== undefined) {
            event.preventDefault()
            deselect()
          }
        }}
      >
        {busy !== null
          ? <div className="dig-board-grid" style={busy.count === 1 ? { gridTemplateColumns: 'minmax(0,1fr)', maxWidth: 520, maxHeight: 520 } : undefined}>
            {Array.from({ length: busy.count }, (_, index) => <div key={index} className="dig-board-cell dig-skeleton">
              {index === 0 && <div className="dig-busy"><LoaderCircle size={22} className="dig-spin" />{t('generating')}<span className="dig-hint">{t('elapsed', { s: Math.max(0, Math.round((now - busy.startedAt) / 1000)) })}</span></div>}
            </div>)}
          </div>
          : selected === undefined
            ? <div className="dig-board-empty"><Palette size={40} strokeWidth={1.4} /><div>{t('emptyCanvas')}</div></div>
            : boardItems.length > 1
              ? <div className="dig-board-grid">
                {boardItems.map((item, index) => <div key={item.id} className="dig-board-cell" aria-current={item.id === selected.id} onClick={() => setSelectedId(item.id)} onDoubleClick={() => setLightbox(index)}>
                  <img src={imageUrl(item.attachment)} alt={item.prompt} />
                </div>)}
              </div>
              : <img className="dig-board-img" src={imageUrl(selected.attachment)} alt={selected.prompt} onClick={() => setLightbox(Math.max(0, lightboxItems.findIndex(item => item.id === selected.id)))} />}
        {busy === null && selected !== undefined && <>
          <div className="dig-board-tools">
            <button type="button" className="dig-icon-btn" title={t('useAsReference')} onClick={() => addReference(selected.attachment)}><ImagePlus size={16} /></button>
            <button type="button" className="dig-icon-btn" title={selected.favorite ? t('unfavorite') : t('favorite')} aria-pressed={selected.favorite} onClick={() => act.favorite(selected)}><Star size={16} fill={selected.favorite ? '#f5a623' : 'none'} /></button>
            <button type="button" className="dig-icon-btn" title={t('copy')} onClick={() => act.copy(selected)}><Copy size={16} /></button>
            <button type="button" className="dig-icon-btn" title={t('download')} onClick={() => act.download(selected)}><Download size={16} /></button>
            <button type="button" className="dig-icon-btn" title={t('revealInFolder')} onClick={() => act.reveal(selected)}><FolderOpen size={16} /></button>
            <button type="button" className="dig-icon-btn" title="Zoom" onClick={() => setLightbox(Math.max(0, lightboxItems.findIndex(item => item.id === selected.id)))}><Maximize2 size={16} /></button>
            <button type="button" className="dig-icon-btn" title={t('delete')} onClick={() => act.remove(selected)}><Trash2 size={16} /></button>
          </div>
          <div className="dig-board-meta" title={selected.prompt}>{selected.providerName ?? selected.providerId} · {selected.model} · {selected.attachment.width}×{selected.attachment.height}</div>
        </>}
      </div>
      {error !== null && <div className="dig-error dig-board-error" role="alert">
        <span className="dig-board-error-text">{error}</span>
        <button type="button" className="dig-icon-btn" title={t('dismiss')} aria-label={t('dismiss')} onClick={() => updateBoard(projectId, { error: null })}><X size={14} /></button>
      </div>}
      <div className="dig-composer" ref={composerRef}>
        <div
          className="dig-composer-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('resizeComposer')}
          title={t('resizeComposer')}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={() => { setComposerCap(null); saveComposerCap(null) }}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const current = promptRef.current?.getBoundingClientRect().height ?? COMPOSER_MIN
            const next = Math.min(Math.round(window.innerHeight * 0.7), Math.max(COMPOSER_MIN, current + (event.key === 'ArrowUp' ? 24 : -24)))
            setComposerCap(next)
            saveComposerCap(next)
          }}
        />
        {references.length > 0 && <div className="dig-refs">
          {references.map(ref => <div key={ref.attachmentId} className="dig-ref" style={{ width: 40, height: 40 }}>
            <img src={imageUrl(ref)} alt="" />
            <button type="button" aria-label={t('delete')} onClick={() => setReferences(current => current.filter(entry => entry.attachmentId !== ref.attachmentId))}><X size={10} /></button>
          </div>)}
        </div>}
        <textarea
          ref={promptRef}
          value={prompt}
          placeholder={t('promptPlaceholder')}
          rows={3}
          onChange={event => setPrompt(event.target.value)}
          onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
            const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
            if (files.length > 0) {
              event.preventDefault()
              void addReferenceFiles(files)
            }
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void generate()
            } else if ((event.key === '/' && prompt.length === 0) || (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey))) {
              event.preventDefault()
              setPickerOpen(true)
            }
          }}
        />
        <div className="dig-composer-row">
          <button type="button" className="dig-icon-btn" title={t('addReference')} disabled={caps === undefined || caps.maxReferences === 0} onClick={() => fileInput.current?.click()}><ImagePlus size={16} /></button>
          <button type="button" className="dig-icon-btn dig-bookmark-btn" title={t('openPromptPicker')} aria-label={t('openPromptPicker')} aria-expanded={pickerOpen} aria-pressed={promptSaved} onClick={() => setPickerOpen(open => !open)}>
            <Bookmark size={16} fill={promptSaved ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="dig-icon-btn" title={t('clearPrompt')} aria-label={t('clearPrompt')} disabled={prompt.length === 0} onClick={() => { setPrompt(''); promptRef.current?.focus() }}><Eraser size={16} /></button>
          <span className="dig-spacer" />
          {busy !== null
            ? <button type="button" className="dig-btn" onClick={() => stopJob(projectId)}><Square size={12} fill="currentColor" />{t('stop')}</button>
            : <button type="button" className="dig-btn dig-btn-primary" disabled={prompt.trim().length === 0 || provider === undefined} onClick={() => { void generate() }}><Sparkles size={14} />{t('generate')}</button>}
        </div>
      </div>
    </section>

    <aside className="dig-history" aria-label={t('history')}>
      <div className="dig-section-title" style={{ padding: '12px 14px 4px' }}><span>{t('history')}</span><span>{history.length}</span></div>
      <button type="button" className="dig-btn dig-btn-sm dig-new-canvas" title={t('newCanvasHint')} onClick={newCanvas}><Plus size={14} />{t('newCanvas')}</button>
      <div className="dig-history-list dig-scroll">
        {history.map(item => <div
          key={item.id}
          className="dig-thumb"
          role="button"
          tabIndex={0}
          title={item.prompt}
          aria-current={selected?.id === item.id}
          onClick={() => pickHistory(item.id)}
          onKeyDown={event => { if (event.key === 'Enter') pickHistory(item.id) }}
        >
          <img src={imageUrl(item.attachment)} alt="" loading="lazy" />
          <button type="button" className="dig-thumb-del" aria-label={t('delete')} onClick={event => { event.stopPropagation(); act.remove(item) }}><X size={12} /></button>
        </div>)}
      </div>
    </aside>

    {pickerOpen && composerRef.current !== null && <PromptPicker
      t={t}
      anchor={composerRef.current}
      prompt={prompt}
      prompts={savedPrompts}
      onReload={reloadPrompts}
      onUse={usePrompt}
      onClose={() => setPickerOpen(false)}
      onError={props.onError}
    />}
    {lightbox !== null && <Lightbox
      items={lightboxItems}
      index={lightbox}
      onIndex={setLightbox}
      onClose={() => setLightbox(null)}
      t={t}
      actions={{
        onDownload: act.download,
        onReveal: act.reveal,
        onCopy: act.copy,
        onFavorite: act.favorite,
        onDelete: item => { act.remove(item); setLightbox(null) },
        onUseAsReference: item => { addReference(item.attachment); setLightbox(null) },
        onReusePrompt: item => { setPrompt(item.prompt); setLightbox(null) },
      }}
    />}
  </>
}
