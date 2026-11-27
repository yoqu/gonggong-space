import type { BridgeLayer } from '@gonggong/protocol'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, EmptyState, Icon, IconButton, type IconName, Spinner, Switch } from '../../ui'
import type { CanvasNode } from './geometry'
import './inspector.css'

/** The tabs of the right-hand 属性面板 (墨刀's style / event panel, with our own 图层, 批注 and 规则); 设计系统 opens from the top bar. */
export type InspectorTab = 'props' | 'layers' | 'annotations' | 'rules' | 'design'

/** The tab a canvas panel shows under; 设计系统 under none (it opens from the top bar). */
export const inspectorTab = (panel: string | null): InspectorTab =>
  panel === 'layers' || panel === 'annotations' || panel === 'rules' || panel === 'design'
    ? panel
    : panel === 'shared'
      ? 'rules'
      : 'props'

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'props', label: t('属性') },
  { id: 'layers', label: t('图层') },
  { id: 'annotations', label: t('批注') },
  { id: 'rules', label: t('规则') },
]

/** Docked at the canvas's right edge (墨刀's right panel): what is selected, or the tab's own panel. */
export function Inspector({
  tab,
  notes,
  onTab,
  children,
}: {
  tab: InspectorTab
  /** Open annotations, as a count on 批注. */
  notes: number
  onTab: (tab: InspectorTab) => void
  children: ReactNode
}) {
  return (
    <aside className="art-inspector" aria-label={t('属性面板')} data-testid="art-inspector">
      <div className="art-inspector__tabs" role="tablist" aria-label={t('属性面板')}>
        {TABS.map((it) => (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={tab === it.id}
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

/** A titled block of the 属性 tab. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="art-inspector__section">
      <h4 className="art-panel__label">{title}</h4>
      {children}
    </section>
  )
}

/** Nothing selected: the canvas itself (墨刀's 画布属性), and where to find the rest. */
export function CanvasInfo({
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
  return (
    <div className="art-inspector__page" data-testid="art-canvas-props">
      <h3 className="art-inspector__title">{t('画布')}</h3>
      <Section title={t('属性')}>
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
      <p className="art-inspector__hint">
        {t('选中屏幕查看页面属性；用「直接编辑」点选元素，在这里改样式和点击跳转')}
      </p>
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
