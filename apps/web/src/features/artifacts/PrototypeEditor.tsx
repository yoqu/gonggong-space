import type {
  ArtifactEditOp,
  ArtifactVersionDetail,
  BotDto,
  BridgeBackRect,
  BridgeLinkRect,
  BridgeMode,
  GgArtifactManifest,
  Rect,
} from '@gonggong/protocol'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, Icon, IconButton, MenuButton, Presence, SegmentedControl, Tooltip, toast } from '../../ui'
import { openUrl } from '../previews/store'
import { saveEdits, sendCommand, useArtifactBot } from './actions'
import { type BridgeMessage, linkSpots, postToScreen, useBridge } from './bridge'
import type { PickedElement } from './elements'
import { useTextEdit } from './inPlace'
import { capsuleOf } from './markLayout'
import { drawerHeight, usePreviewMarks } from './previewMarks'
import { useComposerClearance } from './previewNotes'
import { AskForm, ChangeBar, ConnectPanel, ElementMenu, isTransition } from './protoEditing'
import {
  DEVICE_ICON,
  DEVICE_LABEL,
  DeviceChrome,
  Hot,
  RailButton,
  ScreenThumbs,
  useDeviceZoom,
  useScreenSwap,
  useStageScroll,
  ZOOM_KEY_OF,
  ZOOM_KEYS,
  ZOOM_LABEL,
  ZOOMS,
  type Zoom,
} from './protoParts'
import {
  backRects,
  currentScreen,
  disconnectOps,
  enterClass,
  GUIDE_KEY,
  holds,
  linkHost,
  navReducer,
  notOurKey,
  type ProtoDevice,
  protoDevices,
  startNav,
} from './prototype'
import { useScreenStates } from './screenStates'
import { QrDialog } from './share'

type Mode = 'preview' | 'edit'
/** Room above a zoomed device. */
const ZOOMED_TOP = 52
/** How long after a pick the zoomed stage follows its element as the page scrolls to it (ms). */
const FOLLOW_MS = 1500

/** Around the screen: the bezel (px at 100%). */
const BEZEL = 10
const NO_SCROLL = { x: 0, y: 0 }
/** How long a click beside the hotspots shows them (prototype.css `proto-hots-flash`). */
const FLASH_MS = 800
/** Room the whole-screen change bar takes under the device while open. */
const CHANGE_ROOM = 200
/** Room the connect panel takes at the right while open (its 300px, 60px off the edge, and a gap). */
const CONNECT_ROOM = 380
/** What the screen list takes of the stage's left edge (prototype.css `.proto-screens`: 12 + 212 + 12). */
const LIST_ROOM = 236
/** What the rail takes of the stage's right edge (its 44px, 12px off the edge, and a gap). */
const RAIL_ROOM = 68
/** The stage's margin where nothing sits. */
const EDGE = 12
/**
 * A stage narrower than this opens with the screen list collapsed, leaving the device the room; its rail lies along
 * the bottom, taking RAIL_ROOM there instead of at the right.
 */
const NARROW_STAGE = 720
/** How long a page coming back scrolled stays hidden at most, waiting to be where it was (ms). */
const REVEAL_MS = 400
/** How long the device glides after a layout change (prototype.css `.proto-stage--glide`, --spring-smooth). */
const GLIDE_MS = 700
/** What a narrow stage's guide takes of its top (prototype.css `.proto-guide--narrow`: 52 down, two lines, a gap). */
const GUIDE_ROOM = 120

export interface PrototypeEditorProps {
  artifactId: string
  groupId: string
  botId: string | null
  title: string
  manifest: GgArtifactManifest
  preview: { previewId: string; origin: string } | null
  versionKey: string
  readOnly: boolean
  /** The screen it opens on. */
  start: string
  onEdit: (ops: ArtifactEditOp[]) => Promise<void>
  onBack: () => void
  /** Back to the canvas on a screen's page rules (to add some). */
  onCanvasRules: (screenId: string) => void
  onShare: () => void
  /** Server screenshots of this version's screens; the list falls back to live frames without one. */
  screenThumbs: NonNullable<ArtifactVersionDetail['screenThumbs']>
  /** The shown version's files (null until loaded) and a reader for them: the page rules for 标注. */
  files: { path: string; hash: string }[] | null
  readFile: (file: string) => Promise<string>
}

/**
 * Stitch's prototype editor (capability list §7) on the artifact's preview: the screens in a device frame. Preview
 * follows the screens' `data-gg-link` / `data-gg-back` with their transitions; Edit shows what is connected and
 * connects, rewords or hands elements to the AI.
 */
export function PrototypeEditor({
  artifactId,
  groupId,
  botId,
  title,
  manifest,
  preview,
  versionKey,
  readOnly,
  start,
  onEdit,
  onBack,
  onCanvasRules,
  onShare,
  screenThumbs,
  files,
  readFile,
}: PrototypeEditorProps) {
  const screens = manifest.screens
  const [mode, setMode] = useState<Mode>('preview')
  const [nav, go] = useReducer(navReducer, start, startNav)
  const cur = screens.find((s) => s.id === currentScreen(nav)) ?? screens[0]
  const [device, setDevice] = useState<ProtoDevice>(manifest.device === 'desktop' ? 'desktop' : 'mobile')
  const [zoom, setZoom] = useDeviceZoom(device)
  const devices = protoDevices(manifest.device)
  const [listOpen, setListOpen] = useState(true)
  const [reload, setReload] = useState(0)
  const [hotspots, setHotspots] = useState(false)
  /** Counts preview clicks beside the hotspots; non-zero while they flash. */
  const [flash, setFlash] = useState(0)
  const [qr, setQr] = useState(false)
  /** Each screen's latest `scroll` (0, 0 before any): the frame scrolls itself, the overlays follow. */
  const [scrolls, setScrolls] = useState<Record<string, { x: number; y: number }>>({})
  const [spots, setSpots] = useState<Record<string, BridgeLinkRect[]>>({})
  const [backs, setBacks] = useState<Record<string, BridgeBackRect[]>>({})
  /** The selected element, its rect in document coordinates (the scroll when it was picked added). */
  const [element, setElement] = useState<PickedElement | null>(null)
  const [menu, setMenu] = useState(false)
  const [connect, setConnect] = useState(false)
  const [imagine, setImagine] = useState(false)
  const [change, setChange] = useState(false)
  const [guide, setGuide] = useState(() => !localStorage.getItem(GUIDE_KEY))
  /** The element under the pointer in edit mode, in document coordinates: the hotspot holding it shows its tag. */
  const [hover, setHover] = useState<Rect | null>(null)
  /** The server's screenshot of each screen (screen id → url): the list shows these, not a page per screen. */
  const [room, setRoom] = useState({ width: 0, height: 0 })
  /** The device glides to its new place and size while a panel or the mode changes; resizing the window does not. */
  const [glide, setGlide] = useState(false)
  const root = useRef<HTMLElement>(null)
  /** When the stage last resized: a layout change then is the window's, not a panel's. */
  const resized = useRef(0)
  const stage = useRef<HTMLDivElement>(null)
  const deviceBox = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLIFrameElement>()).current
  const { bots, bot, pick: pickBot } = useArtifactBot(groupId, botId)
  const origin = preview?.origin ?? null
  const edit = mode === 'edit'
  const marks = usePreviewMarks({
    files,
    readFile,
    versionKey,
    screen: cur ?? { id: '', title: '', file: '' },
    active: !edit,
    frames,
    origin,
    scrolls,
    root,
    onCanvasRules,
  })
  const composer = useComposerClearance(stage, true, true)
  const stageScroll = useStageScroll(stage)
  /** The nav step the marks came in on: later screens' come in quietly. */
  const [introStep, setIntroStep] = useState(nav.step)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on turning the marks on only
  useEffect(() => {
    if (!marks.visible) return
    setIntroStep(nav.step)
    localStorage.setItem(GUIDE_KEY, '1')
    setGuide(false)
  }, [marks.visible])
  // A desktop page beside the panel needs the room: the screen list folds.
  useEffect(() => {
    if (marks.panelOpen && device === 'desktop') setListOpen(false)
  }, [marks.panelOpen, device])
  const swap = useScreenSwap(nav, cur?.id ?? '', reload, (id) => {
    const file = screens.find((s) => s.id === id)?.file
    return (file && scrolls[file]) || NO_SCROLL
  })

  const closeGuide = useCallback(() => {
    localStorage.setItem(GUIDE_KEY, '1')
    setGuide(false)
  }, [])
  useEffect(() => {
    if (!guide) return
    const onKey = (e: KeyboardEvent) => {
      // Not the Esc a panel took already (unpicking a rule).
      if (e.key === 'Escape' && !e.defaultPrevented) closeGuide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guide, closeGuide])
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(0), FLASH_MS)
    return () => clearTimeout(id)
  }, [flash])
  const switchMode = (m: Mode) => {
    if (guide) closeGuide()
    if (m === 'preview') setChange(false)
    setMode(m)
  }

  const thumbOf = (id: string) => screenThumbs.find((x) => x.screenId === id)?.url
  const states = useScreenStates(manifest)
  const entry = screens.some((s) => s.id === manifest.entry) ? manifest.entry : (screens[0]?.id ?? start)
  const restart = () => go({ type: 'restart', screen: entry })
  // Window-wide like the guide's Escape, but not from a field, a dialog, or a hidden workbench tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (notOurKey(e, root.current)) return
      const k = e.key.toLowerCase()
      if (k === 'r') setReload((n) => n + 1)
      else if (k === 'h') setHotspots((on) => !on)
      else if (ZOOM_KEYS[k]) setZoom(ZOOM_KEYS[k])
      else if (edit) return
      else if (e.key === 'ArrowLeft') go({ type: 'back' })
      else if (e.key === 'Home') go({ type: 'restart', screen: entry })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edit, entry, setZoom])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    // A stage turning narrow (or opening narrow) leaves the device the room: the list folds to its pill.
    let wasNarrow = false
    let first = true
    const measure = () => {
      // Resizing follows the window at once: no glide meanwhile.
      if (!first) {
        resized.current = performance.now()
        setGlide(false)
      }
      first = false
      setRoom({ width: el.clientWidth, height: el.clientHeight })
      const isNarrow = !!el.clientWidth && el.clientWidth < NARROW_STAGE
      if (isNarrow && !wasNarrow) setListOpen(false)
      wasNarrow = isNarrow
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A page coming back scrolled shows once it is there, or after a moment anyway.
  useEffect(() => {
    if (!swap.holding) return
    const id = setTimeout(swap.reveal, REVEAL_MS)
    return () => clearTimeout(id)
  }, [swap.holding, swap.reveal])

  // A panel, the list, the mode or the device changing moves the device: it glides there, briefly.
  const layoutKey = `${marks.panelOpen}|${mode}|${listOpen}|${device}|${connect}|${change}`
  const lastLayout = useRef(layoutKey)
  useEffect(() => {
    if (lastLayout.current === layoutKey) return
    lastLayout.current = layoutKey
    if (performance.now() - resized.current < GLIDE_MS) return
    setGlide(true)
    const id = setTimeout(() => setGlide(false), GLIDE_MS)
    return () => clearTimeout(id)
  }, [layoutKey])

  const bridgeMode: BridgeMode = edit ? 'edit' : 'preview'
  const textEdit = useTextEdit({
    frames,
    origin,
    canEdit: !readOnly,
    save: (ops) => saveEdits(onEdit, ops),
    onSaved: () => {
      setElement(null)
      setMenu(false)
    },
    onDirect: () => setMenu(false),
  })
  const resetText = textEdit.reset
  const dropElement = () => {
    if (element) postToScreen(frames.get(element.file), origin, { type: 'select-clear' })
    setElement(null)
    setMenu(false)
    setConnect(false)
  }
  useEffect(() => {
    for (const f of frames.values()) postToScreen(f, origin, { type: 'mode', mode: bridgeMode })
    setHover(null)
    setElement(null)
    setMenu(false)
    setConnect(false)
    resetText()
  }, [bridgeMode, origin, frames, resetText])
  // Element positions belong to one version and one screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a version or screen change only
  useEffect(() => {
    setHover(null)
    setElement(null)
    setMenu(false)
    setConnect(false)
    resetText()
  }, [versionKey, cur?.id])

  useBridge(origin, frames, (m: BridgeMessage) => {
    marks.onBridge(m)
    if (m.type === 'ready' || m.type === 'size') {
      if (m.type === 'ready') postToScreen(frames.get(m.file), origin, { type: 'mode', mode: bridgeMode })
      if (m.type === 'ready' && m.file === cur?.file) {
        // Back on a screen left scrolled: it comes back where it was.
        const back = swap.ready()
        if (back) postToScreen(frames.get(m.file), origin, { type: 'scroll-position', ...back })
      }
      // A page (re)loads at its top, or where it says it is: the scroll it had before no longer counts.
      if (m.type === 'ready')
        setScrolls((s) => ({ ...s, [m.file]: { x: m.scrollX ?? 0, y: m.scrollY ?? 0 } }))
      const found = linkSpots(m.links)
      if (found) setSpots((s) => ({ ...s, [m.file]: found }))
      setBacks((b) => ({ ...b, [m.file]: backRects(m.back) }))
    } else if (m.type === 'nav') {
      if (edit) return
      if (guide) closeGuide()
      if (!screens.some((s) => s.id === m.screen))
        return toast({ type: 'warning', message: t('没有屏幕「{id}」', { id: m.screen }) })
      states.choose(m.screen, m.set)
      go({
        type: 'go',
        screen: m.screen,
        ...(isTransition(m.transition) ? { transition: m.transition } : {}),
      })
    } else if (m.type === 'back') {
      if (edit) return
      if (guide) closeGuide()
      go({ type: 'back' })
    } else if (m.type === 'miss') {
      marks.unpick()
      if (!edit && !hotspots) setFlash((n) => n + 1)
    } else if (m.type === 'hover') {
      if (!edit) return
      const at = scrolls[m.file] ?? NO_SCROLL
      setHover(m.rect && { ...m.rect, x: m.rect.x + at.x, y: m.rect.y + at.y })
    } else if (m.type === 'scroll') {
      if (m.file === cur?.file) swap.reveal()
      setScrolls((s) => ({ ...s, [m.file]: { x: m.scrollX, y: m.scrollY } }))
    } else if (m.type === 'key') {
      // A key pressed in the screen: the shortcuts as if pressed here.
      // Cancelable: the 标注 panel's ←/→ take it before the editor's ← (back) sees it.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: m.key, repeat: m.repeat, cancelable: true }))
    } else if (m.type === 'text-edit') {
      textEdit.onMessage(m)
    } else if (m.type === 'select' && edit && cur) {
      const at = scrolls[m.file] ?? NO_SCROLL
      const rect = { ...m.rect, x: m.rect.x + at.x, y: m.rect.y + at.y }
      // A click inside a connected element (a card's title) picks the connection.
      const host = m.link ? null : linkHost(spots[m.file] ?? [], rect)
      setElement({
        ...m,
        ...(host && {
          ggId: host.ggId,
          rect: host.rect,
          link: host.screen,
          transition: host.transition ?? null,
          textOnly: false,
        }),
        ...(!host && { rect }),
        screenId: cur.id,
        screenTitle: cur.title,
      })
      setMenu(true)
      setConnect(false)
    }
  })

  // The layout worked out below, for the effects here (before the early return).
  const layout = useRef({ scale: 1, zoomed: false, pads: { left: 0, right: 0, top: 0, bottom: 0 } })
  // The marks draw outlines 2px on screen at the device's zoom.
  useEffect(() => marks.setScale(layout.current.scale))
  // Zoomed, a picked rule's element is brought into the stage's view (as its page scrolls to it, for a moment).
  const followUntil = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a pick, and as its element moves after it
  useEffect(() => {
    followUntil.current = performance.now() + FOLLOW_MS
  }, [marks.picked.n])
  // biome-ignore lint/correctness/useExhaustiveDependencies: as the picked element moves
  useEffect(() => {
    const r = marks.picked.rect
    const { zoomed, scale, pads } = layout.current
    if (!zoomed || !r || !cur || performance.now() > followUntil.current) return
    const fr = frames.get(cur.file)?.getBoundingClientRect()
    const sr = stage.current?.getBoundingClientRect()
    if (!fr?.width || !sr) return
    stageScroll.reveal(
      {
        x: fr.left - sr.left + r.x * scale,
        y: fr.top - sr.top + r.y * scale,
        w: r.w * scale,
        h: r.h * scale,
      },
      pads,
    )
  }, [marks.picked.n, marks.picked.rect?.x, marks.picked.rect?.y])

  if (!cur) return null
  const size = devices[device]
  const markFrame = {
    w: size.w,
    h: size.h,
    status: size.status,
    capsule: size.capsule ? capsuleOf(size.w) : null,
  }
  const scrolled = scrolls[cur.file] ?? NO_SCROLL
  /** A document rect where it shows in the device now. */
  const inView = (r: Rect): Rect => ({ ...r, x: r.x - scrolled.x, y: r.y - scrolled.y })
  const connecting = connect && !!element && edit
  const narrow = room.width > 0 && room.width < NARROW_STAGE
  /**
   * The device sits centred between the screen list (when open) and the rail, or the connect panel while it is open;
   * above the change bar, and above the rail where a narrow stage lays it along the bottom.
   */
  const left = listOpen ? LIST_ROOM : EDGE
  /**
   * A narrow stage lays the rail along its bottom, unless the full-screen workbench's floating composer covers that:
   * height is then what is short, the rail stays at the right.
   */
  const bottomRail = narrow && composer === null
  /** A narrow stage's 标注 panel lies along its bottom, above the rail or the composer. */
  const drawerBottom = composer ?? RAIL_ROOM
  const drawer =
    narrow && marks.panelOpen ? drawerHeight(room.height, devices[device].h + BEZEL * 2, drawerBottom) : 0
  /** A narrow stage's guide gives way to the drawer meanwhile: it would take the device's room. */
  const guideShown = guide && !drawer
  const right = connecting || (marks.panelOpen && !narrow) ? CONNECT_ROOM : bottomRail ? EDGE : RAIL_ROOM
  /** The full-screen workbench's floating composer covers the stage's bottom: the device keeps clear of it. */
  const bottom = Math.max((change ? CHANGE_ROOM : 0) + (bottomRail ? RAIL_ROOM : 0), composer ?? 0) + drawer
  /** A narrow stage's guide spans it under the screens pill: the device starts below it. */
  const top = narrow && guideShown ? GUIDE_ROOM : 0
  const fitWidth = Math.min(1, (room.width - left - right) / (size.w + BEZEL * 2))
  /** 适应: the whole device in the stage; 适应宽度 and 100%: larger, the stage scrolls (a desktop page reads at all). */
  const scale = !room.width
    ? 1
    : zoom === 'actual'
      ? 1
      : zoom === 'width'
        ? Math.max(0.2, fitWidth)
        : Math.max(0.2, Math.min(fitWidth, (room.height - 96 - top - bottom) / (size.h + BEZEL * 2)))
  const zoomed = zoom !== 'fit'
  /** What the stage keeps clear around the device: a picked rule's element is brought in between. */
  const pads = { left, right, top: Math.max(top, zoomed ? ZOOMED_TOP : 0), bottom }
  layout.current = { scale, zoomed, pads }
  /** What of the device box the scrolled stage shows, between its paddings, in the box's coordinates. */
  const stageView = () => {
    const sr = stage.current?.getBoundingClientRect()
    const br = deviceBox.current?.getBoundingClientRect()
    if (!sr?.width || !br) return undefined
    return {
      x: sr.left + pads.left - br.left,
      y: sr.top + pads.top - br.top,
      w: sr.width - pads.left - pads.right,
      h: sr.height - pads.top - pads.bottom,
    }
  }
  /**
   * A screen rect (in its viewport) where it shows on the stage's box: measured from the screen's frame (zoomed, the
   * stage scrolls); before layout, worked out from the device box centred between the stage's paddings.
   */
  const onStage = (r: Rect): Rect => {
    const fr = frames.get(cur.file)?.getBoundingClientRect()
    const sr = stage.current?.getBoundingClientRect()
    if (fr?.width && sr)
      return {
        x: fr.left - sr.left + r.x * scale,
        y: fr.top - sr.top + r.y * scale,
        w: r.w * scale,
        h: r.h * scale,
      }
    const x = left + (room.width - left - right - (size.w + BEZEL * 2) * scale) / 2
    const y = top + (room.height - top - bottom - (size.h + BEZEL * 2) * scale) / 2
    return { x: x + (BEZEL + r.x) * scale, y: y + (BEZEL + r.y) * scale, w: r.w * scale, h: r.h * scale }
  }
  const src = (s: { id: string; file: string }) =>
    preview ? openUrl(preview.previewId, `/${states.fileOf(s)}`) : undefined
  const titleOf = (id: string) => screens.find((s) => s.id === id)?.title ?? id
  const fileSpots = spots[cur.file] ?? []
  const fileBacks = backs[cur.file] ?? []
  const flashing = flash > 0 && !edit && !hotspots
  const showHots = edit || hotspots || flashing
  const askBot = (f: (b: BotDto) => Promise<boolean>) => (bot ? f(bot) : Promise.resolve(false))
  const located = element?.ggId ? { file: element.file, ggId: element.ggId } : null
  const tip = bottomRail ? 'top' : 'left'
  /** Edit mode tags a hotspot only under the pointer: its outline alone says it is connected. */
  const tagged = (r: Rect) => edit && !!hover && holds(r, hover)
  const at = screens.indexOf(cur) + 1

  const newScreen = (text: string) =>
    askBot((b) =>
      located && edit
        ? sendCommand(artifactId, { command: 'connect-element', botId: b.id, ggIds: [located], text }, b)
        : sendCommand(artifactId, { command: 'connect-element', botId: b.id, screenIds: [cur.id], text }, b),
    )

  return (
    <section ref={root} className="proto" aria-label={t('原型预览')}>
      <header className="proto-bar">
        <Tooltip content={t('返回画布')} placement="bottom">
          <Button size="small" variant="plain" icon="arrow-left" onClick={onBack}>
            <span className="proto-bar__title">{title}</span>
          </Button>
        </Tooltip>
        <div className="proto-bar__mode">
          <SegmentedControl<Mode>
            aria-label={t('原型模式')}
            size="small"
            value={mode}
            onChange={switchMode}
            items={[
              { value: 'preview', label: t('预览'), icon: 'play' },
              { value: 'edit', label: t('编辑'), icon: 'pencil' },
            ]}
          />
          {edit ? null : (
            <div className="proto-bar__nav">
              <span className="proto-bar__where" data-testid="proto-where">
                {`${cur.title} · ${at}/${screens.length}`}
              </span>
              {marks.badge}
              {nav.stack.length > 1 ? (
                <IconButton size="small" title={t('返回')} onClick={() => go({ type: 'back' })}>
                  {'arrow-left' as const}
                </IconButton>
              ) : null}
              <IconButton
                size="small"
                title={t('重新开始')}
                disabled={nav.stack.length === 1 && cur.id === entry}
                onClick={restart}
              >
                {'house' as const}
              </IconButton>
            </div>
          )}
        </div>
        <span className="art-bar__fill" />
        {states.picker(cur.id)}
        {marks.button}
        <Button size="small" variant="primary" icon="share" onClick={onShare}>
          {t('分享')}
        </Button>
      </header>

      <div className="proto-body">
        {listOpen ? (
          <aside className="proto-screens" aria-label={t('原型中的屏幕')}>
            <header className="proto-screens__head">
              <h3>{t('原型中的屏幕')}</h3>
              <IconButton size="small" title={t('收起')} onClick={() => setListOpen(false)}>
                {'minus' as const}
              </IconButton>
            </header>
            <ScreenThumbs
              screens={screens}
              current={cur.id}
              thumbOf={thumbOf}
              src={preview ? src : null}
              size={size}
              onPick={(id) => go({ type: 'jump', screen: id })}
            />
            {edit ? (
              <footer className="proto-screens__foot">
                <MenuButton
                  className="ui-btn ui-btn--small proto-screens__add"
                  items={[
                    { label: t('用 AI 新建屏'), value: 'ai', icon: 'sparkle', disabled: !bot },
                    { label: t('复制当前屏'), value: 'dup', icon: 'copy', disabled: readOnly },
                  ]}
                  onSelect={(v) => {
                    if (v === 'ai') setImagine(true)
                    else void saveEdits(onEdit, [{ kind: 'manifest', op: 'duplicate', screenId: cur.id }])
                  }}
                >
                  <Icon name="plus" size={13} />
                  {t('添加屏幕')}
                </MenuButton>
                {imagine ? (
                  <AskForm
                    label={t('新屏描述')}
                    placeholder={located && edit ? t('描述点所选元素后打开的新屏…') : t('描述要新建的屏幕…')}
                    bots={bots}
                    bot={bot}
                    onPickBot={pickBot}
                    onSend={newScreen}
                    onClose={() => setImagine(false)}
                  />
                ) : (
                  <button
                    type="button"
                    className="proto-screens__imagine"
                    disabled={!bot}
                    title={bot ? undefined : t('群里没有 Bot')}
                    onClick={() => setImagine(true)}
                  >
                    <Icon name="sparkle" size={14} />
                    {t('构想新屏')}
                  </button>
                )}
              </footer>
            ) : null}
          </aside>
        ) : (
          <button type="button" className="proto-screens-pill" onClick={() => setListOpen(true)}>
            <Icon name="list" size={14} />
            {t('原型中的屏幕')}
            <span>{screens.length}</span>
          </button>
        )}

        {/* biome-ignore lint/a11y: a click beside the marks lets a picked rule go; Esc does from the keyboard */}
        <div
          ref={stage}
          className={cx('proto-stage', glide && 'proto-stage--glide', zoomed && 'proto-stage--zoomed')}
          data-testid="proto-stage"
          {...stageScroll.handlers}
          onClick={(e) => {
            if (!(e.target as Element).closest('.proto-mark, .proto-bubble, .proto-notes')) marks.unpick()
          }}
          style={{
            ...(bottom ? { paddingBottom: bottom } : {}),
            ...(top || zoomed ? { paddingTop: Math.max(top, zoomed ? ZOOMED_TOP : 0) } : {}),
            paddingLeft: left,
            paddingRight: right,
          }}
        >
          <div
            ref={deviceBox}
            className="proto-device-box"
            style={{ width: (size.w + BEZEL * 2) * scale, height: (size.h + BEZEL * 2) * scale }}
          >
            <div
              className={cx('proto-device', `proto-device--${device}`)}
              data-testid="proto-device"
              data-device={device}
              style={{ width: size.w + BEZEL * 2, height: size.h + BEZEL * 2, transform: `scale(${scale})` }}
            >
              {/* A fixed clip around the moving screen: transitions slide inside the device, never over its bezel. */}
              <div className="proto-clip" data-testid="proto-clip">
                {swap.layers.map((layer) => {
                  // The leaving layer is the same element the screen had (its key), so its page stays as it was.
                  const live = layer.step === nav.step
                  const s = live ? cur : (screens.find((x) => x.id === layer.screen) ?? cur)
                  return (
                    <div
                      key={layer.step}
                      className={
                        live
                          ? cx('proto-scroll', enterClass(nav.enter))
                          : cx('proto-scroll', swap.leave?.className)
                      }
                      data-testid={live ? 'proto-screen' : 'proto-leave'}
                      data-screen={s.id}
                      aria-hidden={live ? undefined : true}
                      onAnimationEnd={live ? undefined : swap.leave?.onAnimationEnd}
                    >
                      <div className="proto-content" style={{ width: size.w, height: size.h }}>
                        {!live || !(swap.loading || swap.holding) ? null : thumbOf(s.id) &&
                          !swap.restoring ? (
                          <img
                            className="proto-placeholder"
                            data-testid="proto-placeholder"
                            src={thumbOf(s.id)}
                            alt=""
                            aria-hidden="true"
                          />
                        ) : (
                          <div className="proto-skeleton" data-testid="proto-skeleton" aria-hidden="true">
                            <b />
                            <b />
                            <b />
                            <b />
                          </div>
                        )}
                        {preview ? (
                          <iframe
                            key={`${versionKey}:${reload}`}
                            ref={(el) => {
                              if (!el) return
                              frames.set(s.file, el)
                              return () => {
                                if (frames.get(s.file) === el) frames.delete(s.file)
                              }
                            }}
                            // Coming back scrolled: hidden until it is where it was (its top would flash first).
                            className={cx('proto-frame', live && swap.holding && 'proto-frame--hold')}
                            title={s.title}
                            src={src(s)}
                            style={{ height: size.h }}
                          />
                        ) : null}
                        <div
                          key={flashing ? flash : 0}
                          className={cx('proto-hots', flashing && 'proto-hots--flash')}
                          data-testid={live ? 'proto-hots' : undefined}
                        >
                          {live && showHots
                            ? fileSpots.map((h, i) => (
                                <Hot
                                  // biome-ignore lint/suspicious/noArrayIndexKey: one per link element, in document order
                                  key={i}
                                  rect={inView(h.rect)}
                                  tag={tagged(h.rect) ? `→ ${titleOf(h.screen)}` : null}
                                  title={t('跳转到「{title}」', { title: titleOf(h.screen) })}
                                />
                              ))
                            : null}
                          {live && showHots
                            ? fileBacks.map((h, i) => (
                                <Hot
                                  // biome-ignore lint/suspicious/noArrayIndexKey: one per back element, in document order
                                  key={`b${i}`}
                                  rect={inView(h.rect)}
                                  tag={tagged(h.rect) ? `← ${t('返回')}` : null}
                                  title={t('返回上一屏')}
                                />
                              ))
                            : null}
                          {live && edit && element && !textEdit.state ? (
                            <Hot
                              rect={inView(element.rect)}
                              tag={element.link ? `→ ${titleOf(element.link)}` : t('已选中')}
                              selected
                            />
                          ) : null}
                        </div>
                        {/* The leaving screen's marks go with it. */}
                        {live ? null : marks.layer(markFrame, scale, s, true)}
                      </div>
                    </div>
                  )
                })}
                {size.status ? <DeviceChrome frame={size} light={cur.statusBar === 'light'} /> : null}
                {/* Over the chrome: a mark is never under the status bar or a mini program's capsule. */}
                <div
                  key={nav.step}
                  className={cx(
                    'proto-marks-host',
                    nav.enter !== 'none' && 'proto-marks-host--after',
                    nav.step !== introStep && 'proto-marks-host--quiet',
                  )}
                >
                  {marks.layer(markFrame, scale)}
                </div>
              </div>
            </div>
            {zoomed ? null : marks.pageRow(false)}
            {marks.bubble(markFrame, scale, BEZEL, zoomed ? stageView() : undefined)}
          </div>
          {guideShown ? (
            <div
              className={cx('proto-guide', narrow && 'proto-guide--narrow')}
              // Centred over the device, clear of the screen list and a panel at the right.
              style={
                narrow
                  ? undefined
                  : {
                      left: left + (room.width - left - right) / 2,
                      maxWidth: room.width - left - right - 2 * EDGE,
                    }
              }
              role="status"
              aria-label={t('原型预览引导')}
            >
              <Icon name="play" size={14} />
              <span>{t('点屏幕里的按钮就能跳转体验；切到「编辑」可连线、改字或让 AI 改')}</span>
              <IconButton size="small" title={t('知道了')} onClick={closeGuide}>
                {'xmark' as const}
              </IconButton>
            </div>
          ) : null}
          {/* On the stage, outside the device's clip: a tab bar's menu opens above it, whole. */}
          {edit && element && menu ? (
            // Its place is in the stage's box; the stage scrolled (zoomed), it moves with what it shows.
            <div className="proto-pop-at" style={{ left: stageScroll.at.x, top: stageScroll.at.y }}>
              <ElementMenu
                el={element}
                anchor={onStage(inView(element.rect))}
                room={room}
                edges={{ left, right: bottomRail ? EDGE : RAIL_ROOM }}
                readOnly={readOnly}
                bots={bots}
                bot={bot}
                onPickBot={pickBot}
                onConnect={() => {
                  setMenu(false)
                  setConnect(true)
                }}
                texting={textEdit.state}
                onEditText={() => textEdit.start(element)}
                artifactId={artifactId}
                onApply={(ops) => saveEdits(onEdit, ops)}
                onAi={(text) =>
                  askBot((b) =>
                    located
                      ? sendCommand(
                          artifactId,
                          { command: 'edit-with-ai', botId: b.id, ggIds: [located], text },
                          b,
                        )
                      : Promise.resolve(false),
                  )
                }
                onImagine={newScreen}
                onDisconnect={() =>
                  located
                    ? saveEdits(onEdit, disconnectOps({ ...located, transition: element.transition }))
                    : Promise.resolve(false)
                }
                onClose={dropElement}
              />
            </div>
          ) : null}
          {!edit ? null : change ? (
            <ChangeBar
              beside={connecting}
              raised={bottomRail}
              bots={bots}
              bot={bot}
              onPickBot={pickBot}
              onSend={(text) =>
                askBot((b) =>
                  sendCommand(
                    artifactId,
                    { command: 'edit-with-ai', botId: b.id, screenIds: [cur.id], text },
                    b,
                  ),
                )
              }
              onClose={() => setChange(false)}
            />
          ) : (
            <div className={cx('proto-pencil', bottomRail && 'proto-pencil--raised')}>
              <Tooltip content={bot ? t('描述要怎么改这屏') : t('群里没有 Bot')}>
                <button
                  type="button"
                  className="proto-pencil__btn"
                  disabled={!bot}
                  onClick={() => setChange(true)}
                >
                  <Icon name="sparkle" size={14} />
                  {t('AI 改这屏')}
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Zoomed, the stage scrolls: the whole-page rules stay at its top left, in view. */}
        {zoomed ? (
          <div className="proto-page-float" style={{ left: left + EDGE }}>
            {marks.pageRow(true)}
          </div>
        ) : null}
        <div
          className={cx('art-tools proto-rail', bottomRail && 'proto-rail--bottom')}
          style={!bottomRail && bottom ? { top: `calc(50% - ${bottom / 2}px)` } : undefined}
          role="toolbar"
          aria-orientation={bottomRail ? 'horizontal' : 'vertical'}
          aria-label={t('原型工具')}
        >
          <MenuButton
            className="art-tools__btn proto-rail__device"
            aria-label={t('设备：{name}', { name: DEVICE_LABEL[device] })}
            title={t('设备')}
            align="end"
            items={(Object.keys(devices) as ProtoDevice[]).map((d) => ({
              label: `${DEVICE_LABEL[d]} ${devices[d].w}×${devices[d].h}`,
              value: d,
              icon: DEVICE_ICON[d],
              checked: d === device,
            }))}
            onSelect={(d) => setDevice(d as ProtoDevice)}
          >
            <Icon name={DEVICE_ICON[device]} size={16} />
            <small aria-hidden="true">{size.w}</small>
          </MenuButton>
          <MenuButton
            className="art-tools__btn proto-rail__zoom"
            aria-label={t('缩放：{name}', { name: ZOOM_LABEL[zoom] })}
            title={t('缩放')}
            align="end"
            items={ZOOMS.map((z) => ({
              label: ZOOM_LABEL[z],
              shortcut: ZOOM_KEY_OF[z],
              value: z,
              checked: z === zoom,
              radio: true,
            }))}
            onSelect={(z) => setZoom(z as Zoom)}
          >
            <small>{`${Math.round(scale * 100)}%`}</small>
          </MenuButton>
          <RailButton
            icon="arrow-clockwise"
            label={t('重新加载')}
            shortcut="R"
            tip={tip}
            onClick={() => setReload((n) => n + 1)}
          />
          <RailButton
            icon="target"
            label={t('高亮热点')}
            shortcut="H"
            tip={tip}
            on={hotspots}
            onClick={() => setHotspots((on) => !on)}
          />
          <RailButton icon="qrcode" label={t('扫码查看')} tip={tip} onClick={() => setQr(true)} />
          <RailButton
            icon="external"
            label={t('新标签页打开')}
            tip={tip}
            onClick={
              preview
                ? () =>
                    window.open(
                      `${openUrl(preview.previewId, '/')}#play:${cur.id}${states.query(cur.id)}`,
                      '_blank',
                      'noopener',
                    )
                : undefined
            }
          />
        </div>

        {marks.panel(drawer ? { height: drawer, bottom: drawerBottom } : null)}
        {connecting && element ? (
          <ConnectPanel
            key={`${element.file}#${element.ggId}`}
            el={element}
            screens={screens.filter((s) => s.id !== cur.id)}
            readOnly={readOnly || !located}
            onApply={(ops) => saveEdits(onEdit, ops)}
            onClose={dropElement}
          />
        ) : null}
      </div>

      <Presence>
        {qr ? (
          <QrDialog
            artifactId={artifactId}
            groupId={groupId}
            botId={botId}
            screen={cur.id}
            onClose={() => setQr(false)}
          />
        ) : null}
      </Presence>
    </section>
  )
}
