import { z } from 'zod'
import { ArtifactThreadDto } from '../artifact-threads.js'
import { ArtifactActivityDto } from '../artifacts.js'
import { ContextUsage, GitStatus, Tier } from '../common.js'
import { RepoAccessReason } from '../daemon.js'
import { GroupSchedulesDto } from '../schedules.js'
import { SyncStatusDto } from '../sync.js'
import { GroupWebhooksDto } from '../webhooks.js'
import { GitOperationDto } from './git.js'
import { GroupDto, GroupTabsDto } from './groups.js'
import {
  BotDto,
  GroupProviderStateDto,
  LinkRequestDto,
  MachineAgentsDto,
  MachineDto,
} from './machines-bots.js'
import { GroupPinsDto, MessageDto, ReactionsDto, ThreadStateDto, ThreadSummary } from './messages.js'
import { NotificationDto } from './notifications.js'
import { GroupPreviewsDto } from './previews.js'
import { RunDto } from './runs.js'
import { TeamDto, TeamMemberDto } from './teams.js'

// ── Realtime: WS /ws/web (server → browser; the browser only sends WebClientMsg) ──
/** Per-bot workspace state in a group: drives the partition-mode git status bar (spec §5.3, §8.4). */
export const GroupBotStateDto = z.object({
  botId: z.string(),
  workspace: z.enum(['managed', 'cd']),
  /**
   * unbound = waiting for the owner to pick a workspace; confirm = joined a repo group while its owner was online,
   * waiting for them to choose a managed clone or a local one. The bot is not run meanwhile (plan W5).
   */
  state: z.enum(['pending', 'cloning', 'ready', 'failed', 'unbound', 'confirm']),
  path: z.string().nullable(),
  git: GitStatus.nullable(),
  error: z.string().nullable(),
  /** With `failed`: denied / network / timeout pause the bot until a recheck succeeds. */
  reason: RepoAccessReason.nullable(),
  /** This group's tier override; null follows the bot's own tier. */
  tier: Tier.nullable(),
  /** This group's model / thought level; null follows the bot's defaults. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
  /** Context occupancy of the bot's current session here; null before its first report or after /new. */
  context: ContextUsage.nullable(),
  /** The bot's own directories (absolute paths on the owner's machine) it also works in here; not shared by sync. */
  extraDirs: z.array(z.string()),
  /** Extra repo id → the owner's local clone used instead of a managed one; absent = managed. */
  repoPaths: z.record(z.string(), z.string()),
})
export type GroupBotStateDto = z.infer<typeof GroupBotStateDto>

/** GET /api/groups/:id/bots/:botId/repo-candidates: the owner's local clones of the group repo (repo.found). */
export const RepoCandidatesDto = z.object({ managedPath: z.string(), paths: z.array(z.string()) })
export type RepoCandidatesDto = z.infer<typeof RepoCandidatesDto>

export const WebEvent = z.discriminatedUnion('t', [
  /** 团队分区 or what is filed under them changed: refetch them and the directory. */
  z.object({ t: z.literal('directory.changed') }),
  z.object({ t: z.literal('group.botState'), groupId: z.string(), state: GroupBotStateDto }),
  /** The group's pinned messages changed; replaces the list. */
  GroupPinsDto.extend({ t: z.literal('group.pins'), groupId: z.string() }),
  /** The group's tab bar changed; replaces it. */
  GroupTabsDto.extend({ t: z.literal('group.tabs'), groupId: z.string() }),
  /** A manual git operation of the group was requested, decided or finished. */
  z.object({ t: z.literal('group.gitOperation'), groupId: z.string(), operation: GitOperationDto }),
  /** The group's previews or services changed; replaces both lists (`canManage` is per receiving user). */
  GroupPreviewsDto.extend({ t: z.literal('group.previews'), groupId: z.string() }),
  GroupSchedulesDto.extend({ t: z.literal('group.schedules'), groupId: z.string() }),
  GroupWebhooksDto.extend({ t: z.literal('group.webhooks'), groupId: z.string() }),
  /** The group's knowledge base changed (`entryId` when one entry did); clients refetch what they show. */
  z.object({ t: z.literal('group.knowledge'), groupId: z.string(), entryId: z.string().optional() }),
  /** Force groups: the replicas' sync status changed; replaces it. */
  SyncStatusDto.extend({ t: z.literal('group.sync') }),
  z.object({ t: z.literal('message.new'), message: MessageDto }),
  /** A thread got a reply or lost one; replaces the root's summary (null: no replies left). */
  z.object({
    t: z.literal('thread.updated'),
    groupId: z.string(),
    rootId: z.string(),
    thread: ThreadSummary.nullable(),
  }),
  /** The receiving user's state of a thread changed (followed, read, a new reply). */
  ThreadStateDto.extend({ t: z.literal('thread.state') }),
  /** The receiving user's 稍后处理 changed (saved, done, removed, a reminder fired): refetch. */
  z.object({ t: z.literal('saved.changed') }),
  /** A message's reactions changed; replaces its list (`mine` is per receiving user). */
  ReactionsDto.extend({ t: z.literal('message.reactions') }),
  /** Sent to every member; quotes of it now read RECALLED_QUOTE. */
  z.object({ t: z.literal('message.recalled'), groupId: z.string(), messageId: z.string() }),
  /** Sent to every member; quotes of it now read the new text. */
  z.object({ t: z.literal('message.edited'), message: MessageDto }),
  /** Sent to the author only (their other sessions). */
  z.object({ t: z.literal('message.hidden'), groupId: z.string(), messageId: z.string() }),
  z.object({ t: z.literal('run.updated'), run: RunDto }),
  /** Members who may open the artifact: replaces what live runs are writing in it (ArtifactDto.activity). */
  z.object({
    t: z.literal('artifact.activity'),
    artifactId: z.string(),
    activity: z.array(ArtifactActivityDto),
  }),
  /** Viewers of the artifact: head files changed (publish, run, restore); `clientId` lets the sender skip echo. */
  z.object({
    t: z.literal('artifact.files'),
    artifactId: z.string(),
    versionId: z.string(),
    n: z.number().int().min(1),
    changes: z.record(z.string(), z.string().nullable()),
    author: z.string().optional(),
    clientId: z.string().optional(),
  }),
  /** Viewers of the artifact: full comment thread list after any thread mutation. */
  z.object({
    t: z.literal('artifact.threads'),
    artifactId: z.string(),
    threads: z.array(ArtifactThreadDto),
  }),
  /** Only to connections showing the run's group, or that never sent a focus. */
  z.object({
    t: z.literal('run.delta'),
    runId: z.string(),
    text: z.string(),
    lastActivityAt: z.string(),
  }),
  /** The run's process got an event that left its card as it was. Scoped like run.delta. */
  z.object({
    t: z.literal('run.progress'),
    runId: z.string(),
    groupId: z.string(),
    botId: z.string(),
    lastActivityAt: z.string(),
  }),
  /** The run's process got an event that only changed the card's step or usage; replaces those fields. */
  RunDto.pick({ step: true, stepI18n: true, usage: true, lastActivityAt: true }).extend({
    t: z.literal('run.step'),
    runId: z.string(),
    groupId: z.string(),
    botId: z.string(),
  }),
  z.object({ t: z.literal('bot.updated'), bot: BotDto }),
  z.object({ t: z.literal('bot.removed'), botId: z.string() }),
  z.object({ t: z.literal('notification.new'), notification: NotificationDto }),
  /** Some of the user's notifications were settled server-side; `unread` is their fresh unread count. */
  z.object({
    t: z.literal('notification.resolved'),
    notifications: z.array(NotificationDto),
    unread: z.number().int(),
  }),
  z.object({ t: z.literal('group.updated'), group: GroupDto }),
  /** The receiving user is no longer a member. */
  z.object({ t: z.literal('group.removed'), groupId: z.string() }),
  z.object({ t: z.literal('machine.updated'), machine: MachineDto }),
  /** Owner only: `gg login --create-bot` bound the machine and made the bot and the DM with it (Agent 自助接入). */
  z.object({
    t: z.literal('machine.onboarded'),
    machineId: z.string(),
    botId: z.string(),
    groupId: z.string(),
  }),
  z.object({ t: z.literal('machine.removed'), machineId: z.string() }),
  /** Who issued the expired bind code the machine came with: allow it here, as on /link/:id. */
  z.object({ t: z.literal('machine.linkRequested'), request: LinkRequestDto }),
  /** Owner only: a line of a running tools install / upgrade. */
  z.object({
    t: z.literal('machine.tools.progress'),
    machineId: z.string(),
    opId: z.string(),
    line: z.string(),
  }),
  /** Owner only: the install / upgrade ended; `state` null when the machine went offline or never answered. */
  z.object({
    t: z.literal('machine.tools.result'),
    machineId: z.string(),
    opId: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    state: MachineAgentsDto.nullable(),
  }),
  /** Group members: replaces the group's provider banner items. */
  GroupProviderStateDto.extend({ t: z.literal('group.providerState'), groupId: z.string() }),
  /** The receiving member's view of a team they are in (renamed, their role changed, or just joined). */
  z.object({ t: z.literal('team.updated'), team: TeamDto }),
  /** The receiving user left or was removed from the team, or it was archived. */
  z.object({ t: z.literal('team.removed'), teamId: z.string() }),
  /** Team members: someone joined or their role changed. */
  z.object({ t: z.literal('team.member_updated'), teamId: z.string(), member: TeamMemberDto }),
  z.object({ t: z.literal('team.member_removed'), teamId: z.string(), userId: z.string() }),
])
export type WebEvent = z.infer<typeof WebEvent>

export const WebClientMsg = z.discriminatedUnion('t', [
  /** The group this connection shows (null: none), sent on every (re)open and change; scopes run.delta / run.progress. */
  z.object({ t: z.literal('focus'), groupId: z.string().nullable() }),
  /** Whether the page is on screen and focused; with focus it means the user is reading that group (no Feishu ping). */
  z.object({ t: z.literal('visible'), visible: z.boolean() }),
])
export type WebClientMsg = z.infer<typeof WebClientMsg>

/** A run card with a run.step applied. */
export const withRunStep = (
  run: RunDto,
  { step, stepI18n, usage, lastActivityAt }: Extract<WebEvent, { t: 'run.step' }>,
): RunDto => ({ ...run, step, stepI18n, usage, lastActivityAt })

/** A run card with a run.progress timestamp applied. */
export const withRunProgress = (
  run: RunDto,
  { lastActivityAt }: Extract<WebEvent, { t: 'run.progress' }>,
): RunDto => ({ ...run, lastActivityAt })

/** A run card with a run.delta timestamp applied. */
export const withRunDelta = (
  run: RunDto,
  { lastActivityAt }: Extract<WebEvent, { t: 'run.delta' }>,
): RunDto => ({ ...run, lastActivityAt })
