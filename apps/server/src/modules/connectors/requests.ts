import { randomUUID } from 'node:crypto'
import type { ConnectorCard, ConnectorProbe, GONGGONG_TOOLS } from '@gonggong/protocol'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { bots, machines, messages, runs, users } from '../../db/schema.js'
import type { Run } from '../agent-tools/layers.js'
import { refuse, type ToolOutput } from '../agent-tools/service.js'
import { mirrorConnectorCard } from '../feishu/mirror.js'
import {
  authorName,
  type MessageMeta,
  type MessageRow,
  memberIds,
  messageDto,
  postEvent,
} from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import { groupPluginList } from '../plugins/service.js'
import { rerunFor } from '../runs/trigger.js'
import { probesOf, profileOn } from './state.js'
import { cliSpec, machineConnectors } from './sync.js'
import { personOf } from './view.js'

type Args = z.infer<(typeof GONGGONG_TOOLS)['connector_request']['input']>

/** Cards older than this are not carried on by themselves any more. */
const CARD_TTL_MS = 24 * 3600_000
const RENEW_WITHIN_MS = 48 * 3600_000

/**
 * connector_request (plan 连接器-体验升级方案 §6 就地授权): a 连接 card for the originator in the group; the login link
 * only ever opens in their own dialog. The asking run carries on once their profile on the bot's machine is ready.
 */
export async function connectorRequestTool(ctx: Ctx, run: Run, a: Args): Promise<ToolOutput> {
  const found = (await groupPluginList(ctx.db, run.groupId)).find(
    (r) => r.enabledInGroup && r.plugin.name === a.connector && cliSpec(r.plugin.name, r.version.manifest),
  )
  if (!found) return refuse(`本群没有开启命令行连接器 ${a.connector}`)
  const title = found.version.manifest.title
  const [bot] = await ctx.db
    .select({ name: bots.name, machineId: bots.machineId })
    .from(bots)
    .where(eq(bots.id, run.botId))
  const [user] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, run.originUserId))
  const connectorCard: ConnectorCard = {
    id: randomUUID(),
    pluginId: found.plugin.id,
    connector: a.connector,
    title,
    userId: run.originUserId,
    machineId: bot?.machineId ?? null,
    reason: a.reason,
    domains: a.domains ?? [],
    resolved: false,
  }
  const msg = await postEvent(
    ctx,
    run.groupId,
    '{bot} 请 {user} 连接{title}',
    { bot: bot?.name ?? '', user: user?.name ?? '', title },
    { connectorCard, connectorAsk: { runId: run.id } },
  )
  await mirrorConnectorCard(ctx, run.groupId, msg.id)
  return {
    text: `已给发起人发了「连接${title}」卡片（授权链接只在发起人自己的弹窗里显示）。请结束本轮；连接好后本轮会自动重新运行。`,
    groups: [],
  }
}

/**
 * Resolves the machine's open cards whose user's profile is ready there now; a missing_scope card only once `connected`
 * says that user just connected with every domain it asked for. Each asking run is carried on once.
 */
export async function resolveCards(
  ctx: Ctx,
  machineId: string,
  connected?: { userId: string; connector: string; domains: string[] },
) {
  const open = await ctx.db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.kind, 'event'),
        gt(messages.createdAt, new Date(ctx.now().getTime() - CARD_TTL_MS)),
        sql`${messages.meta}->'connectorCard'->>'machineId' = ${machineId}`,
        sql`${messages.meta}->'connectorCard'->>'resolved' = 'false'`,
      ),
    )
  if (!open.length) return
  const [machine] = await ctx.db
    .select({ ownerId: machines.ownerId })
    .from(machines)
    .where(eq(machines.id, machineId))
  if (!machine) return
  const probes = probesOf(ctx, machineId)
  for (const m of open) {
    const card = (m.meta as MessageMeta).connectorCard!
    const on = profileOn(probes, card.connector, machine.ownerId, await personOf(ctx.db, card.userId))
    const ready =
      card.reason === 'missing_scope'
        ? connected?.userId === card.userId &&
          connected.connector === card.connector &&
          card.domains.every((d) => connected.domains.includes(d))
        : on.probe?.state === 'ready'
    if (ready) await resolveCard(ctx, m)
  }
}

async function resolveCard(ctx: Ctx, m: MessageRow) {
  const [row] = (await ctx.db
    .update(messages)
    .set({ meta: sql`jsonb_set(${messages.meta}, '{connectorCard,resolved}', 'true')` })
    .where(and(eq(messages.id, m.id), sql`${messages.meta}->'connectorCard'->>'resolved' = 'false'`))
    .returning()) as MessageRow[]
  if (!row) return
  const dto = messageDto(row, await authorName(ctx, row))
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.edited', message: dto })
  await mirrorConnectorCard(ctx, row.groupId, row.id)
  const meta = row.meta as MessageMeta
  await carryOn(ctx, meta.connectorAsk?.runId, meta.connectorCard!.title)
}

/** As a filled secret card does: the asking bot runs its turn again; relay hops can only be restarted from their source. */
async function carryOn(ctx: Ctx, runId: string | undefined, title: string) {
  if (!runId) return
  const [row] = await ctx.db
    .select({ run: runs, message: messages, bot: bots.name })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(eq(runs.id, runId))
  if (!row) return
  const { run, message } = row
  if (run.hop === 1 && message.authorUserId && !message.recalledAt) {
    await postEvent(ctx, run.groupId, '已连接{title}，{bot} 继续处理', { title, bot: row.bot })
    await rerunFor(ctx, message, [run.botId])
  } else await postEvent(ctx, run.groupId, '已连接{title}，重新 @{bot} 即可继续', { title, bot: row.bot })
}

const reminded = new WeakMap<Ctx['hub'], Set<string>>()

/** §6 续期提醒: a ready login whose refresh token runs out within 48 hours notifies its person, once per expiry. */
export async function remindExpiring(ctx: Ctx, machineId: string, probes: ConnectorProbe[]) {
  const now = ctx.now().getTime()
  const sent = reminded.get(ctx.hub) ?? new Set<string>()
  reminded.set(ctx.hub, sent)
  const due = probes.filter((p) => {
    const at = p.refreshExpiresAt ? Date.parse(p.refreshExpiresAt) : Number.NaN
    return p.state === 'ready' && at > now && at - now < RENEW_WITHIN_MS
  })
  const fresh = due.filter((p) => !sent.has(`${machineId}|${p.connector}|${p.profile}|${p.refreshExpiresAt}`))
  if (!fresh.length) return
  const [machine] = await ctx.db.select().from(machines).where(eq(machines.id, machineId))
  if (!machine) return
  const connectors = await machineConnectors(ctx.db, machineId)
  for (const p of fresh) {
    const key = `${machineId}|${p.connector}|${p.profile}|${p.refreshExpiresAt}`
    if (sent.has(key)) continue
    sent.add(key)
    const c = connectors.find((x) => x.spec.connector === p.connector)
    await notify(ctx, p.profile === 'default' ? machine.ownerId : p.profile.slice(3), 'connector_expiring', {
      connector: p.connector,
      connectorTitle: c?.title ?? p.connector,
      machineId,
      machineName: machine.label ?? machine.name,
      refreshExpiresAt: p.refreshExpiresAt,
      ...(c && { groupId: c.groupId }),
    })
  }
}
