import { z } from 'zod'

export { compareVersions } from './version.js'

export const AgentKind = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof AgentKind>

export const Tier = z.enum(['full', 'workspace', 'read-only'])
export type Tier = z.infer<typeof Tier>

/** 命令审批: what happens to permission requests beyond the bot's tier; set by the bot owner only. */
export const Approval = z.enum(['ask', 'allowlist', 'all'])
export type Approval = z.infer<typeof Approval>
/** Command prefixes auto-approved in `allowlist` mode, e.g. `go build`. */
export const Allowlist = z.array(z.string().trim().min(1).max(200)).max(100)

export const TriggerScope = z.enum(['all', 'list', 'self'])
export type TriggerScope = z.infer<typeof TriggerScope>

/** Run card states (plan D2). */
export const RunStatus = z.enum([
  'queued',
  'offline_wait',
  'forbidden',
  'running',
  'awaiting_approval',
  'awaiting_answer',
  'completed',
  'interrupted',
  'expired',
])
export type RunStatus = z.infer<typeof RunStatus>
export const TERMINAL_RUN_STATUS: readonly RunStatus[] = ['forbidden', 'completed', 'interrupted', 'expired']
/** Minutes a request for an offline bot waits before it expires (spec §4.8); groups override via params.offlineWaitMin. */
export const DEFAULT_OFFLINE_WAIT_MIN = 30

export const Usage = z.object({
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  totalTokens: z.number().int().optional(),
  costUsd: z.number().optional(),
})
export type Usage = z.infer<typeof Usage>

/** Context window occupancy of an ACP session (usage_update): tokens in context now vs the model's window. */
export const ContextUsage = z.object({ used: z.number().int(), size: z.number().int() })
export type ContextUsage = z.infer<typeof ContextUsage>

/** Partition-mode git state of one (group, bot) workspace, refreshed after every turn (spec §5.3). */
export const GitStatus = z.object({
  branch: z.string().nullable(),
  /** null when the branch has no upstream. */
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  dirty: z.boolean(),
  workspace: z.enum(['managed', 'cd']),
})
export type GitStatus = z.infer<typeof GitStatus>

/** A file attached to a message (spec §8.7): ≤ MAX_ATTACHMENT_BYTES each, ≤ MAX_ATTACHMENTS per message. */
export const Attachment = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int(),
  mime: z.string(),
  /** Message that carries it; the daemon writes it to `<workspace>/.gonggong/attachments/<messageId>/<name>`. */
  messageId: z.string(),
})
export type Attachment = z.infer<typeof Attachment>
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

/** Built-in "向群成员提问" tool (spec §8.8): ≤ 4 questions per card. */
export const Question = z.object({
  id: z.string(),
  type: z.enum(['single', 'multi', 'yesno', 'text']),
  title: z.string(),
  options: z.array(z.string()),
  /** Index into options for choice questions. */
  recommended: z.number().int().nullable(),
})
export type Question = z.infer<typeof Question>
export const MAX_QUESTIONS = 4

export const Answer = z.object({
  questionId: z.string(),
  /** Selected option indexes (single/multi/yesno). */
  choices: z.array(z.number().int()),
  /** 「其他，我来补充」 for choice questions, or the answer of a text question. */
  text: z.string().nullable(),
})
export type Answer = z.infer<typeof Answer>

/** macOS privacy permissions the desktop previews need, held by the app running the daemon (gg-cast inherits them). */
export const Permission = z.enum(['screen_recording', 'accessibility'])
export type Permission = z.infer<typeof Permission>

/**
 * What the machine owner must do in the WeChat devtools before a mini program shows: port = turn on 设置 → 安全设置 →
 * 服务端口; auth = allow Gonggong in the authorization dialog; trust = press 「信任并运行」 for the project.
 */
export const DevtoolsBlocker = z.enum(['port', 'auth', 'trust'])
export type DevtoolsBlocker = z.infer<typeof DevtoolsBlocker>
