import type { AnnotationDto, AnnotationStatus, BotDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, Checkbox, EmptyState, Icon, Tag, type TagTone, Textarea } from '../../ui'
import { BotChoice } from './ElementPopover'
import { isRegion } from './elements'
import { Panel } from './SidePanel'

const STATUS: Record<AnnotationStatus, { label: string; tone: TagTone }> = {
  open: { label: t('待处理#note'), tone: 'orange' },
  sent: { label: t('已发给 AI'), tone: 'blue' },
  resolved: { label: t('已解决'), tone: 'green' },
}

/**
 * The annotations of the shown version (Mark M): the open ones are ticked to send to a bot as one @ message (untick
 * to leave some out); anyone resolves or reopens one, its author deletes it. Notes handed to the AI on an earlier
 * version head the panel once a newer one is shown, to be checked against it and resolved or reopened.
 */
export function AnnotationsPanel({
  list,
  meId,
  screenTitle,
  bots,
  bot,
  onPickBot,
  onSend,
  onStatus,
  onDelete,
  onFocus,
  elsewhere,
  sent = [],
  onView,
  onClose,
}: {
  list: AnnotationDto[]
  /** Open annotations on other versions, newest version first. */
  elsewhere: { versionId: string; n: number; count: number }[]
  onView: (versionId: string) => void
  /** Notes sent to the AI on earlier versions than the shown one, with their version's number. */
  sent?: (AnnotationDto & { n: number })[]
  meId: string | null
  screenTitle: (file: string) => string
  bots: BotDto[]
  bot: BotDto | null
  onPickBot: (id: string) => void
  onSend: (ids: string[], extra: string) => Promise<boolean>
  onStatus: (id: string, status: AnnotationStatus) => void
  onDelete: (id: string) => void
  onFocus: (a: AnnotationDto) => void
  onClose: () => void
}) {
  /** Notes whose tick differs from the default (open ones ticked, sent ones not). */
  const [flipped, setFlipped] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = list
    .filter((a) => a.status !== 'resolved' && (a.status === 'open') !== flipped.includes(a.id))
    .map((a) => a.id)
  const send = async () => {
    setBusy(true)
    const ok = await onSend(chosen, extra.trim())
    setBusy(false)
    if (ok) {
      setFlipped([])
      setExtra('')
    }
  }
  const sentBy = [...new Set(sent.map((a) => a.n))].sort((a, b) => b - a)

  return (
    <Panel title={t('批注')} onClose={onClose}>
      {sentBy.map((n) => {
        const notes = sent.filter((a) => a.n === n)
        return (
          <section
            key={n}
            className="art-notes__sent"
            data-testid="art-notes-sent"
            aria-label={t('已发给 AI')}
          >
            <header className="art-notes__sent-head">
              <Icon name="sparkle" size={12} />
              <span>{t('v{n} 上发给 AI 的 {k} 条批注，看看新版本改好了没有', { n, k: notes.length })}</span>
            </header>
            <ul>
              {notes.map((a) => (
                <li key={a.id} className="art-notes__sent-item">
                  <p>
                    <strong>{screenTitle(a.file)}</strong>
                    {a.note}
                  </p>
                  <Button size="small" variant="plain" onClick={() => onStatus(a.id, 'resolved')}>
                    {t('标为已解决')}
                  </Button>
                  <Button size="small" variant="plain" onClick={() => onStatus(a.id, 'open')}>
                    {t('重新打开')}
                  </Button>
                </li>
              ))}
            </ul>
            {notes.length > 1 ? (
              <Button
                size="small"
                variant="plain"
                onClick={() => {
                  for (const a of notes) onStatus(a.id, 'resolved')
                }}
              >
                {t('全部标为已解决')}
              </Button>
            ) : null}
          </section>
        )
      })}
      {list.length ? (
        <ol className="art-notes" data-testid="art-annotations">
          {list.map((a, i) => {
            const on = chosen.includes(a.id)
            return (
              <li key={a.id} className={cx('art-note', a.status === 'resolved' && 'art-note--done')}>
                <Checkbox
                  label={<span className="art-note__no">{i + 1}</span>}
                  checked={on}
                  disabled={a.status === 'resolved'}
                  onChange={() =>
                    setFlipped((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))
                  }
                />
                <div className="art-note__body">
                  <button type="button" className="art-note__head" onClick={() => onFocus(a)}>
                    <strong>{a.authorName}</strong>
                    <span className="art-note__where">{screenTitle(a.file)}</span>
                    <span className="art-note__kind">
                      <Icon name={isRegion(a) ? 'marquee' : 'cursor'} size={11} />
                      {isRegion(a) ? t('区域') : t('元素')}
                    </span>
                    <Tag tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Tag>
                  </button>
                  <p className="art-note__text">{a.note}</p>
                  <div className="art-note__acts">
                    {a.status === 'resolved' ? (
                      <Button size="small" variant="plain" onClick={() => onStatus(a.id, 'open')}>
                        {t('重新打开')}
                      </Button>
                    ) : (
                      <Button size="small" variant="plain" onClick={() => onStatus(a.id, 'resolved')}>
                        {t('解决')}
                      </Button>
                    )}
                    {a.authorId === meId ? (
                      <Button size="small" variant="plain" onClick={() => onDelete(a.id)}>
                        {t('删除')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      ) : sent.length ? null : (
        <EmptyState
          compact
          icon="marquee"
          title={t('还没有批注')}
          description={t('按 M 切到标记，点屏幕里的元素或拖框圈出区域写意见')}
        />
      )}
      {list.length
        ? null
        : elsewhere.map((v) => (
            <div key={v.versionId} className="art-notes__elsewhere" data-testid="art-notes-elsewhere">
              <span>{t('v{n} 上还有 {k} 条未处理批注', { n: v.n, k: v.count })}</span>
              <Button size="small" variant="plain" onClick={() => onView(v.versionId)}>
                {t('查看')}
              </Button>
            </div>
          ))}
      {list.length ? (
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
            disabled={busy || !bot || !chosen.length}
            onClick={() => void send()}
          >
            {bot ? t('发给 @{name}（{n}）', { name: bot.name, n: chosen.length }) : t('群里没有 Bot')}
          </Button>
        </div>
      ) : null}
    </Panel>
  )
}
