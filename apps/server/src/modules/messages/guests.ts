import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactMembers, artifacts, groups, messages, runs, teamMembers } from '../../db/schema.js'
import { type MessageMeta, memberIds } from './service.js'

/**
 * People outside a group who still talk in one of its artifacts' 画布 AI 对话: the artifact's creator and those given
 * 可协作 on it (作品权限), while in the group's team. They get that conversation's messages and runs over realtime,
 * nothing else of the group. Cached per thread root and per run, like `memberIds`; grants changing call `forgetGuests`.
 */
const byRoot = new Map<string, Promise<string[]>>()
const rootOfRun = new Map<string, Promise<string | null>>()
const CACHE_MAX = 5000

function cached<V>(map: Map<string, Promise<V>>, key: string, load: () => Promise<V>) {
  let v = map.get(key)
  if (!v) {
    if (map.size >= CACHE_MAX) map.clear()
    v = load()
    map.set(key, v)
    v.catch(() => map.get(key) === v && map.delete(key))
  }
  return v
}

/** The artifact an artifact chat root is about (artifacts/chat.ts), or none for any other message. */
export const chatArtifactOf = (root: { id: string; threadRootId: string | null; meta: unknown }) =>
  root.threadRootId === root.id ? (root.meta as MessageMeta).artifactChat : undefined

async function loadGuests(ctx: Ctx, rootId: string): Promise<string[]> {
  const [root] = await ctx.db
    .select({ id: messages.id, threadRootId: messages.threadRootId, meta: messages.meta })
    .from(messages)
    .where(eq(messages.id, rootId))
  const artifactId = root && chatArtifactOf(root)
  if (!artifactId) return []
  const [a] = await ctx.db
    .select({ createdBy: artifacts.createdBy, teamId: groups.teamId })
    .from(artifacts)
    .innerJoin(groups, eq(groups.id, artifacts.groupId))
    .where(eq(artifacts.id, artifactId))
  if (!a) return []
  const editors = await ctx.db
    .select({ userId: artifactMembers.userId })
    .from(artifactMembers)
    .where(and(eq(artifactMembers.artifactId, artifactId), eq(artifactMembers.role, 'edit')))
  const ids = [...(a.createdBy ? [a.createdBy] : []), ...editors.map((r) => r.userId)]
  if (!ids.length) return []
  const inTeam = await ctx.db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, a.teamId), inArray(teamMembers.userId, ids)))
  return inTeam.map((r) => r.userId)
}

const guestsOf = (ctx: Ctx, rootId: string | null | undefined) =>
  rootId ? cached(byRoot, rootId, () => loadGuests(ctx, rootId)) : Promise.resolve([])

const union = async (members: Promise<string[]>, guests: Promise<string[]>) => {
  const g = await guests
  return g.length ? [...new Set([...(await members), ...g])] : members
}

/** Who hears of a message: the group's members, plus the guests of the artifact chat it is in. */
export const messageAudience = (ctx: Ctx, m: { groupId: string; threadRootId?: string | null }) =>
  union(memberIds(ctx, m.groupId), guestsOf(ctx, m.threadRootId))

/** Who hears of a run: the group's members, plus the guests of the artifact chat it answers in. */
export function runAudience(ctx: Ctx, run: { id: string; groupId: string }) {
  const root = cached(rootOfRun, run.id, async () => {
    const [r] = await ctx.db.select({ root: runs.threadRootId }).from(runs).where(eq(runs.id, run.id))
    return r?.root ?? null
  })
  return union(
    memberIds(ctx, run.groupId),
    root.then((id) => guestsOf(ctx, id)),
  )
}

/** After 作品权限 or a creator's team changed. */
export function forgetGuests() {
  byRoot.clear()
}
