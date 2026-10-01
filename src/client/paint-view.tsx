/**
 * The “绘画” tab: parameters on the left, artboard + prompt composer in the
 * middle, the current project's history on the right (Cherry Studio layout).
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import { Bookmark, Copy, Download, ImagePlus, LoaderCircle, Maximize2, Palette, Sparkles, Square, Star, Trash2, X } from 'lucide-react'
import type { AttachmentJson, GalleryItem } from '../gallery-types.js'
import { capabilitiesOf, effectiveModel, type ProviderView, type SettingsView } from '../shared.js'
import { api, copyImage, downloadImage, imageUrl, uploadFiles } from './api.js'
import type { Translate } from './i18n.js'
import { Lightbox } from './lightbox.js'
import { RatioGlyph } from './widgets.js'

const PARAMS_KEY = 'copylee-image-gen.paint.v1'
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
  }))
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState<AttachmentJson[]>([])
  const [busy, setBusy] = useState<{ count: number; controller: AbortController } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentBatch, setCurrentBatch] = useState<GalleryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Fall back to a ready provider when the remembered one is not usable.
  const provider = providers.find(entry => entry.id === params.providerId)
    ?? providers.find(entry => entry.id === settings?.activeProvider)
    ?? providers[0]
  const caps = provider === undefined ? undefined : capabilitiesOf(provider)
  const model = provider === undefined ? '' : params.providerId === provider.id && params.model.length > 0 ? params.model : effectiveModel(provider)

  useEffect(() => { saveParams(params) }, [params])
  useEffect(() => {
    const injected = props.injected
    if (injected === null) return
    if (injected.text !== undefined) setPrompt(injected.text)
    if (injected.reference !== undefined) addReference(injected.reference)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.injected])
  // A new project starts with an empty artboard.
  useEffect(() => {
    setCurrentBatch([])
    setSelectedId(null)
  }, [props.projectId])

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
      const uploaded = await uploadFiles(images)
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
    const controller = new AbortController()
    const count = Math.min(params.count, caps?.maxCount ?? 1)
    setBusy({ count, controller })
    setError(null)
    const tier = caps?.tiers.includes(params.tier) === true ? params.tier : caps?.tiers[0]
    const seed = Number(params.seed)
    try {
      const result = await api.paint({
        providerId: provider.id,
        ...(model.length > 0 ? { model } : {}),
        prompt: text,
        ...(params.negative.trim().length > 0 ? { negativePrompt: params.negative.trim() } : {}),
        ...(caps !== undefined && caps.ratios.includes(params.ratio) ? { aspectRatio: params.ratio } : {}),
        ...(tier === undefined ? {} : { imageSize: tier }),
        ...((provider.protocol === 'openai' || provider.protocol === 'openai-compat') && params.quality !== 'auto' ? { quality: params.quality } : {}),
        ...(params.seed.trim().length > 0 && Number.isSafeInteger(seed) ? { seed } : {}),
        count,
        references,
        projectId: props.projectId,
      }, controller.signal)
      setCurrentBatch(result.items)
      setSelectedId(result.items[0]?.id ?? null)
      if (result.failures.length > 0) setError(t('failedN', { n: result.failures.length, error: result.failures[0] ?? '' }))
      props.onGalleryChanged()
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  const act = {
    download: (item: GalleryItem) => { void downloadImage(item.attachment, `copylee-image-${item.id.slice(0, 8)}`).catch((failure: unknown) => props.onError(String(failure))) },
    copy: (item: GalleryItem) => { void copyImage(item.attachment).then(() => props.toast(t('copied')), (failure: unknown) => props.onError(failure instanceof Error ? failure.message : String(failure))) },
    favorite: (item: GalleryItem) => {
      void api.gallery.update([item.id], { favorite: !item.favorite }).then(() => {
        setCurrentBatch(batch => batch.map(entry => entry.id === item.id ? { ...entry, favorite: !item.favorite } : entry))
        props.onGalleryChanged()
      })
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
              <select id="dig-provider" className="dig-select" value={provider?.id ?? ''} onChange={event => selectProvider(event.target.value)}>
                {providers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </div>
            <div className="dig-field">
              <label className="dig-label" htmlFor="dig-model">{t('model')}</label>
              {provider !== undefined && provider.models.length > 0
                ? <select id="dig-model" className="dig-select" value={model} onChange={event => update({ providerId: provider.id, model: event.target.value })}>
                  {(provider.models.includes(model) || model.length === 0 ? provider.models : [model, ...provider.models]).map(id => <option key={id} value={id}>{id}</option>)}
                </select>
                : <input id="dig-model" className="dig-input" value={model} onChange={event => update({ providerId: provider?.id ?? '', model: event.target.value })} />}
            </div>
            {caps !== undefined && caps.ratios.length > 0 && <div className="dig-field">
              <span className="dig-label">{t('ratio')}</span>
              <div className="dig-chips" role="group" aria-label={t('ratio')}>
                {caps.ratios.map(ratio => <button key={ratio} type="button" className="dig-chip" aria-pressed={params.ratio === ratio} onClick={() => update({ ratio })}>
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
      <div className="dig-board">
        {busy !== null
          ? <div className="dig-board-grid" style={busy.count === 1 ? { gridTemplateColumns: 'minmax(0,1fr)', maxWidth: 520, maxHeight: 520 } : undefined}>
            {Array.from({ length: busy.count }, (_, index) => <div key={index} className="dig-board-cell dig-skeleton">
              {index === 0 && <div className="dig-busy"><LoaderCircle size={22} className="dig-spin" />{t('generating')}</div>}
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
            <button type="button" className="dig-icon-btn" title="Zoom" onClick={() => setLightbox(Math.max(0, lightboxItems.findIndex(item => item.id === selected.id)))}><Maximize2 size={16} /></button>
            <button type="button" className="dig-icon-btn" title={t('delete')} onClick={() => act.remove(selected)}><Trash2 size={16} /></button>
          </div>
          <div className="dig-board-meta" title={selected.prompt}>{selected.providerName ?? selected.providerId} · {selected.model} · {selected.attachment.width}×{selected.attachment.height}</div>
        </>}
      </div>
      {error !== null && <div className="dig-error" role="alert">{error}</div>}
      <div className="dig-composer">
        {references.length > 0 && <div className="dig-refs">
          {references.map(ref => <div key={ref.attachmentId} className="dig-ref" style={{ width: 40, height: 40 }}>
            <img src={imageUrl(ref)} alt="" />
            <button type="button" aria-label={t('delete')} onClick={() => setReferences(current => current.filter(entry => entry.attachmentId !== ref.attachmentId))}><X size={10} /></button>
          </div>)}
        </div>}
        <textarea
          value={prompt}
          placeholder={t('promptPlaceholder')}
          rows={2}
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
            }
          }}
        />
        <div className="dig-composer-row">
          <button type="button" className="dig-icon-btn" title={t('addReference')} disabled={caps === undefined || caps.maxReferences === 0} onClick={() => fileInput.current?.click()}><ImagePlus size={16} /></button>
          <button type="button" className="dig-icon-btn" title={t('savePrompt')} disabled={prompt.trim().length === 0} onClick={() => {
            void api.gallery.addFavoritePrompt(prompt).then(() => props.toast(t('promptSaved')), (failure: unknown) => props.onError(String(failure)))
          }}><Bookmark size={16} /></button>
          <span className="dig-spacer" />
          <span className="dig-hint">{provider === undefined ? '' : `${provider.name} · ${model}`}</span>
          {busy !== null
            ? <button type="button" className="dig-btn" onClick={() => busy.controller.abort()}><Square size={12} fill="currentColor" />{t('stop')}</button>
            : <button type="button" className="dig-btn dig-btn-primary" disabled={prompt.trim().length === 0 || provider === undefined} onClick={() => { void generate() }}><Sparkles size={14} />{t('generate')}</button>}
        </div>
      </div>
    </section>

    <aside className="dig-history" aria-label={t('history')}>
      <div className="dig-section-title" style={{ padding: '12px 14px 4px' }}><span>{t('history')}</span><span>{history.length}</span></div>
      <div className="dig-history-list dig-scroll">
        {history.map(item => <div
          key={item.id}
          className="dig-thumb"
          role="button"
          tabIndex={0}
          title={item.prompt}
          aria-current={selected?.id === item.id}
          onClick={() => {
            setCurrentBatch([])
            setSelectedId(item.id)
          }}
          onKeyDown={event => { if (event.key === 'Enter') { setCurrentBatch([]); setSelectedId(item.id) } }}
        >
          <img src={imageUrl(item.attachment)} alt="" loading="lazy" />
          <button type="button" className="dig-thumb-del" aria-label={t('delete')} onClick={event => { event.stopPropagation(); act.remove(item) }}><X size={12} /></button>
        </div>)}
      </div>
    </aside>

    {lightbox !== null && <Lightbox
      items={lightboxItems}
      index={lightbox}
      onIndex={setLightbox}
      onClose={() => setLightbox(null)}
      t={t}
      actions={{
        onDownload: act.download,
        onCopy: act.copy,
        onFavorite: act.favorite,
        onDelete: item => { act.remove(item); setLightbox(null) },
        onUseAsReference: item => { addReference(item.attachment); setLightbox(null) },
        onReusePrompt: item => { setPrompt(item.prompt); setLightbox(null) },
      }}
    />}
  </>
}
