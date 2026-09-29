import type { PreviewDto } from '@gonggong/protocol'
import { useEffect, useRef } from 'react'
import { useSession } from '../../app/session'
import { EmptyState, Icon, PopUpButton, Tag, Tooltip } from '../../ui'
import { ControlBar, ControlRequests } from './control'
import { framePoint, keyInput, useLiveRoom, useLiveStats, useQuality, type Weak } from './live'
import './live.css'

/** Drags send at most this often; the release carries the final position. */
const MOVE_MS = 33
/** Wheel deltas are summed over this long: trackpads fire many tiny ones. */
const WHEEL_MS = 50
/** Where the machine owner fixes a live preview: gg-cast, permissions and its errors are all on this page. */
const DESKTOP_PAGE = '共工桌面端「实时画面」页'

/**
 * A live preview's picture (plan §6 GUI 观看页, B4): everyone watches; the member in control drives the machine's
 * window with the pointer, wheel and keyboard (typed text, IME included, arrives through a hidden text field).
 */
export function LiveView({ preview: p }: { preview: PreviewDto }) {
  const me = useSession((s) => s.user?.id)
  const { track, publication, weak, error, send } = useLiveRoom(p.id)
  const video = useRef<HTMLVideoElement>(null)
  const keys = useRef<HTMLTextAreaElement>(null)
  const pressed = useRef(false)
  const lastMove = useRef(0)
  const controlling = !!me && p.control?.controller?.id === me

  useEffect(() => {
    const el = video.current
    if (!track || !el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  useEffect(() => {
    const el = video.current
    if (!el || !controlling) return
    let pending: { x: number; y: number; dx: number; dy: number } | null = null
    const onWheel = (e: WheelEvent) => {
      const at = framePoint(el, e.clientX, e.clientY)
      if (!at) return
      e.preventDefault()
      if (!pending) {
        pending = { ...at, dx: 0, dy: 0 }
        setTimeout(() => {
          if (pending) send({ t: 'wheel', ...pending })
          pending = null
        }, WHEEL_MS)
      }
      pending.x = at.x
      pending.y = at.y
      pending.dx += e.deltaX
      pending.dy += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [controlling, send])

  const typed = (el: HTMLTextAreaElement) => {
    const text = el.value
    el.value = ''
    if (text) send({ t: 'text', text })
  }

  const problem = error
    ? { title: '无法连接实时画面', description: error }
    : p.status === 'offline'
      ? { title: '机器离线' }
      : p.status === 'stopped'
        ? { title: '应用已停止' }
        : p.live?.missing.includes('screen_recording')
          ? { title: '机器未授权屏幕录制', description: `请 Bot 主人在${DESKTOP_PAGE}完成授权` }
          : p.live?.state === 'failed'
            ? {
                title: '没有推送画面',
                description: [p.live.error, `Bot 主人可在${DESKTOP_PAGE}查看`].filter(Boolean).join('。'),
              }
            : !track
              ? { title: '正在启动实时画面…' }
              : null

  return (
    <div className="lv">
      <div className="lv__bar">
        <ControlBar preview={p} me={me} />
        <ControlRequests preview={p} />
        {(controlling || p.canManage) && p.live?.missing.includes('accessibility') ? (
          <span className="lv-warn">
            <Icon name="hand" size={12} />
            {`机器未授权辅助功能，远程操作不会生效，请在${DESKTOP_PAGE}完成授权`}
          </span>
        ) : null}
        {track ? <LiveNetwork track={track} publication={publication} weak={weak} /> : null}
      </div>
      <div className="lv__stage">
        {problem ? (
          <EmptyState icon="desktop" title={problem.title} description={problem.description} />
        ) : null}
        <video
          ref={video}
          hidden={!track}
          className={controlling ? 'lv__video lv__video--control' : 'lv__video'}
          aria-label={`${p.title} 实时画面`}
          autoPlay
          muted
          playsInline
          onPointerDown={(e) => {
            if (!controlling || e.button !== 0) return
            const at = framePoint(e.currentTarget, e.clientX, e.clientY)
            if (!at) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            pressed.current = true
            send({ t: 'down', ...at })
            keys.current?.focus()
          }}
          onPointerMove={(e) => {
            if (!pressed.current || e.timeStamp - lastMove.current < MOVE_MS) return
            const at = framePoint(e.currentTarget, e.clientX, e.clientY)
            if (!at) return
            lastMove.current = e.timeStamp
            send({ t: 'move', ...at })
          }}
          onPointerUp={(e) => {
            if (!pressed.current) return
            pressed.current = false
            const at = framePoint(e.currentTarget, e.clientX, e.clientY, true)
            if (at) send({ t: 'up', ...at })
          }}
        />
        {controlling ? (
          <textarea
            ref={keys}
            className="lv__keys"
            aria-label="键盘输入"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              const input = keyInput(e)
              if (!input) return
              e.preventDefault()
              send(input)
            }}
            onInput={(e) => {
              if (!(e.nativeEvent as InputEvent).isComposing) typed(e.currentTarget)
            }}
            onCompositionEnd={(e) => typed(e.currentTarget)}
          />
        ) : null}
      </div>
    </div>
  )
}

/** The picture's network figures and this viewer's quality pick, at the bar's right end. */
function LiveNetwork({
  track,
  publication,
  weak,
}: {
  track: Parameters<typeof useLiveStats>[0]
  publication: Parameters<typeof useQuality>[0]
  weak: Weak
}) {
  const live = useLiveStats(track)
  const { picks, pick, choose } = useQuality(publication)
  const who = weak.machine ? '机器网络差' : weak.me ? '你的网络差' : null
  const s = live?.stats
  const details = s
    ? [
        s.width && s.height ? `分辨率 ${s.width}×${s.height}` : null,
        `码率 ${(s.kbps / 1000).toFixed(1)} Mbps`,
        s.jitter === null ? null : `抖动 ${s.jitter} ms`,
        who,
        live.grade === 'poor' && pick !== 'auto' && pick !== picks.at(-1)?.value
          ? `网络较差，建议切换到「${picks.at(-1)?.label}」`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div className="lv-net">
      {live?.grade === 'poor' ? (
        <Tag tone="red">{who ?? '网络差'}</Tag>
      ) : live?.grade === 'fair' ? (
        <Tag tone="orange">网络一般</Tag>
      ) : null}
      {s && details ? (
        <Tooltip content={details} placement="bottom" delay={300}>
          <button type="button" className="lv-net__figures">
            {`${s.fps === null ? '—' : Math.round(s.fps)} fps · 丢包 ${(s.loss * 100).toFixed(1)}% · 延迟 ${s.rtt ?? '—'} ms`}
          </button>
        </Tooltip>
      ) : null}
      {picks.length ? (
        <PopUpButton
          size="small"
          aria-label="画质"
          options={picks.map((q) => ({ value: q.value, label: q.label }))}
          value={pick}
          onChange={choose}
        />
      ) : null}
    </div>
  )
}
