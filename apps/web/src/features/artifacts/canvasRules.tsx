import {
  ArtifactAnchor,
  type ArtifactEditOp,
  type BotDto,
  type BridgeAnchorRect,
  type BridgeMode,
  SHARED_RULES_FILE,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { offlineHint } from './actions'
import { type BridgeMessage, postToScreen } from './bridge'
import { elementBox, inDocument, NO_SCROLL, type Scroll, scrolledBy } from './elements'
import type { CanvasNode, Rect, View } from './geometry'
import { type RulesAdding, RulesBadge } from './RulesPanel'
import {
  addRuleOps,
  anchorSpots,
  defaultLabel,
  loadRomanizer,
  type SharedRef,
  sharedRefs,
  useRuleFiles,
} from './rules'
import { SharedRulesNode, SharedRulesPanel } from './SharedRules'
import './rules.css'

const MARKS_KEY = 'gg.art.ruleMarks'
/** Whole-page marks sit in a row at the screen's top left, this far apart (px). */
const PAGE_MARK_STEP = 22
/** Marks of rules on one element sit in a row, this far apart (px). */
const SAME_ANCHOR_STEP = 16

type RulesPanelKind = 'rules' | 'shared'

/**
 * Page business rules on the canvas (design/app-screens-fzvz canvas, rules-view, rules-add, shared-rules): the badges
 * beside screen titles, the numbered marks on the elements, picking an element for a new rule, the 页面规则 and
 * 共享规则.md panels and the shared rules node. The canvas wires these pieces in where they go.
 */
export function useCanvasRules(o: {
  files: { path: string; hash: string }[] | null
  readFile: (file: string) => Promise<string>
  versionKey: string
  /** The manifest's screens (the canvas lays them out after the shared rules node is known). */
  screens: { id: string; title: string; file: string }[]
  canEdit: boolean
  frames: ReadonlyMap<string, HTMLIFrameElement>
  origin: string | null
  /** The bridge mode of the canvas's tool, restored when picking ends. */
  mode: BridgeMode
  scrolls: Record<string, Scroll>
  panel: string | null
  setPanel: (p: RulesPanelKind | null) => void
  save: (ops: ArtifactEditOp[]) => Promise<boolean>
  /** AI 补全: complete-rules for the screen, to the artifact's bot. */
  complete: (screenId: string) => Promise<boolean>
  bot: BotDto | null
  /** Selects the screen and brings it into view. */
  focus: (screenId: string) => void
  /** A page's rules are asked for (its badge, a mark, 页面规则): its 页面文档 shows them, in view. */
  reveal: (screenId: string) => void
}) {
  const data = useRuleFiles(o.files, o.readFile, o.versionKey)
  const [show, setShow] = useState(() => localStorage.getItem(MARKS_KEY) !== 'off')
  const [screenId, setScreenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [sharedAt, setSharedAt] = useState<{ id: string | null; n: number }>({ id: null, n: 0 })
  const [sharedEditing, setSharedEditing] = useState(false)
  const [anchors, setAnchors] = useState<Record<string, BridgeAnchorRect[]>>({})
  /** A rule being added; `rect`: its element in the screen's document, for the draft mark. */
  const [adding, setAdding] = useState<(RulesAdding & { screenId: string; rect: Rect | null }) | null>(null)
  const highlighted = useRef<string | null>(null)
  const screen = o.screens.find((s) => s.id === screenId) ?? null
  const page = screenId ? data.pages[screenId] : undefined
  const refs = sharedRefs(data.pages, o.screens)

  const toggle = () => {
    localStorage.setItem(MARKS_KEY, show ? 'off' : 'on')
    setShow(!show)
  }
  /** Outlines a rule's element in its tone (settled, or pending to confirm), like the preview's marks. */
  const highlight = (file: string | null, ggId: string | null, pending = false) => {
    const last = highlighted.current
    if (last && last !== file) postToScreen(o.frames.get(last), o.origin, { type: 'highlight', ggIds: [] })
    highlighted.current = ggId ? file : null
    if (!file) return
    const f = o.frames.get(file)
    postToScreen(
      f,
      o.origin,
      ggId
        ? { type: 'highlight', ggIds: [ggId], tone: pending ? 'pending' : 'settled' }
        : { type: 'highlight', ggIds: [] },
    )
    if (ggId) postToScreen(f, o.origin, { type: 'scroll-to', ggId })
  }
  const spotOf = (file: string, anchor: string | null) =>
    anchor ? anchors[file]?.find((a) => a.anchor === anchor) : undefined
  const selectRule = (sid: string, i: number) => {
    setSelected(i)
    const s = o.screens.find((x) => x.id === sid)
    const r = data.pages[sid]?.rules[i]
    if (s && r) highlight(s.file, spotOf(s.file, r.anchor)?.ggId ?? null, r.pending)
  }
  const open = (sid: string, i?: number) => {
    if (sid !== screenId) {
      setSelected(null)
      setAdding(null)
    }
    setScreenId(sid)
    o.reveal(sid)
    if (i !== undefined) selectRule(sid, i)
  }
  const openShared = (id: string | null = null) => {
    setSharedAt((p) => ({ id, n: p.n + 1 }))
    o.setPanel('shared')
  }
  const createShared = () => {
    setSharedEditing(true)
    openShared()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: on the panel only
  useEffect(() => {
    if (o.panel !== 'shared') setSharedEditing(false)
  }, [o.panel])
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a version change only
  useEffect(() => {
    setAdding(null)
    setSelected(null)
    setAnchors({})
  }, [o.versionKey])

  // Picking: the screens take clicks (as with the mark tool) until the rule is saved or cancelled.
  const picking = !!adding
  const wasPicking = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on picking's start and end only
  useEffect(() => {
    if (picking === wasPicking.current) return
    wasPicking.current = picking
    for (const f of o.frames.values()) {
      postToScreen(f, o.origin, { type: 'mode', mode: picking ? 'mark' : o.mode })
      if (!picking) postToScreen(f, o.origin, { type: 'select-clear' })
    }
  }, [picking])
  useEffect(() => {
    if (!picking) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAdding(null)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [picking])

  const wholePage = () =>
    adding && setAdding({ ...adding, picked: true, target: null, scriptMade: false, rect: null })

  /** Takes the bridge messages that are about rules; true when the canvas should not handle it as well. */
  const onBridge = (m: BridgeMessage) => {
    if (m.type === 'ready' || m.type === 'size') {
      const found = anchorSpots((m as { anchors?: unknown }).anchors)
      if (found) setAnchors((a) => ({ ...a, [m.file]: found }))
      return false
    }
    if (!adding) return false
    if (m.type === 'mark-rect') {
      postToScreen(o.frames.get(m.file), o.origin, { type: 'select-clear' })
      return true
    }
    if (m.type !== 'select') return false
    pick(m)
    return true
  }
  /** The element a new rule hangs on; one made by a script (no ggId, no anchor) leaves the whole page. */
  const pick = (el: Extract<BridgeMessage, { type: 'select' }>) => {
    const s = o.screens.find((x) => x.file === el.file)
    if (!s) return
    const anchor = ArtifactAnchor.safeParse(el.anchor).success ? (el.anchor as string) : null
    const usable = !!el.ggId || !!anchor
    if (s.id !== screenId) {
      setScreenId(s.id)
      setSelected(null)
    }
    setAdding({
      screenId: s.id,
      picked: true,
      scriptMade: !usable,
      target: usable ? { label: defaultLabel(el), file: el.file, ggId: el.ggId, anchor, tag: el.tag } : null,
      rect: usable ? inDocument(el.rect, o.scrolls[el.file] ?? NO_SCROLL) : null,
    })
  }
  /** 添加规则 on an element picked with direct edit: straight to the new rule. */
  const addFor = (el: { screenId: string } & Extract<BridgeMessage, { type: 'select' }>) => {
    open(el.screenId)
    pick(el)
  }

  const create = async (label: string, text: string, pending: boolean) => {
    if (!adding || !screen) return false
    const target = adding.target && { ...adding.target, label: label.trim() || adding.target.label }
    const taken = [
      ...(anchors[screen.file] ?? []).map((a) => a.anchor),
      ...(page?.rules ?? []).flatMap((r) => (r.anchor ? [r.anchor] : [])),
    ]
    const romanize = target && !target.anchor && target.ggId ? await loadRomanizer() : undefined
    const ops = addRuleOps({
      screenId: screen.id,
      title: page?.title ?? `${screen.title} · 页面规则`,
      rules: page?.rules ?? [],
      target,
      text,
      pending,
      taken,
      romanize,
    })
    const ok = await o.save(ops)
    if (ok) {
      setAdding(null)
      setSelected(page?.rules.length ?? 0)
    }
    return ok
  }

  const badge = (n: CanvasNode): ReactNode =>
    show ? (
      <RulesBadge
        rules={data.pages[n.id]?.rules}
        testId={`art-rules-badge-${n.id}`}
        onClick={() => open(n.id)}
      />
    ) : null

  /** The numbered marks on the screens (and the new rule's), over the canvas at the current pan and zoom. */
  const marks = (view: View, nodes: CanvasNode[]): ReactNode => {
    const showMarks = show && view.z >= 0.35
    if (!showMarks && !adding) return null
    const pageAt = (n: CanvasNode, k: number) => ({
      left: view.x + n.x * view.z + 6 + k * PAGE_MARK_STEP,
      top: view.y + n.y * view.z + 6,
    })
    const out: ReactNode[] = []
    for (const n of nodes) {
      if (n.kind !== 'screen') continue
      const rules = showMarks ? (data.pages[n.id]?.rules ?? []) : []
      let k = 0
      const onAnchor = new Map<string, number>()
      const place = (rect: Rect, shift = 0) => {
        const at = scrolledBy(rect, o.scrolls[n.file] ?? NO_SCROLL)
        if (at.y + at.h < 0 || at.y > n.h) return null
        const b = elementBox(n, at, view)
        return { left: b.left + b.width + shift * SAME_ANCHOR_STEP, top: b.top }
      }
      for (const [i, r] of rules.entries()) {
        const spot = spotOf(n.file, r.anchor)
        // Not showing (not displayed, out of a scrolling row, or gone): no mark, rather than one in the wrong place.
        if (r.anchor && (!spot || spot.hidden)) continue
        let at: { left: number; top: number } | null
        if (spot && r.anchor) {
          const shift = onAnchor.get(r.anchor) ?? 0
          onAnchor.set(r.anchor, shift + 1)
          at = place(spot.rect, shift)
        } else at = pageAt(n, k++)
        if (!at) continue
        out.push(
          <button
            key={`${n.id}:${i}`}
            type="button"
            className={cx(
              'art-rule-mark',
              !spot && 'art-rule-mark--page',
              r.pending && 'art-rule-mark--pending',
              screenId === n.id && selected === i && 'art-rule-mark--on',
            )}
            data-testid={`art-rule-mark-${n.id}-${i + 1}`}
            title={r.text}
            style={at}
            onClick={() => open(n.id, i)}
          >
            {i + 1}
          </button>,
        )
      }
      if (adding?.picked && adding.screenId === n.id) {
        const at = adding.rect ? place(adding.rect) : pageAt(n, k++)
        if (at)
          out.push(
            <span
              key={`${n.id}:new`}
              className={cx('art-rule-mark', 'art-rule-mark--draft', !adding.rect && 'art-rule-mark--page')}
              data-testid="art-rule-draft"
              style={at}
            >
              {(data.pages[n.id]?.rules.length ?? 0) + 1}
            </span>,
          )
      }
    }
    return out.length ? <div className="art-rule-marks">{out}</div> : null
  }

  const banner = adding ? (
    <div className="art-rule-pick" role="status" aria-label={t('选取元素')}>
      {t('点击页面元素挂规则，或')}
      <button type="button" onClick={wholePage}>
        {t('挂到整页')}
      </button>
      <span aria-hidden="true">·</span>
      {t('Esc 取消')}
    </div>
  ) : null

  const saveRef = useRef(o.save)
  saveRef.current = o.save
  const pagesRef = useRef(data.pages)
  pagesRef.current = data.pages
  const hint = o.bot ? offlineHint(o.bot) : t('暂无可用 Bot')
  const panel =
    o.panel === 'shared' ? (
      <SharedRulesPanel
        md={data.shared}
        refs={refs}
        canEdit={o.canEdit}
        editing={sharedEditing}
        focus={sharedAt}
        onSave={(md) => o.save([{ kind: 'file', path: SHARED_RULES_FILE, content: md }])}
        onRef={(r: SharedRef) => open(r.screenId, r.n - 1)}
        onClose={() => o.setPanel(null)}
      />
    ) : null

  /** The shared rules node's content; it shows with the file, or empty for an editor to start one. */
  const node = (
    <SharedRulesNode
      md={data.shared}
      canEdit={o.canEdit}
      onOpen={() => openShared()}
      onCreate={createShared}
    />
  )

  /** One page's rules for its 页面文档: the list as the marks number it, editing, adding and AI 补全. */
  const pageRules = (sid: string) => ({
    page: data.pages[sid] ?? null,
    selected: screenId === sid ? selected : null,
    select: (i: number) => {
      setScreenId(sid)
      selectRule(sid, i)
    },
    adding: adding?.screenId === sid ? adding : null,
    add: () => {
      setScreenId(sid)
      setSelected(null)
      setAdding({ screenId: sid, picked: false, target: null, scriptMade: false, rect: null })
    },
    create,
    cancelAdd: () => setAdding(null),
    saveMd: (md: string) => o.save([{ kind: 'file', path: `rules/${sid}.md`, content: md }]),
    complete: () => void o.complete(sid),
    ai: o.bot ? (offlineHint(o.bot) ?? null) : hint,
    gone: (i: number) => {
      const file = o.screens.find((x) => x.id === sid)?.file
      const r = data.pages[sid]?.rules[i]
      return !!file && !!r?.anchor && !!anchors[file] && !spotOf(file, r.anchor)
    },
    openShared: (id: string) => openShared(id),
  })

  return {
    data,
    pageRules,
    show,
    toggle,
    picking,
    /** The bridge mode the screens should be in (a screen that loads while picking gets the picking mode). */
    modeFor: (mode: BridgeMode): BridgeMode => (picking ? 'mark' : mode),
    /** With the file, or empty for an editor once the artifact has page rules (it would only clutter one without). */
    hasSharedNode: data.shared !== null || (o.canEdit && Object.keys(data.pages).length > 0),
    open,
    openShared,
    addFor,
    onBridge,
    badge,
    marks,
    banner,
    panel,
    node,
  }
}
