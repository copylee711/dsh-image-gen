/**
 * Provider model list: one row per model with a “默认” toggle and a delete
 * button, an add row, and a fetch-and-pick dialog (providers such as
 * SiliconFlow list hundreds of models, so fetched ids are chosen, not merged).
 */
import { useMemo, useState } from 'react'
import { LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'
import type { Translate } from './i18n.js'
import { Modal } from './widgets.js'

export function ModelList({ t, models, defaultModel, onChange, onFetch, fetchDisabled }: {
  t: Translate
  models: readonly string[]
  defaultModel: string
  onChange: (next: { models: string[]; defaultModel: string }) => void
  /** Pull model ids from the provider; rejects with a readable message. */
  onFetch: () => Promise<string[]>
  fetchDisabled?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [picker, setPicker] = useState<string[] | null>(null)
  const effectiveDefault = defaultModel.length > 0 && models.includes(defaultModel) ? defaultModel : models[0] ?? ''

  const add = (ids: readonly string[]): void => {
    const next = [...models]
    for (const raw of ids) {
      const id = raw.trim()
      if (id.length > 0 && !next.includes(id)) next.push(id)
    }
    onChange({ models: next, defaultModel: defaultModel.length > 0 ? defaultModel : next[0] ?? '' })
  }
  const remove = (id: string): void => {
    const next = models.filter(model => model !== id)
    onChange({ models: next, defaultModel: defaultModel === id ? next[0] ?? '' : defaultModel })
  }
  const submitDraft = (): void => {
    if (draft.trim().length === 0) return
    add(draft.split(/[\n,]+/))
    setDraft('')
  }
  const fetchModels = async (): Promise<void> => {
    setFetching(true)
    setFetchError(null)
    try {
      setPicker((await onFetch()).filter(id => !models.includes(id)))
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error))
    } finally {
      setFetching(false)
    }
  }

  return <div className="dig-field">
    <span className="dig-label">
      <span>{t('models')} <span className="dig-hint">({models.length})</span></span>
      <button type="button" className="dig-btn dig-btn-sm" disabled={fetching || fetchDisabled === true} onClick={() => { void fetchModels() }}>
        {fetching ? <LoaderCircle size={13} className="dig-spin" /> : <RefreshCw size={13} />}{t('fetchModels')}
      </button>
    </span>
    <div className="dig-models" role="list">
      {models.length === 0 && <div className="dig-models-empty">{t('noModels')}</div>}
      {models.map(model => <div key={model} className="dig-model-row" role="listitem">
        <span className="dig-model-id" title={model}>{model}</span>
        {model === effectiveDefault
          ? <span className="dig-badge dig-badge-accent">{t('defaultLabel')}</span>
          : <button type="button" className="dig-model-action" onClick={() => onChange({ models: [...models], defaultModel: model })}>{t('setDefault')}</button>}
        <button type="button" className="dig-icon-btn dig-model-remove" aria-label={`${t('delete')} ${model}`} onClick={() => remove(model)}><X size={14} /></button>
      </div>)}
      <div className="dig-model-add">
        <input
          className="dig-input"
          value={draft}
          placeholder={t('addModelPlaceholder')}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submitDraft()
            }
          }}
        />
        <button type="button" className="dig-btn dig-btn-sm" disabled={draft.trim().length === 0} onClick={submitDraft}><Plus size={13} />{t('add')}</button>
      </div>
    </div>
    <span className="dig-hint">{t('modelsHint')}</span>
    {fetchError !== null && <span className="dig-test-result dig-test-fail">{fetchError}</span>}
    {picker !== null && <ModelPicker t={t} ids={picker} onClose={() => setPicker(null)} onConfirm={ids => { add(ids); setPicker(null) }} />}
  </div>
}

function ModelPicker({ t, ids, onClose, onConfirm }: { t: Translate; ids: readonly string[]; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle.length === 0 ? ids : ids.filter(id => id.toLowerCase().includes(needle))
  }, [ids, query])
  const toggle = (id: string): void => setChosen(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return <Modal
    title={t('fetchModels')}
    onClose={onClose}
    wide
    actions={<>
      <span className="dig-hint" style={{ marginRight: 'auto' }}>{t('selectedModels', { n: chosen.size })}</span>
      <button type="button" className="dig-btn" onClick={onClose}>{t('cancel')}</button>
      <button type="button" className="dig-btn dig-btn-primary" disabled={chosen.size === 0} onClick={() => onConfirm(ids.filter(id => chosen.has(id)))}>{t('addSelected')}</button>
    </>}
  >
    {ids.length === 0
      ? <p className="dig-hint" style={{ margin: 0 }}>{t('noNewModels')}</p>
      : <>
        <div className="dig-row">
          <div className="dig-search" style={{ maxWidth: 'none' }}>
            <Search size={14} />
            <input className="dig-input" autoFocus value={query} placeholder={t('searchModels')} onChange={event => setQuery(event.target.value)} />
          </div>
          <button type="button" className="dig-btn dig-btn-sm" onClick={() => setChosen(new Set([...chosen, ...visible]))}>{t('selectAll')}</button>
          <button type="button" className="dig-btn dig-btn-sm" onClick={() => setChosen(new Set())}>{t('clearSelection')}</button>
        </div>
        <div className="dig-pick-list dig-scroll" role="listbox" aria-multiselectable="true">
          {visible.map(id => <label key={id} className="dig-pick-row" role="option" aria-selected={chosen.has(id)}>
            <input type="checkbox" checked={chosen.has(id)} onChange={() => toggle(id)} />
            <span className="dig-model-id" title={id}>{id}</span>
          </label>)}
          {visible.length === 0 && <div className="dig-models-empty">—</div>}
        </div>
      </>}
  </Modal>
}
