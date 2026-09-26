import type { ApprovalDto, RunDetailDto } from '@gonggong/protocol'
import { newSessionNote } from '../chat/TimelineItems'
import { parsePatch } from '../diff/patch'
import { VOID_TEXT } from './ApprovalBlock'
import { processSteps, type Step, type Timed } from './steps'

export type { Step }

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function approvalText(a: ApprovalDto) {
  switch (a.status) {
    case 'pending':
      return '等待 Bot 主人审批'
    case 'approved':
      return `${a.decidedByName ?? ''} 已批准`.trim()
    case 'rejected':
      return `${a.decidedByName ?? ''} 已拒绝`.trim()
    case 'expired':
      return '超时未审批，已自动拒绝'
    case 'void':
      return VOID_TEXT[a.voidReason ?? 'ended']
  }
}

function contextStep(d: RunDetailDto, gitStep: string | undefined): Step {
  const reason = d.run.newSessionReason
  const session =
    reason === null
      ? '续用上次会话，补送上次被 @ 以来的群消息'
      : (newSessionNote(reason) ?? '首次会话，补送此前的群消息')
  const git = gitStep ? `git 默认动作：${gitStep.replace(/^git /, '')}` : null
  return {
    key: 'context',
    kind: 'context',
    label: '本轮上下文',
    meta: reason === null ? '续用会话' : '新会话',
    body: [session, git].filter(Boolean).join('。'),
  }
}

/** Side-panel 过程 steps: this turn's context, then thoughts / replies / tool calls / statuses / approvals in time order. */
export function buildSteps(d: RunDetailDto): Step[] {
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
        label: '权限请求',
        meta: hhmm(a.createdAt),
        mono: a.detail,
        body: approvalText(a),
        running: a.status === 'pending',
      },
    })
  const events = d.events.filter((e) => e !== gitEvent)
  const steps = processSteps(events, parsePatch(d.patch ?? ''), d.run.status === 'running', timed)
  const gitStep = gitEvent?.event.kind === 'status' ? gitEvent.event.step : undefined
  return [contextStep(d, gitStep), ...steps]
}
