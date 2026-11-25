import type { MessageDto, ProgressCard as ProgressCardDto, RunDto } from '@gonggong/protocol'
import type { ReactNode } from 'react'
import { ArtifactCardView } from '../artifacts/ArtifactCard'
import { FeishuIssueEventRow } from '../feishu/FeishuIssueEvent'
import { CreationDraftView } from '../plugins/CreationCard'
import { ScheduleCard } from '../schedules/ScheduleCard'
import { ConflictEvent } from '../sync/RunSyncLine'
import { ProgressCard } from './ProgressCard'
import { isRequestCard, RequestCard } from './RequestCard'
import { eventText, LIVE } from './TimelineItems'

/**
 * The card a message carries in place of its text (schedules, sync conflicts, requests, progress, plugin and artifact
 * cards, Feishu issues), null when it has none. Shared by the main timeline and threads, where a run's cards land.
 */
export function eventCard(m: MessageDto): ReactNode {
  if (m.scheduleId)
    return <ScheduleCard scheduleId={m.scheduleId} groupId={m.groupId} fallback={eventText(m)} />
  if (m.syncConflict) return <ConflictEvent m={m} conflict={m.syncConflict} />
  if (isRequestCard(m)) return <RequestCard m={m} />
  if (m.progress) return <ProgressCard card={m.progress} />
  if (m.card?.type === 'creation-draft') return <CreationDraftView m={m} card={m.card} />
  if (m.card?.type === 'artifact') return <ArtifactCardView card={m.card} groupId={m.groupId} />
  if (m.feishuIssue) return <FeishuIssueEventRow m={m} issue={m.feishuIssue} />
  return null
}

/**
 * Each run's last bot message, its card moves onto it. Files a live run sends meanwhile (send_attachments) show as
 * replies of their own, so its card (steps, 停止) stays put.
 */
export function runReplies(messages: MessageDto[], runs: Record<string, RunDto>) {
  const replies = new Map<string, MessageDto>()
  for (const m of messages) {
    const run = m.kind === 'bot' && m.runId ? runs[m.runId] : undefined
    if (run && !(LIVE.includes(run.status) && m.attachments.length)) replies.set(run.id, m)
  }
  return replies
}

/** Progress cards by the loaded run that last updated them: they show inside its card. */
export function progressOfRuns(messages: MessageDto[], runs: Record<string, RunDto>) {
  const byRun = new Map<string, ProgressCardDto[]>()
  for (const m of messages) {
    const runId = m.progress?.runId
    if (m.progress && runId && runs[runId]) byRun.set(runId, [...(byRun.get(runId) ?? []), m.progress])
  }
  return byRun
}
