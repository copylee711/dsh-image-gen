/** Gallery project list (own grouping, independent of DSH workspaces). */
import { useState } from 'react'
import { Folder, FolderOpen, Images, MessageSquare, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { CONVERSATION_PROJECT_ID } from '../gallery-types.js'
import { api, type ProjectSummary } from './api.js'
import type { Translate } from './i18n.js'
import { Menu, Modal, useMenu } from './widgets.js'

/** Pseudo-project ids used by the gallery tab's filter rows. */
export const ALL_PROJECTS = '__all__'
export const FAVORITES = '__favorites__'

export function ProjectList({ projects, current, onSelect, onChanged, t, showAll, onError }: {
  projects: readonly ProjectSummary[]
  current: string
  onSelect: (id: string) => void
  onChanged: () => void
  t: Translate
  /** Gallery tab: prepend “全部” and “收藏” rows. */
  showAll?: { total: number; favorites: number }
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)
  const [deleteItems, setDeleteItems] = useState(false)
  const [menuAnchor, openMenu, closeMenu] = useMenu()
  const [menuFor, setMenuFor] = useState<ProjectSummary | null>(null)

  const commitRename = async (id: string): Promise<void> => {
    const name = draft.trim()
    setEditing(null)
    if (name.length === 0) return
    try {
      await api.gallery.renameProject(id, name)
      onChanged()
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }
  const commitCreate = async (): Promise<void> => {
    const name = draft.trim()
    setCreating(false)
    if (name.length === 0) return
    try {
      const { project } = await api.gallery.createProject(name)
      onChanged()
      onSelect(project.id)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  const row = (id: string, label: string, icon: JSX.Element, count: number) => <div
    key={id}
    className="dig-proj"
    role="button"
    tabIndex={0}
    aria-current={current === id}
    onClick={() => onSelect(id)}
    onKeyDown={event => { if (event.key === 'Enter') onSelect(id) }}
  >
    {icon}
    <span className="dig-proj-name">{label}</span>
    <span className="dig-proj-count">{count}</span>
    <span style={{ width: 22, flex: 'none' }} />
  </div>

  return <div className="dig-side-section">
    <div className="dig-section-title">
      <span>{t('projects')}</span>
      <button type="button" className="dig-icon-btn" title={t('newProject')} aria-label={t('newProject')} onClick={() => { setDraft(''); setCreating(true) }}><Plus size={15} /></button>
    </div>
    <div className="dig-proj-list dig-scroll">
      {showAll !== undefined && row(ALL_PROJECTS, t('allProjects'), <Images size={15} />, showAll.total)}
      {showAll !== undefined && row(FAVORITES, t('favorites'), <Star size={15} />, showAll.favorites)}
      {projects.map(project => {
        const active = current === project.id
        const icon = project.id === CONVERSATION_PROJECT_ID ? <MessageSquare size={15} /> : active ? <FolderOpen size={15} /> : <Folder size={15} />
        if (editing === project.id) {
          return <div key={project.id} className="dig-proj" aria-current={active}>
            {icon}
            <input
              className="dig-proj-input"
              autoFocus
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={() => { void commitRename(project.id) }}
              onKeyDown={event => {
                if (event.key === 'Enter') void commitRename(project.id)
                if (event.key === 'Escape') setEditing(null)
              }}
            />
          </div>
        }
        return <div
          key={project.id}
          className="dig-proj"
          role="button"
          tabIndex={0}
          aria-current={active}
          onClick={() => onSelect(project.id)}
          onDoubleClick={() => { if (project.builtin !== true) { setDraft(project.name); setEditing(project.id) } }}
          onKeyDown={event => { if (event.key === 'Enter') onSelect(project.id) }}
        >
          {icon}
          <span className="dig-proj-name" title={project.name}>{projectLabel(project, t)}</span>
          <span className="dig-proj-count">{project.count}</span>
          <button
            type="button"
            className="dig-icon-btn"
            style={{ width: 22, height: 22 }}
            aria-label="more"
            aria-expanded={menuFor?.id === project.id && menuAnchor !== null}
            onClick={event => { setMenuFor(project); openMenu(event) }}
          ><MoreHorizontal size={14} /></button>
        </div>
      })}
      {creating && <div className="dig-proj">
        <Folder size={15} />
        <input
          className="dig-proj-input"
          autoFocus
          placeholder={t('projectName')}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => { void commitCreate() }}
          onKeyDown={event => {
            if (event.key === 'Enter') void commitCreate()
            if (event.key === 'Escape') setCreating(false)
          }}
        />
      </div>}
    </div>
    {menuAnchor !== null && menuFor !== null && <Menu
      anchor={menuAnchor}
      onClose={closeMenu}
      items={[
        { label: t('rename'), icon: <Pencil size={14} />, onSelect: () => { setDraft(menuFor.name); setEditing(menuFor.id) } },
        ...(menuFor.builtin === true ? [] : [{ label: t('deleteProject'), icon: <Trash2 size={14} />, danger: true, onSelect: () => { setDeleteItems(false); setDeleting(menuFor) } }]),
      ]}
    />}
    {deleting !== null && <Modal
      title={t('deleteProject')}
      onClose={() => setDeleting(null)}
      actions={<>
        <button type="button" className="dig-btn" onClick={() => setDeleting(null)}>{t('cancel')}</button>
        <button type="button" className="dig-btn dig-btn-primary" style={{ background: 'var(--dig-danger)', borderColor: 'var(--dig-danger)' }} onClick={() => {
          const target = deleting
          setDeleting(null)
          void api.gallery.deleteProject(target.id, deleteItems).then(() => {
            if (current === target.id) onSelect(showAll === undefined ? 'default' : ALL_PROJECTS)
            onChanged()
          }, (error: unknown) => onError(error instanceof Error ? error.message : String(error)))
        }}>{t('delete')}</button>
      </>}
    >
      <p style={{ margin: 0 }}>{t('deleteProjectConfirm', { name: deleting.name })}</p>
      <label className="dig-row" style={{ fontSize: 13 }}>
        <input type="checkbox" checked={deleteItems} onChange={event => setDeleteItems(event.target.checked)} />
        {t('deleteProjectAndImages')}
      </label>
    </Modal>}
  </div>
}

/** Built-in project names follow the UI language. */
export function projectLabel(project: { id: string; name: string; builtin?: boolean }, t: Translate): string {
  if (project.builtin !== true) return project.name
  if (project.id === CONVERSATION_PROJECT_ID && project.name === '对话') return t('fromConversation') === '来自对话' ? '对话' : 'Conversations'
  if (project.id === 'default' && project.name === '默认画板') return t('panel') === '绘画' ? '默认画板' : 'Default board'
  return project.name
}
