import type { RunConfigPick } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import type { runs } from '../../db/schema.js'
import { activeBots } from '../groups/service.js'
import { refuse } from './service.js'

type Run = typeof runs.$inferSelect

/** Chinese labels of terminal run statuses shown in agent-tool listings. */
export const RUN_STATUS_ZH: Record<string, string> = {
  completed: '完成',
  interrupted: '中断',
  forbidden: '无权触发',
  expired: '离线作废',
}

/** Resolves bot names (with optional leading `@`) in the run's group to their bot ids. */
export async function botIdsOf(ctx: Ctx, run: Run, names: string[]) {
  if (!names.length) return []
  const inGroup = await activeBots(ctx, run.groupId)
  return names.map((raw) => {
    const name = raw.trim().replace(/^@/, '')
    const bot = inGroup.find((b) => b.name === name)
    return (
      bot?.id ?? refuse(`本群没有叫「${name}」的 Bot，可选的有：${inGroup.map((b) => b.name).join('、')}`)
    )
  })
}

export async function runOptionsOf(
  ctx: Ctx,
  run: Run,
  list: { bot: string; model?: string; effort?: string }[],
) {
  const ids = await botIdsOf(
    ctx,
    run,
    list.map((o) => o.bot),
  )
  return Object.fromEntries(list.map(({ model, effort }, i) => [ids[i], { model, effort }]))
}

/** Bot actor payload passed to group services when a bot acts during a run. */
export async function botActorOf(ctx: Ctx, run: Run) {
  const botName = (await activeBots(ctx, run.groupId)).find((b) => b.id === run.botId)?.name ?? ''
  return { botId: run.botId, runId: run.id, botName, originUserId: run.originUserId }
}

/** Formats per-bot model / reasoning-effort picks as summary lines for tool replies. */
export function formatRunOptionLines(runOptions: Record<string, RunConfigPick>, names: Map<string, string>) {
  return Object.entries(runOptions).map(
    ([id, p]) =>
      `${names.get(id) ?? '已移出'} 使用：${[p.model ?? '默认模型', p.effort].filter(Boolean).join(' · ')}`,
  )
}
