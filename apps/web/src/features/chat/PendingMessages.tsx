import type { MessageDto } from '@gonggong/protocol'
import { useEffect, useRef } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { realtime } from '../../lib/realtime'
import { Button, Message, Tag } from '../../ui'
import { autoResendable, dropPending, pendingOf, restorePending, sendPending, usePending } from './pending'

const MAX_TRACKED = 200
const optimisticClientIds = new Set<string>()

function rememberOptimisticClientId(id: string) {
  if (!id || optimisticClientIds.has(id)) return
  optimisticClientIds.add(id)
  if (optimisticClientIds.size > MAX_TRACKED) {
    const first = optimisticClientIds.values().next().value
    if (first) optimisticClientIds.delete(first)
  }
}

/** Whether `clientId` was rendered as an optimistic pending row (suppresses a second entrance when confirmed). */
export const hasOptimisticClientId = (id?: string | null) => !!id && optimisticClientIds.has(id)

/** My messages still on their way (发送中) or refused (发送失败, with 重发 / 放回输入框 / 丢弃), after the timeline. */
export function PendingMessages({
  groupId,
  thread,
  messages,
  onSent,
}: {
  groupId: string
  thread?: string
  messages: MessageDto[]
  onSent: (m: MessageDto) => void
}) {
  const list = usePending((s) => s.list)
  const me = useSession((s) => s.user)
  const latest = useRef({ groupId, thread, messages, onSent })
  latest.current = { groupId, thread, messages, onSent }
  // Sends the connection cut off a moment ago go again once it is back; older ones wait for the user to decide.
  useEffect(
    () =>
      realtime.onReconnect(() => {
        const { groupId, thread, messages, onSent } = latest.current
        for (const p of pendingOf(usePending.getState().list, groupId, thread, messages))
          if (autoResendable(p)) void sendPending(p, onSent, true)
      }),
    [],
  )
  return pendingOf(list, groupId, thread, messages).map((p) => {
    rememberOptimisticClientId(p.req.clientId)
    const retry = () => void sendPending(p, onSent)
    return (
      <div
        key={p.req.clientId}
        className="tl-item tl-item--enter"
        data-client-id={p.req.clientId}
        data-testid="pending-message"
      >
        <Message
          author={{ name: me?.name ?? '', avatar: me?.avatar ?? undefined }}
          self
          status={p.status}
          onRetry={retry}
          actions={false}
          bare={!p.req.body}
          reply={p.draft.quote ? { author: p.draft.quote.who, text: p.draft.quote.text } : undefined}
          footer={
            p.draft.uploads.length || p.status === 'failed' || p.auto ? (
              <div className="tl-pending">
                {p.draft.uploads.map((u) => (
                  <Tag key={u.key} tone="gray" icon="paperclip">
                    {u.name}
                  </Tag>
                ))}
                {p.auto && p.status === 'sending' ? (
                  <span className="tl-pending__resending">{t('网络恢复，正在重发')}</span>
                ) : null}
                {p.status === 'failed' ? (
                  <>
                    <span className="tl-pending__failed">{t('发送失败')}</span>
                    <Button size="small" variant="plain" onClick={retry}>
                      {t('重发')}
                    </Button>
                    <Button size="small" variant="plain" onClick={() => restorePending(p)}>
                      {t('放回输入框')}
                    </Button>
                    <Button size="small" variant="plain" onClick={() => dropPending(p.req.clientId)}>
                      {t('丢弃')}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null
          }
        >
          {p.req.body || undefined}
        </Message>
      </div>
    )
  })
}
