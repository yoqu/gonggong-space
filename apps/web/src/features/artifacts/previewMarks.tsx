import type { BridgeAnchorRect, PageRule, Rect } from '@gonggong/protocol'
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, Tooltip } from '../../ui'
import type { BridgeMessage } from './bridge'
import { isRect, postToScreen } from './bridge'
import { NO_SCROLL, type Scroll, scrolledBy } from './elements'
import { BUBBLE_W, bubbleAt, type MarkFrame, markLabel, placeMarks } from './markLayout'
import { NotesPanel, RuleBubble, type RulePlace, stillMotion } from './previewNotes'
import { notOurKey } from './prototype'
import { RulesBadge, ruleLabel } from './RulesPanel'
import { anchorSpots, ruleStats, useRuleFiles } from './rules'
import './rules.css'
import './preview-marks.css'

const MARKS_KEY = 'gg.art.previewMarks'
/** The narrow stage's drawer: at least this tall, and never so tall the device drops under MIN_SCALE. */
const DRAWER_MIN = 220
const MIN_SCALE = 0.45
/** What the stage keeps free around the device vertically (PrototypeEditor's scale). */
const STAGE_SLACK = 96
/** The screen as the marks see it; the page's pinned layers come from its own reports. */
type ScreenFrame = Omit<MarkFrame, 'covers'>
/** Leaving a mark for its bubble: how long the bubble waits for the pointer (ms). */
const HOVER_GRACE = 150

interface Screen {
  id: string
  title: string
  file: string
}

/**
 * The narrow stage's bottom drawer height: as tall as leaves the device at MIN_SCALE (`taken`: what else the stage's
 * height holds — the rail, a guide), within DRAWER_MIN and half the stage.
 */
export const drawerHeight = (stage: number, device: number, taken: number) =>
  Math.floor(
    Math.min(stage / 2, Math.max(DRAWER_MIN, stage - STAGE_SLACK - taken - Math.ceil(MIN_SCALE * device))),
  )

/**
 * The prototype preview's 标注 (annotation) mode, like Axure's and Mockplus's: the screen's page rules
 * (rules/<screen>.md, the canvas's rules) as numbered marks over its elements, whole-page ones above the device, a
 * bubble by the mark and a side panel, linked both ways — a mark picks its rule, a rule outlines its element in the page
 * in the mark's tone. The editor wires the pieces in where they go.
 */
export function usePreviewMarks(o: {
  files: { path: string; hash: string }[] | null
  readFile: (file: string) => Promise<string>
  versionKey: string
  screen: Screen
  /** Preview mode: edit mode has no marks. */
  active: boolean
  frames: ReadonlyMap<string, HTMLIFrameElement>
  origin: string | null
  /** Each screen file's latest scroll. */
  scrolls: Record<string, Scroll>
  /** The editor, for its window-wide shortcuts. */
  root: RefObject<HTMLElement | null>
  /** Back to the canvas on this screen's page rules (to add some). */
  onCanvasRules: (screenId: string) => void
}) {
  const data = useRuleFiles(o.files, o.readFile, o.versionKey)
  const [show, setShow] = useState(() => localStorage.getItem(MARKS_KEY) === 'on')
  const [open, setOpen] = useState(show)
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  /** The rule under the pointer on its mark or its bubble (not in the panel, which shows it already). */
  const [bubbleHover, setBubbleHover] = useState<number | null>(null)
  const [anchors, setAnchors] = useState<Record<string, BridgeAnchorRect[]>>({})
  /** Each screen's layers pinned over its page (a sticky head, a fixed tab bar), in its viewport. */
  const [covers, setCovers] = useState<Record<string, Rect[]>>({})
  /** Bumped when the current screen's page (re)loads: it lost its outline. */
  const [loads, setLoads] = useState(0)
  /** The device's zoom (the editor sets it): outlines are drawn wider by its inverse, 2px on screen. */
  const [scale, setScale] = useState(1)
  /** Bumped by each pick: the editor brings its element into the stage's view. */
  const [picks, setPicks] = useState(0)
  const rulesOf = (id: string) => data.pages[id]?.rules ?? []
  const rules = rulesOf(o.screen.id)
  const visible = o.active && show
  const spotOf = (file: string, r: PageRule | undefined) =>
    r?.anchor ? anchors[file]?.find((a) => a.anchor === r.anchor) : undefined
  const placeOf = (file: string, r: PageRule): RulePlace => {
    if (!r.anchor) return 'page'
    if (!anchors[file]) return 'unknown'
    const spot = spotOf(file, r)
    return !spot ? 'missing' : spot.hidden ? 'hidden' : 'element'
  }
  const places = rules.map((r) => placeOf(o.screen.file, r))

  // A mark's bubble outlives the pointer leaving the mark for a moment, so the pointer can reach it.
  const grace = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hoverOn = (i: number) => {
    clearTimeout(grace.current)
    setHover(i)
    setBubbleHover(i)
  }
  const hoverOff = () => {
    clearTimeout(grace.current)
    grace.current = setTimeout(() => {
      setHover(null)
      setBubbleHover(null)
    }, HOVER_GRACE)
  }
  useEffect(() => () => clearTimeout(grace.current), [])
  // Marks gone (off, or edit mode): nothing is under the pointer any more.
  useEffect(() => {
    if (visible) return
    clearTimeout(grace.current)
    setHover(null)
    setBubbleHover(null)
  }, [visible])

  const toggle = (on = !show) => {
    localStorage.setItem(MARKS_KEY, on ? 'on' : 'off')
    setShow(on)
    setOpen(on)
    if (!on) setSelected(null)
  }
  const select = (i: number | null, panel = open) => {
    setSelected(i)
    if (i === null) return
    setShow(true)
    setOpen(panel)
    setPicks((n) => n + 1)
    const ggId = spotOf(o.screen.file, rules[i])?.ggId
    if (ggId)
      postToScreen(o.frames.get(o.screen.file), o.origin, {
        type: 'scroll-to',
        ggId,
        behavior: stillMotion() ? 'instant' : 'smooth',
      })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: a screen or version of its own starts unpicked
  useEffect(() => {
    setSelected(null)
    setHover(null)
    setBubbleHover(null)
  }, [o.screen.id, o.versionKey])
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a version change only
  useEffect(() => setAnchors({}), [o.versionKey])

  // The page outlines the rule under the pointer, else the picked one, in its mark's tone.
  const lit = useRef('')
  const shown = visible ? rules[hover ?? selected ?? -1] : undefined
  const ggId = shown ? (spotOf(o.screen.file, shown)?.ggId ?? null) : null
  const tone = shown?.pending ? 'pending' : 'settled'
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loads` re-sends to a reloaded page
  useEffect(() => {
    const key = `${o.screen.file}|${ggId}|${tone}|${scale}`
    if (lit.current === key) return
    const first = !lit.current.startsWith(`${o.screen.file}|`)
    lit.current = key
    if (first && !ggId) return
    postToScreen(
      o.frames.get(o.screen.file),
      o.origin,
      ggId
        ? { type: 'highlight', ggIds: [ggId], tone, ...(scale < 1 && { unscale: Math.min(10, 1 / scale) }) }
        : { type: 'highlight', ggIds: [] },
    )
  }, [ggId, tone, o.screen.file, o.frames, o.origin, loads, scale])

  // With the focus on a mark or in the panel, ←/→ take it to the rule they pick, on the same side.
  const follow = useRef<'marks' | 'panel' | null>(null)
  useEffect(() => {
    const side = follow.current
    if (!side || selected === null) return
    follow.current = null
    const root = o.root.current
    const note = root?.querySelector<HTMLElement>(
      `[data-testid="proto-note-${selected + 1}"] .proto-note__pick`,
    )
    // A mark scrolled out of view (or one in a group) cannot take it: the panel's rule does.
    const mark = root?.querySelector<HTMLElement>(
      `[data-testid="proto-mark-${selected + 1}"]:not(.proto-mark--out)`,
    )
    ;(side === 'marks' ? (mark ?? note) : note)?.focus({ preventScroll: true })
  }, [selected, o.root])
  /** The rule the focus is on (a mark or a panel's rule), else the picked one. */
  const focusedRule = () => {
    const el = document.activeElement
    const id =
      el?.closest('.proto-mark')?.getAttribute('data-testid') ??
      el?.closest('.proto-note')?.getAttribute('data-testid') ??
      ''
    const n = Number(/-(\d+)$/.exec(id)?.[1])
    return n ? n - 1 : selected
  }

  /**
   * [ / ] walk the rules; ← / → too while the focus is on a mark or in the panel (elsewhere ← goes back a screen).
   */
  const walks = (key: string) =>
    key === '[' ||
    key === ']' ||
    ((key === 'ArrowLeft' || key === 'ArrowRight') &&
      !!document.activeElement?.closest('.proto-mark, .proto-notes'))
  // N toggles; with the panel open [ / ] walk the rules, Esc unpicks then closes.
  const onKey = (e: KeyboardEvent) => {
    if (!o.active || notOurKey(e, o.root.current)) return false
    if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
      if (!e.repeat) toggle()
    } else if (!show) return false
    // Esc in a bubble is the bubble's (back to its mark).
    else if (e.key === 'Escape' && e.target instanceof Element && e.target.closest('.proto-bubble'))
      return false
    else if (e.key === 'Escape' && selected !== null) setSelected(null)
    else if (e.key === 'Escape' && open) setOpen(false)
    else if (walks(e.key) && rules.length) {
      // With the panel closed too: the picked rule's bubble shows it, the focus goes to its mark.
      const step = e.key === 'ArrowRight' || e.key === ']' ? 1 : -1
      const focus = document.activeElement
      follow.current = focus?.closest('.proto-notes')
        ? 'panel'
        : focus?.closest('.proto-mark') || !open
          ? 'marks'
          : null
      const from = focusedRule()
      select(((from ?? (step > 0 ? -1 : 0)) + step + rules.length) % rules.length)
    } else return false
    return true
  }
  const keys = useRef(onKey)
  keys.current = onKey
  useEffect(() => {
    const listen = (e: KeyboardEvent) => {
      if (keys.current(e)) e.preventDefault()
    }
    // Capture: ahead of the editor's own ← (back) and Esc.
    window.addEventListener('keydown', listen, true)
    return () => window.removeEventListener('keydown', listen, true)
  }, [])

  const onBridge = (m: BridgeMessage) => {
    if (m.type !== 'ready' && m.type !== 'size') return
    const found = anchorSpots((m as { anchors?: unknown }).anchors)
    if (found) setAnchors((a) => ({ ...a, [m.file]: found }))
    const pinned = (m as { covers?: unknown }).covers
    if (Array.isArray(pinned))
      setCovers((c) => ({ ...c, [m.file]: pinned.flatMap((r) => (isRect(r) ? [r] : [])) }))
    if (m.type === 'ready' && m.file === o.screen.file) {
      lit.current = ''
      setLoads((n) => n + 1)
    }
  }

  /** The rule under the pointer (or focus) on its mark, else the picked one while the panel is closed: its bubble. */
  const bubbled = bubbleHover ?? (open ? null : selected)
  const bubbleRule = visible && bubbled !== null ? rules[bubbled] : undefined
  const bubbleId = useId()

  const stats = ruleStats(rules)
  const badge = o.active ? <RulesBadge rules={rules} onClick={() => toggle(true)} /> : null
  const button = o.active ? (
    <Tooltip content={show ? t('隐藏页面规则标注') : t('显示页面规则标注')} shortcut="N" placement="bottom">
      <Button
        size="small"
        variant="plain"
        icon="checklist"
        className={cx('proto-marks-toggle', show && 'proto-marks-toggle--on')}
        aria-label={t('标注')}
        aria-pressed={show}
        onClick={() => toggle()}
      >
        <span className="proto-marks-toggle__label">{t('标注')}</span>
        {/* A narrow bar has no room for the badge: the count goes here (prototype.css). */}
        {rules.length ? (
          <span className="proto-marks-toggle__count">
            {stats.pending ? `${stats.total} · ${stats.pending}` : stats.total}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  ) : null

  /**
   * A mark for one rule, or a group of one element's rules whose marks would sit on one another (`5+2`; its bubble lists them, a
   * click picks the first, again unpicks). Tab from a mark with its bubble open goes into the bubble.
   */
  const markProps = (ids: number[], extra?: string) => {
    const at = selected === null ? -1 : ids.indexOf(selected)
    const label = ids
      .map((i) => t('规则 {n}：{label}', { n: i + 1, label: ruleLabel(rules[i] as PageRule) }))
      .join('；')
    return {
      type: 'button' as const,
      className: cx(
        'art-rule-mark proto-mark',
        ids.some((i) => rules[i]?.pending) && 'art-rule-mark--pending proto-mark--pending',
        ids.length > 1 && 'proto-mark--group',
        at >= 0 && 'proto-mark--on',
        hover !== null && ids.includes(hover) && 'proto-mark--hover',
        extra,
      ),
      'data-testid': `proto-mark-${(ids[0] ?? 0) + 1}`,
      'aria-label': label,
      'aria-pressed': at >= 0,
      onClick: () => {
        if (ids.length > 1) return select(at >= 0 ? null : (ids[0] ?? null))
        select(at >= 0 ? null : (ids[0] ?? null))
      },
      // Its bubble's text describes it (the bubble opens on hover and on focus).
      'aria-describedby': bubbled !== null && ids.includes(bubbled) ? `${bubbleId}-text` : undefined,
      // ↓ goes into its bubble (Esc or Shift+Tab there comes back); Tab goes on to the next mark.
      onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== 'ArrowDown' || bubbled === null || !ids.includes(bubbled)) return
        const into = document.getElementById(bubbleId)?.querySelector('button')
        if (!into) return
        e.preventDefault()
        into.focus()
      },
      onMouseEnter: () => hoverOn(ids[at >= 0 ? at : 0] ?? 0),
      onMouseLeave: hoverOff,
      onFocus: () => hoverOn(ids[at >= 0 ? at : 0] ?? 0),
      onBlur: hoverOff,
      children: (
        <>
          {(ids[0] ?? 0) + 1}
          {ids.length > 1 ? <small className="proto-mark__more">+{ids.length - 1}</small> : null}
        </>
      ),
    }
  }

  /** Where each screen's element marks go (`frame`: the screen; `scale`: the device's zoom, the marks undo). */
  const placed = (frame: ScreenFrame, scale: number, of: Screen) => {
    const at = o.scrolls[of.file] ?? NO_SCROLL
    const items = rulesOf(of.id).flatMap((r, i) => {
      const spot = spotOf(of.file, r)
      // Pinned to the viewport (a fixed tab bar): where it is, whatever the page's scroll.
      if (!spot || spot.hidden) return []
      return [{ i, rect: spot.fixed ? spot.rect : scrolledBy(spot.rect, at), pinned: !!spot.fixed }]
    })
    // Marks keep their size on screen (18px, 11px figures): a crowded spot groups or steps aside instead.
    return { items, marks: placeMarks(items, { ...frame, covers: covers[of.file] ?? [] }, 1 / scale) }
  }

  /**
   * The marks of a screen's elements, over it and its chrome. Marks scrolled out of view hide but stay, so they do not
   * come in again; the leaving screen's go with it, inert.
   */
  const layer = (frame: ScreenFrame, scale: number, of = o.screen, leaving = false) => {
    if (!visible) return null
    const { marks } = placed(frame, scale, of)
    if (!marks.length) return null
    return (
      <div
        className={cx('proto-marks', leaving && 'proto-marks--leaving')}
        data-testid={leaving ? 'proto-marks-leaving' : 'proto-marks'}
        aria-hidden={leaving || undefined}
        style={{ '--proto-unscale': 1 / scale } as CSSProperties}
      >
        {marks.map((m) => {
          const style = { left: m.left, top: m.top, '--proto-mark-i': m.ids[0] } as CSSProperties
          return leaving ? (
            <span key={m.ids[0]} className="art-rule-mark proto-mark" style={style}>
              {markLabel(m.ids)}
            </span>
          ) : (
            <button
              key={m.ids[0]}
              {...markProps(m.ids, cx(m.out && 'proto-mark--out', m.compact && 'proto-mark--compact'))}
              style={style}
              tabIndex={m.out ? -1 : 0}
            />
          )
        })}
      </div>
    )
  }

  const bubbleOf = (i: number, r: PageRule, group: number[] = [i]) => (
    <RuleBubble
      id={bubbleId}
      n={i + 1}
      rule={r}
      group={group.length > 1 ? group.map((k) => ({ n: k + 1, rule: rules[k] as PageRule })) : null}
      onPick={(n) => select(n - 1, open)}
      onPanel={() => {
        // The panel shows it now: the bubble goes.
        clearTimeout(grace.current)
        setBubbleHover(null)
        select(i, true)
      }}
      onEnter={() => hoverOn(i)}
      onLeave={hoverOff}
      onBack={() =>
        o.root.current
          ?.querySelector<HTMLElement>(`[data-testid="proto-mark-${(group[0] ?? i) + 1}"]`)
          ?.focus()
      }
    />
  )
  /**
   * The bubble by an element's mark, on the device box (outside the screen's clip): `bezel` and `scale` turn screen
   * coordinates into the box's.
   */
  /** The bubble's height when placing it (it shows up to four lines and a button). */
  const BUBBLE_H = 150
  const bubble = (
    frame: ScreenFrame,
    scale: number,
    bezel: number,
    /** Zoomed, what of the device box the stage shows: the bubble stays in it, turning over when it must. */
    view?: { x: number; y: number; w: number; h: number },
  ): ReactNode => {
    if (!bubbleRule || bubbled === null || places[bubbled] !== 'element') return null
    const { items, marks } = placed(frame, scale, o.screen)
    const mark = marks.find((m) => m.ids.includes(bubbled))
    const el = items.find((x) => x.i === bubbled)?.rect
    if (!mark || mark.out || !el) return null
    const at = bubbleAt(mark, el, { ...frame, covers: [] }, 1 / scale)
    let left = (bezel + at.left) * scale
    // Its top edge on the box, whichever way it opens.
    const above = (bezel + el.y) * scale - 6 - BUBBLE_H
    const below = (bezel + el.y + el.h) * scale + 6
    let top =
      at.bottom !== undefined
        ? (bezel + frame.h - at.bottom) * scale - BUBBLE_H
        : (bezel + (at.top ?? 0)) * scale
    if (view) {
      left = Math.min(Math.max(left, view.x + 8), view.x + view.w - BUBBLE_W - 8)
      if (top < view.y) top = below
      if (top + BUBBLE_H > view.y + view.h) top = above >= view.y ? above : view.y + view.h - BUBBLE_H
      top = Math.max(top, view.y)
    }
    const style: CSSProperties =
      at.bottom !== undefined && !view
        ? { left, top: (bezel + frame.h - at.bottom) * scale, translate: '0 -100%' }
        : { left, top }
    return (
      <div key={bubbled} className="proto-bubble-at" style={style}>
        {bubbleOf(bubbled, bubbleRule, mark.ids)}
      </div>
    )
  }

  /**
   * The whole-page rules, out of the screen's way: above the device, or (`float`, zoomed: the stage scrolls) at the
   * stage's top left, always in view. A page rule's bubble opens under them.
   */
  const page = rules.flatMap((r, i) => (places[i] === 'page' ? [{ r, i }] : []))
  const pageRow = (float: boolean) =>
    visible && page.length ? (
      <fieldset
        className={cx('proto-page-marks', float && 'proto-page-marks--float')}
        data-testid="proto-page-marks"
        aria-label={t('整页规则')}
      >
        <span>{t('整页')}</span>
        {page.map(({ i }) => (
          <button
            key={i}
            {...markProps([i], 'proto-mark--page')}
            style={{ '--proto-mark-i': i } as CSSProperties}
          />
        ))}
        {bubbleRule && bubbled !== null && places[bubbled] === 'page' ? (
          <div className="proto-bubble-at proto-bubble-at--page">{bubbleOf(bubbled, bubbleRule)}</div>
        ) : null}
      </fieldset>
    ) : null

  const panel = (drawer: { height: number; bottom: number } | null) => (
    <NotesPanel
      open={visible && open}
      drawer={drawer}
      screen={o.screen}
      rules={rules}
      places={places}
      stats={stats}
      shared={data.shared}
      selected={selected}
      hover={hover}
      onPick={(i) => select(selected === i ? null : i)}
      onHover={setHover}
      onCanvas={() => o.onCanvasRules(o.screen.id)}
      onClose={() => setOpen(false)}
    />
  )

  return {
    /** A click beside the marks (the stage, the page): a rule picked with the panel closed lets go. */
    unpick: () => {
      if (!open && selected !== null) setSelected(null)
    },
    /** The panel takes the stage's right side, or its bottom on a narrow stage. */
    panelOpen: visible && open,
    /** Marks show (the editor brings each screen's in, the first loudly, the rest quietly). */
    visible,
    setScale,
    /** The picked rule's element in the screen's viewport, and a count of picks (for the stage to follow). */
    picked: {
      n: picks,
      rect: (() => {
        const spot = selected === null ? undefined : spotOf(o.screen.file, rules[selected])
        return spot && !spot.hidden
          ? spot.fixed
            ? spot.rect
            : scrolledBy(spot.rect, o.scrolls[o.screen.file] ?? NO_SCROLL)
          : null
      })(),
    },
    onBridge,
    badge,
    button,
    layer,
    bubble,
    pageRow,
    panel,
  }
}
