import type { ApprovalDto, RunDetailDto } from '@gonggong/protocol'
import { hm } from '../../lib/time'
import { newSessionNote } from '../chat/TimelineItems'
import { parsePatch } from '../diff/patch'
import { VOID_TEXT } from './ApprovalBlock'
import { CONFIG_ECHO } from './mcp'
import { processSteps, type Step, type Timed } from './steps'

export type { Step }

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

/** Daemon statuses that only mirror an approval's lifecycle; its 权限请求 row carries the outcome. */
const APPROVAL_ECHO = /^(等待审批|已批准)：|^请求被拒绝，/

const statusOf = (e: RunDetailDto['events'][number]) => (e.event.kind === 'status' ? e.event.step : null)

function contextStep(d: RunDetailDto, gitStep: string | undefined, configs: string[]): Step {
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
    body: [session, git, ...configs].filter(Boolean).join('。'),
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
        meta: hm(a.createdAt),
        mono: a.detail,
        body: approvalText(a),
        running: a.status === 'pending',
      },
    })
  const configs = d.events.map(statusOf).filter((s): s is string => !!s && CONFIG_ECHO.test(s))
  const events = d.events.filter((e) => {
    const s = statusOf(e)
    return e !== gitEvent && !(s && (CONFIG_ECHO.test(s) || APPROVAL_ECHO.test(s)))
  })
  const steps = processSteps(events, parsePatch(d.patch ?? ''), d.run.status === 'running', timed)
  const gitStep = gitEvent?.event.kind === 'status' ? gitEvent.event.step : undefined
  return [contextStep(d, gitStep, configs), ...steps]
}
