import type { ApprovalDto, QuestionSetDto, RunDetailDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { newSessionNote } from '../chat/TimelineItems'
import { parsePatch } from '../diff/patch'
import { VOID_TEXT } from './ApprovalBlock'
import { CONFIG_ECHO } from './mcp'
import { processSteps, type Step, type Timed } from './steps'

export type { Step }

export function approvalText(a: ApprovalDto) {
  switch (a.status) {
    case 'pending':
      return t('等待 Bot 主人审批')
    case 'approved':
      return t('{name} 已批准', { name: a.decidedByName ?? '' }).trim()
    case 'rejected':
      return t('{name} 已拒绝', { name: a.decidedByName ?? '' }).trim()
    case 'expired':
      return t('超时未审批，已自动拒绝')
    case 'void':
      return VOID_TEXT[a.voidReason ?? 'ended']
  }
}

export function questionText(q: QuestionSetDto) {
  switch (q.status) {
    case 'pending':
      return t('等待触发人或 Bot 主人回答')
    case 'answered':
      return t('{name} 已回答', { name: q.answeredByName ?? '' }).trim()
    case 'expired':
      return t('无人回答，agent 已按推荐项继续')
    case 'void':
      return t('提问已作废')
  }
}

/** Each question with what was answered, one per line: options picked and 「其他」 text, — when left empty. */
export function answerLines(q: QuestionSetDto) {
  return q.questions
    .map((x) => {
      const a = q.answers?.find((y) => y.questionId === x.id)
      const other = a?.text?.replace(/\s+/g, ' ')
      const said = [...(a?.choices.map((i) => x.options[i]) ?? []), other].filter(Boolean)
      return `${x.title}：${said.join(t('、')) || '—'}`
    })
    .join('\n')
}

/** Daemon statuses that only mirror an approval's lifecycle; its 权限请求 row carries the outcome. */
const APPROVAL_ECHO = /^(等待审批|已批准)：|^请求被拒绝，|^(Awaiting approval|Approved): |^Request denied; /

const statusOf = (e: RunDetailDto['events'][number]) => (e.event.kind === 'status' ? e.event.step : null)

function contextStep(d: RunDetailDto, gitStep: string | undefined, configs: string[]): Step {
  const reason = d.run.newSessionReason
  const session =
    reason === null
      ? t('续用上次会话，补送上次被 @ 以来的群消息')
      : (newSessionNote(reason) ?? t('首次会话，补送此前的群消息'))
  const git = gitStep ? t('git 默认动作：{action}', { action: gitStep.replace(/^git /, '') }) : null
  return {
    key: 'context',
    kind: 'context',
    label: t('本轮上下文'),
    meta: reason === null ? t('续用会话') : t('新会话'),
    body: [session, git, ...configs].filter(Boolean).join(t('。')),
  }
}

/** Side-panel 过程 steps: the trigger message and this turn's context, then thoughts / replies / tool calls /
 * statuses / approvals / questions / appended messages in time order. `trigger: false` leaves out the trigger, shown
 * elsewhere. */
export function buildSteps(d: RunDetailDto, { trigger = true } = {}): Step[] {
  const firstReal = d.events.findIndex((e) => e.event.kind !== 'status')
  const opening = d.events.slice(0, firstReal < 0 ? d.events.length : firstReal)
  const gitEvent = opening.find((e) => e.event.kind === 'status' && e.event.step.startsWith('git '))
  const timed: Timed[] = []
  for (const a of d.run.approvals)
    timed.push({
      at: a.createdAt,
      step: {
        key: `a${a.id}`,
        kind: 'approval',
        label: t('权限请求'),
        mono: a.detail,
        body: approvalText(a),
        running: a.status === 'pending',
        at: a.createdAt,
        end: a.decidedAt ?? undefined,
      },
    })
  for (const q of d.run.questions)
    timed.push({
      at: q.createdAt,
      step: {
        key: `q${q.id}`,
        kind: 'question',
        label: t('向群成员提问'),
        mono: q.questions.map((x) => x.title).join(' / '),
        body: questionText(q),
        ...(q.status === 'answered' && { out: answerLines(q) }),
        running: q.status === 'pending',
        at: q.createdAt,
        end: q.answeredAt ?? undefined,
      },
    })
  const prompts = (d.prompts ?? []).map(
    (p): Step => ({
      key: `m${p.id}`,
      kind: 'prompt',
      label: p.kind === 'append' ? t('{name} · 打断并追加', { name: p.author }) : p.author,
      body: p.body,
      at: p.at,
    }),
  )
  // The trigger opens the list; appends go where they came in.
  const [head, ...appends] = d.prompts?.[0]?.kind === 'trigger' ? prompts : [undefined, ...prompts]
  for (const p of appends) if (p) timed.push({ at: p.at ?? '', step: p })
  const configs = d.events.map(statusOf).filter((s): s is string => !!s && CONFIG_ECHO.test(s))
  const events = d.events.filter((e) => {
    const s = statusOf(e)
    return e !== gitEvent && !(s && (CONFIG_ECHO.test(s) || APPROVAL_ECHO.test(s)))
  })
  const steps = processSteps(events, parsePatch(d.patch ?? ''), d.run.status === 'running', timed)
  const gitStep = gitEvent?.event.kind === 'status' ? gitEvent.event.step : undefined
  return [...(head && trigger ? [head] : []), contextStep(d, gitStep, configs), ...steps]
}
