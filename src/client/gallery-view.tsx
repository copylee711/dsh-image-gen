/** The “图库” tab: every image across gallery projects, with filters and bulk actions. */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Check, CheckSquare, Download, FolderInput, ImagePlus, Images, Search, Star, Trash2, X } from 'lucide-react'
import { DEFAULT_PROJECT_ID, type GalleryItem } from '../gallery-types.js'
import type { SettingsView } from '../shared.js'
import { api, copyImage, downloadImage, imageUrl, uploadFiles, type ProjectSummary } from './api.js'
import type { Translate } from './i18n.js'
import { Lightbox } from './lightbox.js'
import { ALL_PROJECTS, FAVORITES, projectLabel } from './projects.js'
import { Menu, Modal, useMenu } from './widgets.js'

const PAGE = 120

export function GalleryView(props: {
  t: Translate
  settings: SettingsView | null
  projects: readonly ProjectSummary[]
  /** Project id, ALL_PROJECTS or FAVORITES. */
  filter: string
  refreshKey: number
  onGalleryChanged: () => void
  onError: (message: string) => void
  toast: (message: string) => void
  /** Send an image to the paint tab as a reference / its prompt to the composer. */
  onUseAsReference: (item: GalleryItem) => void
  onReusePrompt: (item: GalleryItem) => void
  sideTop: JSX.Element
}) {
  const { t, filter } = props
  const [query, setQuery] = useState('')
  const [providerId, setProviderId] = useState('')
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [items, setItems] = useState<GalleryItem[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [moveAnchor, openMove, closeMove] = useMenu()

  const load = useCallback(async () => {
    try {
      const page = await api.gallery.list({
        ...(filter === ALL_PROJECTS || filter === FAVORITES ? {} : { projectId: filter }),
        ...(filter === FAVORITES ? { favorite: true } : {}),
        ...(providerId.length > 0 ? { providerId } : {}),
        ...(query.trim().length > 0 ? { query: query.trim() } : {}),
        order,
        limit,
      })
      setItems(page.items)
      setTotal(page.total)
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error))
    }
  }, [filter, providerId, query, order, limit, props.onError])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, query.length > 0 ? 200 : 0)
    return () => clearTimeout(timer)
  }, [load, props.refreshKey, query.length])
  useEffect(() => {
    setSelected(new Set())
    setLimit(PAGE)
  }, [filter])

  const toggle = (id: string): void => setSelected(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const after = (): void => {
    props.onGalleryChanged()
    void load()
  }
  const ids = [...selected]
  const projectName = (id: string): string => {
    const project = props.projects.find(entry => entry.id === id)
    return project === undefined ? id : projectLabel(project, t)
  }
  const importFiles = async (files: File[]): Promise<void> => {
    try {
      const attachments = await uploadFiles(files.filter(file => file.type.startsWith('image/')))
      const target = filter === ALL_PROJECTS || filter === FAVORITES ? DEFAULT_PROJECT_ID : filter
      await api.gallery.importAttachments(attachments, target)
      after()
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error))
    }
  }
  const providerOptions = props.settings?.providers ?? []

  return <>
    <aside className="dig-side">{props.sideTop}</aside>
    <section className="dig-gallery">
      <div className="dig-toolbar">
        <div className="dig-search">
          <Search size={14} />
          <input className="dig-input" placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <select className="dig-select" value={providerId} onChange={event => setProviderId(event.target.value)} aria-label={t('provider')}>
          <option value="">{t('allProviders')}</option>
          {providerOptions.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          <option value="import">{t('importImages')}</option>
        </select>
        <select className="dig-select" style={{ minWidth: 120 }} value={order} onChange={event => setOrder(event.target.value as 'asc' | 'desc')} aria-label="order">
          <option value="desc">{t('newest')}</option>
          <option value="asc">{t('oldest')}</option>
        </select>
        <span className="dig-spacer" />
        {selecting
          ? <>
            <span className="dig-hint">{t('selected', { n: selected.size })}</span>
            <button type="button" className="dig-btn dig-btn-sm" onClick={() => setSelected(new Set(items.map(item => item.id)))}>{t('selectAll')}</button>
            <button type="button" className="dig-btn dig-btn-sm" disabled={selected.size === 0} onClick={() => { void api.gallery.update(ids, { favorite: true }).then(after) }}><Star size={13} />{t('favorite')}</button>
            <button type="button" className="dig-btn dig-btn-sm" disabled={selected.size === 0} onClick={openMove}><FolderInput size={13} />{t('moveTo')}</button>
            <button type="button" className="dig-btn dig-btn-sm" disabled={selected.size === 0} onClick={() => {
              for (const item of items.filter(entry => selected.has(entry.id))) void downloadImage(item.attachment, `copylee-image-${item.id.slice(0, 8)}`)
            }}><Download size={13} />{t('download')}</button>
            <button type="button" className="dig-btn dig-btn-sm dig-btn-danger" disabled={selected.size === 0} onClick={() => setConfirmDelete(ids)}><Trash2 size={13} />{t('delete')}</button>
            <button type="button" className="dig-icon-btn" aria-label={t('clearSelection')} onClick={() => { setSelecting(false); setSelected(new Set()) }}><X size={15} /></button>
          </>
          : <>
            <label className="dig-btn dig-btn-sm" style={{ cursor: 'pointer' }}>
              <ImagePlus size={13} />{t('importImages')}
              <input type="file" accept="image/*" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void importFiles([...(event.target.files ?? [])])
                event.target.value = ''
              }} />
            </label>
            <button type="button" className="dig-btn dig-btn-sm" onClick={() => setSelecting(true)}><CheckSquare size={13} />{t('batchSelect')}</button>
          </>}
      </div>
      <div className="dig-grid dig-scroll">
        {items.length === 0 && <div className="dig-empty"><Images size={36} strokeWidth={1.4} />{t('emptyGallery')}</div>}
        {items.map((item, index) => <div
          key={item.id}
          className="dig-card"
          role="button"
          tabIndex={0}
          aria-selected={selecting ? selected.has(item.id) : undefined}
          title={item.prompt}
          onClick={() => selecting ? toggle(item.id) : setLightbox(index)}
          onKeyDown={event => { if (event.key === 'Enter') { if (selecting) toggle(item.id); else setLightbox(index) } }}
        >
          <img src={imageUrl(item.attachment)} alt={item.prompt} loading="lazy" />
          {selecting && <span className="dig-card-check">{selected.has(item.id) && <Check size={14} />}</span>}
          {!selecting && item.favorite && <Star size={16} className="dig-card-star" fill="#f5a623" />}
          <div className="dig-card-overlay">{item.prompt || item.providerName}</div>
        </div>)}
        {items.length < total && <div className="dig-empty" style={{ padding: 16 }}>
          <button type="button" className="dig-btn dig-btn-sm" onClick={() => setLimit(current => current + PAGE)}>{t('loadMore')} ({items.length}/{total})</button>
        </div>}
      </div>
    </section>
    {moveAnchor !== null && <Menu
      anchor={moveAnchor}
      onClose={closeMove}
      items={props.projects.map(project => ({
        label: projectLabel(project, t),
        onSelect: () => { void api.gallery.update(ids, { projectId: project.id }).then(() => { setSelected(new Set()); after() }) },
      }))}
    />}
    {confirmDelete !== null && <Modal
      title={t('delete')}
      onClose={() => setConfirmDelete(null)}
      actions={<>
        <button type="button" className="dig-btn" onClick={() => setConfirmDelete(null)}>{t('cancel')}</button>
        <button type="button" className="dig-btn dig-btn-primary" style={{ background: 'var(--dig-danger)', borderColor: 'var(--dig-danger)' }} onClick={() => {
          const target = confirmDelete
          setConfirmDelete(null)
          void api.gallery.remove(target).then(() => {
            setSelected(new Set())
            setLightbox(null)
            after()
          })
        }}>{t('delete')}</button>
      </>}
    ><p style={{ margin: 0 }}>{t('deleteConfirm', { n: confirmDelete.length })}</p></Modal>}
    {lightbox !== null && <Lightbox
      items={items}
      index={lightbox}
      onIndex={setLightbox}
      onClose={() => setLightbox(null)}
      t={t}
      projectName={projectName}
      actions={{
        onDownload: item => { void downloadImage(item.attachment, `copylee-image-${item.id.slice(0, 8)}`) },
        onCopy: item => { void copyImage(item.attachment).then(() => props.toast(t('copied')), (error: unknown) => props.onError(error instanceof Error ? error.message : String(error))) },
        onFavorite: item => { void api.gallery.update([item.id], { favorite: !item.favorite }).then(after) },
        onDelete: item => setConfirmDelete([item.id]),
        onUseAsReference: item => { setLightbox(null); props.onUseAsReference(item) },
        onReusePrompt: item => { setLightbox(null); props.onReusePrompt(item) },
      }}
    />}
  </>
}
