import { z } from 'zod'
import { RunSettingsSnapshot } from '../agent-settings.js'
import { RunArtifact } from '../artifacts.js'
import {
  AiReview,
  Answer,
  ApprovalMcp,
  Attachment,
  ContextBreakdown,
  ContextUsage,
  DiffRepo,
  MAX_ATTACHMENTS,
  Question,
  RunAudience,
  RunStatus,
  Usage,
} from '../common.js'
import { PermissionOption, PlanItem, RunErrorKind, RunEvent } from '../daemon.js'
import { HtmlRenderRef } from '../html-render.js'
import { I18nText } from '../i18n.js'
import { RunSecret } from '../secrets.js'
import { RunSyncDone } from '../sync.js'

export const ApprovalDto = z.object({
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  toolKind: z.string(),
  detail: z.string(),
  reason: z
    .enum([
      'high_risk',
      'protected_base',
      'network',
      'write',
      'unparsed',
      'not_allowed',
      'ai_denied',
      'ai_timeout',
      'ai_unparsed',
      'ai_error',
    ])
    .default('not_allowed'),
  options: z.array(PermissionOption),
  /** What 始终允许 would add to the bot's alwaysAllow. */
  remember: z.array(z.string()),
  /** What 本次会话不再问 trusts until the agent session ends. */
  rememberSession: z.array(z.string()),
  /** The AI pre-review's assessment that left it to the owner; null = not reviewed. */
  review: AiReview.nullable(),
  /** The MCP tool asked for; null for other requests and old records. */
  mcp: ApprovalMcp.nullable().default(null),
  /** expired = auto-rejected on timeout; void = the run ended/stopped first. */
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'void']),
  /** Why a request became void: the run was stopped, its relay chain was stopped, or the run ended first. */
  voidReason: z.enum(['stopped', 'chain_stopped', 'ended']).nullable(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type ApprovalDto = z.infer<typeof ApprovalDto>

/** `session`: 本次会话不再问 (an allow option only); the request's rememberSession rules are trusted until the session ends. */
export const DecideApprovalReq = z.object({ optionId: z.string(), session: z.boolean().optional() })
/** POST /api/runs/:id/interrupt — partition /stop leftovers (plan D7). */
export const InterruptChoiceReq = z.object({ choice: z.enum(['keep', 'discard']) })
/** POST /api/runs/:id/stop | stop-chain — how many unfinished runs were stopped. */
export const StopRes = z.object({ stopped: z.number().int() })
/** Answer to POST /api/messages/:id/branch: the new private chat with the bot. */
export const BranchMessageRes = z.object({ groupId: z.string() })
export type BranchMessageRes = z.infer<typeof BranchMessageRes>
export type StopRes = z.infer<typeof StopRes>
/** Whether the stop reached the bot's machine; the task's end then shows in the run process. */
export const TaskStopRes = z.object({ sent: z.boolean() })
export type TaskStopRes = z.infer<typeof TaskStopRes>

export const QuestionSetDto = z.object({
  id: z.string(),
  runId: z.string(),
  questions: z.array(Question),
  status: z.enum(['pending', 'answered', 'expired', 'void']),
  answers: z.array(Answer).nullable(),
  attachments: z.array(Attachment),
  /** Group members the questions @: they may answer too, besides the trigger user and the bot owner. */
  assigneeIds: z.array(z.string()).default([]),
  answeredBy: z.string().nullable(),
  answeredByName: z.string().nullable(),
  answeredAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  /** 倾向: members' leanings while pending, for reference only (not votes); the answerer still decides. */
  leanings: z
    .array(
      z.object({ questionId: z.string(), choice: z.number().int(), userId: z.string(), name: z.string() }),
    )
    .default([]),
})
export type QuestionSetDto = z.infer<typeof QuestionSetDto>
/** POST /api/runs/:runId/questions/:setId/leanings — toggles the caller's leaning on one option. */
export const LeanReq = z.object({ questionId: z.string(), choice: z.number().int().min(0) })

export const AnswerQuestionsReq = z.object({
  answers: z.array(Answer),
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
})

export const RunDto = z.object({
  id: z.string(),
  groupId: z.string(),
  botId: z.string(),
  triggerMessageId: z.string(),
  triggerUserId: z.string().nullable(),
  /** The thread the run answers in (plan 话题); its card shows there, not in the main timeline. */
  threadRootId: z.string().nullable().optional(),
  hop: z.number().int(),
  status: RunStatus,
  step: z.string(),
  /** `step`'s translatable source when the server wrote it; `step` holds its Chinese rendering. */
  stepI18n: I18nText.optional(),
  /** Structured failure classification (e.g. `auth` when the agent CLI is not signed in); absent otherwise. */
  errorKind: RunErrorKind.optional(),
  filesChanged: z.number().int(),
  usage: Usage.nullable(),
  newSessionReason: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** Latest persisted run activity, falling back to the end, start or queue fact. Never a client clock value. */
  lastActivityAt: z.string(),
  /** Relay chain (spec §4.6): hop 1 = triggered by a human; hopMax = the group's chain limit. */
  parentRunId: z.string().nullable(),
  /** The run whose agent went on by itself here once a background task finished (后台任务完成后继续). */
  continuationOf: z.string().nullable().optional(),
  hopMax: z.number().int(),
  /** The group's offline wait (spec §4.8): an offline_wait card expires at queuedAt + this. */
  offlineWaitMin: z.number().int(),
  /** Human whose @ started the chain; every hop is authorized and answerable by them. */
  originUserId: z.string(),
  /** Which access rule the run was started under, fixed at trigger; null = from before audiences (owner rule). */
  audience: RunAudience.nullable().optional(),
  /** Skills from the origin user's personal layer delivered with the turn (Skill 市场 M3); only the count is shown. */
  personalSkills: z.number().int().optional(),
  approvals: z.array(ApprovalDto),
  questions: z.array(QuestionSetDto),
  /** Partition-mode /stop leftovers (plan D7): pending = edits kept, discard still possible. */
  interrupt: z.enum(['pending', 'kept', 'discarded']).nullable(),
  /** Who issued /stop. */
  stoppedBy: z.string().nullable(),
  /** Delegated work of the run for the card: subagents and background tasks still running (may outlive it). */
  delegation: z.object({
    subagents: z.number().int(),
    subagentsRunning: z.number().int(),
    tasksRunning: z.number().int(),
  }),
  /** The main agent's latest plan (ACP `plan`); absent when it has none. */
  plan: z.array(PlanItem).optional(),
  /** Model and thought level of the turn: as requested, then as the daemon reported them in effect. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
  /** Force group: how the turn's submit settled (F10, F14); null elsewhere or before run.done. */
  sync: RunSyncDone.nullable().optional(),
  /** Secrets injected into the run, names and sources only. */
  secrets: z.array(RunSecret).optional(),
  /** Pages published with html_render so far; the final reply carries them once it is posted. */
  htmlRenders: z.array(HtmlRenderRef).optional(),
  /** Artifact versions the run made; absent when none. */
  artifacts: z.array(RunArtifact).optional(),
})
export type RunDto = z.infer<typeof RunDto>

export const TimelineQuery = z.object({
  /** Only messages with a smaller seq (older page). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
/** GET /api/runs/:id[/events]?since=<event id>: the process from that event on, which is included because streamed
 * text extends the latest event in place. */
export const RunDetailQuery = z.object({ since: z.coerce.number().int().positive().optional() })
/** GET /api/runs/:id — card fields plus the full (redacted) process for the side panel. */
export const RunDetailDto = z.object({
  run: RunDto,
  /** null once the full process has been purged by retention (card keeps the summary). */
  patch: z.string().nullable(),
  /** Repos `patch` spans (empty for runs recorded before repos were tracked). */
  patchRepos: z.array(DiffRepo),
  purged: z.boolean(),
  /** The (group, bot) conversation's current agent session. */
  sessionId: z.string().nullable(),
  /** What the run's agent settings came from (session.config); null = codex / not reported. */
  settings: RunSettingsSnapshot.nullable(),
  /** System param runRetentionDays: how long the full process is kept. */
  retentionDays: z.number().int(),
  events: z.array(z.object({ id: z.number().int(), at: z.string(), event: RunEvent })),
  /** While the run goes on: the latest estimated make-up of its context (`breakdown.live`), kept out of `events`. */
  live: z.object({ context: ContextUsage, breakdown: ContextBreakdown }).optional(),
  /** What people said to the run: its trigger message, then the messages 打断并追加 into it, oldest first. */
  prompts: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['trigger', 'append']),
        author: z.string(),
        body: z.string(),
        at: z.string(),
      }),
    )
    .optional(),
})
export type RunDetailDto = z.infer<typeof RunDetailDto>
/** GET /api/runs/:id/events — only the process, for refreshes of an open run (its card arrives by realtime). */
export const RunEventsDto = RunDetailDto.pick({ events: true, live: true, purged: true, prompts: true })
export type RunEventsDto = z.infer<typeof RunEventsDto>

/** GET /api/runs/:id/session — earlier rounds of the run's agent session (oldest first), with their trigger text. */
export const RunSessionDto = z.object({ rounds: z.array(z.object({ run: RunDto, prompt: z.string() })) })
export type RunSessionDto = z.infer<typeof RunSessionDto>
