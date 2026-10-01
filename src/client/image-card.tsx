/** Conversation card for paint_image / paint_images / edit_painting results. */
import { useState } from 'react'
import { Copy, Download } from 'lucide-react'
import type { AttachmentJson, GalleryItem } from '../gallery-types.js'
import { copyImage, downloadImage, imageUrl } from './api.js'
import { useT, type LocaleService } from './i18n.js'
import { Lightbox } from './lightbox.js'

interface ImageResult {
  attachment: AttachmentJson
  prompt: string
  provider: string
  model: string
  output: string
}

type Block = {
  kind?: string
  meta?: unknown
  content?: Array<{ type: string; text?: string; attachment?: AttachmentJson }>
  resultView?: { card?: string; meta?: unknown; content?: Array<{ type: string; text?: string; attachment?: AttachmentJson }> } | null
}

function isAttachment(value: unknown): value is AttachmentJson {
  return typeof value === 'object' && value !== null && typeof (value as { attachmentId?: unknown }).attachmentId === 'string'
    && typeof (value as { mediaType?: unknown }).mediaType === 'string'
}

function resultFromMeta(meta: unknown): ImageResult | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const value = meta as Record<string, unknown>
  if (value.kind !== 'copylee-image-gen' || !isAttachment(value.attachment)) return undefined
  return {
    attachment: value.attachment,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    provider: typeof value.provider === 'string' ? value.provider : '',
    model: typeof value.model === 'string' ? value.model : '',
    output: typeof value.output === 'string' ? value.output : '',
  }
}

/** Every image a tool-call block carries, from meta first, then content. */
export function imageResults(block: Block | undefined): ImageResult[] {
  if (block === undefined) return []
  const meta = block.meta ?? block.resultView?.meta
  if (typeof meta === 'object' && meta !== null && (meta as { kind?: unknown }).kind === 'copylee-image-gen-batch') {
    const images = (meta as { images?: unknown }).images
    if (Array.isArray(images)) return images.map(resultFromMeta).filter((entry): entry is ImageResult => entry !== undefined)
  }
  const single = resultFromMeta(meta)
  if (single !== undefined) return [single]
  const content = block.resultView?.card === 'generic' ? block.resultView.content : block.content
  return (content ?? []).flatMap(item => item.type === 'image' && isAttachment(item.attachment)
    ? [{ attachment: item.attachment, prompt: '', provider: '', model: '', output: '' }]
    : [])
}

export function ImageToolCard(props: { block?: Block; locale?: LocaleService | undefined }) {
  const t = useT(props.locale)
  const results = imageResults(props.block)
  const [open, setOpen] = useState<number | null>(null)
  if (results.length === 0) {
    const running = props.block === undefined || !('kind' in props.block)
    if (running) return <div className="dig-root" style={{ background: 'transparent' }}><div className="dig-skeleton" style={{ width: 240, height: 180 }} /></div>
    const text = (props.block?.content ?? props.block?.resultView?.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
    return <div className="dig-root" style={{ background: 'transparent' }}>{text.length > 0 ? <div className="dig-error" style={{ margin: 0 }}>{text}</div> : null}</div>
  }
  const items: GalleryItem[] = results.map((result, index) => ({
    id: `${result.attachment.attachmentId}:${String(index)}`,
    attachment: result.attachment,
    prompt: result.prompt,
    providerId: result.provider,
    model: result.model,
    output: result.output,
    createdAt: Date.now(),
    projectId: 'conversation',
    favorite: false,
  }))
  return <div className="dig-root" style={{ background: 'transparent' }}>
    <div className="dig-card-chat">
      {items.map((item, index) => <div key={item.id}>
        <div className="dig-chat-img" role="button" tabIndex={0} onClick={() => setOpen(index)} onKeyDown={event => { if (event.key === 'Enter') setOpen(index) }}>
          <img src={imageUrl(item.attachment)} alt={item.prompt} loading="lazy" />
        </div>
        <div className="dig-chat-meta">
          <span>{[item.providerId, item.model].filter(Boolean).join(' · ')}</span>
          <button type="button" className="dig-icon-btn" title={t('download')} onClick={() => { void downloadImage(item.attachment, 'copylee-image') }}><Download size={14} /></button>
          <button type="button" className="dig-icon-btn" title={t('copy')} onClick={() => { void copyImage(item.attachment) }}><Copy size={14} /></button>
        </div>
      </div>)}
    </div>
    {open !== null && <Lightbox
      items={items}
      index={open}
      onIndex={setOpen}
      onClose={() => setOpen(null)}
      t={t}
      actions={{
        onDownload: item => { void downloadImage(item.attachment, 'copylee-image') },
        onCopy: item => { void copyImage(item.attachment) },
      }}
    />}
  </div>
}
