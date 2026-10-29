import type { GONGGONG_TOOLS } from '@gonggong/protocol'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { artifacts } from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'
import { manifestOf, requireVersion } from '../artifacts/service.js'
import type { Run } from './layers.js'
import { refuse, type ToolOutput } from './service.js'

type Args = z.infer<(typeof GONGGONG_TOOLS)['artifact_checkout']['input']>

/**
 * artifact_checkout: the daemon checks artifacts out only when a run starts, so this one is queued for the bot's next
 * run (RunStart.artifacts takes it first, see runArtifacts).
 */
export async function artifactCheckout(ctx: Ctx, run: Run, a: Args): Promise<ToolOutput> {
  const key = a.artifact.trim()
  const found = await ctx.db
    .select()
    .from(artifacts)
    .where(
      and(eq(artifacts.groupId, run.groupId), isUuid(key) ? eq(artifacts.id, key) : eq(artifacts.title, key)),
    )
    .orderBy(desc(artifacts.updatedAt))
  const [hit] = found
  if (!hit) return refuse(`本群没有产物「${key}」`)
  if (found.length > 1)
    return refuse(
      [
        `本群有 ${found.length} 个产物叫「${key}」，请用 id 指定：`,
        ...found.map((x) => `- ${x.id} ${x.dir}/`),
      ].join('\n'),
    )
  const head = hit.headVersionId ? await requireVersion(ctx.db, hit, hit.headVersionId) : null
  const m = await manifestOf(hit, head ?? undefined)
  const about = [
    `产物「${hit.title}」（id ${hit.id}），目录 ${hit.dir}/，${head ? `当前版本 v${head.n}` : '还没有版本'}。`,
    ...(m ? [`屏幕：${m.screens.map((s) => `${s.id}（${s.title}）`).join('、')}`] : []),
  ]
  if (run.artifacts.includes(hit.id))
    return { text: [...about, '本轮已经检出，直接在该目录里读写。'].join('\n'), groups: [] }
  await ctx.db
    .update(artifacts)
    .set({
      checkoutBotIds: sql`case when ${artifacts.checkoutBotIds} @> ${JSON.stringify([run.botId])}::jsonb
        then ${artifacts.checkoutBotIds} else ${artifacts.checkoutBotIds} || ${JSON.stringify([run.botId])}::jsonb end`,
    })
    .where(eq(artifacts.id, hit.id))
  return {
    text: [
      ...about,
      '已登记：下一轮开跑前会检出到该目录，本轮之内目录不会出现，也不要自己新建同名目录。需要马上处理就在回复里说明，请群成员再 @ 你一次。',
    ].join('\n'),
    groups: [],
  }
}
