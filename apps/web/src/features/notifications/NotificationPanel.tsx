import { type NotificationDto, notificationView } from '@aiws/protocol'
import {
  Bot,
  Link2,
  Lock,
  type LucideIcon,
  MessageCircleQuestionMark,
  ShieldAlert,
  WifiOff,
} from 'lucide-react'
import { type AnimationEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { realtime } from '../../lib/realtime'
import { Badge, type PresenceState, Spinner, toast, useEscape, usePresence } from '../../ui'
import { fmtTime } from '../chat/TimelineItems'
import { enablePush, type PushState, pushState } from './push'
import './notifications.css'

const ICON: Record<NotificationDto['type'], { icon: LucideIcon; color: string }> = {
  approval: { icon: ShieldAlert, color: 'var(--color-brand-warm)' },
  question: { icon: MessageCircleQuestionMark, color: 'var(--color-brand-info)' },
  lock: { icon: Lock, color: 'var(--color-selection-blue)' },
  offline_expired: { icon: WifiOff, color: 'var(--color-brand-warm)' },
  chain_done: { icon: Link2, color: 'var(--color-text-tertiary)' },
  bot_confirm: { icon: Bot, color: 'var(--color-brand-warm)' },
}

function PushAction() {
  const [state, setState] = useState<PushState>(pushState)
  if (state === 'unsupported') return null
  if (state === 'granted') return <span className="notif__push-on">浏览器通知已开启</span>
  if (state === 'denied')
    return <span className="notif__push-on">浏览器通知已被禁止，请在浏览器设置中允许</span>
  return (
    <button
      type="button"
      className="notif__link"
      onClick={() =>
        enablePush().then(setState, (e: Error) =>
          toast({ type: 'error', title: '开启浏览器通知失败', message: e.message }),
        )
      }
    >
      开启浏览器通知
    </button>
  )
}

/** Top-bar notification popover (Web 对话.dc.html `notifs`). */
export function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const presence = usePresence(open)
  return presence.mounted ? (
    <Panel state={presence.state} onAnimationEnd={presence.onAnimationEnd} onClose={onClose} />
  ) : null
}

function Panel({
  state,
  onAnimationEnd,
  onClose,
}: {
  state: PresenceState
  onAnimationEnd: (e: AnimationEvent) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [items, setItems] = useState<NotificationDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  const count = useWorkspace((s) => s.notifCount)
  useEscape(onClose, state === 'open')

  const load = useCallback(() => {
    setFailed(false)
    api.get<NotificationDto[]>('/notifications').then(setItems, () => setFailed(true))
  }, [])

  // Refetch whenever a new one arrives while open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: count is the refresh trigger
  useEffect(load, [count])

  useEffect(
    () =>
      realtime.subscribe((e) => {
        if (e.t !== 'notification.resolved') return
        const done = new Map(e.notifications.map((n) => [n.id, n]))
        setItems((list) => list?.map((n) => done.get(n.id) ?? n) ?? null)
      }),
    [],
  )

  const readAll = async () => {
    try {
      await api.post('/notifications/read-all')
    } catch (e) {
      toast({ type: 'error', title: '标记已读失败', message: (e as Error).message })
      return
    }
    const now = new Date().toISOString()
    setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? now })) ?? null)
    useWorkspace.setState({ notifCount: 0 })
  }

  const open = (n: NotificationDto) => {
    if (!n.readAt) {
      useWorkspace.setState((s) => ({ notifCount: Math.max(0, s.notifCount - 1) }))
      void api.post(`/notifications/${n.id}/read`)
    }
    onClose()
    navigate(notificationView(n).href)
  }

  return (
    <>
      {state === 'open' ? <div className="notif__backdrop" onClick={onClose} aria-hidden="true" /> : null}
      <div
        className="notif ui-popover"
        role="dialog"
        aria-label="通知"
        data-state={state}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="notif__head">
          <span className="notif__title">通知</span>
          <span className="spacer" />
          <PushAction />
          <button type="button" className="notif__link" onClick={() => void readAll()}>
            全部标为已读
          </button>
        </div>
        <div className="notif__list" data-testid="notification-list">
          {failed ? (
            <div className="notif__empty">
              加载失败
              <button type="button" className="notif__link" onClick={load}>
                重试
              </button>
            </div>
          ) : !items ? (
            <div className="notif__empty">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <div className="notif__empty">暂无通知</div>
          ) : null}
          {failed
            ? null
            : items?.map((n) => {
                const v = notificationView(n)
                const { icon: Icon, color } = ICON[n.type]
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={cx(
                      'notif__item',
                      !n.readAt && 'notif__item--unread',
                      n.resolvedAt && 'notif__item--resolved',
                    )}
                    onClick={() => open(n)}
                  >
                    <Icon size={14} color={color} className="notif__icon" />
                    <div className="notif__body">
                      <div className="notif__line">
                        <span className="notif__type">{v.label}</span>
                        {n.resolvedAt ? <Badge size="xs">已处理</Badge> : null}
                        <span className="spacer" />
                        <span className="notif__time">{fmtTime(n.createdAt)}</span>
                      </div>
                      <div className="notif__text" title={v.text}>
                        {v.text}
                      </div>
                      {v.group ? <div className="notif__group">{v.group}</div> : null}
                    </div>
                  </button>
                )
              })}
        </div>
        <div className="notif__foot">只推送需要你操作的事项；模式切换、机器落后等群级事件只在群内显示。</div>
      </div>
    </>
  )
}
