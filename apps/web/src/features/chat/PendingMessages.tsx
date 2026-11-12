import type { MessageDto } from '@gonggong/protocol'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { Button, Message, Tag } from '../../ui'
import { dropPending, pendingOf, sendPending, usePending } from './pending'

/** My messages still on their way (发送中) or refused (发送失败, with 重发 / 删除), after the timeline. */
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
  return pendingOf(list, groupId, thread, messages).map((p) => {
    const retry = () => void sendPending(p, onSent)
    return (
      <div key={p.req.clientId} className="tl-item" data-testid="pending-message">
        <Message
          author={{ name: me?.name ?? '', avatar: me?.avatar ?? undefined }}
          self
          status={p.status}
          onRetry={retry}
          actions={false}
          bare={!p.req.body}
          reply={p.quote ? { author: p.quote.who, text: p.quote.text } : undefined}
          footer={
            p.files.length || p.status === 'failed' ? (
              <div className="tl-pending">
                {p.files.map((name) => (
                  <Tag key={name} tone="gray" icon="paperclip">
                    {name}
                  </Tag>
                ))}
                {p.status === 'failed' ? (
                  <>
                    <span className="tl-pending__failed">{t('发送失败')}</span>
                    <Button size="small" variant="plain" onClick={retry}>
                      {t('重发')}
                    </Button>
                    <Button size="small" variant="plain" onClick={() => dropPending(p.req.clientId)}>
                      {t('删除')}
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
