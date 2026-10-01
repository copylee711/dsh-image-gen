/** Full-screen viewer with metadata and actions for one gallery image. */
import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Copy, Download, FolderOpen, ImagePlus, RotateCcw, Star, Trash2, X } from 'lucide-react'
import type { GalleryItem } from '../gallery-types.js'
import { imageUrl } from './api.js'
import type { Translate } from './i18n.js'
import { Portal } from './widgets.js'

export interface LightboxActions {
  onFavorite?: (item: GalleryItem) => void
  onDelete?: (item: GalleryItem) => void
  onDownload: (item: GalleryItem) => void
  onCopy: (item: GalleryItem) => void
  onUseAsReference?: (item: GalleryItem) => void
  onReusePrompt?: (item: GalleryItem) => void
  /** Show the image's file in the OS file manager. */
  onReveal?: (item: GalleryItem) => void
}

export function Lightbox({ items, index, onIndex, onClose, t, actions, projectName }: {
  items: readonly GalleryItem[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  t: Translate
  actions: LightboxActions
  projectName?: (id: string) => string
}) {
  const item = items[index]
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      else if (event.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndex])
  if (item === undefined) return null
  const date = new Date(item.createdAt).toLocaleString()
  return <Portal>
    <div className="dig-overlay" role="dialog" aria-modal="true">
      <div className="dig-lightbox">
        <div className="dig-lightbox-stage" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
          <button type="button" className="dig-icon-btn dig-lightbox-close" aria-label="close" onClick={onClose}><X size={18} /></button>
          {index > 0 && <button type="button" className="dig-nav" style={{ left: 16 }} aria-label="previous" onClick={() => onIndex(index - 1)}><ChevronLeft size={22} /></button>}
          <img src={imageUrl(item.attachment)} alt={item.prompt} />
          {index < items.length - 1 && <button type="button" className="dig-nav" style={{ right: 16 }} aria-label="next" onClick={() => onIndex(index + 1)}><ChevronRight size={22} /></button>}
        </div>
        <aside className="dig-lightbox-info">
          <h3>Prompt</h3>
          <div className="dig-lightbox-prompt">{item.prompt || '—'}</div>
          {item.negativePrompt !== undefined && item.negativePrompt.length > 0 && <>
            <h3>{t('negativePrompt')}</h3>
            <div className="dig-lightbox-prompt">{item.negativePrompt}</div>
          </>}
          <dl className="dig-kv">
            <dt>{t('provider')}</dt><dd>{item.providerName ?? item.providerId}</dd>
            {item.model.length > 0 && <><dt>{t('model')}</dt><dd>{item.model}</dd></>}
            <dt>{t('resolution')}</dt><dd>{`${String(item.attachment.width)} × ${String(item.attachment.height)}`}{item.output ? ` · ${item.output}` : ''}</dd>
            {projectName !== undefined && <><dt>{t('projects')}</dt><dd>{projectName(item.projectId)}</dd></>}
            <dt>{t('createdAt')}</dt><dd>{date}</dd>
            {item.sessionId !== undefined && <><dt>{t('source')}</dt><dd>{t('fromConversation')}</dd></>}
            {item.filePath !== undefined && <><dt>{t('file')}</dt><dd>{item.filePath}</dd></>}
            {item.savedTo !== undefined && <><dt>{t('workspaceCopy')}</dt><dd>{item.savedTo}</dd></>}
          </dl>
          <div className="dig-lightbox-actions">
            <button type="button" className="dig-btn dig-btn-sm" onClick={() => actions.onDownload(item)}><Download size={14} />{t('download')}</button>
            <button type="button" className="dig-btn dig-btn-sm" onClick={() => actions.onCopy(item)}><Copy size={14} />{t('copy')}</button>
            {actions.onFavorite !== undefined && <button type="button" className="dig-btn dig-btn-sm" onClick={() => actions.onFavorite?.(item)}>
              <Star size={14} fill={item.favorite ? '#f5a623' : 'none'} color={item.favorite ? '#f5a623' : 'currentColor'} />{item.favorite ? t('unfavorite') : t('favorite')}
            </button>}
            {actions.onUseAsReference !== undefined && <button type="button" className="dig-btn dig-btn-sm" onClick={() => actions.onUseAsReference?.(item)}><ImagePlus size={14} />{t('useAsReference')}</button>}
            {actions.onReveal !== undefined && <button type="button" className="dig-btn dig-btn-sm" onClick={() => actions.onReveal?.(item)}><FolderOpen size={14} />{t('revealInFolder')}</button>}
            {actions.onReusePrompt !== undefined && item.prompt.length > 0 && <button type="button" className="dig-btn dig-btn-sm" onClick={() => actions.onReusePrompt?.(item)}><RotateCcw size={14} />{t('reusePrompt')}</button>}
            {actions.onDelete !== undefined && <button type="button" className="dig-btn dig-btn-sm dig-btn-danger" onClick={() => actions.onDelete?.(item)}><Trash2 size={14} />{t('delete')}</button>}
          </div>
        </aside>
      </div>
    </div>
  </Portal>
}
