import type { GONGGONG_TOOLS } from '@gonggong/protocol'
import { and, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupKnowledge, groupMembers, type runs } from '../../db/schema.js'
import { snippet } from '../../lib/text.js'
import { activeBots } from '../groups/service.js'
import {
  createKnowledge,
  deleteKnowledge,
  entryById,
  type KnowledgeRow,
  loadEntries,
  matching,
  updateKnowledge,
} from '../knowledge/service.js'
import { asTool, refuse, type ToolOutput } from './service.js'

type Run = typeof runs.$inferSelect
type Args<N extends keyof typeof GONGGONG_TOOLS> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>

const time = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
const tagsOf = (e: KnowledgeRow) => (e.tags.length ? ` · 标签：${e.tags.join('、')}` : '')
const head = (e: KnowledgeRow) =>
  `${e.title}（id ${e.id} · v${e.version}${e.pinned ? ' · 置顶' : ''}${tagsOf(e)}）`
const inGroup = (run: Run) => eq(groupKnowledge.groupId, run.groupId)

async function actorOf(ctx: Ctx, run: Run) {
  const name = (await activeBots(ctx, run.groupId)).find((b) => b.id === run.botId)?.name ?? ''
  return { botId: run.botId, name }
}

async function ownEntry(ctx: Ctx, run: Run, id: string) {
  const l = await entryById(ctx, id)
  if (!l || l.e.groupId !== run.groupId) return refuse(`本群知识库没有 id 为 ${id} 的条目，请用 kb_list 查看`)
  return l
}

export async function kbList(ctx: Ctx, run: Run, a: Args<'kb_list'>): Promise<ToolOutput> {
  const tag = a.tag?.trim()
  const rows = await loadEntries(
    ctx,
    and(inGroup(run), tag ? sql`${groupKnowledge.tags} @> ${JSON.stringify([tag])}::jsonb` : undefined),
  )
  if (!rows.length)
    return { text: tag ? `本群知识库没有带标签「${tag}」的条目` : '本群知识库还没有条目', groups: [] }
  const lines = rows.map(({ e }) => `- ${head(e)}`)
  return { text: [`本群知识库（${rows.length} 条）：`, ...lines].join('\n'), groups: [run.groupId] }
}

export async function kbGet(ctx: Ctx, run: Run, a: Args<'kb_get'>): Promise<ToolOutput> {
  const { e, user, bot } = await ownEntry(ctx, run, a.id)
  const who = user ?? bot
  const meta = `「${e.title}」（id ${e.id} · v${e.version}${e.pinned ? ' · 置顶' : ''}${tagsOf(e)} · ${who ? `${who} ` : ''}修改于 ${time(e.updatedAt)}）`
  return { text: `${meta}\n\n${e.body}`, groups: [run.groupId] }
}

export async function kbSearch(ctx: Ctx, run: Run, a: Args<'kb_search'>): Promise<ToolOutput> {
  const rows = (await loadEntries(ctx, and(inGroup(run), matching(a.query)))).slice(0, a.limit ?? 10)
  if (!rows.length) return { text: `知识库没有命中「${a.query}」的条目`, groups: [] }
  const lines = rows.map(({ e }) => `- ${e.title}（id ${e.id} · v${e.version}）：${snippet(e.body, a.query)}`)
  return { text: [`命中「${a.query}」${rows.length} 条：`, ...lines].join('\n'), groups: [run.groupId] }
}

export async function kbCreate(ctx: Ctx, run: Run, a: Args<'kb_create'>): Promise<ToolOutput> {
  const actor = await actorOf(ctx, run)
  const e = await asTool(() =>
    createKnowledge(ctx, run.groupId, { title: a.title, body: a.body, tags: a.tags ?? [] }, actor),
  )
  return { text: `已新建知识库条目「${e.title}」（id ${e.id}，v1）`, groups: [] }
}

export async function kbUpdate(ctx: Ctx, run: Run, a: Args<'kb_update'>): Promise<ToolOutput> {
  const { e } = await ownEntry(ctx, run, a.id)
  if (a.base_version !== e.version)
    refuse(
      `条目已被修改，当前是 v${e.version}：请先用 kb_get 读取最新内容，合并你的改动后以 base_version=${e.version} 重试`,
    )
  const req = { baseVersion: a.base_version, title: a.title, body: a.body, tags: a.tags }
  const actor = await actorOf(ctx, run)
  const row = await asTool(() => updateKnowledge(ctx, e, req, actor))
  return { text: `已更新知识库条目「${row.title}」，当前 v${row.version}`, groups: [] }
}

export async function kbDelete(ctx: Ctx, run: Run, a: Args<'kb_delete'>): Promise<ToolOutput> {
  const { e } = await ownEntry(ctx, run, a.id)
  const [origin] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, run.groupId), eq(groupMembers.userId, run.originUserId)))
  if (!origin?.isAdmin) refuse('删除条目需要发起本轮的人是本群管理员；内容有误时用 kb_update 修正')
  await deleteKnowledge(ctx, e, await actorOf(ctx, run))
  return { text: `已删除知识库条目「${e.title}」`, groups: [] }
}
