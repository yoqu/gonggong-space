import type { ArtifactThreadDto, ArtifactThreadStatus, BotDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../../i18n'
import { cx } from '../../../lib/cx'
import { ago } from '../../../lib/time'
import { Button, Checkbox, EmptyState, Icon, Tag, type TagTone, Textarea } from '../../../ui'
import { BotChoice } from '../ElementPopover'
import { Panel } from '../SidePanel'

const STATUS: Record<ArtifactThreadStatus, { label: string; tone: TagTone }> = {
  open: { label: t('待处理#note'), tone: 'orange' },
  sent: { label: t('已发给 AI'), tone: 'blue' },
  resolved: { label: t('已解决'), tone: 'green' },
}

function threadPlace(th: ArtifactThreadDto) {
  if (typeof th.anchor === 'string') return th.label || th.anchor
  if (th.anchor.kind === 'site')
    return `${th.anchor.path} (${Math.round(th.anchor.point.x)}, ${Math.round(th.anchor.point.y)})`
  if (th.anchor.kind === 'slides') return th.label || th.anchor.slide
  if (th.anchor.kind === 'whiteboard')
    return th.label || `(${Math.round(th.anchor.point.x)}, ${Math.round(th.anchor.point.y)})`
  if (th.anchor.kind === 'motion') return th.label || `${th.anchor.t}s`
  return th.label || th.anchor.file
}

/**
 * Unified comment threads sidebar for Shell artifacts (`site`, `slides`, `whiteboard`, `motion`).
 * Supports selecting open threads to send to a Bot, inline replies, resolve/reopen, and author delete.
 */
export function ThreadsSidebar({
  threads,
  versionId,
  meId,
  readOnly,
  activeId,
  bots,
  bot,
  onPickBot,
  onSelect,
  onReply,
  onStatus,
  onDelete,
  onSend,
  onClose,
}: {
  threads: ArtifactThreadDto[]
  versionId: string | null
  meId: string | null
  readOnly: boolean
  activeId: string | null
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSelect: (th: ArtifactThreadDto) => void
  onReply: (threadId: string, text: string) => Promise<void>
  onStatus: (threadId: string, status: ArtifactThreadStatus) => Promise<void>
  onDelete: (threadId: string) => Promise<void>
  onSend: (ids: string[], extra: string) => Promise<boolean>
  onClose: () => void
}) {
  const [flipped, setFlipped] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [sending, setSending] = useState(false)
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)

  const list = versionId ? threads.filter((x) => x.versionId === versionId) : threads
  const olderSent = versionId ? threads.filter((x) => x.versionId !== versionId && x.status === 'sent') : []

  const chosen = list
    .filter((x) => x.status !== 'resolved' && (x.status === 'open') !== flipped.includes(x.id))
    .map((x) => x.id)

  const send = async () => {
    setSending(true)
    const ok = await onSend(chosen, extra.trim())
    setSending(false)
    if (ok) {
      setFlipped([])
      setExtra('')
    }
  }

  const submitReply = async (threadId: string) => {
    const text = replyText.trim()
    if (!text) return
    setReplyBusy(true)
    try {
      await onReply(threadId, text)
      setReplyText('')
      setReplyOpen(null)
    } finally {
      setReplyBusy(false)
    }
  }

  return (
    <Panel title={t('批注')} onClose={onClose}>
      {olderSent.length ? (
        <section
          className="art-notes__sent"
          data-testid="shell-threads-older-sent"
          aria-label={t('已发给 AI')}
        >
          <header className="art-notes__sent-head">
            <Icon name="sparkle" size={12} />
            <span>
              {t('已发给 AI')} ({olderSent.length})
            </span>
          </header>
          <ul>
            {olderSent.map((th) => (
              <li key={th.id} className="art-notes__sent-item">
                <p>
                  <strong>{threadPlace(th)}</strong> {th.messages[0]?.text ?? ''}
                </p>
                {!readOnly ? (
                  <>
                    <Button size="small" variant="plain" onClick={() => void onStatus(th.id, 'resolved')}>
                      {t('标为已解决')}
                    </Button>
                    <Button size="small" variant="plain" onClick={() => void onStatus(th.id, 'open')}>
                      {t('重新打开')}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {list.length ? (
        <ol className="art-notes" data-testid="shell-threads">
          {list.map((th, i) => {
            const on = chosen.includes(th.id)
            const [first, ...replies] = th.messages
            return (
              <li
                key={th.id}
                data-testid={`shell-thread-${i + 1}`}
                className={cx(
                  'art-note',
                  th.status === 'resolved' && 'art-note--done',
                  activeId === th.id && 'art-shell__thread--active',
                )}
              >
                {!readOnly ? (
                  <Checkbox
                    label={<span className="art-note__no">{i + 1}</span>}
                    checked={on}
                    disabled={th.status === 'resolved'}
                    onChange={() =>
                      setFlipped((s) => (s.includes(th.id) ? s.filter((x) => x !== th.id) : [...s, th.id]))
                    }
                  />
                ) : (
                  <span className="art-note__no">{i + 1}</span>
                )}
                <div className="art-note__body">
                  <button type="button" className="art-note__head" onClick={() => onSelect(th)}>
                    <strong>{th.createdByName}</strong>
                    <span className="art-note__where">{threadPlace(th)}</span>
                    <Tag tone={STATUS[th.status].tone}>{STATUS[th.status].label}</Tag>
                  </button>
                  <p className="art-note__text">{first?.text ?? ''}</p>
                  {replies.length ? (
                    <ul className="art-shell__replies">
                      {replies.map((m) => (
                        <li key={m.id}>
                          <strong>{m.authorName}</strong>
                          <span>{m.text}</span>
                          <time>{ago(m.at)}</time>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!readOnly ? (
                    <div className="art-note__acts">
                      <Button
                        size="small"
                        variant="plain"
                        onClick={() => {
                          setReplyOpen((cur) => (cur === th.id ? null : th.id))
                          setReplyText('')
                        }}
                      >
                        {t('回复')}
                      </Button>
                      {th.status === 'resolved' ? (
                        <Button size="small" variant="plain" onClick={() => void onStatus(th.id, 'open')}>
                          {t('重新打开')}
                        </Button>
                      ) : (
                        <Button size="small" variant="plain" onClick={() => void onStatus(th.id, 'resolved')}>
                          {t('解决')}
                        </Button>
                      )}
                      {th.createdBy === meId ? (
                        <Button size="small" variant="plain" onClick={() => void onDelete(th.id)}>
                          {t('删除')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {!readOnly && replyOpen === th.id ? (
                    <div className="art-shell__reply-box">
                      <Textarea
                        rows={2}
                        maxLength={2000}
                        placeholder={t('回复这条批注…')}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                      />
                      <div className="art-shell__reply-acts">
                        <Button size="small" variant="plain" onClick={() => setReplyOpen(null)}>
                          {t('取消')}
                        </Button>
                        <Button
                          size="small"
                          variant="primary"
                          disabled={replyBusy || !replyText.trim()}
                          onClick={() => void submitReply(th.id)}
                        >
                          {t('回复')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <EmptyState
          compact
          icon="mappin"
          title={t('还没有批注')}
          description={readOnly ? undefined : t('请先点击上方「添加批注」在页面上落点')}
        />
      )}
      {!readOnly && list.length ? (
        <div className="art-notes__send">
          <Textarea
            aria-label={t('补充说明')}
            placeholder={t('补充说明（可选）')}
            rows={2}
            maxLength={2000}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
          <BotChoice bots={bots} bot={bot} onPick={onPickBot} />
          <Button
            variant="primary"
            icon="send"
            fullWidth
            disabled={sending || !bot || !chosen.length}
            onClick={() => void send()}
          >
            {bot ? t('发给 @{name}（{n}）', { name: bot.name, n: chosen.length }) : t('群里没有 Bot')}
          </Button>
        </div>
      ) : null}
    </Panel>
  )
}
