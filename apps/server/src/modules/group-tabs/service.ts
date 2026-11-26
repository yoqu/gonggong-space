import {
  type GroupTabDto,
  type GroupTabsDto,
  type GroupTabTarget,
  type GroupTabTargetReq,
  MAX_GROUP_TABS,
} from '@gonggong/protocol'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupKnowledge, groupTabs, users } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { memberIds, postEvent } from '../messages/service.js'
import { linkMeta } from './link-meta.js'

export type TabActor = { userId: string; name: string } | { botId: string; name: string }
export const ENTRY_TITLES = {
  notice: '群公告',
  pins: '置顶消息',
  schedules: '定时任务',
  'git-log': 'Git 记录',
} as const

type Row = typeof groupTabs.$inferSelect

export async function groupTabList(ctx: Ctx, groupId: string): Promise<GroupTabsDto> {
  const rows = await ctx.db
    .select({ tab: groupTabs, user: users.name, bot: bots.name })
    .from(groupTabs)
    .leftJoin(users, eq(users.id, groupTabs.createdByUserId))
    .leftJoin(bots, eq(bots.id, groupTabs.createdByBotId))
    .where(eq(groupTabs.groupId, groupId))
    .orderBy(asc(groupTabs.position), asc(groupTabs.createdAt))
  const [entries, inGroup] = await Promise.all([
    ctx.db
      .select({ id: groupKnowledge.id })
      .from(groupKnowledge)
      .where(and(eq(groupKnowledge.groupId, groupId), isNull(groupKnowledge.archivedAt))),
    ctx.db
      .select({ id: groupBots.botId })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt), isNull(bots.deletedAt))),
  ])
  const live = new Set([...entries, ...inGroup].map((r) => r.id))
  const stale = (t: GroupTabTarget) =>
    t.kind === 'knowledge' ? !live.has(t.knowledgeId) : 'botId' in t && t.botId ? !live.has(t.botId) : false
  return {
    tabs: rows.map(
      ({ tab, user, bot }): GroupTabDto => ({
        id: tab.id,
        title:
          tab.target.kind === 'entry' && tab.title === ENTRY_TITLES[tab.target.entry]
            ? t(ENTRY_TITLES[tab.target.entry])
            : tab.title,
        target: tab.target,
        stale: stale(tab.target),
        createdBy: { name: user ?? bot ?? '', bot: !!tab.createdByBotId },
        createdAt: tab.createdAt.toISOString(),
      }),
    ),
  }
}

async function publish(ctx: Ctx, groupId: string) {
  const dto = await groupTabList(ctx, groupId)
  ctx.bus.publish(await memberIds(ctx, groupId), { t: 'group.tabs', groupId, ...dto })
  return dto
}

const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** Resolves what the tab points at (checking it belongs to the group) and the title it gets by default. */
async function resolve(ctx: Ctx, groupId: string, req: GroupTabTargetReq): Promise<[GroupTabTarget, string]> {
  switch (req.kind) {
    case 'link': {
      const meta = await linkMeta(req.url)
      const target = { kind: 'link' as const, url: req.url, icon: meta.icon, embeddable: meta.embeddable }
      return [target, meta.title ?? new URL(req.url).hostname]
    }
    case 'knowledge': {
      const [e] = await ctx.db
        .select({ title: groupKnowledge.title })
        .from(groupKnowledge)
        .where(
          and(
            eq(groupKnowledge.id, req.knowledgeId),
            eq(groupKnowledge.groupId, groupId),
            isNull(groupKnowledge.archivedAt),
          ),
        )
      if (!e) return fail('not_found', '知识库条目不存在')
      return [req, e.title]
    }
    case 'file':
    case 'entry': {
      if (req.kind === 'entry' && req.entry === 'git-log' && !req.botId)
        return fail('invalid', 'Git 记录标签需要指定 Bot')
      if (req.botId) {
        const [b] = await ctx.db
          .select({ id: groupBots.botId })
          .from(groupBots)
          .where(
            and(eq(groupBots.groupId, groupId), eq(groupBots.botId, req.botId), isNull(groupBots.removedAt)),
          )
        if (!b) return fail('not_found', 'Bot 不在本群')
      }
      const target =
        req.kind === 'entry' && req.entry !== 'git-log' ? { kind: req.kind, entry: req.entry } : req
      return [target, req.kind === 'file' ? baseName(req.path) : ENTRY_TITLES[req.entry]]
    }
  }
}

export async function createTab(
  ctx: Ctx,
  groupId: string,
  req: { title?: string; target: GroupTabTargetReq },
  actor: TabActor,
) {
  const [target, fallbackTitle] = await resolve(ctx, groupId, req.target)
  const title = (req.title ?? fallbackTitle).slice(0, 40)
  const tab = await ctx.db.transaction(async (tx) => {
    // One insert at a time per group, so two members never both take the last slot or the same position.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tabs:${groupId}`}))`)
    const [n] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        max: sql<number>`coalesce(max(${groupTabs.position}), -1)::int`,
      })
      .from(groupTabs)
      .where(eq(groupTabs.groupId, groupId))
    if ((n?.n ?? 0) >= MAX_GROUP_TABS)
      return fail('conflict', '本群最多 {n} 个标签，请先删除一个', { n: MAX_GROUP_TABS })
    const [row] = await tx
      .insert(groupTabs)
      .values({
        groupId,
        title,
        target,
        position: (n?.max ?? -1) + 1,
        createdByUserId: 'userId' in actor ? actor.userId : null,
        createdByBotId: 'botId' in actor ? actor.botId : null,
        createdAt: ctx.now(),
      })
      .returning()
    return row as Row
  })
  await postEvent(ctx, groupId, '{user} 添加了标签：{title}', { user: actor.name, title: tab.title })
  await publish(ctx, groupId)
  return tab
}

async function requireTab(ctx: Ctx, groupId: string, tabId: string) {
  const [row] = await ctx.db
    .select()
    .from(groupTabs)
    .where(and(eq(groupTabs.id, tabId), eq(groupTabs.groupId, groupId)))
  return row ?? fail('not_found', '标签不存在')
}

export async function renameTab(ctx: Ctx, groupId: string, tabId: string, title: string) {
  await requireTab(ctx, groupId, tabId)
  await ctx.db.update(groupTabs).set({ title }).where(eq(groupTabs.id, tabId))
  return publish(ctx, groupId)
}

export async function deleteTab(ctx: Ctx, groupId: string, tabId: string, by: { name: string }) {
  const tab = await requireTab(ctx, groupId, tabId)
  await ctx.db.delete(groupTabs).where(eq(groupTabs.id, tabId))
  await postEvent(ctx, groupId, '{user} 删除了标签：{title}', { user: by.name, title: tab.title })
  return publish(ctx, groupId)
}

/** `ids` must be exactly the group's tabs, so a reorder racing an add or delete fails instead of dropping one. */
export async function reorderTabs(ctx: Ctx, groupId: string, ids: string[]) {
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tabs:${groupId}`}))`)
    const rows = await tx.select({ id: groupTabs.id }).from(groupTabs).where(eq(groupTabs.groupId, groupId))
    const same =
      rows.length === ids.length && new Set(ids).size === ids.length && rows.every((r) => ids.includes(r.id))
    if (!same) return fail('conflict', '标签已被他人修改，请刷新后重试')
    for (const [position, id] of ids.entries())
      await tx.update(groupTabs).set({ position }).where(eq(groupTabs.id, id))
  })
  return publish(ctx, groupId)
}
