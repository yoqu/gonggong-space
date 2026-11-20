import type { MessageDto } from '@gonggong/protocol'
import { Fragment, type ReactNode } from 'react'
import { t } from '../../i18n'
import { Linkified } from '../../lib/links'
import { Icon, Mention, MessageCard, splitMentions } from '../../ui'

export interface MentionTarget {
  id: string
  name: string
}

const FULL_SHA = /\b([0-9a-f]{40})\b/gi
const COMMIT_LINE = /^(?:[-•*]\s+)?[0-9a-f]{7,40}\b/i

function renderTextSegments(text: string, byName: Map<string, string>, meId?: string, shortenSha = false) {
  const names = [...byName.keys()]
  return splitMentions(text, names).map((s, i) => {
    if (s.mention)
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
        <Mention key={i} name={s.text.slice(1)} me={!!meId && byName.get(s.text.slice(1)) === meId} />
      )
    if (!shortenSha || !FULL_SHA.test(s.text)) {
      FULL_SHA.lastIndex = 0
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
        <Fragment key={i}>
          <Linkified text={s.text} />
        </Fragment>
      )
    }
    FULL_SHA.lastIndex = 0
    const parts: ReactNode[] = []
    let last = 0
    for (const match of s.text.matchAll(FULL_SHA)) {
      const idx = match.index ?? 0
      if (idx > last) parts.push(<Linkified key={`t${last}`} text={s.text.slice(last, idx)} />)
      const sha = match[1]!
      parts.push(
        <code key={`s${idx}`} className="tl-webhook-card__sha" title={sha}>
          {sha.slice(0, 7)}
        </code>,
      )
      last = idx + sha.length
    }
    if (last < s.text.length) parts.push(<Linkified key={`t${last}`} text={s.text.slice(last)} />)
    // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
    return <Fragment key={i}>{parts}</Fragment>
  })
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
  // Only targets actually @-ed by id are highlighted.
  const ids = new Set([...m.mentions, ...(m.userMentions ?? [])])
  const byName = new Map(targets.filter((x) => ids.has(x.id)).map((x) => [x.name, x.id]))

  if (!card) {
    return <p>{renderTextSegments(m.body, byName, meId)}</p>
  }

  // Promote a concise first summary line into the card header so it doesn't repeat the message's webhook authorName.
  while (lines.length && !lines[0]?.trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop()
  const first = lines[0]?.trim() ?? ''
  const hasSummaryTitle =
    lines.length > 1 && first.length > 0 && first.length <= 120 && !/^https?:\/\//.test(first)
  const cardTitle = hasSummaryTitle ? first : card.tone === 'success' ? t('执行成功') : t('执行异常')
  const bodyLines = hasSummaryTitle ? lines.slice(1) : lines
  while (bodyLines.length && !bodyLines[0]?.trim()) bodyLines.shift()

  return (
    <MessageCard
      title={cardTitle}
      icon={card.tone === 'success' ? 'check' : 'exclamation-circle'}
      template={card.tone === 'success' ? 'green' : 'red'}
      className="tl-webhook-card"
    >
      {bodyLines.length ? (
        <div className="tl-webhook-card__text">
          {bodyLines.map((line, idx) => {
            const isCommit = COMMIT_LINE.test(line.trim())
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static webhook message lines
              <div key={idx} className={isCommit ? 'tl-webhook-card__commit' : undefined}>
                {line ? renderTextSegments(line, byName, meId, true) : '\u00a0'}
              </div>
            )
          })}
        </div>
      ) : null}
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
            {consoleLine >= 0 ? t('打开控制台') : t('打开链接')}
          </a>
        </div>
      ) : null}
    </MessageCard>
  )
}
