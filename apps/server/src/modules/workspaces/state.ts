import {
  type ContextUsage,
  GitStatus,
  type GroupBotStateDto,
  type RepoAccessReason,
  type Tier,
} from '@gonggong/protocol'
import { and, eq, isNotNull, isNull, ne, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupBots, groupRepos } from '../../db/schema.js'
import { memberIds } from '../messages/service.js'

type Row = typeof groupBots.$inferSelect

export const botStateDto = (r: Row): GroupBotStateDto => ({
  botId: r.botId,
  workspace: r.workspaceKind === 'cd' ? 'cd' : 'managed',
  state: r.workspaceState as GroupBotStateDto['state'],
  path: r.workspacePath,
  // Parsed so statuses stored before `repos` existed gain its default.
  git: r.gitStatus ? GitStatus.parse(r.gitStatus) : null,
  error: r.workspaceError,
  reason: r.workspaceState === 'failed' ? (r.workspaceReason as RepoAccessReason | null) : null,
  tier: r.tier as Tier | null,
  model: r.model,
  effort: r.effort,
  context: (r.contextUsage as ContextUsage | null) ?? null,
  extraDirs: r.extraDirs,
  repoPaths: r.repoPaths,
})

export async function listBotStates(ctx: Ctx, groupId: string) {
  const rows = await ctx.db
    .select()
    .from(groupBots)
    .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt)))
  return rows.map(botStateDto)
}

/** Single write path for a (group, bot) workspace's state; pushes `group.botState` to the group's members. */
export async function updateBotState(
  ctx: Ctx,
  groupId: string,
  botId: string,
  patch: Partial<
    Pick<
      Row,
      | 'workspaceKind'
      | 'cdPath'
      | 'workspaceState'
      | 'workspacePath'
      | 'workspaceError'
      | 'workspaceReason'
      | 'gitStatus'
      | 'tier'
      | 'model'
      | 'effort'
      | 'contextUsage'
      | 'extraDirs'
      | 'repoPaths'
      | 'sessionId'
      | 'newSessionReason'
    >
  >,
) {
  const [row] = await ctx.db
    .update(groupBots)
    .set(patch)
    .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
    .returning()
  if (!row) return null
  return publishBotState(ctx, row)
}

/** Ends a (group, bot)'s session: the next turn opens a new one, so the old context occupancy no longer applies. */
export const RESET_SESSION = { sessionId: null, contextUsage: null } as const

/** Context occupancy arrives with every usage report: written and pushed only when it changed. */
export async function updateContextUsage(ctx: Ctx, groupId: string, botId: string, value: SQL) {
  const [row] = await ctx.db
    .update(groupBots)
    .set({ contextUsage: value })
    .where(
      and(
        eq(groupBots.groupId, groupId),
        eq(groupBots.botId, botId),
        sql`${groupBots.contextUsage} is distinct from ${value}`,
      ),
    )
    .returning()
  if (row) await publishBotState(ctx, row)
}

export async function publishBotState(ctx: Ctx, row: Row) {
  const state = botStateDto(row)
  ctx.bus.publish(await memberIds(ctx, row.groupId), { t: 'group.botState', groupId: row.groupId, state })
  return state
}

/**
 * Groups where the bot's clone or directory binding is not ready yet; the scheduler holds their runs back.
 * Repo-less managed workspaces need no daemon round trip and never wait.
 */
export async function unreadyGroups(db: Pick<Ctx['db'], 'selectDistinct'>, botId: string) {
  const rows = await db
    .selectDistinct({ groupId: groupBots.groupId })
    .from(groupBots)
    .leftJoin(groupRepos, eq(groupRepos.groupId, groupBots.groupId))
    .where(
      and(
        eq(groupBots.botId, botId),
        ne(groupBots.workspaceState, 'ready'),
        or(isNotNull(groupRepos.id), eq(groupBots.workspaceKind, 'cd')),
      ),
    )
  return new Set(rows.map((r) => r.groupId))
}

/**
 * Where a bot keeps the group's extra repos: managed clones go to the daemon as `extraRepos`, its local clones join its
 * own directories as `extraDirs` (what any daemon already gives the session). Paths of removed repos are ignored.
 */
export function splitExtras<T extends { id: string }>(
  extras: T[],
  gb: { extraDirs: string[]; repoPaths: Record<string, string> },
) {
  const local = extras.flatMap((r) => (gb.repoPaths[r.id] ? [gb.repoPaths[r.id] as string] : []))
  return {
    extraRepos: extras.filter((r) => !gb.repoPaths[r.id]),
    extraDirs: [...new Set([...gb.extraDirs, ...local])],
  }
}

/** A (group, bot)'s own directories and local clones of extra repos. */
export async function botDirs(ctx: Pick<Ctx, 'db'>, groupId: string, botId: string) {
  const [gb] = await ctx.db
    .select({ cdPath: groupBots.cdPath, extraDirs: groupBots.extraDirs, repoPaths: groupBots.repoPaths })
    .from(groupBots)
    .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
  return gb ?? { cdPath: null, extraDirs: [], repoPaths: {} }
}
