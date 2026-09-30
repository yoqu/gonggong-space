import { type NotificationDto, notificationView } from '@gonggong/protocol'
import { type AnimationEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { realtime } from '../../lib/realtime'
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  type IconName,
  listTime,
  NoNotificationsArt,
  type PresenceState,
  Spinner,
  Tag,
  toast,
  useEscape,
  usePresence,
} from '../../ui'
import { enablePush, type PushState, pushState } from './push'
import './notifications.css'

const ICON: Record<NotificationDto['type'], { icon: IconName; color: string }> = {
  approval: { icon: 'shield-warning', color: 'var(--system-orange)' },
  question: { icon: 'bubble-question', color: 'var(--system-indigo)' },
  lock: { icon: 'lock', color: 'var(--system-blue)' },
  offline_expired: { icon: 'wifi', color: 'var(--system-orange)' },
  chain_done: { icon: 'link', color: 'var(--system-gray)' },
  bot_confirm: { icon: 'bot', color: 'var(--system-orange)' },
  repo_access: { icon: 'git-branch', color: 'var(--system-red)' },
}

function PushAction() {
  const [state, setState] = useState<PushState>(pushState)
  if (state === 'unsupported') return null
  if (state === 'granted') return <span>浏览器通知已开启</span>
  if (state === 'denied') return <span>浏览器通知已被禁止，请在浏览器设置中允许</span>
  return (
    <Button
      size="small"
      variant="plain"
      onClick={() =>
        enablePush().then(setState, (e: Error) =>
          toast({ type: 'error', title: '开启浏览器通知失败', message: e.message }),
        )
      }
    >
      开启浏览器通知
    </Button>
  )
}

/** Glass notification popover opened from the NavRail. */
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
      toastError(e, '标记已读失败')
      return
    }
    const now = new Date().toISOString()
    setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? now })) ?? null)
    useWorkspace.setState({ notifCount: 0 })
  }

  const clearRead = async () => {
    try {
      await api.del('/notifications/read')
    } catch (e) {
      toastError(e, '清除已读失败')
      return
    }
    setItems((list) => list?.filter((n) => !n.readAt) ?? null)
  }

  const remove = async (n: NotificationDto) => {
    try {
      await api.del(`/notifications/${n.id}`)
    } catch (e) {
      toastError(e, '删除通知失败')
      return
    }
    setItems((list) => list?.filter((x) => x.id !== n.id) ?? null)
    if (!n.readAt) useWorkspace.setState((s) => ({ notifCount: Math.max(0, s.notifCount - 1) }))
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
          <Button
            size="small"
            variant="plain"
            disabled={!items?.some((n) => !n.readAt)}
            onClick={() => void readAll()}
          >
            全部标为已读
          </Button>
          <Button
            size="small"
            variant="plain"
            disabled={!items?.some((n) => n.readAt)}
            onClick={() => void clearRead()}
          >
            清除已读
          </Button>
        </div>
        <div className="notif__list" data-testid="notification-list">
          {failed ? (
            <div className="notif__empty">
              加载失败
              <Button size="small" variant="plain" onClick={load}>
                重试
              </Button>
            </div>
          ) : !items ? (
            <div className="notif__empty">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              compact
              illustration={<NoNotificationsArt />}
              title="暂无通知"
              description="需要你审批或回答的事项会出现在这里。"
            />
          ) : null}
          {failed
            ? null
            : items?.map((n) => {
                const v = notificationView(n)
                const { icon, color } = ICON[n.type]
                return (
                  <div key={n.id} className="notif__row">
                    <button
                      type="button"
                      className={cx(
                        'notif__item',
                        !n.readAt && 'notif__item--unread',
                        n.resolvedAt && 'notif__item--resolved',
                      )}
                      onClick={() => open(n)}
                    >
                      <span className="notif__icon" style={{ color }}>
                        <Icon name={icon} />
                      </span>
                      <div className="notif__body">
                        <div className="notif__line">
                          <span className="notif__type">{v.label}</span>
                          {n.resolvedAt ? <Tag>已处理</Tag> : null}
                          <span className="spacer" />
                          <span className="notif__time">{listTime(n.createdAt)}</span>
                        </div>
                        <div className="notif__text" title={v.text}>
                          {v.text}
                        </div>
                        {v.group ? <div className="notif__group">{v.group}</div> : null}
                      </div>
                    </button>
                    <IconButton
                      size="small"
                      variant="plain"
                      title="删除通知"
                      className="notif__delete"
                      onClick={() => void remove(n)}
                    >
                      <Icon name="xmark" />
                    </IconButton>
                  </div>
                )
              })}
        </div>
        <div className="notif__foot">
          只推送需要你操作的事项；模式切换、机器落后等群级事件只在群内显示。
          <PushAction />
        </div>
      </div>
    </>
  )
}
