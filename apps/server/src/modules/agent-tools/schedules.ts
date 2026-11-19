import { describeSchedule, formatInZone, type GONGGONG_TOOLS, TimeZone } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupMembers, type runs, schedules } from '../../db/schema.js'
import { zhText } from '../../i18n/index.js'
import { isUuid } from '../../lib/ids.js'
import { activeBots } from '../groups/service.js'
import {
  createSchedule,
  deleteSchedule,
  loadSchedules,
  type ScheduleRow,
  scheduleById,
  updateSchedule,
} from '../schedules/service.js'
import { nextFires } from '../schedules/timing.js'
import { botActorOf, botIdsOf, formatRunOptionLines, RUN_STATUS_ZH, runOptionsOf } from './bots.js'
import { asTool, refuse, type ToolOutput } from './service.js'

type Run = typeof runs.$inferSelect
type Args<N extends keyof typeof GONGGONG_TOOLS> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>

const DEFAULT_TZ = 'Asia/Shanghai'

function timingOf(a: { cron?: string; at?: string; timezone?: string }) {
  if (a.timezone !== undefined && !TimeZone.safeParse(a.timezone).success) refuse(`时区无效：${a.timezone}`)
  return { cron: a.cron, runAt: a.at, timezone: a.timezone }
}

async function summary(ctx: Ctx, s: ScheduleRow, head: string) {
  const names = new Map((await activeBots(ctx, s.groupId)).map((b) => [b.id, b.name]))
  const next = s.enabled
    ? nextFires(s, ctx.now(), 3).map((d) => formatInZone(d.toISOString(), s.timezone))
    : []
  return [
    `${head}：${zhText(describeSchedule({ ...s, runAt: s.runAt?.toISOString() ?? null }))}（${s.timezone}）。`,
    `候选 Bot：${s.botIds.map((id) => names.get(id) ?? '已移出').join(' → ')}（到点由第一个可用的执行）`,
    ...formatRunOptionLines(s.runOptions, names),
    next.length ? `接下来执行：${next.join('、')}` : '已暂停，不会执行',
  ].join('\n')
}

/** A task of the run's group that this bot created or is a candidate of. */
async function ownTask(ctx: Ctx, run: Run, id: string) {
  const row = isUuid(id) ? await scheduleById(ctx, id) : undefined
  if (!row || row.s.groupId !== run.groupId)
    return refuse(`本群没有 id 为 ${id} 的定时任务，请用 schedule_list 查看`)
  if (row.s.createdByBotId !== run.botId && !row.s.botIds.includes(run.botId))
    refuse('只能修改你创建的、或候选里有你的定时任务')
  return row.s
}

export async function scheduleCreate(ctx: Ctx, run: Run, a: Args<'schedule_create'>): Promise<ToolOutput> {
  const [origin] = await ctx.db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, run.groupId), eq(groupMembers.userId, run.originUserId)))
  if (!origin) refuse('发起本轮的人已不在本群，不能代为创建定时任务')
  const t = timingOf(a)
  const req = {
    name: a.name,
    prompt: a.prompt,
    botIds: a.bots ? await botIdsOf(ctx, run, a.bots) : [run.botId],
    runOptions: a.run_options ? await runOptionsOf(ctx, run, a.run_options) : {},
    ...(t.cron !== undefined && { cron: t.cron }),
    ...(t.runAt !== undefined && { runAt: t.runAt }),
    timezone: t.timezone ?? DEFAULT_TZ,
  }
  const actor = await botActorOf(ctx, run)
  const s = await asTool(() => createSchedule(ctx, run.groupId, req, run.originUserId, actor))
  return {
    text: await summary(ctx, s, `已创建定时任务「${s.name}」（id ${s.id}），立即生效，群里已出现任务卡片`),
    groups: [],
  }
}

export async function scheduleList(ctx: Ctx, run: Run): Promise<ToolOutput> {
  const rows = await loadSchedules(ctx, eq(schedules.groupId, run.groupId))
  if (!rows.length) return { text: '本群还没有定时任务', groups: [run.groupId] }
  const names = new Map((await activeBots(ctx, run.groupId)).map((b) => [b.id, b.name]))
  const lines = rows.map(({ s, lastStatus }) => {
    const when = zhText(describeSchedule({ ...s, runAt: s.runAt?.toISOString() ?? null }))
    const state = s.enabled
      ? `启用中 · 下次 ${s.nextRunAt ? formatInZone(s.nextRunAt.toISOString(), s.timezone) : '无'}`
      : `已暂停${s.pausedReason ? `（${zhText(s.pausedReason)}）` : ''}`
    const last = s.lastFiredAt
      ? ` · 最近 ${formatInZone(s.lastFiredAt.toISOString(), s.timezone)} ${names.get(s.lastBotId ?? '') ?? ''} ${RUN_STATUS_ZH[lastStatus ?? ''] ?? lastStatus ?? '跳过'}`
      : ''
    const bots = s.botIds.map((id) => names.get(id) ?? '已移出').join(' → ')
    return `- 「${s.name}」（id ${s.id}）· ${when} · 候选 ${bots} · ${state}${last}\n  指令：${s.prompt}`
  })
  return { text: [`本群的定时任务（${rows.length} 个）：`, ...lines].join('\n'), groups: [run.groupId] }
}

export async function scheduleUpdate(ctx: Ctx, run: Run, a: Args<'schedule_update'>): Promise<ToolOutput> {
  const s = await ownTask(ctx, run, a.id)
  const t = timingOf(a)
  const req = {
    ...(a.name !== undefined && { name: a.name }),
    ...(a.prompt !== undefined && { prompt: a.prompt }),
    ...(a.bots && { botIds: await botIdsOf(ctx, run, a.bots) }),
    ...(a.run_options && { runOptions: await runOptionsOf(ctx, run, a.run_options) }),
    ...(t.cron !== undefined && { cron: t.cron }),
    ...(t.runAt !== undefined && { runAt: t.runAt }),
    ...(t.timezone !== undefined && { timezone: t.timezone }),
    ...(a.enabled !== undefined && { enabled: a.enabled }),
  }
  const actor = await botActorOf(ctx, run)
  const row = await asTool(() => updateSchedule(ctx, s, req, actor))
  return { text: await summary(ctx, row, `已更新定时任务「${row.name}」`), groups: [] }
}

export async function scheduleDelete(ctx: Ctx, run: Run, a: Args<'schedule_delete'>): Promise<ToolOutput> {
  const s = await ownTask(ctx, run, a.id)
  await deleteSchedule(ctx, s, await botActorOf(ctx, run))
  return { text: `已删除定时任务「${s.name}」`, groups: [] }
}
