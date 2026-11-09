import type {
  ArtifactEditOp,
  ArtifactTransition,
  BotDto,
  BridgeBackRect,
  BridgeLinkRect,
  BridgeMode,
  GgArtifactManifest,
  Rect,
} from '@gonggong/protocol'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import {
  Button,
  CloseButton,
  Icon,
  IconButton,
  type IconName,
  MenuButton,
  PopUpButton,
  Presence,
  SegmentedControl,
  Textarea,
  Tooltip,
  toast,
  useEscape,
} from '../../ui'
import { openUrl } from '../previews/store'
import { offlineHint, saveEdits, sendCommand, useArtifactBot } from './actions'
import { type BridgeMessage, linkSpots, postToScreen, useBridge } from './bridge'
import { BotChoice } from './ElementPopover'
import type { PickedElement } from './elements'
import {
  ImageUrlForm,
  isImage,
  type TextEditing,
  textEditingHint,
  useImageUpload,
  useTextEdit,
} from './inPlace'
import {
  backRects,
  connectOps,
  currentScreen,
  disconnectOps,
  enterClass,
  GUIDE_KEY,
  linkHost,
  menuPlace,
  navReducer,
  type ProtoDevice,
  type ProtoFrame,
  protoDevices,
  startNav,
} from './prototype'
import { Panel } from './SidePanel'
import { QrDialog } from './share'

type Mode = 'preview' | 'edit'

const DEVICE_ICON: Record<ProtoDevice, IconName> = {
  mobile: 'smartphone',
  tablet: 'tablet',
  desktop: 'desktop',
}
const DEVICE_LABEL: Record<ProtoDevice, string> = {
  mobile: t('手机'),
  tablet: t('平板'),
  desktop: t('桌面'),
}
const TRANSITIONS: { value: ArtifactTransition; label: string }[] = [
  { value: 'none', label: t('无转场') },
  { value: 'push', label: t('推入') },
  { value: 'push-back', label: t('推回') },
  { value: 'slide-up', label: t('上滑') },
  { value: 'fade', label: t('淡入') },
]
const isTransition = (v: unknown): v is ArtifactTransition => TRANSITIONS.some((x) => x.value === v)
/** Around the screen: the bezel (px at 100%). */
const BEZEL = 10
const NO_SCROLL = { x: 0, y: 0 }
/** How long a click beside the hotspots shows them (prototype.css `proto-hots-flash`). */
const FLASH_MS = 800
/** Room the whole-screen change bar takes under the device while open. */
const CHANGE_ROOM = 200
/** Room the connect panel takes at the right while open (its 300px, 60px off the edge, and a gap). */
export const CONNECT_ROOM = 380
/** The popover's width on screen. */
const MENU_W = 248
/** The popover's height before it is measured (its four actions). */
const MENU_H = 190
/** What the screen list takes of the stage's left edge (prototype.css `.proto-screens`: 12 + 212 + 12). */
const LIST_ROOM = 236
/** What the rail takes of the stage's right edge (its 44px, 12px off the edge, and a gap). */
const RAIL_ROOM = 68
/** The stage's margin where nothing sits. */
const EDGE = 12
/** A thumbnail's width in the screen list (px). */
const THUMB_W = 188
/** A stage narrower than this opens with the screen list collapsed, leaving the device the room. */
const NARROW_STAGE = 720

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
  onShare: () => void
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
  onShare,
}: PrototypeEditorProps) {
  const screens = manifest.screens
  const [mode, setMode] = useState<Mode>('preview')
  const [nav, go] = useReducer(navReducer, start, startNav)
  const cur = screens.find((s) => s.id === currentScreen(nav)) ?? screens[0]
  const [device, setDevice] = useState<ProtoDevice>(manifest.device === 'desktop' ? 'desktop' : 'mobile')
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
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const stage = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLIFrameElement>()).current
  const { bots, bot, pick: pickBot } = useArtifactBot(groupId, botId)
  const origin = preview?.origin ?? null
  const edit = mode === 'edit'

  const closeGuide = useCallback(() => {
    localStorage.setItem(GUIDE_KEY, '1')
    setGuide(false)
  }, [])
  useEffect(() => {
    if (!guide) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGuide()
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
    setMode(m)
  }

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight })
    measure()
    if (el.clientWidth && el.clientWidth < NARROW_STAGE) setListOpen(false)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    setElement(null)
    setMenu(false)
    setConnect(false)
    resetText()
  }, [bridgeMode, origin, frames, resetText])
  // Element positions belong to one version and one screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a version or screen change only
  useEffect(() => {
    setElement(null)
    setMenu(false)
    setConnect(false)
    resetText()
  }, [versionKey, cur?.id])

  useBridge(origin, frames, (m: BridgeMessage) => {
    if (m.type === 'ready' || m.type === 'size') {
      if (m.type === 'ready') postToScreen(frames.get(m.file), origin, { type: 'mode', mode: bridgeMode })
      const found = linkSpots(m.links)
      if (found) setSpots((s) => ({ ...s, [m.file]: found }))
      setBacks((b) => ({ ...b, [m.file]: backRects(m.back) }))
    } else if (m.type === 'nav') {
      if (edit) return
      if (guide) closeGuide()
      if (!screens.some((s) => s.id === m.screen))
        return toast({ type: 'warning', message: t('没有屏幕「{id}」', { id: m.screen }) })
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
      if (!edit && !hotspots) setFlash((n) => n + 1)
    } else if (m.type === 'scroll') {
      setScrolls((s) => ({ ...s, [m.file]: { x: m.scrollX, y: m.scrollY } }))
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

  if (!cur) return null
  const size = devices[device]
  const scrolled = scrolls[cur.file] ?? NO_SCROLL
  /** A document rect where it shows in the device now. */
  const inView = (r: Rect): Rect => ({ ...r, x: r.x - scrolled.x, y: r.y - scrolled.y })
  const connecting = connect && !!element && edit
  /** The device sits centred between the screen list (when open) and the rail, or the connect panel while it is open. */
  const left = listOpen ? LIST_ROOM : EDGE
  const right = connecting ? CONNECT_ROOM : RAIL_ROOM
  const scale = room.width
    ? Math.max(
        0.2,
        Math.min(
          1,
          (room.width - left - right) / (size.w + BEZEL * 2),
          (room.height - 96 - (change ? CHANGE_ROOM : 0)) / (size.h + BEZEL * 2),
        ),
      )
    : 1
  /** A screen rect (in its viewport) on the stage: the device box sits centred between the stage's paddings. */
  const onStage = (r: Rect): Rect => {
    const x = left + (room.width - left - right - (size.w + BEZEL * 2) * scale) / 2
    const y = (room.height - (change ? CHANGE_ROOM : 0) - (size.h + BEZEL * 2) * scale) / 2
    return { x: x + (BEZEL + r.x) * scale, y: y + (BEZEL + r.y) * scale, w: r.w * scale, h: r.h * scale }
  }
  const src = (file: string) => (preview ? openUrl(preview.previewId, `/${file}`) : undefined)
  const titleOf = (id: string) => screens.find((s) => s.id === id)?.title ?? id
  const fileSpots = spots[cur.file] ?? []
  const fileBacks = backs[cur.file] ?? []
  const flashing = flash > 0 && !edit && !hotspots
  const showHots = edit || hotspots || flashing
  const askBot = (f: (b: BotDto) => Promise<boolean>) => (bot ? f(bot) : Promise.resolve(false))
  const located = element?.ggId ? { file: element.file, ggId: element.ggId } : null

  const newScreen = (text: string) =>
    askBot((b) =>
      located && edit
        ? sendCommand(artifactId, { command: 'connect-element', botId: b.id, ggIds: [located], text }, b)
        : sendCommand(artifactId, { command: 'connect-element', botId: b.id, screenIds: [cur.id], text }, b),
    )

  return (
    <section className="proto" aria-label={t('原型编辑器')}>
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
        </div>
        <span className="art-bar__fill" />
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
            <ul className="proto-screens__list">
              {screens.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="proto-thumb"
                    aria-current={s.id === cur.id ? 'page' : undefined}
                    onClick={() => s.id !== cur.id && go({ type: 'jump', screen: s.id })}
                  >
                    <span className="proto-thumb__shot">
                      {preview ? (
                        <iframe
                          title={t('{title} 缩略图', { title: s.title })}
                          src={src(s.file)}
                          tabIndex={-1}
                          loading="lazy"
                          style={{ width: size.w, height: size.h, transform: `scale(${THUMB_W / size.w})` }}
                        />
                      ) : null}
                    </span>
                    <span className="proto-thumb__title">{s.title}</span>
                  </button>
                </li>
              ))}
            </ul>
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
          </aside>
        ) : (
          <button type="button" className="proto-screens-pill" onClick={() => setListOpen(true)}>
            <Icon name="list" size={14} />
            {t('原型中的屏幕')}
            <span>{screens.length}</span>
          </button>
        )}

        <div
          ref={stage}
          className="proto-stage"
          data-testid="proto-stage"
          style={{
            ...(change ? { paddingBottom: CHANGE_ROOM } : {}),
            paddingLeft: left,
            paddingRight: right,
          }}
        >
          <div
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
                <div
                  key={nav.step}
                  className={cx('proto-scroll', enterClass(nav.enter))}
                  data-testid="proto-screen"
                  data-screen={cur.id}
                >
                  <div className="proto-content" style={{ width: size.w, height: size.h }}>
                    {preview ? (
                      <iframe
                        key={`${versionKey}:${reload}`}
                        ref={(el) => {
                          if (el) frames.set(cur.file, el)
                          else frames.delete(cur.file)
                        }}
                        className="proto-frame"
                        title={cur.title}
                        src={src(cur.file)}
                        style={{ height: size.h }}
                      />
                    ) : null}
                    <div
                      key={flashing ? flash : 0}
                      className={cx('proto-hots', flashing && 'proto-hots--flash')}
                      data-testid="proto-hots"
                    >
                      {showHots
                        ? fileSpots.map((h, i) => (
                            <Hot
                              // biome-ignore lint/suspicious/noArrayIndexKey: one per link element, in document order
                              key={i}
                              rect={inView(h.rect)}
                              tag={edit ? t('已连接') : null}
                              title={t('跳转到「{title}」', { title: titleOf(h.screen) })}
                            />
                          ))
                        : null}
                      {showHots
                        ? fileBacks.map((h, i) => (
                            <Hot
                              // biome-ignore lint/suspicious/noArrayIndexKey: one per back element, in document order
                              key={`b${i}`}
                              rect={inView(h.rect)}
                              tag={edit ? t('返回') : null}
                              title={t('返回上一屏')}
                            />
                          ))
                        : null}
                      {edit && element && !textEdit.state ? (
                        <Hot rect={inView(element.rect)} tag={t('已选中')} selected />
                      ) : null}
                    </div>
                  </div>
                </div>
                {size.status ? <DeviceChrome frame={size} light={cur.statusBar === 'light'} /> : null}
              </div>
            </div>
          </div>
          {guide ? (
            <div className="proto-guide" role="status" aria-label={t('原型编辑器引导')}>
              <Icon name="play" size={14} />
              <span>{t('点屏幕里的按钮就能跳转体验；切到「编辑」可连线、改字或让 AI 改')}</span>
              <IconButton size="small" title={t('知道了')} onClick={closeGuide}>
                {'xmark' as const}
              </IconButton>
            </div>
          ) : null}
          {/* On the stage, outside the device's clip: a tab bar's menu opens above it, whole. */}
          {edit && element && menu ? (
            <ElementMenu
              el={element}
              anchor={onStage(inView(element.rect))}
              room={room}
              edges={{ left: listOpen ? LIST_ROOM : EDGE, right: RAIL_ROOM }}
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
          ) : null}
          {change ? (
            <ChangeBar
              beside={connecting}
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
            <div className="proto-pencil">
              <Tooltip content={t('描述要怎么改这屏')}>
                <button
                  type="button"
                  className="proto-pencil__btn"
                  aria-label={t('用 AI 修改这屏')}
                  disabled={!bot}
                  onClick={() => setChange(true)}
                >
                  <Icon name="pencil" size={15} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        <div
          className="art-tools proto-rail"
          role="toolbar"
          aria-orientation="vertical"
          aria-label={t('原型工具')}
        >
          <MenuButton
            className="art-tools__btn"
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
          </MenuButton>
          <RailButton icon="arrow-clockwise" label={t('重新加载')} onClick={() => setReload((n) => n + 1)} />
          <RailButton
            icon="target"
            label={t('高亮热点')}
            on={hotspots}
            onClick={() => setHotspots((on) => !on)}
          />
          <RailButton icon="qrcode" label={t('扫码查看')} onClick={() => setQr(true)} />
          <RailButton
            icon="external"
            label={t('新标签页打开')}
            onClick={
              preview
                ? () => window.open(`${openUrl(preview.previewId, '/')}#play:${cur.id}`, '_blank', 'noopener')
                : undefined
            }
          />
        </div>

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

/**
 * The phone's status bar (and a mini program's capsule) and home indicator, drawn over the screen like the
 * web-prototype kit's shell: screens leave `--gg-status-bar` free for it. Clicks go through to the screen.
 */
function DeviceChrome({ frame, light }: { frame: ProtoFrame; light: boolean }) {
  return (
    <div
      className={cx('proto-chrome', light && 'proto-chrome--light')}
      data-testid="proto-chrome"
      aria-hidden="true"
    >
      <div className="proto-chrome__status" style={{ height: frame.status }}>
        <span>9:41</span>
        <svg width="68" height="12" viewBox="0 0 68 12" fill="currentColor" aria-hidden="true">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="6" width="3" height="6" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
          <path d="M30 3.2a8.6 8.6 0 0 1 11.6 0l-1.3 1.4a6.7 6.7 0 0 0-9 0zm2.6 2.8a4.8 4.8 0 0 1 6.4 0l-1.3 1.4a3 3 0 0 0-3.8 0zm3.2 2.4 1.5 1.6-1.5 1.6-1.5-1.6z" />
          <rect
            x="44.5"
            y="0.5"
            width="21"
            height="11"
            rx="3.2"
            fill="none"
            stroke="currentColor"
            opacity="0.4"
          />
          <rect x="46" y="2" width="18" height="8" rx="2" />
          <rect x="66.5" y="4" width="1.5" height="4" rx="0.7" opacity="0.4" />
        </svg>
      </div>
      {frame.capsule ? (
        <div className="proto-chrome__capsule" data-testid="proto-capsule">
          <span>
            <svg width="20" height="6" viewBox="0 0 20 6" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="3" r="2.2" />
              <circle cx="10" cy="3" r="3" />
              <circle cx="17" cy="3" r="2.2" />
            </svg>
          </span>
          <i />
          <span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="7.2" />
              <circle cx="9" cy="9" r="2.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Room a hotspot tag takes above its element (prototype.css `.proto-hot__tag`: 15px line + 2px gap). */
const TAG_ROOM = 17

/**
 * A hotspot box in the screen's viewport coordinates; `tag` labels it in edit mode, outside the box so it covers none
 * of the element: above it, or below when the screen's top leaves no room.
 */
function Hot({
  rect,
  tag,
  title,
  selected,
}: {
  rect: { x: number; y: number; w: number; h: number }
  tag: string | null
  title?: string
  selected?: boolean
}) {
  return (
    <div
      className={cx('proto-hot', selected && 'proto-hot--selected')}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      title={title}
    >
      {tag ? (
        <span className={cx('proto-hot__tag', rect.y < TAG_ROOM && 'proto-hot__tag--below')}>{tag}</span>
      ) : null}
    </div>
  )
}

function RailButton({
  icon,
  label,
  on,
  onClick,
}: {
  icon: IconName
  label: string
  on?: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="art-tools__btn"
        aria-label={label}
        aria-pressed={on === undefined ? undefined : on}
        disabled={!onClick}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
      </button>
    </Tooltip>
  )
}

/** A request to the bot: text, the bot when the group has several, send. */
function AskForm({
  label,
  placeholder,
  bots,
  bot,
  onPickBot,
  onSend,
  onClose,
  children,
}: {
  label: string
  placeholder: string
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSend: (text: string) => Promise<boolean>
  onClose: () => void
  children?: ReactNode
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    const ok = await onSend(text.trim())
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <form
      className="art-pop__form proto-ask"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <Textarea
        aria-label={label}
        placeholder={placeholder}
        value={text}
        rows={3}
        maxLength={2000}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
        }}
      />
      <BotChoice bots={bots} bot={bot} onPick={onPickBot} />
      {children}
      <div className="art-pop__row">
        <Button size="small" variant="plain" onClick={onClose}>
          {t('取消')}
        </Button>
        <Button
          size="small"
          variant="primary"
          icon="send"
          type="submit"
          disabled={busy || !text.trim() || !bot}
        >
          {bot ? t('发给 @{name}', { name: bot.name }) : t('发送')}
        </Button>
      </div>
    </form>
  )
}

/** The pencil under the device: describe how to change this screen. */
function ChangeBar({
  beside,
  ...props
}: {
  /** The connect panel is open: keep clear of it. */
  beside: boolean
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSend: (text: string) => Promise<boolean>
  onClose: () => void
}) {
  return (
    <div className={cx('proto-change', beside && 'proto-change--beside')}>
      <AskForm label={t('修改要求')} placeholder={t('描述要怎么改这屏…')} {...props}>
        <small className="proto-change__hint">{t('Esc 关闭')}</small>
      </AskForm>
    </div>
  )
}

/** Edit mode's element menu (Stitch: Connect to screen, Edit text, Change with AI, Imagine new screen). */
function ElementMenu({
  el,
  anchor,
  room,
  edges,
  readOnly,
  bots,
  bot,
  onPickBot,
  onConnect,
  texting,
  onEditText,
  artifactId,
  onApply,
  onAi,
  onImagine,
  onDisconnect,
  onClose,
}: {
  el: PickedElement
  /** The element on the stage. */
  anchor: Rect
  room: { width: number; height: number }
  /** What the screen list and the rail take of the stage's sides. */
  edges: { left: number; right: number }
  readOnly: boolean
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onConnect: () => void
  /** Whether the element's text is being picked or typed in the screen. */
  texting: TextEditing
  onEditText: () => void
  artifactId: string
  onApply: (ops: ArtifactEditOp[]) => Promise<boolean>
  onAi: (text: string) => Promise<boolean>
  onImagine: (text: string) => Promise<boolean>
  onDisconnect: () => Promise<boolean>
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(MENU_H)
  // Each step (the actions, a form) has its own height: placed by the one it has now.
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight
    if (h && h !== height) setHeight(h)
  })
  const [step, setStep] = useState<'menu' | 'image' | 'ai' | 'imagine'>('menu')
  const [busy, setBusy] = useState(false)
  const located = el.ggId !== null
  const noSource = located ? undefined : t('脚本生成的元素，只能批注')
  const noBot = bot ? undefined : t('群里没有 Bot')
  const offline = offlineHint(bot) ?? undefined
  const ro = readOnly ? t('历史版本只读') : undefined
  const status = textEditingHint(texting)
  const apply = async (ops: ArtifactEditOp[]) => (await onApply(ops)) && onClose()
  const upload = useImageUpload(artifactId, el, apply)
  const at = menuPlace(anchor, { w: MENU_W, h: height }, room, edges)
  /** `hint` says why it is off; `note` (an offline bot) only informs. */
  const action = (
    icon: IconName,
    label: string,
    hint: string | undefined,
    onClick: () => void,
    note?: string,
    danger?: boolean,
    on?: boolean,
  ) => (
    <button
      type="button"
      className={cx('art-pop__action', danger && 'art-pop__action--danger', on && 'art-pop__action--on')}
      aria-pressed={on}
      disabled={!!hint}
      title={hint ?? note}
      onClick={onClick}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
      {hint || note ? <small>{hint ?? note}</small> : null}
    </button>
  )
  return (
    <div
      ref={box}
      className="art-pop proto-pop"
      role="dialog"
      aria-label={t('编辑元素')}
      style={{ ...at, width: MENU_W }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <header className="art-pop__head">
        <span className="art-pop__title">{t('编辑元素')}</span>
        <CloseButton onClick={onClose} />
      </header>
      {step === 'menu' ? (
        <div className="art-pop__actions">
          {action('link', el.link ? t('编辑连接') : t('连到屏幕'), ro ?? noSource, onConnect)}
          {isImage(el) ? (
            <>
              {action('globe', t('输入图片地址'), ro ?? noSource, () => setStep('image'))}
              {action(
                'upload',
                t('上传图片'),
                ro ?? noSource ?? (upload.busy ? t('上传中…') : undefined),
                upload.open,
              )}
              {upload.input}
            </>
          ) : (
            action(
              'textformat',
              t('编辑文字'),
              ro ?? noSource,
              onEditText,
              undefined,
              false,
              texting !== null,
            )
          )}
          {status ? (
            <p className="art-pop__status" role="status">
              {status}
            </p>
          ) : null}
          {action('sparkle', t('用 AI 修改'), noSource ?? noBot, () => setStep('ai'), offline)}
          {action('plus', t('构想新屏'), noSource ?? noBot, () => setStep('imagine'), offline)}
          {el.link
            ? action(
                'xmark-circle',
                t('移除连接'),
                ro ?? noSource,
                async () => {
                  setBusy(true)
                  const ok = await onDisconnect()
                  setBusy(false)
                  if (ok) onClose()
                },
                undefined,
                true,
              )
            : null}
        </div>
      ) : step === 'image' ? (
        <ImageUrlForm el={el} readOnly={readOnly} onApply={apply} onBack={() => setStep('menu')} />
      ) : (
        <AskForm
          label={step === 'ai' ? t('修改要求') : t('新屏描述')}
          placeholder={step === 'ai' ? t('描述要怎么改这个元素…') : t('描述点它之后打开的新屏…')}
          bots={bots}
          bot={bot}
          onPickBot={onPickBot}
          onSend={step === 'ai' ? onAi : onImagine}
          onClose={onClose}
        />
      )}
    </div>
  )
}

/** Connect Element: the screen the element opens and how it moves there; Disconnect removes the link. */
function ConnectPanel({
  el,
  screens,
  readOnly,
  onApply,
  onClose,
}: {
  el: PickedElement
  screens: { id: string; title: string }[]
  readOnly: boolean
  onApply: (ops: ArtifactEditOp[]) => Promise<boolean>
  onClose: () => void
}) {
  const [to, setTo] = useState(el.link && screens.some((s) => s.id === el.link) ? el.link : '')
  const [transition, setTransition] = useState<ArtifactTransition>(
    isTransition(el.transition) ? el.transition : 'push',
  )
  const [busy, setBusy] = useState(false)
  useEscape(onClose)
  const where = { file: el.file, ggId: el.ggId ?? '' }
  const unchanged =
    to === (el.link ?? '') && transition === (isTransition(el.transition) ? el.transition : 'push')
  const run = async (ops: ArtifactEditOp[]) => {
    setBusy(true)
    const ok = await onApply(ops)
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Panel title={t('连接元素')} onClose={onClose}>
      <div className="art-el proto-connect" data-testid="proto-connect">
        <p className="art-el__crumbs">
          <code className="art-el__tag">{`<${el.tag}>`}</code>
          <span>{el.text.slice(0, 40)}</span>
        </p>
        <h4 className="art-panel__label">{t('连到屏幕')}</h4>
        <PopUpButton
          aria-label={t('连到屏幕')}
          size="small"
          disabled={readOnly}
          value={to}
          placeholder={t('选择屏幕')}
          onChange={setTo}
          options={screens.map((s) => ({ value: s.id, label: s.title }))}
        />
        <h4 className="art-panel__label">{t('转场')}</h4>
        <PopUpButton<ArtifactTransition>
          aria-label={t('转场')}
          size="small"
          disabled={readOnly}
          value={transition}
          onChange={setTransition}
          options={TRANSITIONS}
        />
      </div>
      <div className="art-el__foot">
        {el.link ? (
          <Button
            size="small"
            disabled={readOnly || busy}
            onClick={() => void run(disconnectOps({ ...where, transition: el.transition }))}
          >
            {t('断开连接')}
          </Button>
        ) : null}
        <Button
          size="small"
          variant="primary"
          loading={busy}
          disabled={readOnly || !to || unchanged}
          onClick={() => void run(connectOps(where, to, transition))}
        >
          {t('应用连接')}
        </Button>
      </div>
    </Panel>
  )
}
