import type { Answer, Question, QuestionSetDto, RunDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { useNow } from '../../lib/now'
import { countdown, hm } from '../../lib/time'
import { Avatar, Button, Icon, Tag, Textarea } from '../../ui'
import { workspacePath } from '../attachments/api'
import { AttachmentChips, useUploads } from '../attachments/ComposerAttachments'
import { Swatches } from '../plugins/PluginTile'
import { QUESTION_TYPE } from './mcp'
import { answerLines } from './process'
import { useMemberName } from './RunActions'
import './question.css'
import { t } from '../../i18n'

const LIVE: RunDto['status'][] = ['running', 'awaiting_approval', 'awaiting_answer']

type Draft = { choices: number[]; text: string }

const EMPTY: Draft = { choices: [], text: '' }

/** Options with design metadata (plan 插件体系-方案 §5) render as cards with leanings. */
const rich = (q: Question) => !!q.optionMeta?.length && q.type !== 'text'

const answered = (q: Question, d: Draft) => {
  const text = d.text.trim() !== ''
  switch (q.type) {
    case 'text':
      return text
    case 'yesno':
      return d.choices.length === 1
    case 'single':
      return d.choices.length === 1 || text
    case 'multi':
      return d.choices.length > 0 || text
  }
}

function outcome(q: QuestionSetDto, run: RunDto) {
  switch (q.status) {
    case 'answered':
      return t('{name} 已回答 · {at} · 已写入审计记录', {
        name: q.answeredByName ?? '',
        at: q.answeredAt ? hm(q.answeredAt) : '',
      })
    case 'expired':
      return t('无人回答，agent 已按推荐项继续 · {at}', { at: hm(q.expiresAt) })
    case 'void':
      if (LIVE.includes(run.status)) return t('提问已作废，agent 不再等待回答')
      return run.status === 'interrupted' ? t('运行已停止，提问作废') : t('运行已结束，提问作废')
    default:
      return null
  }
}

/** The run's latest 「向群成员提问」 card (spec §8.8): the trigger user or the bot owner answers, others watch. */
export function QuestionBlock({ run }: { run: RunDto }) {
  const q = run.questions.at(-1)
  // A new card starts with empty drafts.
  return q ? <QuestionCard key={q.id} run={run} set={q} /> : null
}

/** One 「向群成员提问」 card of the run, answerable while pending. */
export function QuestionCard({ run, set }: { run: RunDto; set: QuestionSetDto }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const me = useSession((s) => s.user?.id)
  const trigger = useMemberName(run.groupId, run.originUserId)
  const pending = set.status === 'pending'
  const now = useNow(pending)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const uploads = useUploads(run.groupId)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const canAnswer = pending && !!me && (me === run.originUserId || me === bot?.ownerId)
  const locked = !canAnswer || busy

  const draftOf = (question: Question): Draft => {
    const a = set.answers?.find((x) => x.questionId === question.id)
    return a ? { choices: a.choices, text: a.text ?? '' } : (drafts[question.id] ?? EMPTY)
  }
  const edit = (question: Question, next: Draft) => setDrafts((d) => ({ ...d, [question.id]: next }))
  const pick = (question: Question, i: number) => {
    const d = draftOf(question)
    if (question.type === 'multi') {
      const choices = d.choices.includes(i) ? d.choices.filter((c) => c !== i) : [...d.choices, i]
      edit(question, { ...d, choices })
    } else edit(question, { choices: [i], text: '' })
  }
  const other = (question: Question, text: string) => {
    const d = draftOf(question)
    // A single choice is either an option or 「其他」.
    edit(question, { choices: question.type === 'single' && text.trim() ? [] : d.choices, text })
  }

  const submit = async () => {
    const answers: Answer[] = set.questions.map((question) => {
      const d = draftOf(question)
      const text = d.text.trim()
      return {
        questionId: question.id,
        choices: d.choices,
        text: question.type === 'yesno' || !text ? null : text,
      }
    })
    setBusy(true)
    try {
      await api.post(`/runs/${run.id}/questions/${set.id}/answers`, {
        answers,
        attachmentIds: uploads.ids,
      })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const [leanings, setLeanings] = useState(set.leanings ?? [])
  useEffect(() => setLeanings(set.leanings ?? []), [set.leanings])
  const lean = async (question: Question, choice: number) => {
    try {
      const next = await api.post<QuestionSetDto>(`/runs/${run.id}/questions/${set.id}/leanings`, {
        questionId: question.id,
        choice,
      })
      setLeanings(next.leanings ?? [])
    } catch (e) {
      toastError(e)
    }
  }
  const imageUrl = (path: string) =>
    `/api/groups/${run.groupId}/bots/${run.botId}/files/raw?path=${encodeURIComponent(path)}`
  const anyRich = set.questions.some(rich)

  const owner = bot?.ownerName ?? ''
  const who =
    run.originUserId === bot?.ownerId
      ? t('{name}（触发人兼 Bot 主人）可回答', { name: trigger })
      : t('触发人 {trigger} 或 Bot 主人 {owner} 可回答', { trigger, owner })
  const ready = set.questions.every((question) => answered(question, draftOf(question)))
  const done = (
    <div className="question__done">
      <Tag tone={set.status === 'answered' ? 'green' : 'gray'}>
        {set.status === 'answered' ? t('已回答') : set.status === 'expired' ? t('已超时') : t('已作废')}
      </Tag>
      <span>{outcome(set, run)}</span>
      <button type="button" className="question__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t('收起') : t('查看提问')}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={10} />
      </button>
    </div>
  )

  // Once settled, the card shrinks to what was decided; the questions stay one click away.
  if (!pending && !open)
    return (
      <div className="question question--brief">
        <div className="question__title">
          <Icon name="bubble-question" size={14} />
          <span>{t('向群成员提问 · {n} 个问题', { n: set.questions.length })}</span>
        </div>
        {set.status === 'answered' ? (
          <ul className="question__answers">
            {answerLines(set)
              .split('\n')
              .map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: one line per question, in order
                <li key={i} title={line}>
                  {line}
                </li>
              ))}
          </ul>
        ) : null}
        {done}
      </div>
    )

  return (
    <div className="question" data-pending-id={pending ? set.id : undefined}>
      <div className="question__head">
        <div className="question__title">
          <Icon name="bubble-question" size={14} />
          <span>{t('向群成员提问 · {n} 个问题', { n: set.questions.length })}</span>
        </div>
        <div className="question__meta">
          <span>{who}</span>
          {pending && anyRich ? <span>{t('其他人的倾向仅供参考，不算投票')}</span> : null}
          {pending ? (
            <span className="question__timeout" title={t('超时后 agent 按推荐项继续，并在最终回复列出假设')}>
              {t('{time} 后超时，按推荐项继续', { time: countdown(Date.parse(set.expiresAt) - now) })}
            </span>
          ) : null}
        </div>
      </div>
      {set.questions.map((question) => {
        const d = draftOf(question)
        return (
          <div key={question.id} className="question__item">
            <div className="question__q">
              <span className="question__type">{QUESTION_TYPE[question.type]}</span>
              <span>{question.title}</span>
            </div>
            {rich(question) ? (
              <div className="qopts">
                {question.options.map((label, i) => {
                  const on = d.choices.includes(i)
                  const meta = question.optionMeta?.[i]
                  const leaners = leanings.filter((l) => l.questionId === question.id && l.choice === i)
                  const mine = leaners.some((l) => l.userId === me)
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
                    <div key={i} className={cx('qopt', on && 'qopt--on')}>
                      <button
                        type="button"
                        className="qopt__pick"
                        aria-label={label}
                        aria-pressed={on}
                        disabled={locked}
                        onClick={() => pick(question, i)}
                      >
                        {meta?.image ? (
                          <img className="qopt__img" src={imageUrl(meta.image)} alt={label} />
                        ) : null}
                        {meta?.swatch.length ? (
                          <Swatches colors={meta.swatch} className="qopt__swatch" />
                        ) : null}
                        <span className="qopt__title">
                          <span>{label}</span>
                          {question.recommended === i ? (
                            <span className="question__rec">{t('推荐')}</span>
                          ) : null}
                        </span>
                        {meta?.description ? <span className="qopt__desc">{meta.description}</span> : null}
                        {on ? (
                          <span className="qopt__check" aria-hidden>
                            <Icon name="check" size={10} />
                          </span>
                        ) : null}
                      </button>
                      {pending ? (
                        <div className="qopt__lean">
                          {leaners.map((l) => (
                            <span key={l.userId} role="img" aria-label={t('{name} 倾向', { name: l.name })}>
                              <Avatar name={l.name} size={16} />
                            </span>
                          ))}
                          <button
                            type="button"
                            className="qopt__lean-btn"
                            aria-label={
                              mine ? t('取消倾向 {label}', { label }) : t('倾向 {label}', { label })
                            }
                            disabled={!me}
                            onClick={() => void lean(question, i)}
                          >
                            {mine ? t('取消倾向') : t('倾向')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : question.options.length ? (
              <div className="question__opts">
                {question.options.map((label, i) => {
                  const on = d.choices.includes(i)
                  return (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
                      key={i}
                      type="button"
                      className={cx(
                        'question__opt',
                        question.type === 'multi' && 'question__opt--multi',
                        on && 'question__opt--on',
                      )}
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => pick(question, i)}
                    >
                      <span className="question__mark" aria-hidden>
                        {on ? <Icon name="check" size={10} /> : null}
                      </span>
                      <span className="question__label">{label}</span>
                      {question.recommended === i ? <span className="question__rec">{t('推荐')}</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {question.type === 'text' ? (
              <Textarea
                rows={2}
                className="question__free"
                placeholder={t('自由作答')}
                value={d.text}
                disabled={locked}
                onChange={(e) => edit(question, { choices: [], text: e.target.value })}
              />
            ) : null}
            {question.type === 'single' || question.type === 'multi' ? (
              <Textarea
                rows={1}
                className="question__other"
                placeholder={t('其他，我来补充')}
                value={d.text}
                disabled={locked}
                onChange={(e) => other(question, e.target.value)}
              />
            ) : null}
          </div>
        )
      })}
      {set.attachments.length ? (
        <div className="question__files">
          {set.attachments.map((a) => (
            <span key={a.id} className="question__file" title={workspacePath(a)}>
              {a.name}
            </span>
          ))}
        </div>
      ) : null}
      {pending ? <AttachmentChips uploads={uploads} /> : null}
      {pending ? (
        <div className="question__actions">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              uploads.add([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <Button size="small" icon="paperclip" disabled={locked} onClick={() => fileInput.current?.click()}>
            {t('附图片或附件…')}
          </Button>
          <Button
            variant="primary"
            size="small"
            className="question__submit"
            disabled={locked || !ready || uploads.uploading}
            onClick={() => void submit()}
          >
            {t('提交回答')}
          </Button>
        </div>
      ) : (
        done
      )}
    </div>
  )
}
