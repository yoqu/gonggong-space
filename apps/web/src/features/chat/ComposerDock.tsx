import type { MessageDto, RunDto, RunStatus } from '@gonggong/protocol'
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FloatingChat, ShowFloatingChat } from '../../app/floatingChat'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { motionTiming } from '../../lib/motion'
import { Icon } from '../../ui'
import { useCanvasChat } from '../artifacts/chatRoot'
import { hudOffset, ORB } from './composerDockHud'
import { usePending } from './pending'
import { STATUS_LABEL } from './RunGraphics'
import './composer-dock.css'

type Phase = 'open' | 'opening' | 'closing' | 'closed'
const KEY = 'gg.composerDock.hidden'
const POS_KEY = 'gg.composerDock.orbPos'
const DRAG_THRESHOLD = 5
const HUD_TTL_MS = 5000

export interface OrbPos {
  edge: 'bottom' | 'left' | 'right'
  ratio: number
}

export interface ComposerHud {
  tone?: 'sending' | 'sent' | 'running' | 'attention' | 'done'
  text: string
  /** Full detail for the hover tooltip while keeping the floating pill compact. */
  title?: string
  onClick?: () => void
}

const AWAITING: RunStatus[] = ['awaiting_approval', 'awaiting_answer']
const ACTIVE: RunStatus[] = ['running', 'queued', 'offline_wait']

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
const clamp01 = (v: number) => clamp(v, 0, 1)

function clipText(raw: string, max = 28): string {
  const one = raw.replace(/\s+/g, ' ').trim()
  if (!one) return '…'
  return one.length > max ? `${one.slice(0, max)}…` : one
}

const stored = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const storedPos = (): OrbPos => {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return { edge: 'bottom', ratio: 0.5 }
    const parsed = JSON.parse(raw) as Partial<OrbPos>
    if (
      (parsed.edge === 'bottom' || parsed.edge === 'left' || parsed.edge === 'right') &&
      typeof parsed.ratio === 'number' &&
      Number.isFinite(parsed.ratio)
    ) {
      return { edge: parsed.edge, ratio: clamp01(parsed.ratio) }
    }
  } catch {
    // Fall back to default bottom-center when storage is unavailable or corrupted.
  }
  return { edge: 'bottom', ratio: 0.5 }
}

type FlashHud = { kind: 'sent'; text: string } | { kind: 'done'; name: string; text: string }

type HudMessage = Pick<MessageDto, 'id' | 'kind' | 'authorName' | 'body'>

function useAutoHud(
  floating: boolean,
  groupId?: string,
  runs?: RunDto[],
  messages?: HudMessage[],
  onLocate?: (run: RunDto, pendingId?: string) => void,
): ComposerHud | null {
  const bots = useWorkspace((s) => s.bots)
  const sending = usePending((s) =>
    groupId
      ? s.list.find((p) => p.groupId === groupId && !p.req.threadRootId && p.status === 'sending')
      : undefined,
  )
  const [flash, setFlash] = useState<FlashHud | null>(null)
  const lastMsgId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const last = messages?.at(-1)
    if (!floating) {
      lastMsgId.current = last?.id ?? null
      setFlash(null)
      return
    }
    if (lastMsgId.current === undefined) {
      lastMsgId.current = last?.id ?? null
      return
    }
    if (!last || last.id === lastMsgId.current) return
    lastMsgId.current = last.id
    if (last.kind === 'user') {
      setFlash({ kind: 'sent', text: clipText(last.body) })
    } else if (last.kind === 'bot') {
      setFlash({ kind: 'done', name: last.authorName, text: clipText(last.body) })
    }
  }, [floating, messages])

  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), HUD_TTL_MS)
    return () => clearTimeout(timer)
  }, [flash])

  return useMemo(() => {
    if (!floating) return null
    const botName = (botId: string) => bots.find((b) => b.id === botId)?.name ?? 'Bot'

    if (runs?.length) {
      const attentionRun = runs.find((r) => AWAITING.includes(r.status))
      if (attentionRun) {
        const name = botName(attentionRun.botId)
        const approval = attentionRun.approvals.find((a) => a.status === 'pending')
        const question = attentionRun.questions.find((q) => q.status === 'pending')
        const kind = approval ? t('待审批') : t('待回答')
        const detail = clipText(
          approval?.title ?? question?.questions[0]?.title ?? STATUS_LABEL[attentionRun.status],
          48,
        )
        return {
          tone: 'attention',
          text: t('{name} · {kind}', { name, kind }),
          title: t('{kind}：{text}（{name}）', { kind, text: detail, name }),
          onClick: () => onLocate?.(attentionRun, approval?.id ?? question?.id),
        }
      }

      const activeRuns = runs.filter((r) => ACTIVE.includes(r.status))
      const activeRun = activeRuns.find((r) => r.status === 'running') ?? activeRuns[0]
      if (activeRun) {
        const name = botName(activeRun.botId)
        const more = activeRuns.length - 1
        const status = STATUS_LABEL[activeRun.status]
        return {
          tone: 'running',
          text:
            more > 0
              ? t('{name} +{n}', { name, n: more })
              : activeRun.status === 'running'
                ? name
                : t('{name} · {status}', { name, status }),
          title: t('{name} · {status}', { name, status }),
          onClick: () => onLocate?.(activeRun),
        }
      }
    }

    if (sending) {
      return {
        tone: 'sending',
        text: t('发送中'),
        title: t('正在发送「{text}」…', { text: clipText(sending.req.body) }),
      }
    }

    if (flash?.kind === 'sent') {
      return {
        tone: 'sent',
        text: t('已发送'),
        title: t('已发送「{text}」', { text: flash.text }),
      }
    }

    if (flash?.kind === 'done') {
      return {
        tone: 'done',
        text: t('{name} 已回复', { name: flash.name }),
        title: t('{name} 已回复：「{text}」', { name: flash.name, text: flash.text }),
      }
    }

    return null
  }, [floating, runs, bots, sending, flash, onLocate])
}

type DockProps = {
  children: ReactNode
  groupId?: string
  runs?: RunDto[]
  messages?: HudMessage[]
  onLocate?: (run: RunDto, pendingId?: string) => void
  hud?: ComposerHud | null
}

/**
 * 全屏 with an artifact's canvas in front, the canvas has its own composer (画布 AI 对话); the group's would float over
 * it, so it stays out of the way until the chat is opened.
 */
export function ComposerDock(props: DockProps) {
  const floating = useContext(FloatingChat)
  const canvasInFront = useCanvasChat((s) => !!props.groupId && !!s.byGroup[props.groupId])
  return floating && canvasInFront ? null : <Dock {...props} />
}

/**
 * The composer's place. Normally it stays in the chat column (layout-neutral); while the workbench is 全屏 it floats
 * over the workbench as a glass bar, and hides into a draggable edge-snapping glass orb (⌘J both ways).
 */
function Dock({ children, groupId, runs, messages, onLocate, hud: customHud }: DockProps) {
  const floating = useContext(FloatingChat)
  const showChat = useContext(ShowFloatingChat)
  const [phase, setPhase] = useState<Phase>(() => (stored() ? 'closed' : 'open'))
  const [at, setAt] = useState<{ left: number; width: number; height: number; bottom: number } | null>(null)
  const [orbPos, setOrbPos] = useState<OrbPos>(storedPos)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const shell = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const hudPos = useRef<HTMLDivElement>(null)
  const [hudSize, setHudSize] = useState({ w: 0, h: 0 })
  const from = useRef<{ w: number; h: number } | null>(null)
  const shellAnim = useRef<Animation | null>(null)
  const bodyAnim = useRef<Animation | null>(null)
  const dragged = useRef(false)

  const autoHud = useAutoHud(floating, groupId, runs, messages, onLocate)
  const hud = customHud !== undefined ? customHud : autoHud

  // Over the workbench: centred on it, clear of its edges.
  useLayoutEffect(() => {
    if (!floating) return
    const bench = document.querySelector<HTMLElement>('.bench')
    if (!bench) return
    const place = () => {
      const r = bench.getBoundingClientRect()
      const next = {
        left: r.left + 24,
        width: Math.max(r.width - 48, 0),
        height: Math.max(r.height - 32, 0),
        bottom: window.innerHeight - r.bottom + 16,
      }
      setAt((prev) =>
        prev &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.bottom === next.bottom
          ? prev
          : next,
      )
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(bench)
    window.addEventListener('resize', place)
    // Switching to 全屏 slides the layout: a move without a resize, so measure again once it settles.
    document.addEventListener('transitionend', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('transitionend', place)
    }
  }, [floating])

  const travelW = Math.max((at?.width || window.innerWidth - 48 || 720) - ORB, 200)
  const travelH = Math.max((at?.height || window.innerHeight - 32 || 500) - ORB, 200)
  const dockedOffset = useMemo(() => {
    if (orbPos.edge === 'left') {
      return { x: Math.round(-travelW / 2), y: Math.round(-travelH * (1 - clamp01(orbPos.ratio))) }
    }
    if (orbPos.edge === 'right') {
      return { x: Math.round(travelW / 2), y: Math.round(-travelH * (1 - clamp01(orbPos.ratio))) }
    }
    return { x: Math.round((clamp01(orbPos.ratio) - 0.5) * travelW), y: 0 }
  }, [orbPos, travelW, travelH])
  const activeOffset = dragOffset ?? dockedOffset
  const dockedOffsetRef = useRef(dockedOffset)
  dockedOffsetRef.current = dockedOffset

  const persist = (hidden: boolean) => {
    try {
      localStorage.setItem(KEY, hidden ? '1' : '0')
    } catch {
      // Storage unavailable: the choice lasts for this page.
    }
  }

  const persistPos = (pos: OrbPos) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos))
    } catch {
      // Storage unavailable: position lasts for this page.
    }
  }

  const toggle = () => {
    const s = shell.current
    if (!s) return
    // Fully interruptible mid-flight: pressing ⌘J while opening/closing reverses from the current animated state.
    if (phase === 'closed' || phase === 'closing') {
      persist(false)
      return setPhase('opening')
    }
    persist(true)
    if (s.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    const timing = motionTiming('--spring-smooth')
    if (!timing || typeof s.animate !== 'function') return setPhase('closed')
    const r = s.getBoundingClientRect()
    from.current = { w: r.width || s.offsetWidth, h: r.height || s.offsetHeight }
    setPhase('closing')
  }

  // Pure compositor animation (transform + clipPath + opacity): zero width/height layout thrash and mid-flight reversible.
  useLayoutEffect(() => {
    const s = shell.current
    const b = body.current
    if (!s || !b) return
    const prevShell = shellAnim.current
    const prevBody = bodyAnim.current
    const interrupting = prevShell?.playState === 'running'
    // Snapshot primitives BEFORE cancel() — getComputedStyle returns a live CSSStyleDeclaration that resets on cancel.
    const shellStyle = interrupting ? getComputedStyle(s) : null
    const liveShell = shellStyle ? { transform: shellStyle.transform, clipPath: shellStyle.clipPath } : null
    const bodyStyle = prevBody?.playState === 'running' ? getComputedStyle(b) : null
    const parsedBodyOpacity = bodyStyle ? Number.parseFloat(bodyStyle.opacity) : Number.NaN
    const liveBody = bodyStyle
      ? {
          opacity: Number.isFinite(parsedBodyOpacity) ? parsedBodyOpacity : null,
          transform: bodyStyle.transform,
        }
      : null
    const cancelRef = (ref: { current: Animation | null }) => {
      const a = ref.current
      if (!a) return
      ref.current = null
      a.onfinish = null
      a.cancel()
    }
    cancelRef(shellAnim)
    cancelRef(bodyAnim)
    if (phase === 'open' || phase === 'closed') {
      for (const a of s.getAnimations?.() ?? []) a.cancel()
      for (const a of b.getAnimations?.() ?? []) a.cancel()
      return
    }
    const { x: ox, y: oy } = dockedOffsetRef.current
    const r = s.getBoundingClientRect()
    const w = Math.max(r.width || s.offsetWidth || from.current?.w || 400, ORB)
    const h = Math.max(r.height || s.offsetHeight || from.current?.h || 96, ORB)
    const radius = getComputedStyle(s).borderTopLeftRadius || '18px'
    const topInset = Math.max(0, h - ORB)
    const sideInset = Math.max(0, (w - ORB) / 2)
    const openFrame = {
      transform: 'translate3d(0px, 0px, 0)',
      clipPath: `inset(0px 0px 0px 0px round ${radius})`,
    }
    const orbFrame = {
      transform: `translate3d(${ox}px, ${oy}px, 0)`,
      clipPath: `inset(${topInset}px ${sideInset}px 0px ${sideInset}px round ${ORB / 2}px)`,
    }
    const liveFrame = (fallback: typeof openFrame) =>
      liveShell
        ? {
            transform:
              liveShell.transform && liveShell.transform !== 'none'
                ? liveShell.transform
                : fallback.transform,
            clipPath:
              liveShell.clipPath && liveShell.clipPath !== 'none' ? liveShell.clipPath : fallback.clipPath,
          }
        : fallback

    if (phase === 'opening') {
      const timing = motionTiming('--spring-bouncy')
      if (!timing || typeof s.animate !== 'function') return setPhase('open')
      const { duration, easing } = timing
      const grow = s.animate([liveFrame(orbFrame), openFrame], { duration, easing })
      shellAnim.current = grow
      const bodyStart = liveBody
        ? {
            opacity: liveBody.opacity ?? 0,
            transform: liveBody.transform && liveBody.transform !== 'none' ? liveBody.transform : 'none',
          }
        : { opacity: 0, transform: 'translateY(6px) scale(0.98)' }
      bodyAnim.current = b.animate([bodyStart, { opacity: 1, transform: 'none' }], {
        duration: duration * 0.5,
        delay: interrupting ? 0 : duration * 0.25,
        easing,
        fill: 'backwards',
      })
      grow.onfinish = () => {
        if (shellAnim.current !== grow) return
        shellAnim.current = null
        setPhase('open')
        b.querySelector('textarea')?.focus()
      }
      return
    }
    if (phase === 'closing') {
      const timing = motionTiming('--spring-smooth')
      if (!timing || typeof s.animate !== 'function') return setPhase('closed')
      const { duration, easing } = timing
      const bodyStart = liveBody
        ? {
            opacity: liveBody.opacity ?? 1,
            transform: liveBody.transform && liveBody.transform !== 'none' ? liveBody.transform : 'scale(1)',
          }
        : { opacity: 1, transform: 'scale(1)' }
      bodyAnim.current = b.animate([bodyStart, { opacity: 0, transform: 'scale(0.96)' }], {
        duration: duration * 0.25,
        easing: 'ease-out',
        fill: 'forwards',
      })
      const shrink = s.animate([liveFrame(openFrame), orbFrame], { duration, easing, fill: 'forwards' })
      shellAnim.current = shrink
      shrink.onfinish = () => {
        if (shellAnim.current !== shrink) return
        shellAnim.current = null
        setPhase('closed')
      }
    }
  }, [phase])

  // ⌘J hides and shows it while floating.
  useEffect(() => {
    if (!floating) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onOrbPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const startOx = dockedOffset.x
    const startOy = dockedOffset.y
    let curOx = startOx
    let curOy = startOy
    let moved = false
    dragged.current = false

    const onMove = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        moved = true
        dragged.current = true
      }
      if (!moved) return
      curOx = Math.round(clamp(startOx + dx, -travelW / 2, travelW / 2))
      curOy = Math.round(clamp(startOy + dy, -travelH, 0))
      setDragOffset({ x: curOx, y: curOy })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!moved) return
      const dLeft = curOx + travelW / 2
      const dRight = travelW / 2 - curOx
      const dBottom = -curOy
      let nextPos: OrbPos
      if (dBottom <= dLeft && dBottom <= dRight) {
        nextPos = { edge: 'bottom', ratio: travelW > 0 ? clamp01((curOx + travelW / 2) / travelW) : 0.5 }
      } else if (dLeft <= dRight) {
        nextPos = { edge: 'left', ratio: travelH > 0 ? clamp01(1 + curOy / travelH) : 1 }
      } else {
        nextPos = { edge: 'right', ratio: travelH > 0 ? clamp01(1 + curOy / travelH) : 1 }
      }
      setOrbPos(nextPos)
      persistPos(nextPos)
      setDragOffset(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const onOrbClick = () => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    toggle()
  }

  const closed = floating && phase === 'closed'
  const orbTransform =
    closed && (activeOffset.x !== 0 || activeOffset.y !== 0)
      ? `translate3d(${activeOffset.x}px, ${activeOffset.y}px, 0)`
      : undefined
  const showHud = floating && !!hud && phase !== 'closing'

  useLayoutEffect(() => {
    const el = hudPos.current
    if (!showHud || !el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    setHudSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
  })

  const hudShift = closed
    ? hudOffset({
        edge: orbPos.edge,
        orb: activeOffset,
        width: travelW + ORB,
        height: travelH + ORB,
        hud: hudSize,
      })
    : null
  const hudTransform =
    hudShift && (hudShift.x !== 0 || hudShift.y !== 0)
      ? `translate3d(${hudShift.x}px, ${hudShift.y}px, 0)`
      : undefined

  return (
    <div
      className={cx('cdock', floating && 'cdock--float')}
      data-phase={floating ? phase : undefined}
      data-dragging={closed && dragOffset ? '' : undefined}
      style={floating && at ? { left: at.left, width: at.width, bottom: at.bottom } : undefined}
    >
      {showHud && hud ? (
        // Positioned here, animated in on the button: the enter keyframes would override this transform.
        <div
          ref={hudPos}
          className="cdock__hud-pos"
          style={hudTransform ? { transform: hudTransform } : undefined}
        >
          <button
            type="button"
            className="cdock__hud"
            data-testid="cdock-hud"
            data-tone={hud.tone ?? 'sent'}
            aria-label={t('{text} · 展开聊天', { text: hud.title ?? hud.text })}
            title={t('{text} · 点击展开聊天', { text: hud.title ?? hud.text })}
            onClick={() => {
              hud.onClick?.()
              showChat?.()
            }}
          >
            {hud.tone === 'running' || hud.tone === 'sending' ? (
              <span className="cdock__hud-wave" data-testid="cdock-hud-anim" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <span className="cdock__hud-dot" aria-hidden="true" />
            )}
            <span className="cdock__hud-text">{hud.text}</span>
            <span className="cdock__hud-action" aria-hidden="true">
              <Icon name="chevron-right" size={12} />
            </span>
          </button>
        </div>
      ) : null}
      <div
        ref={shell}
        className={cx('cdock__shell', closed && 'cdock__shell--orb')}
        data-edge={closed ? orbPos.edge : undefined}
        data-dragging={closed && dragOffset ? '' : undefined}
        style={orbTransform ? { transform: orbTransform } : undefined}
      >
        {floating && (phase === 'open' || phase === 'opening') ? (
          <>
            <span
              className="cdock__grip"
              data-testid="cdock-grip"
              aria-hidden="true"
              title={t('收起输入框 ⌘J')}
              onClick={toggle}
            />
            <button
              type="button"
              className="cdock__hide"
              aria-label={t('收起输入框')}
              title={t('收起输入框 ⌘J')}
              onClick={toggle}
            >
              <Icon name="chevron-down" size={12} />
              <span>{t('收起')}</span>
              <kbd className="cdock__kbd">⌘J</kbd>
            </button>
          </>
        ) : null}
        <div ref={body} className="cdock__body" hidden={closed} inert={closed || undefined}>
          {children}
        </div>
        {closed ? (
          <button
            type="button"
            className="cdock__orb"
            aria-label={t('展开输入框')}
            title={t('展开输入框 ⌘J')}
            onPointerDown={onOrbPointerDown}
            onClick={onOrbClick}
          >
            <Icon name="message" size={18} />
            {hud ? (
              <span className="cdock__orb-badge" data-tone={hud.tone ?? 'sent'} aria-hidden="true" />
            ) : null}
          </button>
        ) : null}
      </div>
    </div>
  )
}
