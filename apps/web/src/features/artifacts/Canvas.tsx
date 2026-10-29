import type {
  AnnotationDto,
  ArtifactCommand,
  ArtifactCommandReq,
  ArtifactDevice,
  ArtifactEditOp,
  BridgeFromShell,
  BridgeLinkRect,
  BridgeMode,
  GgArtifactManifest,
} from '@gonggong/protocol'
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { attempt, toastError } from '../../lib/errors'
import {
  ConfirmActionDialog,
  ContextMenu,
  hasOpenOverlay,
  Icon,
  IconButton,
  type IconName,
  MenuButton,
  type MenuItem,
  overlayMark,
  Presence,
  Skeleton,
  Tooltip,
} from '../../ui'
import { openUrl } from '../previews/store'
import { AnnotationsPanel } from './AnnotationsPanel'
import {
  createAnnotation,
  deleteAnnotation,
  handedTo,
  offlineHint,
  saveEdits,
  sendAnnotations,
  sendCommand,
  updateAnnotation,
  useAnnotations,
  useArtifactBot,
  useOpenElsewhere,
} from './actions'
import { linkSpots, postToScreen, useBridge } from './bridge'
import { CodeDialog } from './CodeDialog'
import { dropSelectionContext, elementItem, pinContext, screenItem, setSelectionContext } from './context'
import { DesignSystemNode } from './DesignSystemNode'
import { ElementPanel } from './ElementPanel'
import { EditPopover, MarkPopover, TOOLS } from './ElementPopover'
import { ExportPanel } from './ExportPanel'
import { elementBox, elementLabel, type PickedElement } from './elements'
import {
  boundsKey,
  type CanvasNode,
  type Direction,
  defaultFrame,
  dropIndex,
  FRAME_PRESETS,
  type FramePreset,
  fitView,
  framePreset,
  layoutNodes,
  neighbour,
  onScreen,
  revealView,
  type ScreenFrame,
  SYSTEM_HEIGHT,
  TITLE_ROOM,
  type View,
  ZOOM_STEP,
  zoomAt,
} from './geometry'
import { Links, linkPaths } from './Links'
import {
  type BotState,
  CMD,
  canvasContextItems,
  generateItems,
  modifyItems,
  moreItems,
  previewItems,
  screenContextItems,
  VARIATION_CUSTOM,
  VARIATION_DIMENSIONS,
  ZOOM_100,
  ZOOM_FIT,
  ZOOM_IN,
  ZOOM_OUT,
  ZOOM_SELECTION,
  zoomItems,
} from './menus'
import { ShortcutsDialog } from './ShortcutsDialog'
import { DetailsPanel, FavouritesPanel } from './SidePanel'
import { QrDialog, useShareAccess } from './share'
import type { ArtifactLink } from './store'
import type { DesignTokens } from './tokens'
import { VariationsDialog } from './VariationsDialog'

type Tool = 'select' | 'hand' | 'mark' | 'edit'
type Panel = 'details' | 'favourites' | 'design' | 'element' | 'annotations' | 'export'

/** Room (px) an open side panel takes at the right, with the tools: its width plus its 60px offset. */
const PANEL_SIDE = 360
const WIDE_PANEL_SIDE = 420
/** Below this much width the selection toolbar shows icons only (labels move into tooltips). */
const FLOAT_FULL = 380
const FLOAT_FULL_WITH_BOT = 500

/** Below this zoom node titles show their icon only. */
const TINY_ZOOM = 0.15
/** A title is at most as wide as its node on screen, but keeps room for its icon. */
const TITLE_MIN = 26

/** Pointer travel (px) after which a press pans instead of clicking. */
const DRAG = 4
/** Arrow keys move the view this far (px), ⇧ ten times as far. */
const NUDGE = 40

export interface CanvasProps {
  artifactId: string
  groupId: string
  /** The artifact's own bot (ArtifactDto.botId): AI instructions go to it by default. */
  botId: string | null
  title: string
  manifest: GgArtifactManifest | null | undefined
  /** The shown version's tokens.css, parsed; null when it has none. */
  tokens: DesignTokens | null
  links: ArtifactLink[]
  favourites: string[]
  /** The preview serving the screens; null while it opens. */
  preview: { previewId: string; origin: string } | null
  /** Changes when the shown version does, so frames reload. */
  versionKey: string
  /** No edits: a run is working on the artifact, or a past version is shown. */
  readOnly: boolean
  undo: (() => void) | null
  redo: (() => void) | null
  /** One new version from `ops`; rejects with the server's reason. */
  onEdit: (ops: ArtifactEditOp[]) => Promise<void>
  onFavourites: (screenIds: string[]) => void
  onPresent: () => void
  readFile: (file: string) => Promise<string>
  /** The design-system panel (DesignSystemPanel.tsx); `close` hides it. */
  designPanel: (close: () => void) => ReactNode
  /** Leaving the design-system panel goes through this (it asks first when there are unsaved changes). */
  guardDesign: (proceed: () => void) => void
  /** The artifact's versions, to name the ones with open annotations. */
  versions: { id: string; n: number }[]
  /** Shows a version (read-only unless it is the head). */
  onViewVersion: (versionId: string) => void
  /** Bumped by the tab's 导出 button: opens the export panel. */
  exportRequest: number
  /** Instant Prototype was handed to the bot: the tab opens the prototype editor once its run ends. */
  onPrototypeAsked: () => void
}

const deviceIcon = (d: ArtifactDevice): IconName => (d === 'desktop' ? 'desktop' : 'smartphone')

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

const bridgeMode = (tool: Tool): BridgeMode => (tool === 'mark' || tool === 'edit' ? tool : 'preview')

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const manifestOp = (
  op: 'rename' | 'duplicate' | 'delete' | 'reorder',
  screenId: string,
  extra: { title?: string; index?: number } = {},
): ArtifactEditOp => ({ kind: 'manifest', op, screenId, ...extra })

/**
 * The artifact canvas (Stitch capability list §3–§4, §9): the design system, the screens and the prototype side by
 * side on a dotted plane that pans and zooms. With the select and hand tools the canvas keeps the pointer; with mark
 * and direct edit the screens get it and talk back over the bridge.
 */
export function Canvas({
  artifactId,
  groupId,
  botId,
  title,
  manifest,
  tokens,
  links,
  favourites,
  preview,
  versionKey,
  readOnly,
  undo,
  redo,
  onEdit,
  onFavourites,
  onPresent,
  readFile,
  designPanel,
  guardDesign,
  exportRequest,
  onPrototypeAsked,
  versions,
  onViewVersion,
}: CanvasProps) {
  const root = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const frameEls = useRef(new Map<string, HTMLIFrameElement>()).current
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ x: 64, y: 64 + TITLE_ROOM, z: 1 })
  const [tool, setTool] = useState<Tool>('select')
  const [space, setSpace] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [help, setHelp] = useState(false)
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [dragging, setDragging] = useState(false)
  const [frames, setFrames] = useState<Record<string, ScreenFrame>>({})
  const [content, setContent] = useState<Record<string, number>>({})
  const [systemH, setSystemH] = useState(SYSTEM_HEIGHT)
  const [allLinks, setAllLinks] = useState(false)
  const setPanel = (next: SetStateAction<Panel | null>) => {
    const p = typeof next === 'function' ? next(panel) : next
    if (panel === 'design' && p !== 'design') guardDesign(() => setPanelNow(p))
    else setPanelNow(p)
  }
  const [code, setCode] = useState<CanvasNode | null>(null)
  const [removing, setRemoving] = useState<string[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [clip, setClip] = useState<{ ids: string[]; cut: boolean } | null>(null)
  const [moving, setMoving] = useState<{ id: string; x: number; y: number; dx: number; dy: number } | null>(
    null,
  )
  const [ctxOnScreen, setCtxOnScreen] = useState(false)
  /** The element a screen reported clicked with mark or direct edit; `pop` shows its popover. */
  const [element, setElement] = useState<PickedElement | null>(null)
  const [pop, setPop] = useState(false)
  const [deleting, setDeleting] = useState<PickedElement | null>(null)
  const [variations, setVariations] = useState(false)
  /** Show QR Code: the screen whose share link it shows. */
  const [qr, setQr] = useState<string | null>(null)
  /** Where each screen's link elements are (by file), as the screens report them. */
  const [spots, setSpots] = useState<Record<string, BridgeLinkRect[]>>({})
  const { bots, bot, pick: pickBot } = useArtifactBot(groupId, botId)
  const shareDenied = useShareAccess(groupId, botId)
  const botState: BotState = bot ? offlineHint(bot) : 'none'
  const annotations = useAnnotations(artifactId, versionKey || null)
  const [panel, setPanelNow] = useState<Panel | null>(null)
  const openElsewhere = useOpenElsewhere(
    artifactId,
    versionKey || null,
    panel === 'annotations' && !annotations.list.length,
    annotations.tick,
  )
  const elsewhere = versions
    .filter((v) => openElsewhere[v.id])
    .map((v) => ({ versionId: v.id, n: v.n, count: openElsewhere[v.id] ?? 0 }))
    .sort((a, b) => b.n - a.n)
  const meId = useSession((s) => s.user?.id ?? null)
  const press = useRef<{ id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  )
  /** Until the member moves the view or selects, the view follows the layout as it grows and settles. */
  const auto = useRef(true)
  /** Overlays opened after this (menus over the canvas) take Escape before the canvas does. */
  const escapeFrom = useRef(0)
  const panning = tool === 'hand' || space
  const live = tool === 'mark' || tool === 'edit'
  const canEdit = !readOnly && !!manifest

  const { device, nodes } = useMemo(
    () => layoutNodes({ title, manifest, system: tokens ? systemH : null, frames, content }),
    [title, manifest, tokens, systemH, frames, content],
  )
  const screens = useMemo(() => nodes.filter((n) => n.kind === 'screen'), [nodes])
  const picked = screens.filter((n) => selected.includes(n.id))
  const one = picked.length === 1 ? picked[0] : undefined
  const frameOf = (n: CanvasNode) => frames[n.id] ?? defaultFrame(device)
  const sharedFrame = picked.length
    ? picked
        .map(frameOf)
        .reduce<ScreenFrame | null>(
          (a, f) => (a && a.w === f.w && a.h === f.h && a.full === f.full ? a : null),
          frameOf(picked[0] as CanvasNode),
        )
    : null

  useEffect(() => {
    const el = plane.current
    if (!el) return
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** What the open side panel takes of the canvas's right edge (with the tools); popovers and the toolbar avoid it. */
  const side = (panel === 'element' ? !!element && tool === 'edit' : panel === 'details' ? !!one : !!panel)
    ? panel === 'design'
      ? WIDE_PANEL_SIDE
      : PANEL_SIDE
    : 0
  const fitTo = (only?: string[]) => {
    auto.current = false
    const v = fitView(only ? nodes.filter((n) => only.includes(n.id)) : nodes, room, Math.max(side, TOOLS))
    if (v) setView(v)
  }
  // Fit whenever the layout's bounds or the plane's size change, until the member takes over the view.
  const bounds = boundsKey(nodes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on new bounds or a new plane size only
  useEffect(() => {
    if (!auto.current || !room.width) return
    const v = fitView(nodes, room, Math.max(side, TOOLS))
    if (v) setView(v)
  }, [bounds, room.width, room.height])
  useEffect(() => {
    if (selected.length) auto.current = false
  }, [selected])
  /** The member moves the view: no more fitting to the layout. */
  const moveView = (next: SetStateAction<View>) => {
    auto.current = false
    setView(next)
  }
  // Screens gone from the manifest leave the selection.
  useEffect(() => setSelected((s) => s.filter((id) => nodes.some((n) => n.id === id))), [nodes])

  // React's wheel listener is passive; zooming must keep the page from scrolling or zooming itself.
  useEffect(() => {
    const el = plane.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      // ctrlKey is also how trackpads report a pinch.
      auto.current = false
      if (e.ctrlKey || e.metaKey)
        setView((v) => zoomAt(v, v.z * Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top))
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  // The design-system card is as tall as its content.
  const measureSystem = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight) setSystemH(el.offsetHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── bridge ──
  const origin = preview?.origin ?? null
  const fromScreen = (m: BridgeFromShell) => {
    if (m.type === 'ready') {
      const f = frameEls.get(m.file)
      postToScreen(f, origin, { type: 'mode', mode: bridgeMode(tool) })
      if (tool === 'mark') postToScreen(f, origin, { type: 'highlight', ggIds: markedIn(m.file) })
    }
    if (m.type === 'ready' || m.type === 'size') {
      const h = m.height
      if (h) setContent((c) => (c[m.file] === h ? c : { ...c, [m.file]: h }))
      const found = linkSpots(m.links)
      if (found) setSpots((s) => ({ ...s, [m.file]: found }))
    } else if (m.type === 'select') {
      const s = screens.find((n) => n.file === m.file)
      if (!s) return
      setSelected([s.id])
      if (!live) return
      setElement({ ...m, screenId: s.id, screenTitle: s.title })
      // With the element panel open, a click just moves the panel to the new element.
      setPop(!(panel === 'element' && tool === 'edit'))
    }
  }
  useBridge(origin, frameEls, fromScreen)
  useEffect(() => {
    for (const f of frameEls.values()) postToScreen(f, origin, { type: 'mode', mode: bridgeMode(tool) })
    setElement(null)
  }, [tool, origin, frameEls])
  // Element positions belong to one version.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a version change only
  useEffect(() => {
    setElement(null)
    setDeleting(null)
  }, [versionKey])
  // With the mark tool the annotated elements are outlined in their screens; leaving it clears them.
  const markedIn = (file: string) =>
    annotations.list.flatMap((a) => (a.file === file && a.ggId ? [a.ggId] : []))
  const outlined = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: markedIn reads annotations.list
  useEffect(() => {
    if (tool !== 'mark' && !outlined.current) return
    outlined.current = tool === 'mark'
    for (const [file, f] of frameEls)
      postToScreen(f, origin, { type: 'highlight', ggIds: tool === 'mark' ? markedIn(file) : [] })
  }, [tool, origin, frameEls, annotations.list])
  const dropElement = () => {
    if (element) postToScreen(frameEls.get(element.file), origin, { type: 'select-clear' })
    setElement(null)
    setPop(false)
    if (panel === 'element') setPanel(null)
  }

  // ── selection as chat context (Stitch's Add to Chat) ──
  const contextBase = { groupId, artifactId, title, botId }
  const selectionItems = () =>
    element?.ggId
      ? [
          elementItem(element.screenId, element.screenTitle, {
            file: element.file,
            ggId: element.ggId,
            label: elementLabel(element),
          }),
        ]
      : picked.map((n) => screenItem(n.id, n.title))
  const selectionKey = `${selected.join(',')}|${element?.file ?? ''}#${element?.ggId ?? ''}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the selection, by its key
  useEffect(() => {
    if (manifest) setSelectionContext(contextBase, selectionItems())
  }, [selectionKey, manifest])
  useEffect(() => () => dropSelectionContext(artifactId), [artifactId])
  // A request made before this canvas mounted (it was away for the prototype editor) is not a new one.
  const exportSeen = useRef(exportRequest)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new request only
  useEffect(() => {
    if (exportRequest === exportSeen.current) return
    exportSeen.current = exportRequest
    setPanel('export')
    // The tab's button keeps the focus otherwise, outside the canvas: its shortcuts (? and all) would stop working.
    root.current?.focus({ preventScroll: true })
  }, [exportRequest])

  // ── AI commands (Stitch's Generate and Variations menus) ──
  /** About the selected screens, or with `ggIds` about elements only. */
  const ask = (command: ArtifactCommand, extra: Partial<ArtifactCommandReq> = {}) => {
    if (!bot) return Promise.resolve(false)
    const req: ArtifactCommandReq = {
      command,
      botId: bot.id,
      ...(manifest && picked.length && !extra.ggIds ? { screenIds: picked.map((n) => n.id) } : {}),
      ...extra,
    }
    return sendCommand(artifactId, req, bot).then((ok) => {
      if (ok && command === 'instant-prototype') onPrototypeAsked()
      return ok
    })
  }
  const askAboutElement = (command: ArtifactCommand, el: PickedElement, text: string) =>
    el.ggId ? ask(command, { ggIds: [{ file: el.file, ggId: el.ggId }], text }) : Promise.resolve(false)
  const saveOps = (ops: ArtifactEditOp[]) => saveEdits(onEdit, ops)
  const annotate = async (el: PickedElement, note: string) => {
    try {
      await createAnnotation(artifactId, {
        versionId: versionKey,
        file: el.file,
        ggId: el.ggId,
        selector: el.selector.slice(0, 500),
        rect: el.rect,
        snippet: (el.snippet || `<${el.tag}> ${el.text}`).slice(0, 2000),
        note,
      })
      annotations.reload()
      dropElement()
      return true
    } catch (e) {
      toastError(e)
      return false
    }
  }
  const annotationAction = (f: () => Promise<unknown>) => void attempt(f).then(() => annotations.reload())

  // ── commands ──
  const edit = (ops: ArtifactEditOp[]) => {
    if (canEdit && ops.length) void attempt(() => onEdit(ops))
  }
  const toggleFavourite = () => {
    if (!picked.length) return
    const ids = picked.map((n) => n.id)
    const all = ids.every((id) => favourites.includes(id))
    onFavourites(all ? favourites.filter((id) => !ids.includes(id)) : [...new Set([...favourites, ...ids])])
  }
  const reframe = (f: (old: ScreenFrame) => ScreenFrame) =>
    setFrames((fs) => ({
      ...fs,
      ...Object.fromEntries(picked.map((n) => [n.id, f(fs[n.id] ?? defaultFrame(device))])),
    }))
  const paste = () => {
    if (!clip || !canEdit) return
    const present = clip.ids.filter((id) => screens.some((s) => s.id === id))
    if (!clip.cut) return edit(present.map((id) => manifestOp('duplicate', id)))
    // A cut screen moves to after the selected one (or to the end).
    const anchor = one && !present.includes(one.id) ? one.id : null
    const rest = screens.filter((s) => !present.includes(s.id))
    let at = anchor ? rest.findIndex((s) => s.id === anchor) + 1 : rest.length
    edit(present.map((id) => manifestOp('reorder', id, { index: at++ })))
    setClip(null)
  }
  const go = (dir: Direction) => {
    const from = one ?? screens[0]
    const next = from && neighbour(screens, from, dir)
    if (!next) return
    setSelected([next.id])
    fitTo([next.id])
  }

  const command = (value: string) => {
    const ids = picked.map((n) => n.id)
    if (value.startsWith(CMD.generate)) {
      if (picked.length) void ask(value.slice(CMD.generate.length) as ArtifactCommand)
      return
    }
    if (value.startsWith(CMD.variations)) {
      const k = value.slice(CMD.variations.length)
      const d = VARIATION_DIMENSIONS[k]
      if (!picked.length || !bot) return
      if (k === VARIATION_CUSTOM) setVariations(true)
      else if (d) void ask('variations', { count: 3, text: `维度：${d.ai}` })
      return
    }
    if (value.startsWith(CMD.frame)) {
      const name = value.slice(CMD.frame.length) as FramePreset
      if (name in FRAME_PRESETS) {
        const p = framePreset(name, device)
        reframe((f) => ({ ...f, w: p.w, h: p.h }))
      }
      return
    }
    switch (value) {
      case CMD.newTab:
        // An L1 artifact opens in its shell's presentation, in the device frame (as the prototype editor does).
        if (one && preview)
          window.open(
            manifest
              ? `${openUrl(preview.previewId, '/')}#play:${one.id}`
              : openUrl(preview.previewId, `/${one.file}`),
            '_blank',
            'noopener',
          )
        return
      case CMD.edit:
        if (canEdit) setTool('edit')
        return
      case CMD.qr:
        return setQr(one?.id ?? manifest?.entry ?? '')
      case CMD.export:
        return setPanel('export')
      case CMD.designSystem:
        return setPanel('design')
      case CMD.details:
        if (one) setPanel('details')
        return
      case CMD.code:
        if (one) setCode(one)
        return
      case CMD.download:
        for (const n of picked)
          void attempt(async () => saveFile(n.file.split('/').pop() ?? n.file, await readFile(n.file)))
        return
      case CMD.reload:
        return setReloads((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, (r[id] ?? 0) + 1])) }))
      case CMD.remove:
        if (canEdit && ids.length) setRemoving(ids)
        return
      case CMD.copy:
        if (ids.length) setClip({ ids, cut: false })
        return
      case CMD.cut:
        if (canEdit && ids.length) setClip({ ids, cut: true })
        return
      case CMD.paste:
        return paste()
      case CMD.duplicate:
        return edit(ids.map((id) => manifestOp('duplicate', id)))
      case CMD.focus:
        if (selected.length) fitTo(selected)
        return
      case CMD.favourite:
        return toggleFavourite()
      case CMD.rename:
        if (canEdit && one) setRenaming(one.id)
        return
      case CMD.links:
        return setAllLinks((on) => !on)
      case CMD.addToChat:
        if (manifest && (picked.length || element)) pinContext(contextBase, selectionItems())
        return
      case CMD.selectAll:
        return setSelected(nodes.map((n) => n.id))
      case CMD.fit:
        return fitTo()
      case CMD.fullHeight: {
        const full = !picked.every((n) => frameOf(n).full)
        return reframe((f) => ({ ...f, full }))
      }
    }
  }

  const zoom = (value: string) => {
    const cx = room.width / 2
    const cy = room.height / 2
    if (value === ZOOM_IN) moveView((v) => zoomAt(v, v.z * ZOOM_STEP, cx, cy))
    else if (value === ZOOM_OUT) moveView((v) => zoomAt(v, v.z / ZOOM_STEP, cx, cy))
    else if (value === ZOOM_100) moveView((v) => zoomAt(v, 1, cx, cy))
    else if (value === ZOOM_FIT) fitTo()
    else if (value === ZOOM_SELECTION && selected.length) fitTo(selected)
  }

  const ARROWS: Record<string, Direction> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  }
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed in a field, or in a dialog portalled out of the canvas, are not shortcuts.
    if (editable(e.target) || !root.current?.contains(e.target as Node)) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const arrow = ARROWS[e.key]
    const run = (f: () => void) => {
      e.preventDefault()
      f()
    }
    if (mod) {
      if (key === '=' || key === '+') run(() => zoom(ZOOM_IN))
      else if (key === '-') run(() => zoom(ZOOM_OUT))
      else if (key === 'a') run(() => command(CMD.selectAll))
      else if (key === 'z') run(() => (e.shiftKey ? redo : undo)?.())
      else if (key === 'c' && !e.shiftKey) run(() => command(CMD.copy))
      else if (key === 'x') run(() => command(CMD.cut))
      else if (key === 'v') run(() => command(CMD.paste))
      else if (key === 'd') run(() => command(CMD.duplicate))
      else if (key === 'r') run(() => command(CMD.reload))
      else if (key === 'l') run(() => command(CMD.addToChat))
      else if (key === 'e' && e.shiftKey) run(() => command(CMD.export))
      else if (arrow) run(() => go(arrow))
      return
    }
    if (e.key === '?') return run(() => setHelp(true))
    if (e.shiftKey) {
      if (e.code === 'Digit0') run(() => zoom(ZOOM_100))
      else if (e.code === 'Digit1') run(() => zoom(ZOOM_FIT))
      else if (e.code === 'Digit2') run(() => zoom(ZOOM_SELECTION))
      else if (key === 'f') run(() => command(CMD.favourite))
      else if (key === 'd') run(() => command(CMD.download))
      else if (key === 'c') run(() => command(CMD.code))
      else if (key === 'p') run(() => command(CMD.newTab))
      else if (key === 'v') run(() => command(`${CMD.variations}${VARIATION_CUSTOM}`))
      else if (key === 'r') run(() => command(`${CMD.generate}regenerate`))
      else if (arrow) run(() => pan(arrow, NUDGE * 10))
      return
    }
    // A menu or popover over the canvas takes Escape (the shared overlay stack closes it), and only it.
    if (e.key === 'Escape' && hasOpenOverlay(escapeFrom.current)) return
    if (arrow) run(() => pan(arrow, NUDGE))
    else if (e.key === 'Escape' && element) run(dropElement)
    else if (e.key === 'Escape' && (selected.length || panel))
      run(() => (selected.length ? setSelected([]) : setPanel(null)))
    else if (e.key === ' ') run(() => setSpace(true))
    else if (e.key === 'Delete' || e.key === 'Backspace') run(() => command(CMD.remove))
    else if (key === 'v') run(() => setTool('select'))
    else if (key === 'h') run(() => setTool('hand'))
    else if (key === 'm') run(() => setTool('mark'))
    else if (key === 'e') run(() => command(CMD.edit))
    else if (key === 'f') run(() => command(CMD.focus))
    else if (key === 'i') run(() => command(CMD.details))
    else if (key === 'x') run(() => command(CMD.links))
  }
  const pan = (dir: Direction, by: number) =>
    moveView((v) => ({
      ...v,
      x: v.x + (dir === 'left' ? by : dir === 'right' ? -by : 0),
      y: v.y + (dir === 'up' ? by : dir === 'down' ? -by : 0),
    }))

  // ── pointer ──
  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    root.current?.focus({ preventScroll: true })
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
  }
  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (p?.id !== e.pointerId) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.moved) {
      if (Math.hypot(dx, dy) < DRAG) return
      // Captured only once it pans, so a plain click still lands on the screen under it.
      p.moved = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setDragging(true)
    }
    moveView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }))
  }
  const pointerUp = () => {
    setDragging(false)
    // The click that follows a pan is not a selection.
    setTimeout(() => {
      press.current = null
    })
  }
  const panned = () => !!press.current?.moved

  const pick = (id: string, shift: boolean) => {
    if (panned() || panning) return
    setSelected((s) => (shift ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))
  }
  const clickPlane = (shift: boolean) => {
    if (panned() || panning || shift) return
    setSelected([])
  }
  const open = (n: CanvasNode) => {
    if (n.kind === 'prototype') onPresent()
    else if (n.kind === 'system') setPanel('design')
    else fitTo([n.id])
  }

  // Dragging a screen by its title's grip reorders the screens (manifest `reorder`).
  const gripDown = (e: PointerEvent<HTMLSpanElement>, n: CanvasNode) => {
    if (!canEdit || n.kind !== 'screen' || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setMoving({ id: n.id, x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
  }
  const gripMove = (e: PointerEvent<HTMLSpanElement>) =>
    setMoving((m) => (m ? { ...m, dx: e.clientX - m.x, dy: e.clientY - m.y } : m))
  const gripUp = () => {
    const m = moving
    setMoving(null)
    const n = m && screens.find((s) => s.id === m.id)
    if (!m || !n || Math.hypot(m.dx, m.dy) < DRAG) return
    const index = dropIndex(screens, n.id, n.x + n.w / 2 + m.dx / view.z, n.y + m.dy / view.z)
    if (index !== screens.indexOf(n)) edit([manifestOp('reorder', n.id, { index })])
  }

  const src = (n: CanvasNode) => (preview ? openUrl(preview.previewId, `/${n.file}`) : null)
  const shownLinks = allLinks
    ? links
    : links.filter((l) => picked.some((n) => n.id === l.from || n.id === l.to))
  const paths = linkPaths(nodes, shownLinks, view, spots)
  const favNodes = favourites
    .map((id) => screens.find((s) => s.id === id))
    .filter((n): n is CanvasNode => !!n)

  /** Zoomed out this far, titles show their icon only (the name in a tooltip) so they never run into each other. */
  const tiny = view.z < TINY_ZOOM
  /** Dot spacing on screen: sparser as the view zooms out, never a haze. */
  let dot = 24 * view.z
  while (dot < 12) dot *= 4

  const sidePanel =
    panel === 'element' && element && tool === 'edit' ? (
      <ElementPanel
        key={`${element.file}#${element.ggId}`}
        el={element}
        artifactId={artifactId}
        screens={screens}
        tokens={tokens}
        readOnly={!canEdit}
        onSave={saveOps}
        onClose={dropElement}
      />
    ) : panel === 'annotations' ? (
      <AnnotationsPanel
        list={annotations.list}
        meId={meId}
        screenTitle={(file) => screens.find((s) => s.file === file)?.title ?? file}
        bots={bots}
        bot={bot}
        onPickBot={pickBot}
        onSend={async (annotationIds, extra) => {
          if (!bot) return false
          const ok = await attempt(() =>
            sendAnnotations(artifactId, { annotationIds, botId: bot.id, ...(extra ? { extra } : {}) }),
          )
          if (ok) handedTo(bot)
          annotations.reload()
          return ok
        }}
        onStatus={(id, status) => annotationAction(() => updateAnnotation(id, { status }))}
        onDelete={(id) => annotationAction(() => deleteAnnotation(id))}
        onFocus={(a: AnnotationDto) => {
          const n = screens.find((s) => s.file === a.file)
          if (!n) return
          setSelected([n.id])
          fitTo([n.id])
          if (a.ggId) postToScreen(frameEls.get(a.file), origin, { type: 'scroll-to', ggId: a.ggId })
        }}
        elsewhere={elsewhere}
        onView={onViewVersion}
        onClose={() => setPanel(null)}
      />
    ) : panel === 'details' && one ? (
      <DetailsPanel
        artifactId={artifactId}
        versionId={versionKey}
        node={one}
        src={src(one)}
        prompt={manifest?.screens.find((s) => s.id === one.id)?.prompt}
        systemName={tokens ? tokens.name || t('设计系统') : null}
        onCode={() => setCode(one)}
        onDesignSystem={() => setPanel('design')}
        onClose={() => setPanel(null)}
      />
    ) : panel === 'favourites' ? (
      <FavouritesPanel
        screens={favNodes}
        onPick={(id) => {
          setSelected([id])
          fitTo([id])
        }}
        onClose={() => setPanel(null)}
      />
    ) : panel === 'design' ? (
      designPanel(() => setPanel(null))
    ) : panel === 'export' ? (
      <ExportPanel
        artifactId={artifactId}
        versionId={versionKey}
        screens={screens}
        selected={picked.map((n) => n.id)}
        bot={bot}
        shareDenied={shareDenied}
        readFile={readFile}
        onBrief={() =>
          bot
            ? sendCommand(artifactId, { command: 'project-brief', botId: bot.id }, bot)
            : Promise.resolve(false)
        }
        onClose={() => setPanel(null)}
      />
    ) : null
  const compactFloat =
    room.width > 0 && room.width - side - 24 < (bots.length > 1 ? FLOAT_FULL_WITH_BOT : FLOAT_FULL)
  /** Keyboard focus on an off-screen title pans the view to its node (the plane itself never scrolls). */
  const reveal = (n: CanvasNode) => {
    const v = revealView(n, view, { width: room.width - Math.max(side, TOOLS), height: room.height })
    if (v) moveView(v)
  }

  const contextItems: MenuItem[] =
    ctxOnScreen && picked.length
      ? screenContextItems({
          readOnly: !canEdit,
          single: !!one,
          canPaste: !!clip,
          favourite: picked.every((n) => favourites.includes(n.id)),
          showAllLinks: allLinks,
          frame: sharedFrame,
          bot: botState,
          device,
        })
      : canvasContextItems({ readOnly: !canEdit, canPaste: !!clip, showAllLinks: allLinks })

  return (
    <div
      ref={root}
      className="art-canvas"
      style={{ '--art-side': `${side}px` } as CSSProperties}
      role="application"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so its shortcuts work
      tabIndex={0}
      aria-label={t('画布')}
      onKeyDown={keyDown}
      onFocus={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) escapeFrom.current = overlayMark()
      }}
      onKeyUp={(e) => {
        if (e.key === ' ') setSpace(false)
      }}
      onBlur={() => setSpace(false)}
    >
      <ContextMenu items={contextItems} onSelect={command} className="art-ctx">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer panning; the keyboard pans with the arrows */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc clears the selection */}
        <div
          ref={plane}
          className={cx('art-plane', panning && 'art-plane--hand', dragging && 'art-plane--dragging')}
          data-testid="art-plane"
          style={{
            backgroundPosition: `${view.x}px ${view.y}px`,
            backgroundSize: `${dot}px ${dot}px`,
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onContextMenu={(e) => setCtxOnScreen(!!(e.target as Element).closest('.art-node--screen'))}
          onClick={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('art-world'))
              clickPlane(e.shiftKey)
          }}
        >
          <div
            className="art-world"
            style={{
              transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.z})`,
            }}
          >
            {nodes.map((n) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: ⌘A and the title buttons select from the keyboard
              // biome-ignore lint/a11y/noStaticElementInteractions: a node is picked by pointer; its title is the button
              <div
                key={n.id}
                className={cx('art-node', `art-node--${n.kind}`)}
                data-testid={`art-node-${n.id}`}
                style={{
                  left: n.x,
                  top: n.y,
                  width: n.w,
                  height: n.kind === 'system' ? undefined : n.h,
                  ...(moving?.id === n.id
                    ? { translate: `${moving.dx / view.z}px ${moving.dy / view.z}px`, zIndex: 1 }
                    : {}),
                }}
                onClick={(e) => pick(n.id, e.shiftKey)}
                onDoubleClick={() => open(n)}
                onContextMenu={() => {
                  if (!selected.includes(n.id)) setSelected([n.id])
                }}
                ref={n.kind === 'system' ? measureSystem : undefined}
              >
                {n.kind === 'system' && tokens ? (
                  <DesignSystemNode tokens={tokens} />
                ) : n.kind === 'prototype' ? (
                  <div className="art-proto">
                    <Icon name="play" size={28} />
                    <strong>{t('原型')}</strong>
                    <span>{t('双击打开')}</span>
                  </div>
                ) : src(n) ? (
                  <iframe
                    key={`${versionKey}:${reloads[n.id] ?? 0}`}
                    ref={(el) => {
                      if (el) frameEls.set(n.file, el)
                      else frameEls.delete(n.file)
                    }}
                    className={cx('art-node__frame', live && 'art-node__frame--live')}
                    title={n.title}
                    src={src(n) ?? undefined}
                    tabIndex={-1}
                  />
                ) : (
                  <Skeleton variant="block" count={1} width="100%" height="100%" />
                )}
              </div>
            ))}
          </div>
          <div className="art-overlay">
            <Links paths={paths} />
            {nodes.map((n) => {
              const r = onScreen(n, view)
              const on = selected.includes(n.id)
              const fav = favourites.includes(n.id)
              const label =
                n.kind === 'system'
                  ? [t('设计系统'), tokens?.name].filter(Boolean).join(' · ')
                  : n.kind === 'prototype'
                    ? `${t('原型')} · ${n.title}`
                    : n.title
              const icon: IconName =
                n.kind === 'system' ? 'palette' : n.kind === 'prototype' ? 'play' : deviceIcon(device)
              const shift = moving?.id === n.id ? moving : { dx: 0, dy: 0 }
              return (
                <div key={n.id}>
                  {renaming === n.id ? (
                    <RenameField
                      title={n.title}
                      style={{ left: r.left, top: r.top - 26, width: Math.max(r.width, 160) }}
                      onDone={(next) => {
                        setRenaming(null)
                        if (next && next !== n.title) edit([manifestOp('rename', n.id, { title: next })])
                        root.current?.focus({ preventScroll: true })
                      }}
                    />
                  ) : (
                    <div
                      className={cx(
                        'art-title',
                        on && 'art-title--on',
                        canEdit && n.kind === 'screen' && 'art-title--movable',
                        tiny && 'art-title--tiny',
                      )}
                      style={{
                        left: r.left + shift.dx,
                        top: r.top - 26 + shift.dy,
                        maxWidth: Math.max(r.width, TITLE_MIN),
                      }}
                    >
                      <span
                        className="art-title__icon"
                        data-testid={`art-grip-${n.id}`}
                        onPointerDown={(e) => gripDown(e, n)}
                        onPointerMove={gripMove}
                        onPointerUp={gripUp}
                        onPointerCancel={() => setMoving(null)}
                      >
                        <Icon name={icon} size={13} />
                        <svg
                          className="art-title__grip"
                          width="13"
                          height="13"
                          viewBox="0 0 13 13"
                          aria-hidden="true"
                        >
                          {[3, 6.5, 10].flatMap((y) => [
                            <circle key={`a${y}`} cx="4.5" cy={y} r="1.1" />,
                            <circle key={`b${y}`} cx="8.5" cy={y} r="1.1" />,
                          ])}
                        </svg>
                      </span>
                      <button
                        type="button"
                        className="art-title__name"
                        aria-pressed={on}
                        aria-label={label}
                        title={tiny ? label : undefined}
                        onFocus={() => reveal(n)}
                        onClick={(e) => pick(n.id, e.shiftKey)}
                        onDoubleClick={() => (n.kind === 'screen' && canEdit ? setRenaming(n.id) : open(n))}
                      >
                        {tiny ? <Icon name={icon} size={13} /> : <span>{label}</span>}
                      </button>
                      {fav ? (
                        <Icon name="star" size={11} className="art-title__fav" label={t('已收藏')} />
                      ) : null}
                    </div>
                  )}
                  {on ? (
                    <div
                      className="art-select"
                      data-testid={`art-select-${n.id}`}
                      style={{
                        left: r.left + shift.dx,
                        top: r.top + shift.dy,
                        width: r.width,
                        height: r.height,
                      }}
                    >
                      <i className="art-select__handle art-select__handle--nw" />
                      <i className="art-select__handle art-select__handle--ne" />
                      <i className="art-select__handle art-select__handle--sw" />
                      <i className="art-select__handle art-select__handle--se" />
                      <span className="art-select__size">{`${n.w} x ${n.h}`}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </ContextMenu>

      {picked.length ? (
        <div
          className={cx('art-float', compactFloat && 'art-float--compact')}
          role="toolbar"
          aria-label={t('所选屏幕')}
        >
          <FloatMenu
            icon="sparkle"
            label={t('生成')}
            compact={compactFloat}
            items={generateItems(botState)}
            onSelect={command}
          />
          <FloatMenu
            icon="pencil"
            label={t('修改#modify')}
            compact={compactFloat}
            items={modifyItems(!canEdit)}
            onSelect={command}
          />
          <FloatMenu
            icon="eye"
            label={t('预览')}
            compact={compactFloat}
            items={previewItems(!!one && !!preview, sharedFrame, device)}
            onSelect={command}
          />
          <FloatMenu
            icon="more"
            label={t('更多')}
            compact={compactFloat}
            items={moreItems(!canEdit)}
            onSelect={command}
          />
          {bots.length > 1 && bot ? (
            <FloatMenu
              icon="bot"
              label={`@${bot.name}`}
              compact={compactFloat}
              items={bots.map((b) => ({ label: `@${b.name}`, value: b.id, checked: b.id === bot.id }))}
              onSelect={pickBot}
            />
          ) : null}
        </div>
      ) : null}

      <div className="art-tools" role="toolbar" aria-orientation="vertical" aria-label={t('画布工具')}>
        <ToolButton
          icon="cursor"
          label={t('选择')}
          shortcut="V"
          on={tool === 'select'}
          onClick={() => setTool('select')}
        />
        <ToolButton
          icon="marquee"
          label={t('标记#mark')}
          shortcut="M"
          on={tool === 'mark'}
          onClick={() => setTool('mark')}
        />
        <ToolButton
          icon="pencil"
          label={t('直接编辑')}
          shortcut="E"
          on={tool === 'edit'}
          onClick={canEdit ? () => setTool('edit') : undefined}
        />
        <ToolButton
          icon="hand"
          label={t('抓手')}
          shortcut="H"
          on={tool === 'hand'}
          onClick={() => setTool('hand')}
        />
        <ToolButton icon="upload" label={t('上传到画布')} />
        <hr className="art-tools__sep" />
        <ToolButton
          icon="palette"
          label={t('设计系统')}
          on={panel === 'design'}
          onClick={() => setPanel((p) => (p === 'design' ? null : 'design'))}
        />
        <ToolButton
          icon="star"
          label={t('收藏')}
          on={panel === 'favourites'}
          onClick={() => setPanel((p) => (p === 'favourites' ? null : 'favourites'))}
        />
        <ToolButton
          icon="bubble"
          label={t('批注')}
          on={panel === 'annotations'}
          onClick={() => setPanel((p) => (p === 'annotations' ? null : 'annotations'))}
        />
      </div>

      {(tool === 'mark' || panel === 'annotations') && annotations.list.length ? (
        <div className="art-bubbles">
          {annotations.list.map((a, i) => {
            const n = screens.find((s) => s.file === a.file)
            if (!n) return null
            const b = elementBox(n, a.rect, view)
            return (
              <button
                key={a.id}
                type="button"
                className={cx('art-bubble', `art-bubble--${a.status}`)}
                data-testid={`art-bubble-${a.id}`}
                style={{ left: b.left + b.width, top: b.top }}
                title={`${a.authorName}：${a.note}`}
                onClick={() => setPanel('annotations')}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      ) : null}

      {element && pop
        ? (() => {
            const n = screens.find((s) => s.id === element.screenId)
            if (!n) return null
            const box = elementBox(n, element.rect, view)
            return tool === 'mark' ? (
              <MarkPopover
                key={`${element.file}#${element.selector}`}
                el={element}
                box={box}
                room={{ ...room, right: side }}
                onSave={(note) => annotate(element, note)}
                onClose={dropElement}
              />
            ) : (
              <EditPopover
                key={`${element.file}#${element.selector}`}
                el={element}
                box={box}
                room={{ ...room, right: side }}
                readOnly={!canEdit}
                bots={bots}
                bot={bot}
                onPickBot={pickBot}
                onText={(text) =>
                  element.ggId
                    ? saveOps([{ kind: 'text', file: element.file, ggId: element.ggId, text }])
                    : Promise.resolve(false)
                }
                onAi={(text) => askAboutElement('edit-with-ai', element, text)}
                onConnect={(text) => askAboutElement('connect-element', element, text)}
                onProps={() => {
                  setPop(false)
                  setPanel('element')
                }}
                onDelete={() => {
                  setPop(false)
                  setDeleting(element)
                }}
                onClose={dropElement}
              />
            )
          })()
        : null}

      {sidePanel}

      <div className="art-corner">
        <IconButton size="regular" title={t('撤销#undo')} disabled={!undo} onClick={() => undo?.()}>
          {'undo' as const}
        </IconButton>
        <IconButton size="regular" title={t('重做')} disabled={!redo} onClick={() => redo?.()}>
          {'redo' as const}
        </IconButton>
        <MenuButton
          className="ui-btn ui-btn--plain art-corner__zoom"
          aria-label={t('缩放')}
          title={t('缩放')}
          items={zoomItems(selected.length > 0)}
          onSelect={zoom}
          align="end"
          placement="above"
        >
          {`${Math.round(view.z * 100)}%`}
        </MenuButton>
        <IconButton size="regular" title={t('快捷键')} onClick={() => setHelp(true)}>
          <span className="art-corner__help">?</span>
        </IconButton>
      </div>

      <Presence>{help ? <ShortcutsDialog onClose={() => setHelp(false)} /> : null}</Presence>
      <Presence>
        {qr !== null ? (
          <QrDialog
            artifactId={artifactId}
            groupId={groupId}
            botId={botId}
            screen={qr || undefined}
            onClose={() => setQr(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {deleting?.ggId ? (
          <ConfirmActionDialog
            title={t('删除这个元素？')}
            message={`${deleting.screenTitle} › ${elementLabel(deleting)}`}
            consequences={[t('元素从源码中删除，生成一个新版本'), t('可以用撤销恢复')]}
            label={t('删除')}
            done={t('已删除')}
            run={() => onEdit([{ kind: 'delete', file: deleting.file, ggId: deleting.ggId as string }])}
            onDone={() => {
              setDeleting(null)
              dropElement()
            }}
            onClose={() => setDeleting(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {variations ? (
          <VariationsDialog
            screens={picked.map((n) => n.title)}
            bots={bots}
            bot={bot}
            onPickBot={pickBot}
            onSend={(text, count) => ask('variations', { count, text })}
            onClose={() => setVariations(false)}
          />
        ) : null}
      </Presence>
      <Presence>
        {code ? (
          <CodeDialog title={code.title} load={() => readFile(code.file)} onClose={() => setCode(null)} />
        ) : null}
      </Presence>
      <Presence>
        {removing ? (
          <ConfirmActionDialog
            title={t('删除 {n} 个屏幕？', { n: removing.length })}
            message={removing.map((id) => screens.find((s) => s.id === id)?.title ?? id).join('、')}
            consequences={[t('屏幕从产物中移除，生成一个新版本'), t('可以用撤销恢复')]}
            label={t('删除')}
            done={t('已删除')}
            run={() => onEdit(removing.map((id) => manifestOp('delete', id)))}
            onClose={() => {
              setRemoving(null)
              root.current?.focus({ preventScroll: true })
            }}
          />
        ) : null}
      </Presence>
    </div>
  )
}

/** The title's inline rename (Stitch's Rename): Enter saves, Esc or leaving cancels. */
function RenameField({
  title,
  style,
  onDone,
}: {
  title: string
  style: CSSProperties
  onDone: (title: string | null) => void
}) {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      className="art-title art-title__input"
      style={style}
      aria-label={t('重命名')}
      value={value}
      maxLength={80}
      // biome-ignore lint/a11y/noAutofocus: opened on purpose by Rename
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(value.trim() || null)
        else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={() => finish(null)}
    />
  )
}

/** A menu of the selection toolbar; `compact` (a narrow canvas) shows its icon only, the label in a tooltip. */
function FloatMenu({
  icon,
  label,
  compact,
  items,
  onSelect,
}: {
  icon: IconName
  label: string
  compact: boolean
  items: MenuItem[]
  onSelect: (value: string) => void
}) {
  const menu = (
    <MenuButton
      className="ui-btn ui-btn--plain ui-btn--small art-float__btn"
      aria-label={compact ? label : undefined}
      items={items}
      onSelect={onSelect}
    >
      <Icon name={icon} size={14} />
      {compact ? null : label}
      <Icon name="chevron-down" size={10} weight={2} />
    </MenuButton>
  )
  return compact ? (
    <Tooltip content={label} placement="bottom">
      {menu}
    </Tooltip>
  ) : (
    menu
  )
}

/** A tool of the right-hand toolbar; tools without `onClick` are not available (yet). */
function ToolButton({
  icon,
  label,
  shortcut,
  on,
  onClick,
}: {
  icon: IconName
  label: string
  shortcut?: string
  on?: boolean
  onClick?: () => void
}): ReactElement {
  return (
    <Tooltip
      content={onClick ? label : t('{name}（即将支持）', { name: label })}
      shortcut={shortcut}
      placement="left"
    >
      <button
        type="button"
        className="art-tools__btn"
        aria-label={label}
        aria-pressed={onClick ? !!on : undefined}
        disabled={!onClick}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
      </button>
    </Tooltip>
  )
}
