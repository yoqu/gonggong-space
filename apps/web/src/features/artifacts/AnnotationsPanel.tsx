import type { AnnotationDto, AnnotationStatus, BotDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, Checkbox, EmptyState, Tag, type TagTone, Textarea } from '../../ui'
import { BotChoice } from './ElementPopover'
import { Panel } from './SidePanel'

const STATUS: Record<AnnotationStatus, { label: string; tone: TagTone }> = {
  open: { label: t('待处理#note'), tone: 'orange' },
  sent: { label: t('已发给 AI'), tone: 'blue' },
  resolved: { label: t('已解决'), tone: 'green' },
}

/**
 * The annotations of the shown version (Mark M): tick some and send them to a bot as one @ message; anyone resolves
 * or reopens one, its author deletes it.
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
  onView,
  onClose,
}: {
  list: AnnotationDto[]
  /** Open annotations on other versions, newest version first. */
  elsewhere: { versionId: string; n: number; count: number }[]
  onView: (versionId: string) => void
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
  const [ticked, setTicked] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = ticked.filter((id) => list.some((a) => a.id === id))
  const send = async () => {
    setBusy(true)
    const ok = await onSend(chosen, extra.trim())
    setBusy(false)
    if (ok) {
      setTicked([])
      setExtra('')
    }
  }

  return (
    <Panel title={t('批注')} onClose={onClose}>
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
                  onChange={() => setTicked((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))}
                />
                <div className="art-note__body">
                  <button type="button" className="art-note__head" onClick={() => onFocus(a)}>
                    <strong>{a.authorName}</strong>
                    <span className="art-note__where">{screenTitle(a.file)}</span>
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
      ) : (
        <EmptyState
          compact
          icon="marquee"
          title={t('还没有批注')}
          description={t('按 M 切到标记，点屏幕里的元素写意见')}
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
