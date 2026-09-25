import type { Answer, Question, QuestionSetDto, RunDto } from '@gonggong/protocol'
import { MessageCircleQuestion } from 'lucide-react'
import { useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Button, Input, Textarea, toast } from '../../ui'
import { workspacePath } from '../attachments/api'
import { AttachmentChips, useUploads } from '../attachments/ComposerAttachments'
import { countdown, hm, useNow } from './ApprovalBlock'
import { useMemberName } from './RunActions'
import './question.css'

const TYPE: Record<Question['type'], string> = {
  single: '单选',
  multi: '多选',
  yesno: '是/否',
  text: '自由文本',
}
const LIVE: RunDto['status'][] = ['running', 'awaiting_approval', 'awaiting_answer']

type Draft = { choices: number[]; text: string }

const EMPTY: Draft = { choices: [], text: '' }

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
      return `${q.answeredByName} 已回答 · ${q.answeredAt ? hm(q.answeredAt) : ''} · 已写入审计记录`
    case 'expired':
      return `无人回答，agent 已按推荐项继续 · ${hm(q.expiresAt)}`
    case 'void':
      if (LIVE.includes(run.status)) return '已打断并追加，提问作废'
      return run.status === 'interrupted' ? '运行已停止，提问作废' : '运行已结束，提问作废'
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

function QuestionCard({ run, set }: { run: RunDto; set: QuestionSetDto }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const me = useSession((s) => s.user?.id)
  const trigger = useMemberName(run.groupId, run.originUserId)
  const pending = set.status === 'pending'
  const now = useNow(pending)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const uploads = useUploads(run.groupId)
  const [busy, setBusy] = useState(false)
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
      toast({ type: 'error', message: e instanceof ApiError ? e.message : '提交失败' })
    } finally {
      setBusy(false)
    }
  }

  const owner = bot?.ownerName ?? ''
  const who =
    run.originUserId === bot?.ownerId
      ? `触发人兼 Bot 主人 ${trigger} 可回答`
      : `触发人 ${trigger} 或 Bot 主人 ${owner} 可回答`
  const ready = set.questions.every((question) => answered(question, draftOf(question)))

  return (
    <div className="question">
      <div className="question__title">
        <MessageCircleQuestion size={13} />
        <span>向群成员提问 · {set.questions.length} 个问题</span>
        <span className="question__who">· {who}</span>
      </div>
      {set.questions.map((question) => {
        const d = draftOf(question)
        return (
          <div key={question.id} className="question__item">
            <div className="question__q">
              <span className="question__type">{`${TYPE[question.type]} · `}</span>
              {question.title}
            </div>
            {question.options.length ? (
              <div className="question__opts">
                {question.options.map((label, i) => {
                  const on = d.choices.includes(i)
                  return (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
                      key={i}
                      type="button"
                      className={cx('question__opt', on && 'question__opt--on')}
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => pick(question, i)}
                    >
                      {label}
                      {question.recommended === i ? <span className="question__rec">推荐</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {question.type === 'text' ? (
              <Textarea
                rows={2}
                className="question__free"
                placeholder="自由作答"
                value={d.text}
                disabled={locked}
                onChange={(e) => edit(question, { choices: [], text: e.target.value })}
              />
            ) : null}
            {question.type === 'single' || question.type === 'multi' ? (
              <Input
                size="sm"
                placeholder="其他，我来补充"
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
          <Button variant="ghost" size="sm" disabled={locked} onClick={() => fileInput.current?.click()}>
            附图片或附件
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={locked || !ready || uploads.uploading}
            onClick={() => void submit()}
          >
            提交回答
          </Button>
          <span className="question__timeout">
            {countdown(Date.parse(set.expiresAt) - now)} 后超时，agent 按推荐项继续并在最终回复列出假设
          </span>
        </div>
      ) : (
        <div className="question__done">{outcome(set, run)}</div>
      )}
    </div>
  )
}
