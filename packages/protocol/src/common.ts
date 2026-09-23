import { z } from 'zod'

export const AgentKind = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof AgentKind>

export const Tier = z.enum(['full', 'workspace', 'read-only'])
export type Tier = z.infer<typeof Tier>

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

export const Usage = z.object({
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  totalTokens: z.number().int().optional(),
  costUsd: z.number().optional(),
})
export type Usage = z.infer<typeof Usage>

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
