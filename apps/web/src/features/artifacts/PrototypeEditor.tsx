import type {
  ArtifactEditOp,
  ArtifactTransition,
  BotDto,
  BridgeBackRect,
  BridgeFromShell,
  BridgeLinkRect,
  BridgeMode,
  GgArtifactManifest,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useReducer, useRef, useState } from 'react'
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
} from '../../ui'
import { openUrl } from '../previews/store'
import { askInChat, saveEdits, sendCommand, useArtifactBot } from './actions'
import { linkSpots, postToScreen, useBridge } from './bridge'
import { BotChoice } from './ElementPopover'
import type { PickedElement } from './elements'
import {
  backRects,
  connectOps,
  currentScreen,
  disconnectOps,
  enterClass,
  GUIDE_KEY,
  navReducer,
  PROTO_DEVICES,
  type ProtoDevice,
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
/** The popover's width on screen. */
const MENU_W = 248
/** A thumbnail's width in the screen list (px). */
const THUMB_W = 188

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
  const [listOpen, setListOpen] = useState(true)
  const [reload, setReload] = useState(0)
  const [hotspots, setHotspots] = useState(false)
  const [qr, setQr] = useState(false)
  const [content, setContent] = useState<Record<string, number>>({})
  const [spots, setSpots] = useState<Record<string, BridgeLinkRect[]>>({})
  const [backs, setBacks] = useState<Record<string, BridgeBackRect[]>>({})
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

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bridgeMode: BridgeMode = edit ? 'edit' : 'preview'
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
  }, [bridgeMode, origin, frames])
  // Element positions belong to one version and one screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a version or screen change only
  useEffect(() => {
    setElement(null)
    setMenu(false)
    setConnect(false)
  }, [versionKey, cur?.id])

  useBridge(origin, frames, (m: BridgeFromShell) => {
    if (m.type === 'ready' || m.type === 'size') {
      if (m.type === 'ready') postToScreen(frames.get(m.file), origin, { type: 'mode', mode: bridgeMode })
      const h = m.height
      if (h) setContent((c) => (c[m.file] === h ? c : { ...c, [m.file]: h }))
      const found = linkSpots(m.links)
      if (found) setSpots((s) => ({ ...s, [m.file]: found }))
      setBacks((b) => ({ ...b, [m.file]: backRects(m.back) }))
    } else if (m.type === 'nav') {
      if (edit) return
      if (!screens.some((s) => s.id === m.screen))
        return toast({ type: 'warning', message: t('没有屏幕「{id}」', { id: m.screen }) })
      go({
        type: 'go',
        screen: m.screen,
        ...(isTransition(m.transition) ? { transition: m.transition } : {}),
      })
    } else if (m.type === 'back') {
      if (!edit) go({ type: 'back' })
    } else if (m.type === 'select' && edit && cur) {
      setElement({ ...m, screenId: cur.id, screenTitle: cur.title })
      setMenu(true)
      setConnect(false)
    }
  })

  if (!cur) return null
  const size = PROTO_DEVICES[device]
  const fullH = Math.max(size.h, Math.round(content[cur.file] ?? size.h))
  const side = listOpen ? 260 : 72
  const scale = room.width
    ? Math.max(
        0.2,
        Math.min(
          1,
          (room.width - side * 2) / (size.w + BEZEL * 2),
          (room.height - 96) / (size.h + BEZEL * 2),
        ),
      )
    : 1
  const src = (file: string) => (preview ? openUrl(preview.previewId, `/${file}`) : undefined)
  const titleOf = (id: string) => screens.find((s) => s.id === id)?.title ?? id
  const fileSpots = spots[cur.file] ?? []
  const fileBacks = backs[cur.file] ?? []
  const showHots = edit || hotspots
  const askBot = (f: (b: BotDto) => Promise<boolean>) => (bot ? f(bot) : Promise.resolve(false))
  const located = element?.ggId ? { file: element.file, ggId: element.ggId } : null

  const closeGuide = () => {
    localStorage.setItem(GUIDE_KEY, '1')
    setGuide(false)
  }
  const newScreen = (text: string) =>
    askBot((b) =>
      located && edit
        ? sendCommand(artifactId, { command: 'connect-element', botId: b.id, ggIds: [located], text }, b.name)
        : askInChat(groupId, artifactId, b, t('新建一屏：{text}', { text }), [cur.id]),
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
            onChange={setMode}
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

        <div ref={stage} className="proto-stage">
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
              <div
                key={nav.step}
                className={cx('proto-scroll', enterClass(nav.enter))}
                data-testid="proto-screen"
                data-screen={cur.id}
              >
                <div className="proto-content" style={{ width: size.w, height: fullH }}>
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
                      style={{ height: fullH }}
                    />
                  ) : null}
                  <div className="proto-hots" data-testid="proto-hots">
                    {showHots
                      ? fileSpots.map((h, i) => (
                          <Hot
                            // biome-ignore lint/suspicious/noArrayIndexKey: one per link element, in document order
                            key={i}
                            rect={h.rect}
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
                            rect={h.rect}
                            tag={edit ? t('返回') : null}
                            title={t('返回上一屏')}
                          />
                        ))
                      : null}
                    {edit && element ? <Hot rect={element.rect} tag={t('已选中')} selected /> : null}
                  </div>
                  {edit && element && menu ? (
                    <ElementMenu
                      el={element}
                      scale={scale}
                      width={size.w}
                      readOnly={readOnly}
                      bots={bots}
                      bot={bot}
                      onPickBot={pickBot}
                      onConnect={() => {
                        setMenu(false)
                        setConnect(true)
                      }}
                      onText={(text) =>
                        located
                          ? saveEdits(onEdit, [{ kind: 'text', ...located, text }])
                          : Promise.resolve(false)
                      }
                      onAi={(text) =>
                        askBot((b) =>
                          located
                            ? sendCommand(
                                artifactId,
                                { command: 'edit-with-ai', botId: b.id, ggIds: [located], text },
                                b.name,
                              )
                            : Promise.resolve(false),
                        )
                      }
                      onImagine={newScreen}
                      onClose={dropElement}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          {change ? (
            <ChangeBar
              bots={bots}
              bot={bot}
              onPickBot={pickBot}
              onSend={(text) => askBot((b) => askInChat(groupId, artifactId, b, text, [cur.id]))}
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
            items={(Object.keys(PROTO_DEVICES) as ProtoDevice[]).map((d) => ({
              label: `${DEVICE_LABEL[d]} ${PROTO_DEVICES[d].w}×${PROTO_DEVICES[d].h}`,
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

        {connect && element && edit ? (
          <ConnectPanel
            key={`${element.file}#${element.ggId}`}
            el={element}
            screens={screens.filter((s) => s.id !== cur.id)}
            readOnly={readOnly || !located}
            onApply={(ops) => saveEdits(onEdit, ops)}
            onClose={dropElement}
          />
        ) : null}

        {guide ? (
          <div className="proto-guide" role="dialog" aria-label={t('原型编辑器引导')}>
            <Icon name="play" size={18} />
            <p>
              {t(
                '欢迎使用原型编辑器！屏幕已经按跳转连好，可以直接点击体验。切到「编辑」可以连接元素、改文字，或让 AI 修改和新建屏幕。',
              )}
            </p>
            <Button size="small" variant="primary" onClick={closeGuide}>
              {t('开始体验')}
            </Button>
          </div>
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

/** A hotspot box in the screen's document coordinates; `tag` labels it in edit mode. */
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
      {tag ? <span className="proto-hot__tag">{tag}</span> : null}
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
function ChangeBar(props: {
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSend: (text: string) => Promise<boolean>
  onClose: () => void
}) {
  return (
    <div className="proto-change">
      <AskForm label={t('修改要求')} placeholder={t('描述要怎么改这屏…')} {...props}>
        <small className="proto-change__hint">{t('Esc 关闭')}</small>
      </AskForm>
    </div>
  )
}

/** Edit mode's element menu (Stitch: Connect to screen, Edit text, Change with AI, Imagine new screen). */
function ElementMenu({
  el,
  scale,
  width,
  readOnly,
  bots,
  bot,
  onPickBot,
  onConnect,
  onText,
  onAi,
  onImagine,
  onClose,
}: {
  el: PickedElement
  scale: number
  width: number
  readOnly: boolean
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onConnect: () => void
  onText: (text: string) => Promise<boolean>
  onAi: (text: string) => Promise<boolean>
  onImagine: (text: string) => Promise<boolean>
  onClose: () => void
}) {
  const [step, setStep] = useState<'menu' | 'text' | 'ai' | 'imagine'>('menu')
  const [text, setText] = useState(el.text)
  const [busy, setBusy] = useState(false)
  const located = el.ggId !== null
  const noSource = located ? undefined : t('脚本生成的元素，只能批注')
  const noBot = bot ? undefined : t('群里没有 Bot')
  const ro = readOnly ? t('AI 正在修改') : undefined
  // Inside the scaled screen, scaled back to its real size.
  const span = MENU_W / scale
  const left = Math.max(8, Math.min(el.rect.x, width - span - 8))
  const top = el.rect.y + el.rect.h + 8
  const action = (icon: IconName, label: string, hint: string | undefined, onClick: () => void) => (
    <button type="button" className="art-pop__action" disabled={!!hint} title={hint} onClick={onClick}>
      <Icon name={icon} size={15} />
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </button>
  )
  return (
    <div
      className="art-pop proto-pop"
      role="dialog"
      aria-label={t('编辑元素')}
      style={{ left, top, width: MENU_W, transform: `scale(${1 / scale})` }}
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
          {action('link', t('连到屏幕'), ro ?? noSource, onConnect)}
          {action(
            'textformat',
            t('编辑文字'),
            ro ?? noSource ?? (el.textOnly ? undefined : t('含子元素，交给 AI 修改')),
            () => setStep('text'),
          )}
          {action('sparkle', t('用 AI 修改'), noSource ?? noBot, () => setStep('ai'))}
          {action('plus', t('构想新屏'), noSource ?? noBot, () => setStep('imagine'))}
        </div>
      ) : step === 'text' ? (
        <form
          className="art-pop__form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (text === el.text) return
            setBusy(true)
            const ok = await onText(text)
            setBusy(false)
            if (ok) onClose()
          }}
        >
          <Textarea
            aria-label={t('文字')}
            value={text}
            rows={3}
            maxLength={5000}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
          <div className="art-pop__row">
            <Button size="small" variant="plain" onClick={() => setStep('menu')}>
              {t('返回')}
            </Button>
            <Button size="small" variant="primary" type="submit" disabled={busy || text === el.text}>
              {t('保存')}
            </Button>
          </div>
        </form>
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
