import {
  type FeishuIdentityView,
  type NotificationDto,
  notificationView,
  type PermissionOption,
} from '@gonggong/protocol'
import { type AnimationEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { realtime } from '../../lib/realtime'
import { useGet } from '../../lib/useGet'
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
  useEscape,
  usePresence,
} from '../../ui'
import { useSettings } from '../settings/store'
import { otherTeam } from '../teams/store'
import { PushAction } from './NotificationSettings'
import './notifications.css'
import { t } from '../../i18n'

const ICON: Record<NotificationDto['type'], { icon: IconName; color: string }> = {
  approval: { icon: 'shield-warning', color: 'var(--system-orange)' },
  question: { icon: 'bubble-question', color: 'var(--system-indigo)' },
  offline_expired: { icon: 'wifi', color: 'var(--system-orange)' },
  chain_done: { icon: 'link', color: 'var(--system-gray)' },
  bot_confirm: { icon: 'bot', color: 'var(--system-orange)' },
  bot_shared: { icon: 'bot', color: 'var(--system-blue)' },
  repo_access: { icon: 'git-branch', color: 'var(--system-red)' },
  schedule_paused: { icon: 'clock', color: 'var(--system-orange)' },
  sync_drift: { icon: 'arrow-clockwise', color: 'var(--system-orange)' },
  sync_conflict: { icon: 'exclamation-circle', color: 'var(--system-red)' },
  mention: { icon: 'at', color: 'var(--system-blue)' },
  bot_share_request: { icon: 'person-add', color: 'var(--system-orange)' },
  bot_share_decided: { icon: 'bot', color: 'var(--system-blue)' },
  git_operation_request: { icon: 'git-branch', color: 'var(--system-orange)' },
  install_request: { icon: 'download', color: 'var(--system-orange)' },
  install_request_decided: { icon: 'download', color: 'var(--system-blue)' },
  listing_reviewed: { icon: 'shield-check', color: 'var(--system-green)' },
  listing_submitted: { icon: 'checklist', color: 'var(--system-orange)' },
  listing_banned: { icon: 'shield-warning', color: 'var(--system-red)' },
}

/** Whether 飞书通知 is on, and a way to its setting; only once the account is linked to Feishu. */
function FeishuNotifyShortcut({ onClose }: { onClose: () => void }) {
  const { data } = useGet<FeishuIdentityView>('/me/feishu')
  const openSettings = useSettings((s) => s.open)
  const identity = data?.identity
  if (!identity) return null
  return (
    <div className="notif__feishu">
      <span>{identity.notify ? t('飞书通知已开启') : t('飞书通知未开启')}</span>
      <Button
        size="small"
        variant="plain"
        onClick={() => {
          onClose()
          openSettings('notifications')
        }}
      >
        {t('飞书通知设置')}
      </Button>
    </div>
  )
}

/** 同意 / 拒绝 of a 申请共享 right in the notification; the settled notification arrives over realtime. */
function ShareRequestActions({ n }: { n: NotificationDto }) {
  const [busy, setBusy] = useState(false)
  const decide = async (verb: 'approve' | 'reject') => {
    setBusy(true)
    try {
      await api.post(`/share-requests/${n.payload.requestId}/${verb}`, {})
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="notif__actions">
      <Button size="small" variant="primary" disabled={busy} onClick={() => void decide('approve')}>
        {t('同意')}
      </Button>
      <Button size="small" disabled={busy} onClick={() => void decide('reject')}>
        {t('拒绝#reject')}
      </Button>
    </div>
  )
}

/**
 * 批准 / 拒绝 of an approval raised in a chat the owner is not in (someone's DM with a bot shared with them): there is
 * no card to decide on, so the notification carries the options. The settled notification arrives over realtime.
 */
function ApprovalActions({ n }: { n: NotificationDto }) {
  const [busy, setBusy] = useState(false)
  const options = (n.payload.options ?? []) as PermissionOption[]
  const allow = options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always')
  const reject =
    options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always')
  const decide = async (o: PermissionOption) => {
    setBusy(true)
    try {
      await api.post(`/runs/${n.payload.runId}/approvals/${n.payload.approvalId}`, { optionId: o.optionId })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="notif__actions">
      {allow ? (
        <Button size="small" variant="primary" disabled={busy} onClick={() => void decide(allow)}>
          {t('批准')}
        </Button>
      ) : null}
      {reject ? (
        <Button size="small" disabled={busy} onClick={() => void decide(reject)}>
          {t('拒绝#reject')}
        </Button>
      ) : null}
    </div>
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
  // Pushed since the panel opened: a list read while they arrived may predate them.
  const arrived = useRef<NotificationDto[]>([])
  const groups = useWorkspace((s) => s.groups)
  const outside = (n: NotificationDto) =>
    n.type === 'approval' &&
    !n.resolvedAt &&
    !!n.payload.options &&
    !groups.some((g) => g.id === n.payload.groupId)
  useEscape(onClose, state === 'open')

  const load = useCallback(() => {
    setFailed(false)
    api.get<NotificationDto[]>('/notifications').then(
      (list) => setItems([...arrived.current.filter((n) => !list.some((x) => x.id === n.id)), ...list]),
      () => setFailed(true),
    )
  }, [])

  useEffect(load, [load])

  useEffect(
    () =>
      realtime.subscribe((e) => {
        if (e.t === 'notification.new') {
          // Same scope as the list and the badge: this team's and platform-level ones.
          const n = e.notification
          if (otherTeam(n.teamId)) return
          arrived.current = [n, ...arrived.current]
          setItems((list) => list && [n, ...list.filter((x) => x.id !== n.id)])
        } else if (e.t === 'notification.resolved') {
          const done = new Map(e.notifications.map((n) => [n.id, n]))
          setItems((list) => list?.map((n) => done.get(n.id) ?? n) ?? null)
        }
      }),
    [],
  )

  const readAll = async () => {
    try {
      await api.post('/notifications/read-all')
    } catch (e) {
      toastError(e, t('标记已读失败'))
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
      toastError(e, t('清除已读失败'))
      return
    }
    setItems((list) => list?.filter((n) => !n.readAt) ?? null)
  }

  const remove = async (n: NotificationDto) => {
    try {
      await api.del(`/notifications/${n.id}`)
    } catch (e) {
      toastError(e, t('删除通知失败'))
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
    navigate(notificationView(n, t.text).href)
  }

  return (
    <>
      {state === 'open' ? <div className="notif__backdrop" onClick={onClose} aria-hidden="true" /> : null}
      <div
        className="notif ui-popover"
        role="dialog"
        aria-label={t('通知')}
        data-state={state}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="notif__head">
          <span className="notif__title">{t('通知')}</span>
          <span className="spacer" />
          <Button
            size="small"
            variant="plain"
            disabled={!items?.some((n) => !n.readAt)}
            onClick={() => void readAll()}
          >
            {t('全部标为已读')}
          </Button>
          <Button
            size="small"
            variant="plain"
            disabled={!items?.some((n) => n.readAt)}
            onClick={() => void clearRead()}
          >
            {t('清除已读')}
          </Button>
        </div>
        <div className="notif__list" data-testid="notification-list">
          {failed ? (
            <div className="notif__empty">
              {t('加载失败')}
              <Button size="small" variant="plain" onClick={load}>
                {t('重试')}
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
              title={t('暂无通知')}
              description={t('需要你审批或回答的事项会出现在这里。')}
            />
          ) : null}
          {failed
            ? null
            : items?.map((n) => {
                const v = notificationView(n, t.text)
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
                          {n.resolvedAt ? <Tag>{t('已处理')}</Tag> : null}
                          <span className="spacer" />
                          <span className="notif__time">{listTime(n.createdAt)}</span>
                        </div>
                        <div className="notif__text" title={v.text}>
                          {v.text}
                        </div>
                        {v.group ? <div className="notif__group">{v.group}</div> : null}
                      </div>
                    </button>
                    {outside(n) ? <ApprovalActions n={n} /> : null}
                    {n.type === 'bot_share_request' && !n.resolvedAt ? <ShareRequestActions n={n} /> : null}
                    <IconButton
                      size="small"
                      variant="plain"
                      title={t('删除通知')}
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
          {t('只推送需要你操作的事项；模式切换、机器落后等群级事件只在群内显示。')}
          <PushAction />
          <FeishuNotifyShortcut onClose={onClose} />
        </div>
      </div>
    </>
  )
}
