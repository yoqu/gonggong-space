import type { GONGGONG_TOOLS, ProgressCard, ProgressStage } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { bots, messages } from '../../db/schema.js'
import { zh } from '../../i18n/index.js'
import { mirrorProgress } from '../feishu/mirror.js'
import { authorName, type MessageMeta, memberIds, messageDto, postMessage } from '../messages/service.js'
import type { Run } from './layers.js'
import { refuse, type ToolOutput } from './service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Args = z.infer<(typeof GONGGONG_TOOLS)['progress_card']['input']>

const statusOf = (stages: ProgressStage[]): ProgressCard['status'] =>
  stages.some((s) => s.status === 'failed')
    ? 'failed'
    : stages.every((s) => s.status === 'done' || s.status === 'skipped')
      ? 'done'
      : 'running'

/** Posts a progress card, or updates one this bot posted in the group: only the fields given change. */
export async function progressCard(ctx: Ctx, run: Run, a: Args): Promise<ToolOutput> {
  if (!a.id) {
    if (!a.title || !a.stages) return refuse('新建进度卡片需要 title 和 stages')
    const [bot] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, run.botId))
    const id = crypto.randomUUID()
    const progress: ProgressCard = {
      id,
      botId: run.botId,
      runId: run.id,
      title: a.title,
      stages: a.stages,
      percent: a.percent ?? null,
      detail: a.detail ?? null,
      link: a.link ?? null,
      status: statusOf(a.stages),
      updatedAt: ctx.now().toISOString(),
    }
    const i18n = { key: '{bot} 的进度：{title}', params: { bot: bot?.name ?? '', title: a.title } } as const
    await postMessage(ctx, {
      id,
      groupId: run.groupId,
      kind: 'event',
      body: zh(i18n.key, i18n.params),
      meta: { progress, i18n } satisfies MessageMeta,
    })
    await mirrorProgress(ctx, run.groupId, id)
    return { text: `已发出进度卡片，id：${id}。之后用 progress_card 传这个 id 更新它。`, groups: [] }
  }
  if (!UUID.test(a.id)) return refuse('本群没有这张进度卡片')
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, a.id))
  const old = (m?.meta as MessageMeta | undefined)?.progress
  if (!m || !old || m.groupId !== run.groupId) return refuse('本群没有这张进度卡片')
  if (old.botId !== run.botId) return refuse('不是本 Bot 的进度卡片，不能更新')
  const stages = a.stages ?? old.stages
  const progress: ProgressCard = {
    ...old,
    runId: run.id,
    title: a.title ?? old.title,
    stages,
    percent: a.percent === undefined ? old.percent : a.percent,
    detail: a.detail === undefined ? old.detail : a.detail,
    link: a.link === undefined ? old.link : a.link,
    status: statusOf(stages),
    updatedAt: ctx.now().toISOString(),
  }
  const [row] = await ctx.db
    .update(messages)
    .set({ meta: { ...(m.meta as MessageMeta), progress } })
    .where(eq(messages.id, m.id))
    .returning()
  const dto = messageDto(row!, await authorName(ctx, row!))
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.edited', message: dto })
  await mirrorProgress(ctx, run.groupId, m.id)
  return { text: `已更新进度卡片（${progress.status}）。`, groups: [] }
}
