import type { MessageDto } from '@gonggong/protocol'
import { Fragment } from 'react'
import { t } from '../../i18n'
import { Linkified } from '../../lib/links'
import { Icon, Mention, MessageCard, splitMentions } from '../../ui'

export interface MentionTarget {
  id: string
  name: string
}

export function UserMessageText({
  m,
  targets,
  meId,
}: {
  m: MessageDto
  targets: MentionTarget[]
  meId?: string
}) {
  const card = m.webhookCard
  const lines = m.body.split('\n')
  const consoleLine = card?.url ? lines.lastIndexOf(`控制台：${card.url}`) : -1
  if (consoleLine >= 0) lines.splice(consoleLine, 1)
  const body = consoleLine >= 0 ? lines.join('\n').trimEnd() : m.body
  // Only targets actually @-ed by id are highlighted.
  const ids = new Set([...m.mentions, ...(m.userMentions ?? [])])
  const byName = new Map(targets.filter((x) => ids.has(x.id)).map((x) => [x.name, x.id]))
  const content = (
    <p className={card ? 'tl-webhook-card__text' : undefined}>
      {splitMentions(body, [...byName.keys()]).map((s, i) =>
        s.mention ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <Mention key={i} name={s.text.slice(1)} me={!!meId && byName.get(s.text.slice(1)) === meId} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <Fragment key={i}>
            <Linkified text={s.text} />
          </Fragment>
        ),
      )}
    </p>
  )
  if (!card) return content
  return (
    <MessageCard
      title={m.authorName}
      template={card.tone === 'success' ? 'green' : 'red'}
      className="tl-webhook-card"
    >
      {content}
      {card.url ? (
        <div className="pn-mcard__actions">
          <a
            className="ui-btn ui-btn--small"
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="external" />
            {t('打开链接')}
          </a>
        </div>
      ) : null}
    </MessageCard>
  )
}
