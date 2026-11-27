import type { ArtifactEditOp, ArtifactTransition, BridgeFromShell, BridgeLayer } from '@gonggong/protocol'
import { type ReactNode, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  type IconName,
  Input,
  MenuButton,
  type MenuItem,
  PopUpButton,
  Spinner,
  Switch,
} from '../../ui'
import type { CanvasNode } from './geometry'
import { CMD } from './menus'
import './inspector.css'

/** The page's body, as `layers` reports it. */
export type LayersBody = NonNullable<Extract<BridgeFromShell, { type: 'layers' }>['body']>

/**
 * The tabs of the right-hand 属性面板: 墨刀's 画布 (nothing picked) or 外观 / 交互 (an element picked), then our own
 * 图层, 批注 and 规则; 设计系统 opens from the top bar and shows under none.
 */
export type InspectorTab = 'props' | 'interact' | 'layers' | 'annotations' | 'rules' | 'design'

/** The tab a canvas panel shows under. */
export const inspectorTab = (panel: string | null): InspectorTab =>
  panel === 'interact' ||
  panel === 'layers' ||
  panel === 'annotations' ||
  panel === 'rules' ||
  panel === 'design'
    ? panel
    : panel === 'shared'
      ? 'rules'
      : 'props'

/** Docked at the canvas's right edge (墨刀's right panel): what is selected, or the tab's own panel. */
export function Inspector({
  tab,
  element,
  notes,
  onTab,
  children,
}: {
  tab: InspectorTab
  /** An element is picked: 外观 and 交互 instead of 画布. */
  element: boolean
  /** Open annotations, as a count on 批注. */
  notes: number
  onTab: (tab: InspectorTab) => void
  children: ReactNode
}) {
  const tabs: { id: InspectorTab; label: string }[] = [
    ...(element
      ? [
          { id: 'props' as const, label: t('外观') },
          { id: 'interact' as const, label: t('交互') },
        ]
      : [{ id: 'props' as const, label: t('画布') }]),
    { id: 'layers', label: t('图层') },
  ]
  return (
    <aside className="art-inspector" aria-label={t('属性面板')} data-testid="art-inspector">
      <div className="art-inspector__tabs" role="tablist" aria-label={t('属性面板')}>
        {tabs.map((it) => (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={tab === it.id || (it.id === 'props' && tab === 'interact' && !element)}
            className="art-inspector__tab"
            onClick={() => onTab(it.id)}
          >
            {it.label}
            {it.id === 'annotations' && notes ? (
              <span className="art-inspector__badge">{notes > 99 ? '99+' : notes}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="art-inspector__body">{children}</div>
    </aside>
  )
}

/** A titled block of the 画布 tab. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="art-inspector__section">
      <h4 className="art-panel__label">{title}</h4>
      {children}
    </section>
  )
}

/** A colour from the design system's tokens, or any colour (a hex the design lint then warns about). */
function ColorRow({
  label,
  value,
  shown,
  colors,
  disabled,
  onChange,
}: {
  label: string
  value: string
  /** What it is now (computed), for the swatch and the picker. */
  shown: string
  colors: [string, string][]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const token = colors.some(([k]) => value === `var(${k})`)
  return (
    <div className="art-inspector__row">
      <span>{label}</span>
      <div className="art-el__color">
        <PopUpButton
          aria-label={label}
          size="small"
          disabled={disabled}
          value={token ? value : value ? 'custom' : ''}
          onChange={(v) => (v === 'custom' ? undefined : onChange(v))}
          options={[
            {
              value: '',
              label: (
                <span className="art-el__opt">
                  {swatch(shown)}
                  {t('默认')}
                </span>
              ),
            },
            ...(value && !token
              ? [
                  {
                    value: 'custom',
                    label: (
                      <span className="art-el__opt">
                        {swatch(value)}
                        {value}
                      </span>
                    ),
                  },
                ]
              : []),
            ...colors.map(([k, v]) => ({
              value: `var(${k})`,
              label: (
                <span className="art-el__opt">
                  {swatch(v)}
                  {k.slice('--color-'.length)}
                </span>
              ),
            })),
          ]}
        />
        <input
          type="color"
          className="art-el__picker"
          aria-label={t('{name}：任意颜色', { name: label })}
          disabled={disabled}
          value={value.startsWith('#') ? value : hexOf(shown)}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
const swatch = (v: string) => <i className="art-swatch" style={{ background: v }} />
/** `rgb(…)` as the `#rrggbb` a colour input takes; white when transparent, black when it is not a colour. */
export const hexOf = (css: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(css)
  if (!m) return css === 'transparent' ? '#ffffff' : '#000000'
  if (m[4] !== undefined && Number(m[4]) === 0) return '#ffffff'
  return `#${m
    .slice(1, 4)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`
}

/** The selected page in 画布设置 (墨刀's page settings): its name, size, background and 热区. */
export interface PageSettings {
  node: CanvasNode
  /** Its preview size preset ('' when set otherwise), and the presets to pick from. */
  preset: string
  presets: { value: string; label: string }[]
  /** The body's computed background; null until the page has said. */
  background: string | null
  hotspots: BridgeLayer[]
  /** Every page of the artifact, shown on the canvas or not: where a 热区 goes. */
  screens: { id: string; title: string }[]
  onRename: (title: string) => void
  onPreset: (preset: string) => void
  onBackground: ((color: string) => void) | null
  onHotspot: () => void
  onPickHotspot: (ggId: string) => void
  onCode: () => void
}

/**
 * What the selected pages can do (the canvas's old floating toolbar, its duplicates dropped: 编辑 and 设计系统 are
 * in the top bar, 尺寸 and 查看代码 above, 导出 in the tab's bar, 重新加载 is the top bar's 刷新).
 */
export interface SelectionActions {
  count: number
  /** One page with its preview: it opens in a tab, and has details. */
  single: boolean
  /** The pages show their full height. */
  full: boolean
  /** 生成: the platform's and the plugin's AI commands, and the variations. */
  generate: MenuItem[]
  bots: { value: string; label: string }[]
  bot: string
  onPickBot: (id: string) => void
  readOnly: boolean
  onCommand: (value: string) => void
}

function SelectionSection({ s, multi }: { s: SelectionActions; multi: boolean }) {
  return (
    <Section title={multi ? t('所选 {n} 个页面', { n: s.count }) : t('页面操作')}>
      <div className="art-inspector__rows" data-testid="art-selection-actions">
        <div className="art-inspector__row">
          <span>{t('AI')}</span>
          <div className="art-inspector__buttons">
            <MenuButton
              className="ui-btn ui-btn--small"
              aria-label={t('生成')}
              items={s.generate}
              onSelect={s.onCommand}
            >
              <Icon name="sparkle" size={14} />
              {t('生成')}
              <Icon name="chevron-down" size={10} weight={2} />
            </MenuButton>
            {s.bots.length > 1 ? (
              <PopUpButton
                aria-label={t('交给')}
                size="small"
                value={s.bot}
                onChange={s.onPickBot}
                options={s.bots}
              />
            ) : null}
          </div>
        </div>
        <div className="art-inspector__row">
          <span>{t('预览')}</span>
          <div className="art-inspector__buttons">
            {s.single ? (
              <IconButton size="small" title={t('新标签页打开')} onClick={() => s.onCommand(CMD.newTab)}>
                {'external' as const}
              </IconButton>
            ) : null}
            <IconButton size="small" title={t('显示二维码')} onClick={() => s.onCommand(CMD.qr)}>
              {'qrcode' as const}
            </IconButton>
            <Switch
              size="small"
              label={t('全高')}
              checked={s.full}
              onChange={() => s.onCommand(CMD.fullHeight)}
            />
          </div>
        </div>
        <div className="art-inspector__row">
          <span>{t('更多')}</span>
          <div className="art-inspector__buttons">
            {s.single ? (
              <IconButton size="small" title={t('查看详情')} onClick={() => s.onCommand(CMD.details)}>
                {'info' as const}
              </IconButton>
            ) : null}
            <IconButton size="small" title={t('下载')} onClick={() => s.onCommand(CMD.download)}>
              {'download' as const}
            </IconButton>
            <IconButton
              size="small"
              title={s.readOnly ? t('历史版本只读') : t('删除')}
              disabled={s.readOnly}
              onClick={() => s.onCommand(CMD.remove)}
            >
              {'trash' as const}
            </IconButton>
          </div>
        </div>
      </div>
    </Section>
  )
}

/** 画布设置: the selected page's settings (墨刀's), what the selection can do, then the canvas's own. */
export function CanvasSettings({
  page,
  selection,
  readOnly,
  colors,
  screens,
  device,
  systemName,
  favourites,
  showLinks,
  showBadges,
  rulers,
  onDesign,
  onPick,
  onLinks,
  onBadges,
  onRulers,
}: {
  page: PageSettings | null
  selection: SelectionActions | null
  readOnly: boolean
  colors: [string, string][]
  screens: number
  device: string
  systemName: string | null
  favourites: CanvasNode[]
  showLinks: boolean
  showBadges: boolean
  rulers: boolean
  onDesign: () => void
  onPick: (id: string) => void
  onLinks: () => void
  onBadges: () => void
  onRulers: () => void
}) {
  const [bg, setBg] = useState('')
  return (
    <div className="art-inspector__page" data-testid="art-canvas-props">
      <h3 className="art-inspector__title">{t('画布设置')}</h3>
      {page ? (
        <Section title={t('页面')}>
          <div className="art-inspector__rows" data-testid="art-page-settings">
            <div className="art-inspector__row">
              <span>{t('名称')}</span>
              <Input
                key={page.node.id + page.node.title}
                size="sm"
                aria-label={t('页面名称')}
                defaultValue={page.node.title}
                maxLength={80}
                disabled={readOnly}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim()
                  if (next && next !== page.node.title) page.onRename(next)
                }}
              />
            </div>
            <div className="art-inspector__row">
              <span>{t('尺寸')}</span>
              <PopUpButton
                aria-label={t('尺寸')}
                size="small"
                value={page.preset}
                onChange={page.onPreset}
                options={[
                  ...(page.preset ? [] : [{ value: '', label: `${page.node.w} × ${page.node.h}` }]),
                  ...page.presets,
                ]}
              />
            </div>
            {page.onBackground ? (
              <ColorRow
                label={t('背景')}
                value={bg}
                shown={page.background ?? 'transparent'}
                colors={colors}
                disabled={readOnly}
                onChange={(v) => {
                  setBg(v)
                  page.onBackground?.(v)
                }}
              />
            ) : null}
            <div className="art-inspector__row">
              <span>{t('源码')}</span>
              <Button size="small" variant="plain" icon="doc-code" onClick={page.onCode}>
                {t('查看代码')}
              </Button>
            </div>
          </div>
        </Section>
      ) : null}
      {page ? (
        <Section title={t('热区')}>
          {page.hotspots.length ? (
            <ul className="art-favs" aria-label={t('热区')}>
              {page.hotspots.map((h) => (
                <li key={h.ggId}>
                  <button type="button" className="art-favs__item" onClick={() => page.onPickHotspot(h.ggId)}>
                    <Icon name="target" size={14} />
                    <span>
                      {t('跳到 {screen}', {
                        screen: page.screens.find((s) => s.id === h.link)?.title ?? h.link ?? '—',
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="art-inspector__hint">{t('在页面上框出一块区域，点击它跳到别的页面')}</p>
          )}
          <Button size="small" icon="plus" disabled={readOnly} onClick={page.onHotspot}>
            {t('添加热区')}
          </Button>
        </Section>
      ) : (
        <p className="art-inspector__hint">{t('选中一个页面，可以改它的名称、尺寸、背景和热区')}</p>
      )}
      {selection ? <SelectionSection s={selection} multi={!page} /> : null}
      <Section title={t('画布')}>
        <dl className="art-props">
          <dt>{t('屏幕')}</dt>
          <dd>{t('{n} 个', { n: screens })}</dd>
          <dt>{t('设备')}</dt>
          <dd>{device === 'desktop' ? t('桌面端') : t('手机')}</dd>
          <dt>{t('设计系统')}</dt>
          <dd>
            <Button size="small" variant="plain" icon="palette" onClick={onDesign}>
              {systemName ?? t('选择设计系统')}
            </Button>
          </dd>
        </dl>
      </Section>
      <Section title={t('显示')}>
        <div className="art-inspector__switches">
          <Switch size="small" label={t('标尺')} checked={rulers} onChange={onRulers} />
          <Switch size="small" label={t('显示连线')} checked={showLinks} onChange={onLinks} />
          <Switch size="small" label={t('显示角标')} checked={showBadges} onChange={onBadges} />
        </div>
      </Section>
      <Section title={t('收藏')}>
        {favourites.length ? (
          <ul className="art-favs">
            {favourites.map((s) => (
              <li key={s.id}>
                <button type="button" className="art-favs__item" onClick={() => onPick(s.id)}>
                  <Icon name="star" size={14} />
                  <span>{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="art-inspector__hint">{t('选中屏幕按 ⇧F 收藏')}</p>
        )}
      </Section>
      <p className="art-inspector__hint">{t('用「直接编辑」点选页面上的模块，在这里调它的外观和交互')}</p>
    </div>
  )
}

/** 热区: drawn on a page (or about to be), then where it leads. */
export function HotspotForm({
  drawn,
  screens,
  onSave,
  onCancel,
}: {
  /** Where it is drawn (document px of its page); null while it is still to be drawn. */
  drawn: { screenId: string; file: string; rect: { x: number; y: number; w: number; h: number } } | null
  /** Every page of the artifact, shown on the canvas or not. */
  screens: { id: string; title: string }[]
  onSave: (op: ArtifactEditOp) => Promise<boolean>
  onCancel: () => void
}) {
  const others = screens.filter((s) => s.id !== drawn?.screenId)
  const [to, setTo] = useState(others[0]?.id ?? '')
  const [transition, setTransition] = useState('push')
  const [busy, setBusy] = useState(false)
  return (
    <div className="art-inspector__page" data-testid="art-hotspot">
      <h3 className="art-inspector__title">{t('添加热区')}</h3>
      {drawn ? (
        <>
          <p className="art-inspector__hint">
            {t('热区 {w} × {h}，点击后跳到：', { w: Math.round(drawn.rect.w), h: Math.round(drawn.rect.h) })}
          </p>
          <div className="art-inspector__rows">
            <div className="art-inspector__row">
              <span>{t('跳转到')}</span>
              <PopUpButton
                aria-label={t('跳转到')}
                size="small"
                value={to}
                onChange={setTo}
                options={others.map((s) => ({ value: s.id, label: s.title }))}
              />
            </div>
            <div className="art-inspector__row">
              <span>{t('转场')}</span>
              <PopUpButton
                aria-label={t('转场')}
                size="small"
                value={transition}
                onChange={setTransition}
                options={[
                  { value: 'none', label: t('无转场') },
                  { value: 'push', label: t('推入') },
                  { value: 'push-back', label: t('推回') },
                  { value: 'slide-up', label: t('上滑') },
                  { value: 'fade', label: t('淡入') },
                ]}
              />
            </div>
          </div>
        </>
      ) : (
        <p className="art-inspector__hint">{t('在页面上按住拖动，框出热区的范围')}</p>
      )}
      <div className="art-el__foot">
        <Button size="small" onClick={onCancel}>
          {t('取消')}
        </Button>
        <Button
          size="small"
          variant="primary"
          loading={busy}
          disabled={!drawn || !to}
          onClick={async () => {
            if (!drawn) return
            const { x, y, w, h } = drawn.rect
            setBusy(true)
            await onSave({
              kind: 'hotspot',
              file: drawn.file,
              rect: {
                x: Math.max(0, Math.round(x)),
                y: Math.max(0, Math.round(y)),
                w: Math.round(w),
                h: Math.round(h),
              },
              to,
              transition: transition as ArtifactTransition,
            })
            setBusy(false)
          }}
        >
          {t('保存')}
        </Button>
      </div>
    </div>
  )
}

const TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'label',
  'strong',
  'em',
  'small',
  'b',
  'i',
])
const layerIcon = (tag: string): IconName =>
  tag === 'img' || tag === 'svg' || tag === 'picture' || tag === 'video'
    ? 'image'
    : tag === 'a'
      ? 'link'
      : tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select'
        ? 'cursor'
        : TEXT_TAGS.has(tag)
          ? 'textformat'
          : 'grid'

/** 图层: the selected screen's elements, nested as in the page; a click selects one for 直接编辑. */
export function LayersPanel({
  screen,
  items,
  selected,
  onPick,
  onRefresh,
}: {
  screen: CanvasNode | undefined
  /** null while the screen has not answered. */
  items: BridgeLayer[] | null
  selected: string | null
  onPick: (ggId: string) => void
  onRefresh: () => void
}) {
  if (!screen)
    return (
      <EmptyState
        compact
        icon="grid"
        title={t('先选中一个屏幕')}
        description={t('图层列出所选屏幕里的元素')}
      />
    )
  return (
    <div className="art-layers" data-testid="art-layers">
      <header className="art-layers__head">
        <h3 className="art-inspector__title">{screen.title}</h3>
        <IconButton size="small" title={t('刷新图层')} onClick={onRefresh}>
          {'arrow-clockwise' as const}
        </IconButton>
      </header>
      {items === null ? (
        <div className="art-layers__wait">
          <Spinner size={14} />
        </div>
      ) : items.length ? (
        <ul className="art-layers__list" aria-label={t('图层')}>
          {items.map((l) => (
            <li key={l.ggId}>
              <button
                type="button"
                className={cx(
                  'art-layers__row',
                  l.hidden && 'art-layers__row--hidden',
                  selected === l.ggId && 'art-layers__row--on',
                )}
                style={{ paddingLeft: 8 + Math.min(l.depth, 12) * 12 }}
                aria-current={selected === l.ggId || undefined}
                title={l.hidden ? t('已隐藏') : undefined}
                onClick={() => onPick(l.ggId)}
              >
                <Icon name={l.hidden ? 'eye-slash' : layerIcon(l.tag)} size={13} />
                <span className="art-layers__name">{l.name || l.tag}</span>
                {l.name ? <span className="art-layers__tag">{l.tag}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon="grid" title={t('这个屏幕没有可选的元素')} />
      )}
    </div>
  )
}
