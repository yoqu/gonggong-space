import { type PageRule, parseSharedRules, sharedRefsOf } from '@gonggong/protocol'
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, CloseButton, EmptyState, Icon, Tag, usePresence } from '../../ui'
import { Markdown } from '../chat/Markdown'
import { ruleLabel } from './RulesPanel'

/** Where a rule shows: its element (marked), out of sight (no mark), gone from the page, or the whole page. */
export type RulePlace = 'element' | 'hidden' | 'missing' | 'page' | 'unknown'

export const stillMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The panel's gap above the full-screen workbench's floating composer, when it lies under the panel (px). */
const DOCK_GAP = 12

/**
 * How far up from its box's bottom `el` should end so the full-screen workbench's floating composer (`.cdock--float`)
 * does not cover it: null when the composer is elsewhere. Its box: its offset parent, or itself (`self`).
 */
export function useComposerClearance(panel: React.RefObject<HTMLElement | null>, on: boolean, self = false) {
  const [bottom, setBottom] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = panel.current
    const host = self ? el : el?.offsetParent
    if (!on || !el || !host) return
    const measure = () => {
      const dock = document.querySelector('.cdock--float .cdock__shell')?.getBoundingClientRect()
      const p = el.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      const under =
        !!dock && dock.width > 0 && dock.left < p.right && dock.right > p.left && dock.top < h.bottom
      setBottom(under && dock ? Math.max(0, h.bottom - dock.top + DOCK_GAP) : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    const dock = document.querySelector('.cdock--float')
    if (dock) ro.observe(dock)
    return () => ro.disconnect()
  }, [panel, on, self])
  return bottom
}

/**
 * The 标注 panel: the screen's rules in order, each with the shared rules it refers to, opened in place. On a narrow
 * stage it lies along the bottom (`drawer`), above the rail.
 */
export function NotesPanel({
  open,
  drawer,
  screen,
  rules,
  places,
  stats,
  shared,
  selected,
  hover,
  onPick,
  onHover,
  onCanvas,
  onClose,
}: {
  open: boolean
  drawer: { height: number; bottom: number } | null
  screen: { id: string; title: string }
  rules: PageRule[]
  places: RulePlace[]
  stats: { total: number; pending: number }
  shared: string | null
  selected: number | null
  hover: number | null
  onPick: (i: number) => void
  onHover: (i: number | null) => void
  /** Back to the canvas on this screen's page rules. */
  onCanvas: () => void
  onClose: () => void
}) {
  const presence = usePresence(open)
  const box = useRef<HTMLElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const [keys, setKeys] = useState(false)
  const clear = useComposerClearance(box, presence.mounted && !drawer)
  useEffect(() => {
    if (selected === null) return
    list.current?.children[selected]?.scrollIntoView({
      block: 'nearest',
      behavior: stillMotion() ? 'auto' : 'smooth',
    })
  }, [selected])
  if (!presence.mounted) return null
  const sections = shared ? parseSharedRules(shared) : []
  const picked = selected === null ? undefined : rules[selected]
  const style: CSSProperties | undefined = drawer
    ? { height: drawer.height, bottom: drawer.bottom }
    : clear !== null
      ? { bottom: clear }
      : undefined
  return (
    <aside
      ref={box}
      className={cx('art-panel proto-notes', drawer && 'proto-notes--drawer')}
      aria-label={t('标注')}
      data-state={presence.state}
      // On its way out: gone already for the keyboard and assistive tech.
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      style={style}
      onAnimationEnd={presence.onAnimationEnd}
    >
      <header className="art-panel__head">
        <h3>{t('标注')}</h3>
        <button
          type="button"
          className="proto-notes__help"
          aria-label={t('快捷键')}
          title={t('快捷键')}
          aria-expanded={keys}
          onClick={() => setKeys(!keys)}
        >
          ?
        </button>
        <span className="art-bar__fill" />
        <CloseButton onClick={onClose} />
      </header>
      {keys ? (
        <dl className="proto-notes__keys">
          <dt>
            <kbd>N</kbd>
          </dt>
          <dd>{t('隐藏标注')}</dd>
          <dt>
            <kbd>[</kbd> <kbd>]</kbd>
          </dt>
          <dd>{t('切换规则')}</dd>
          <dt>
            <kbd>←</kbd> <kbd>→</kbd>
          </dt>
          <dd>{t('焦点在角标或侧栏时切换规则')}</dd>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>{t('取消选中，再按关闭面板')}</dd>
        </dl>
      ) : null}
      <p className="proto-notes__sub">
        <strong key={screen.id}>{screen.title}</strong>
        {rules.length ? (
          <span>
            {stats.pending
              ? t('{n} 条 · 待确认 {m}', { n: stats.total, m: stats.pending })
              : t('{n} 条', { n: stats.total })}
          </span>
        ) : null}
      </p>
      {/* Read out as ←/→ walk the rules. */}
      <p className="proto-notes__live" role="status">
        {picked && selected !== null
          ? `${t('规则 {n}：{label}', { n: selected + 1, label: ruleLabel(picked) })}${picked.pending ? ` · ${t('待确认')}` : ''} · ${picked.text}`
          : ''}
      </p>
      <div className="art-panel__body proto-notes__body">
        {rules.length ? (
          <ol key={screen.id} ref={list} className="proto-notes__list">
            {rules.map((r, i) => (
              <Note
                // biome-ignore lint/suspicious/noArrayIndexKey: rules are numbered by their place
                key={i}
                n={i + 1}
                rule={r}
                place={places[i] ?? 'unknown'}
                sections={sections}
                on={selected === i}
                hover={hover === i}
                onPick={() => onPick(i)}
                onHover={(on) => onHover(on ? i : null)}
              />
            ))}
          </ol>
        ) : (
          <EmptyState
            compact
            icon="checklist"
            title={t('这屏还没有规则')}
            description={t('页面规则在画布上添加：选中元素，写一句规则')}
            action={
              <Button size="small" icon="arrow-left" onClick={onCanvas}>
                {t('回画布添加规则')}
              </Button>
            }
          />
        )}
      </div>
    </aside>
  )
}

function Note({
  n,
  rule,
  place,
  sections,
  on,
  hover,
  onPick,
  onHover,
}: {
  n: number
  rule: PageRule
  place: RulePlace
  sections: { id: string; title: string; body: string }[]
  on: boolean
  hover: boolean
  onPick: () => void
  onHover: (on: boolean) => void
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const refs = sharedRefsOf(rule.text).flatMap((id) => sections.filter((s) => s.id === id))
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: its button picks it from the keyboard; the row is a larger target
    <li
      className={cx(
        'proto-note',
        rule.pending && 'proto-note--pending',
        on && 'proto-note--on',
        hover && 'proto-note--hover',
      )}
      data-testid={`proto-note-${n}`}
      style={{ '--proto-mark-i': n - 1 } as CSSProperties}
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button
        type="button"
        className="proto-note__pick"
        aria-label={`${n} ${ruleLabel(rule)}${rule.pending ? ` · ${t('待确认')}` : ''}`}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation()
          onPick()
        }}
      >
        <span className={cx('art-rule__no', rule.pending && 'art-rule__no--pending')}>{n}</span>
      </button>
      <div className="proto-note__main">
        <div className="art-rule__anchor">
          <span>{ruleLabel(rule)}</span>
          {rule.pending ? <Tag tone="orange">{t('待确认')}</Tag> : null}
          {place === 'missing' ? <Tag tone="red">{t('元素已不存在')}</Tag> : null}
          {place === 'hidden' ? <Tag>{t('当前不可见 · 点击定位')}</Tag> : null}
        </div>
        <div className="proto-note__text">
          <Markdown text={rule.text} />
        </div>
        {refs.map((s) => {
          const shown = opened.has(s.id)
          return (
            <div key={s.id} className="proto-note__ref">
              <button
                type="button"
                aria-expanded={shown}
                onClick={(e) => {
                  e.stopPropagation()
                  const next = new Set(opened)
                  if (shown) next.delete(s.id)
                  else next.add(s.id)
                  setOpened(next)
                }}
              >
                <Icon name="chevron-right" size={12} />
                {`${s.id} ${s.title}`}
              </button>
              {shown ? (
                // biome-ignore lint/a11y/useKeyWithClickEvents: only keeps a click inside from picking the rule
                // biome-ignore lint/a11y/noStaticElementInteractions: as above
                <div className="proto-note__shared" onClick={(e) => e.stopPropagation()}>
                  <Markdown text={s.body} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </li>
  )
}

/**
 * A rule's Markdown as plain text: the bubble shows words, not controls (a code block's copy button) or markup.
 */
export const plainText = (md: string) =>
  md
    .replace(/```[^\n]*\n?/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*/g, '$1$2$3')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()

/**
 * A rule by its mark: number, element, 待确认, the first lines of its words, and the way to the panel; a group's mark
 * lists its rules to pick. A non-modal popup (it holds buttons; the shortcuts go on with the focus in it) whose text
 * describes the mark; it opens with the pointer or the focus on the mark, and stays while either is on it.
 */
export function RuleBubble({
  id,
  n,
  rule,
  group,
  onPick,
  onPanel,
  onEnter,
  onLeave,
  onBack,
}: {
  id: string
  n: number
  rule: PageRule
  /** The group's rules, for a group's mark. */
  group: { n: number; rule: PageRule }[] | null
  onPick: (n: number) => void
  onPanel: () => void
  onEnter: () => void
  onLeave: () => void
  /** Back to its mark (Esc, Shift+Tab). */
  onBack: () => void
}) {
  const text = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again for another rule
  useLayoutEffect(() => {
    const el = text.current
    setMore(!!el && el.scrollHeight > el.clientHeight + 1)
  }, [rule.text])
  const name = group
    ? t('规则 {n}：{label}', { n: group.map((g) => g.n).join('、'), label: ruleLabel(rule) })
    : t('规则 {n}：{label}', { n, label: ruleLabel(rule) })
  return (
    <div
      id={id}
      className={cx('proto-bubble', rule.pending && !group && 'proto-bubble--pending')}
      role="dialog"
      aria-modal="false"
      aria-label={name}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      // Reached with ↓ from its mark, left with Esc or Shift+Tab: Tab walks the marks, not the bubbles.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' && !(e.key === 'Tab' && e.shiftKey)) return
        e.preventDefault()
        onBack()
      }}
    >
      {group ? (
        <ul id={`${id}-text`} className="proto-bubble__group">
          {group.map((g) => (
            <li key={g.n}>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${g.n} ${ruleLabel(g.rule)}${g.rule.pending ? ` · ${t('待确认')}` : ''}`}
                onClick={() => onPick(g.n)}
              >
                <span className={cx('art-rule__no', g.rule.pending && 'art-rule__no--pending')}>{g.n}</span>
                <span className="proto-bubble__item">
                  <span className="proto-bubble__label">
                    {ruleLabel(g.rule)}
                    {g.rule.pending ? <Tag tone="orange">{t('待确认')}</Tag> : null}
                  </span>
                  <span className="proto-bubble__line">{plainText(g.rule.text)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="art-rule__anchor">
            <span className={cx('art-rule__no', rule.pending && 'art-rule__no--pending')}>{n}</span>
            <strong>{ruleLabel(rule)}</strong>
            {rule.pending ? <Tag tone="orange">{t('待确认')}</Tag> : null}
          </div>
          {/* At most four lines, fading out when there is more (the panel has all of it). */}
          <div
            ref={text}
            id={`${id}-text`}
            className={cx('proto-bubble__text', more && 'proto-bubble__text--more')}
          >
            {plainText(rule.text)}
          </div>
          <button type="button" className="proto-bubble__more" tabIndex={-1} onClick={onPanel}>
            {t('在侧栏查看')}
          </button>
        </>
      )}
    </div>
  )
}
