/**
 * @copylee/dsh-image-gen browser bundle.
 *
 * - Left sidebar entry “绘画” (`sidebar.panellist`) opening a global page in
 *   the `main` seat — the same mechanism DSH's own 自动化任务 uses, so the
 *   gallery lives outside any project/session.
 * - Settings page under 设置 > 插件 (`settings.plugins.tab`, plus the older
 *   `settings.plugin.item` seat for hosts that still have it).
 * - Result cards for the Agent image tools (`tool.call.toolview`).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Palette } from 'lucide-react'
import { PLUGIN_SLUG } from '../shared.js'
import { ImageToolCard } from './image-card.js'
import { langOf, translator, useT, type LocaleService } from './i18n.js'
import { PaintingsPage } from './paintings-page.js'
import { SettingsPanel } from './settings-view.js'
import { installAccent } from './accent.js'
import { STYLE } from './style.js'

export { PaintingsPage } from './paintings-page.js'
export { SettingsPanel } from './settings-view.js'

/** Panel id shared by the sidebar entry and its `main` page. */
export const PANEL_ID = 'copylee-image-gen.paintings'

export const inject = ['slots', 'locale']

type Register = (options: object, component: unknown) => () => void
type InjectSeat = (key: string, factory: () => () => void) => void

function PaintingsIcon({ size }: { size?: number }) {
  return <Palette size={size ?? 16} strokeWidth={1.6} />
}

function SettingsCard(props: { locale?: LocaleService | undefined }) {
  const t = useT(props.locale)
  return <div style={{ height: '100%', minHeight: 560 }}><SettingsPanel t={t} /></div>
}

export function apply(ctx: Context): void {
  const locale = ctx.get('locale') as LocaleService | undefined
  const label = (): string => translator(langOf(locale))('panel')

  ctx.effect(() => installAccent(), `${PLUGIN_SLUG}: accent colour`)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = PLUGIN_SLUG
    style.textContent = STYLE
    document.head.appendChild(style)
    return () => style.remove()
  }, `${PLUGIN_SLUG}: styles`)

  const slots = (ctx as unknown as { slots: { register: Register; inject: InjectSeat } }).slots
  const register: Register = slots.register.bind(slots)
  const seat: InjectSeat = slots.inject.bind(slots)

  // 1. Left sidebar entry + its global page.
  seat('main', () => register({
    name: 'main',
    key: PANEL_ID,
    inject: () => ({ locale }),
  }, PaintingsPage))
  seat('sidebar.panellist', () => register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    label,
  }, PaintingsIcon))

  // 2. Settings page (current seat + legacy seat).
  seat('settings.plugins.tab', () => register({
    name: 'settings.plugins.tab',
    id: PLUGIN_SLUG,
    order: 30,
    label: () => (langOf(locale) === 'zh' ? '图像生成' : 'Image generation'),
    inject: () => ({ locale }),
  }, SettingsCard))
  seat('settings.plugin.item', () => register({
    name: 'settings.plugin.item',
    key: PLUGIN_SLUG,
    inject: () => ({ locale }),
  }, SettingsCard))

  // 3. Conversation cards for the Agent tools.
  for (const tool of ['paint_image', 'paint_images', 'edit_painting']) {
    seat('tool.call.toolview', () => register({
      name: 'tool.call.toolview',
      key: tool,
      inject: () => ({ locale }),
    }, ImageToolCard))
  }
}
