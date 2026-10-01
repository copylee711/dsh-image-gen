/**
 * Settings: Cherry-Studio-style provider list + detail, global proxy and
 * storage. Used both as the DSH settings page and inside the paintings page.
 */
import { useEffect, useMemo, useState } from 'react'
import { Globe, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  PROTOCOL_LABELS,
  PROVIDER_PROTOCOLS,
  type PluginSettings,
  type ProviderEntry,
  type ProviderProtocol,
  type SettingsView,
} from '../shared.js'
import { api } from './api.js'
import type { Translate } from './i18n.js'
import { Modal, Switch } from './widgets.js'

const GENERAL = '__general__'

function stripView(view: SettingsView): PluginSettings {
  return {
    ...view,
    providers: view.providers.map(({ keyConfigured: _ignored, ...entry }) => entry),
  }
}

function newProviderId(existing: readonly ProviderEntry[]): string {
  for (let index = 1; ; index++) {
    const id = `custom-${String(index)}`
    if (!existing.some(entry => entry.id === id)) return id
  }
}

type TestState = { running: boolean; ok?: boolean; message?: string }

export function SettingsPanel({ t, onSaved }: { t: Translate; onSaved?: (view: SettingsView) => void }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<PluginSettings | null>(null)
  const [selected, setSelected] = useState<string>(GENERAL)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [test, setTest] = useState<TestState>({ running: false })
  const [proxyTest, setProxyTest] = useState<TestState>({ running: false })
  const [fetchingModels, setFetchingModels] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ProviderEntry | null>(null)
  const [sizesText, setSizesText] = useState('')
  const [sizesError, setSizesError] = useState<string | null>(null)

  useEffect(() => {
    api.settings().then(next => {
      setView(next)
      setDraft(stripView(next))
      setSelected(current => current === GENERAL ? next.providers[0]?.id ?? GENERAL : current)
    }, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
  }, [])

  const entry = draft?.providers.find(candidate => candidate.id === selected)
  const keyConfigured = view?.providers.find(candidate => candidate.id === selected)?.keyConfigured === true
  const dirty = useMemo(() => view !== null && draft !== null && JSON.stringify(stripView(view)) !== JSON.stringify(draft), [view, draft])

  useEffect(() => {
    setKeyInput('')
    setTest({ running: false })
    setSizesText(entry?.compat?.sizes === undefined || Object.keys(entry.compat.sizes).length === 0 ? '' : JSON.stringify(entry.compat.sizes, null, 2))
    setSizesError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  if (draft === null || view === null) {
    return <div className="dig-root" style={{ padding: 24 }}>{error ?? <LoaderCircle size={18} className="dig-spin" />}</div>
  }

  const patchEntry = (patch: Partial<ProviderEntry>): void => {
    setDraft(current => current === null ? current : {
      ...current,
      providers: current.providers.map(candidate => candidate.id === selected ? { ...candidate, ...patch } : candidate),
    })
  }
  const save = async (next: PluginSettings = draft): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveSettings(next)
      setView(saved)
      setDraft(stripView(saved))
      onSaved?.(saved)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1600)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  const refreshView = async (): Promise<void> => {
    const next = await api.settings()
    setView(current => current === null ? next : { ...current, providers: current.providers.map(candidate => ({ ...candidate, keyConfigured: next.providers.find(other => other.id === candidate.id)?.keyConfigured ?? false })) })
    onSaved?.(next)
  }
  const saveKey = async (value: string): Promise<void> => {
    if (entry === undefined) return
    setError(null)
    try {
      // A provider added in this draft must exist on the Host before its key.
      if (!view.providers.some(candidate => candidate.id === entry.id)) await save()
      await api.setKey(entry.id, value)
      setKeyInput('')
      await refreshView()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const runTest = async (): Promise<void> => {
    if (entry === undefined) return
    setTest({ running: true })
    try {
      const result = await api.test({ providerId: entry.id, entry, ...(keyInput.trim().length > 0 ? { key: keyInput.trim() } : {}), proxy: draft.proxy })
      setTest({ running: false, ok: result.ok, message: result.latencyMs === undefined ? result.message : `${result.message} · ${String(result.latencyMs)}ms` })
    } catch (failure) {
      setTest({ running: false, ok: false, message: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  const fetchModels = async (): Promise<void> => {
    if (entry === undefined) return
    setFetchingModels(true)
    setError(null)
    try {
      const result = await api.models({ providerId: entry.id, entry, ...(keyInput.trim().length > 0 ? { key: keyInput.trim() } : {}) })
      const merged = [...new Set([...entry.models, ...result.models])]
      patchEntry({ models: merged, ...(entry.defaultModel.length === 0 && merged[0] !== undefined ? { defaultModel: merged[0] } : {}) })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setFetchingModels(false)
    }
  }
  const addProvider = (): void => {
    const id = newProviderId(draft.providers)
    const created: ProviderEntry = {
      id, name: t('addProvider') === '添加服务商' ? `自定义服务商 ${id.slice(7)}` : `Custom ${id.slice(7)}`,
      protocol: 'openai-compat', baseURL: '', models: [], defaultModel: '', enabled: true, proxy: { mode: 'inherit' },
    }
    setDraft({ ...draft, providers: [...draft.providers, created] })
    setSelected(id)
  }

  return <div className="dig-root dig-settings">
    <nav className="dig-settings-list" aria-label={t('providers')}>
      <div className="dig-side-section" style={{ paddingBottom: 0 }}>
        <div className="dig-proj" role="button" tabIndex={0} aria-current={selected === GENERAL} onClick={() => setSelected(GENERAL)} onKeyDown={event => { if (event.key === 'Enter') setSelected(GENERAL) }}>
          <Globe size={15} /><span className="dig-proj-name">{t('globalProxy')} / {t('storage')}</span>
        </div>
      </div>
      <div className="dig-section-title" style={{ padding: '10px 18px 4px' }}>
        <span>{t('providers')}</span>
        <button type="button" className="dig-icon-btn" title={t('addProvider')} aria-label={t('addProvider')} onClick={addProvider}><Plus size={15} /></button>
      </div>
      <div className="dig-scroll" style={{ flex: 1, minHeight: 0, padding: '0 12px 12px' }}>
        {draft.providers.map(candidate => {
          const ready = view.providers.find(other => other.id === candidate.id)?.keyConfigured === true
          return <div key={candidate.id} className="dig-proj" role="button" tabIndex={0} aria-current={selected === candidate.id} onClick={() => setSelected(candidate.id)} onKeyDown={event => { if (event.key === 'Enter') setSelected(candidate.id) }}>
            <span className={ready && candidate.enabled ? 'dig-dot dig-dot-ok' : 'dig-dot'} />
            <span className="dig-proj-name" style={{ opacity: candidate.enabled ? 1 : 0.5 }}>{candidate.name}</span>
            {candidate.id === draft.activeProvider && <span className="dig-badge">{t('defaultLabel')}</span>}
          </div>
        })}
      </div>
    </nav>

    <div className="dig-settings-detail dig-scroll">
      {selected === GENERAL || entry === undefined
        ? <>
          <h2>{t('globalProxy')}</h2>
          <p className="dig-hint" style={{ margin: 0 }}>{t('globalProxyHint')}</p>
          <div className="dig-row">
            <Switch checked={draft.proxy.enabled} label={t('globalProxy')} onChange={enabled => setDraft({ ...draft, proxy: { ...draft.proxy, enabled } })} />
            <span>{t('enabled')}</span>
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-proxy-url">{t('proxyUrl')}</label>
            <div className="dig-row">
              <input id="dig-proxy-url" className="dig-input" placeholder="http://127.0.0.1:7890" value={draft.proxy.url} onChange={event => setDraft({ ...draft, proxy: { ...draft.proxy, url: event.target.value } })} />
              <button type="button" className="dig-btn dig-btn-sm" disabled={draft.proxy.url.trim().length === 0 || proxyTest.running} onClick={() => {
                setProxyTest({ running: true })
                api.testProxy(draft.proxy.url.trim()).then(
                  result => setProxyTest({ running: false, ok: result.ok, message: result.latencyMs === undefined ? result.message : `${result.message} · ${String(result.latencyMs)}ms` }),
                  (failure: unknown) => setProxyTest({ running: false, ok: false, message: String(failure) }),
                )
              }}>{proxyTest.running ? t('testing') : t('testProxy')}</button>
            </div>
            <span className="dig-hint">{t('proxyUrlHint')}</span>
            {proxyTest.message !== undefined && <span className={`dig-test-result ${proxyTest.ok === true ? 'dig-test-ok' : 'dig-test-fail'}`}>{proxyTest.message}</span>}
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-no-proxy">{t('noProxy')}</label>
            <input id="dig-no-proxy" className="dig-input" value={draft.proxy.noProxy.join(', ')} onChange={event => setDraft({ ...draft, proxy: { ...draft.proxy, noProxy: event.target.value.split(/[,\s]+/).filter(item => item.length > 0) } })} />
            <span className="dig-hint">{t('noProxyHint')}</span>
          </div>
          <div className="dig-divider" />
          <h2>{t('storage')}</h2>
          <div className="dig-row">
            <Switch checked={draft.saveToWorkspace} label={t('saveToWorkspace')} onChange={saveToWorkspace => setDraft({ ...draft, saveToWorkspace })} />
            <span style={{ fontSize: 13 }}>{t('saveToWorkspace')}</span>
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-ws-folder">{t('workspaceFolder')}</label>
            <input id="dig-ws-folder" className="dig-input" value={draft.workspaceFolder} disabled={!draft.saveToWorkspace} onChange={event => setDraft({ ...draft, workspaceFolder: event.target.value })} />
          </div>
          <div className="dig-notice">{t('galleryNote')}</div>
        </>
        : <>
          <h2>
            {entry.name}
            {entry.preset === true && <span className="dig-badge">{t('presetTag')}</span>}
            {keyConfigured ? <span className="dig-badge dig-badge-ok">{t('apiKeySet')}</span> : <span className="dig-badge">{t('keyMissing')}</span>}
            <span className="dig-spacer" />
            <Switch checked={entry.enabled} label={t('enabled')} onChange={enabled => patchEntry({ enabled })} />
          </h2>
          <div className="dig-row" style={{ flexWrap: 'wrap' }}>
            {draft.activeProvider === entry.id
              ? <span className="dig-hint">✓ {t('isDefaultProvider')}</span>
              : <button type="button" className="dig-btn dig-btn-sm" onClick={() => setDraft({ ...draft, activeProvider: entry.id })}>{t('setDefaultProvider')}</button>}
            {entry.preset !== true && <button type="button" className="dig-btn dig-btn-sm dig-btn-danger" onClick={() => setConfirmDelete(entry)}><Trash2 size={13} />{t('deleteProvider')}</button>}
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-name">{t('name')}</label>
            <input id="dig-name" className="dig-input" value={entry.name} onChange={event => patchEntry({ name: event.target.value })} />
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-protocol">{t('protocol')}</label>
            <select id="dig-protocol" className="dig-select" value={entry.protocol} disabled={entry.preset === true} onChange={event => patchEntry({ protocol: event.target.value as ProviderProtocol })}>
              {PROVIDER_PROTOCOLS.map(protocol => <option key={protocol} value={protocol}>{PROTOCOL_LABELS[protocol]}</option>)}
            </select>
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-base">{t('baseURL')}</label>
            <input id="dig-base" className="dig-input" placeholder="https://" value={entry.baseURL} onChange={event => patchEntry({ baseURL: event.target.value })} />
            <span className="dig-hint">{entry.protocol === 'gemini' ? t('baseURLHintGemini') : t('baseURLHint')}</span>
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-key">{t('apiKey')}</label>
            <div className="dig-row">
              <input id="dig-key" className="dig-input" type="password" autoComplete="off" placeholder={keyConfigured ? t('apiKeySet') : t('apiKeyPlaceholder')} value={keyInput} onChange={event => setKeyInput(event.target.value)} />
              <button type="button" className="dig-btn dig-btn-sm" disabled={keyInput.trim().length === 0} onClick={() => { void saveKey(keyInput.trim()) }}>{t('saveKey')}</button>
              {keyConfigured && <button type="button" className="dig-btn dig-btn-sm" onClick={() => { void saveKey('') }}>{t('clearKey')}</button>}
            </div>
          </div>
          <div className="dig-field">
            <span className="dig-label">{t('models')}
              <button type="button" className="dig-btn dig-btn-sm" disabled={fetchingModels || entry.baseURL.length === 0} onClick={() => { void fetchModels() }}>
                {fetchingModels ? <LoaderCircle size={13} className="dig-spin" /> : <RefreshCw size={13} />}{t('fetchModels')}
              </button>
            </span>
            <textarea className="dig-textarea" rows={4} value={entry.models.join('\n')} onChange={event => patchEntry({ models: event.target.value.split('\n') })} />
            <span className="dig-hint">{t('modelsHint')}</span>
          </div>
          <div className="dig-field">
            <label className="dig-label" htmlFor="dig-default-model">{t('defaultModel')}</label>
            <input id="dig-default-model" className="dig-input" list="dig-model-options" value={entry.defaultModel} onChange={event => patchEntry({ defaultModel: event.target.value })} />
            <datalist id="dig-model-options">{entry.models.map(model => <option key={model} value={model} />)}</datalist>
          </div>
          <div className="dig-field">
            <span className="dig-label">{t('proxy')}</span>
            <div className="dig-chips" role="radiogroup" aria-label={t('proxy')}>
              {(['inherit', 'direct', 'custom'] as const).map(mode => <button key={mode} type="button" className="dig-chip" role="radio" aria-checked={entry.proxy.mode === mode} aria-pressed={entry.proxy.mode === mode} onClick={() => patchEntry({ proxy: mode === 'custom' ? { mode, url: entry.proxy.url ?? '' } : { mode } })}>
                {mode === 'inherit' ? t('proxyInherit') : mode === 'direct' ? t('proxyDirect') : t('proxyCustom')}
              </button>)}
            </div>
            {entry.proxy.mode === 'custom' && <input className="dig-input" placeholder="socks5://127.0.0.1:1080" value={entry.proxy.url ?? ''} onChange={event => patchEntry({ proxy: { mode: 'custom', url: event.target.value } })} />}
            {entry.proxy.mode === 'inherit' && <span className="dig-hint">{draft.proxy.enabled && draft.proxy.url.length > 0 ? `→ ${draft.proxy.url}` : `→ ${t('proxyDirect')}`}</span>}
          </div>
          {entry.protocol === 'openai-compat' && <details className="dig-field">
            <summary className="dig-label" style={{ cursor: 'pointer', justifyContent: 'flex-start' }}>{t('compatAdvanced')}</summary>
            <div className="dig-field" style={{ marginTop: 8 }}>
              <label className="dig-label" htmlFor="dig-edit-format">{t('editFormat')}</label>
              <select id="dig-edit-format" className="dig-select" value={entry.compat?.editFormat ?? 'multipart'} onChange={event => patchEntry({ compat: { ...entry.compat, editFormat: event.target.value as 'multipart' } })}>
                <option value="multipart">multipart (OpenAI)</option>
                <option value="jsonImageUrlArray">JSON images[].image_url</option>
                <option value="formReferenceImages">form reference_images</option>
              </select>
            </div>
            <div className="dig-field">
              <label className="dig-label" htmlFor="dig-sizes">{t('sizesTable')}</label>
              <textarea id="dig-sizes" className="dig-textarea" rows={4} value={sizesText} placeholder='{"1:1":{"1K":"1024x1024"}}' onChange={event => {
                setSizesText(event.target.value)
                if (event.target.value.trim().length === 0) {
                  setSizesError(null)
                  patchEntry({ compat: { ...entry.compat, sizes: {} } })
                  return
                }
                try {
                  const parsed = JSON.parse(event.target.value) as Record<string, Record<string, string>>
                  setSizesError(null)
                  patchEntry({ compat: { ...entry.compat, sizes: parsed } })
                } catch {
                  setSizesError(t('invalidJson'))
                }
              }} />
              <span className={sizesError === null ? 'dig-hint' : 'dig-test-result dig-test-fail'}>{sizesError ?? t('sizesTableHint')}</span>
            </div>
          </details>}
          {entry.protocol === 'seedream' && <>
            <div className="dig-row">
              <Switch checked={entry.ark?.watermark !== false} label={t('seedreamWatermark')} onChange={watermark => patchEntry({ ark: { ...entry.ark, watermark } })} />
              <span style={{ fontSize: 13 }}>{t('seedreamWatermark')}</span>
            </div>
            <div className="dig-field">
              <label className="dig-label" htmlFor="dig-ark-format">{t('seedreamFormat')}</label>
              <select id="dig-ark-format" className="dig-select" value={entry.ark?.outputFormat ?? 'jpeg'} onChange={event => patchEntry({ ark: { ...entry.ark, outputFormat: event.target.value as 'png' | 'jpeg' } })}>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </div>
          </>}
          <div className="dig-row">
            <button type="button" className="dig-btn" disabled={test.running} onClick={() => { void runTest() }}>{test.running ? <><LoaderCircle size={14} className="dig-spin" />{t('testing')}</> : t('testConnection')}</button>
            {test.message !== undefined && <span className={`dig-test-result ${test.ok === true ? 'dig-test-ok' : 'dig-test-fail'}`}>{test.message}</span>}
          </div>
        </>}
      {error !== null && <div className="dig-error" style={{ margin: 0 }} role="alert">{error}</div>}
      {(dirty || savedFlash) && <div className="dig-savebar">
        <span className="dig-hint" style={{ flex: 1 }}>{dirty ? t('unsaved') : t('saved')}</span>
        {dirty && <button type="button" className="dig-btn dig-btn-sm" onClick={() => setDraft(stripView(view))}>{t('discard')}</button>}
        {dirty && <button type="button" className="dig-btn dig-btn-sm dig-btn-primary" disabled={saving || sizesError !== null} onClick={() => { void save() }}>{saving ? '…' : t('save')}</button>}
      </div>}
    </div>
    {confirmDelete !== null && <Modal
      title={t('deleteProvider')}
      onClose={() => setConfirmDelete(null)}
      actions={<>
        <button type="button" className="dig-btn" onClick={() => setConfirmDelete(null)}>{t('cancel')}</button>
        <button type="button" className="dig-btn dig-btn-primary" style={{ background: 'var(--dig-danger)', borderColor: 'var(--dig-danger)' }} onClick={() => {
          const target = confirmDelete
          setConfirmDelete(null)
          const next = {
            ...draft,
            providers: draft.providers.filter(candidate => candidate.id !== target.id),
            activeProvider: draft.activeProvider === target.id ? draft.providers.find(candidate => candidate.id !== target.id)?.id ?? '' : draft.activeProvider,
          }
          setSelected(GENERAL)
          void (async () => {
            if (view.providers.some(candidate => candidate.id === target.id)) await api.setKey(target.id, '').catch(() => {})
            await save(next)
          })()
        }}>{t('delete')}</button>
      </>}
    ><p style={{ margin: 0 }}>{t('deleteProviderConfirm', { name: confirmDelete.name })}</p></Modal>}
  </div>
}
