import { randomUUID } from 'node:crypto'
import { type CreateGroupReq, publicRepoUrl } from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, groupMembers, groupRepos, groups, teamMembers, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { isSharedWith } from '../bots/shares.js'
import { postEvent } from '../messages/service.js'
import { branchKnownMissing } from '../repos/probe.js'
import { recordRepo } from '../repos/service.js'
import { joinWorkspace } from '../workspaces/provision.js'
import { repoProblem } from './repo.js'
import { publishGroup } from './service.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export const uniq = (ids: string[]) => [...new Set(ids)]

/** Enabled accounts of the team; anyone else reads as not existing. */
export async function activeUsers(ctx: Ctx, teamId: string, ids: string[]) {
  if (!ids.length) return []
  if (!ids.every(isUuid)) return fail('invalid', '成员不存在')
  const rows = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, teamId)))
    .where(and(inArray(users.id, ids), isNull(users.disabledAt)))
  if (rows.length !== ids.length) return fail('invalid', '成员不存在或已停用')
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

/** Live bots of the team (plan D5). */
export async function liveBots(ctx: Ctx, teamId: string, ids: string[]) {
  if (!ids.length) return []
  if (!ids.every(isUuid)) return fail('invalid', 'Bot 不存在或已删除')
  const rows = await ctx.db
    .select({
      id: bots.id,
      name: bots.name,
      ownerId: bots.ownerId,
      ownerName: users.name,
      machineId: bots.machineId,
    })
    .from(bots)
    .innerJoin(users, eq(users.id, bots.ownerId))
    .where(and(inArray(bots.id, ids), eq(bots.teamId, teamId), isNull(bots.deletedAt)))
  if (rows.length !== ids.length) return fail('invalid', 'Bot 不存在或已删除')
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

/** Bots that cannot reach the repo don't block binding (they pause); a branch the repo lacks does. */
export function assertBindable(ctx: Ctx, url: string, branch: string) {
  const problem = repoProblem(url, branch)
  if (problem) fail('invalid', problem)
  if (branchKnownMissing(url, branch, ctx.now()))
    fail('invalid', '分支 {branch} 不存在，换一个基准分支', { branch })
}

/**
 * 新建群 / 私聊 in `teamId` with `me` as its admin; `inTx` adds rows that must exist with the group (a bound Feishu
 * chat). Returns the group id.
 */
export async function createGroup(
  ctx: Ctx,
  me: { id: string; name: string },
  teamId: string,
  body: z.output<typeof CreateGroupReq>,
  inTx?: (tx: Tx, groupId: string) => Promise<void>,
) {
  const dm = body.kind === 'dm'
  const name = body.name.trim()
  if (!name) return fail('invalid', '填写群名')
  const repo = body.repo && { url: body.repo.url.trim(), branch: body.repo.branch.trim() }
  if (repo) assertBindable(ctx, repo.url, repo.branch)
  const invitedIds = uniq(body.memberIds).filter((id) => id !== me.id)
  if (dm && invitedIds.length) return fail('invalid', '私聊只能包含你和你的 Bot')
  const picked = await liveBots(ctx, teamId, uniq(body.botIds))
  for (const b of dm ? picked : [])
    if (b.ownerId !== me.id && !(await isSharedWith(ctx, b.id, me.id)))
      return fail('forbidden', '私聊只能拉入你自己或共享给你的 Bot')
  // A DM with a shared bot leaves its owner out.
  const invited = dm
    ? []
    : await activeUsers(
        ctx,
        teamId,
        uniq([...invitedIds, ...picked.map((b) => b.ownerId)]).filter((id) => id !== me.id),
      )
  const sharer = picked.find((b) => b.ownerId !== me.id)

  const group = { id: randomUUID() }
  await ctx.db.transaction(async (tx) => {
    // New groups protect their base branch and reply in business tone; older groups keep what they had.
    await tx.insert(groups).values({
      id: group.id,
      teamId,
      name,
      kind: body.kind,
      visibility: dm ? 'private' : (body.visibility ?? 'private'),
      createdBy: me.id,
      protectBase: true,
      params: { replyStyle: 'business' },
    })
    await tx.insert(groupMembers).values([
      // DMs notify everything by default, groups only @.
      { groupId: group.id, userId: me.id, isAdmin: true, ...(dm && { notifyLevel: 'all' as const }) },
      ...invited.map((u) => ({ groupId: group.id, userId: u.id })),
    ])
    if (picked.length)
      await tx.insert(groupBots).values(picked.map((b) => ({ groupId: group.id, botId: b.id })))
    if (repo)
      await tx.insert(groupRepos).values({ groupId: group.id, url: repo.url, baseBranch: repo.branch })
    await inTx?.(tx, group.id)
  })

  await postEvent(
    ctx,
    group.id,
    dm
      ? sharer
        ? '{user} 创建了私聊 · 使用 {owner} 共享的 Bot'
        : '{user} 创建了私聊 · 仅你和你的 Bot'
      : invited.length
        ? '{user} 创建了群 · 成为群管理员 · 邀请 {invited}'
        : '{user} 创建了群 · 成为群管理员',
    {
      user: me.name,
      invited: invited.map((u) => u.name).join('、'),
      ...(sharer && { owner: sharer.ownerName }),
    },
  )
  await postEvent(
    ctx,
    group.id,
    repo
      ? '群绑定仓库 {url} · 基准分支 {branch} · 分区模式'
      : '未绑定仓库 · 各 Bot 使用主人绑定的目录，仅分区模式',
    repo ? { url: publicRepoUrl(repo.url), branch: repo.branch } : undefined,
  )
  if (repo) await recordRepo(ctx, { ...repo, teamId, userId: me.id })
  for (const b of picked) await joinWorkspace(ctx, group.id, b, { joined: true })
  await publishGroup(ctx, group.id)
  return group.id
}
