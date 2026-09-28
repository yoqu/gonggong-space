import { randomBytes } from 'node:crypto'
import type { GroupPreviewsDto, PreviewDto, ServiceDto } from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, previews, type runs, services } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { refuse } from '../agent-tools/service.js'
import { requireMember } from '../groups/service.js'
import { memberIds, postMessage } from '../messages/service.js'
import { closePortListener, openPortListener } from './gateway.js'
import { syncPreviews } from './services.js'

type Run = typeof runs.$inferSelect
type Preview = typeof previews.$inferSelect
const LIVE = ['starting', 'running']
const REAP_EVERY_MS = 10 * 60_000

/** 16 base32 characters (80 bits): the subdomain label in domain mode. */
const newSlug = () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  return [...randomBytes(16)].map((b) => alphabet[b % 32]).join('')
}

/** Where the agent can say the preview lives; the card is the real entry for members. */
function publicLink(ctx: Ctx, p: Preview) {
  const { domain, publicUrl } = ctx.config.preview
  const proto = publicUrl ? new URL(publicUrl).protocol : 'https:'
  if (domain) return `${proto}//${p.slug}.${domain}${p.path}`
  return publicUrl ? `${proto}//${new URL(publicUrl).hostname}:${p.publicPort}${p.path}` : null
}

async function canManage(ctx: Ctx, groupId: string, botOwnerId: string, userId: string) {
  if (botOwnerId === userId) return true
  const [m] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  return !!m?.isAdmin
}

export async function groupPreviews(ctx: Ctx, groupId: string, userId: string): Promise<GroupPreviewsDto> {
  const [member] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  const manages = (ownerId: string) => ownerId === userId || !!member?.isAdmin
  const open = await ctx.db
    .select({ p: previews, botName: bots.name, ownerId: bots.ownerId, serviceName: services.name })
    .from(previews)
    .innerJoin(bots, eq(bots.id, previews.botId))
    .leftJoin(services, eq(services.id, previews.serviceId))
    .where(and(eq(previews.groupId, groupId), isNull(previews.closedAt)))
    .orderBy(desc(previews.createdAt))
  const live = await ctx.db
    .select({ s: services, botName: bots.name, ownerId: bots.ownerId })
    .from(services)
    .innerJoin(bots, eq(bots.id, services.botId))
    .where(and(eq(services.groupId, groupId), inArray(services.status, LIVE)))
    .orderBy(desc(services.createdAt))
  return {
    previews: open.map(
      ({ p, botName, ownerId, serviceName }): PreviewDto => ({
        id: p.id,
        groupId: p.groupId,
        botId: p.botId,
        botName,
        kind: p.kind as PreviewDto['kind'],
        title: p.title,
        path: p.path,
        serviceId: p.serviceId,
        serviceName,
        status: ctx.tunnels.get(p.machineId) ? 'online' : 'offline',
        canManage: manages(ownerId),
        createdAt: p.createdAt.toISOString(),
      }),
    ),
    services: live.map(
      ({ s, botName, ownerId }): ServiceDto => ({
        id: s.id,
        groupId: s.groupId,
        botId: s.botId,
        botName,
        name: s.name,
        command: s.command,
        cwd: s.cwd,
        port: s.port,
        status: s.status as ServiceDto['status'],
        canManage: manages(ownerId),
        createdAt: s.createdAt.toISOString(),
      }),
    ),
  }
}

export async function publishPreviews(ctx: Ctx, groupId: string) {
  for (const userId of await memberIds(ctx, groupId))
    ctx.bus.publish([userId], {
      t: 'group.previews',
      groupId,
      ...(await groupPreviews(ctx, groupId, userId)),
    })
}

/** `preview_expose` for a live run (plan §5): one open preview per (group, bot, port), announced by a card. */
export async function exposePreview(
  ctx: Ctx,
  run: Run,
  a: { port?: number; service?: string; title: string; path?: string },
) {
  const [bot] = await ctx.db.select().from(bots).where(eq(bots.id, run.botId))
  if (!bot?.machineId) return refuse('bot 未绑定机器')
  const mine = and(
    eq(services.groupId, run.groupId),
    eq(services.botId, run.botId),
    inArray(services.status, LIVE),
  )
  const [svc] = await ctx.db
    .select()
    .from(services)
    .where(and(mine, a.service ? eq(services.name, a.service) : eq(services.port, a.port ?? 0)))
    .orderBy(desc(services.createdAt))
    .limit(1)
  if (a.service && !svc) return refuse(`服务 ${a.service} 不在运行，请先用 service_start 启动`)
  const port = a.port ?? svc?.port
  if (!port) return refuse(`服务 ${a.service} 没有声明端口，请用 service_start 的 port 重新启动`)

  const [existing] = await ctx.db
    .select()
    .from(previews)
    .where(
      and(
        eq(previews.groupId, run.groupId),
        eq(previews.botId, run.botId),
        eq(previews.port, port),
        isNull(previews.closedAt),
      ),
    )
  if (existing) {
    const link = publicLink(ctx, existing)
    return `端口 ${port} 已发布过预览「${existing.title}」（id ${existing.id}）${link ? `：${link}` : ''}，群里已有它的卡片。`
  }
  const [p] = await ctx.db
    .insert(previews)
    .values({
      slug: newSlug(),
      kind: 'http',
      machineId: bot.machineId,
      groupId: run.groupId,
      botId: run.botId,
      serviceId: svc?.id ?? null,
      port,
      path: a.path ?? '/',
      title: a.title,
      createdByRunId: run.id,
    })
    .returning()
  let preview = p as Preview
  if (!ctx.config.preview.domain)
    preview = { ...preview, publicPort: await openPortListener(ctx, preview.id) }
  const card = await postMessage(ctx, {
    groupId: run.groupId,
    kind: 'bot',
    authorBotId: run.botId,
    body: `预览：${a.title}`,
    meta: { preview: preview.id },
  })
  await ctx.db.update(previews).set({ messageId: card.id }).where(eq(previews.id, preview.id))
  await syncPreviews(ctx, bot.machineId)
  await publishPreviews(ctx, run.groupId)
  const link = publicLink(ctx, preview)
  return [
    `已发布预览「${a.title}」（id ${preview.id}），群里已出现它的卡片，群成员可直接打开。`,
    link ? `地址：${link}（需通过共工登录，外部人员需要群管理员生成公开链接）` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function closePreview(ctx: Ctx, preview: Preview) {
  await ctx.db.update(previews).set({ closedAt: ctx.now() }).where(eq(previews.id, preview.id))
  await closePortListener(ctx, preview.id)
  await syncPreviews(ctx, preview.machineId)
  await publishPreviews(ctx, preview.groupId)
}

/** `preview_close`: only previews of the run's own conversation. */
export async function closeOwnPreview(ctx: Ctx, run: Run, previewId: string) {
  const [p] = await ctx.db
    .select()
    .from(previews)
    .where(
      and(
        eq(previews.id, previewId),
        eq(previews.groupId, run.groupId),
        eq(previews.botId, run.botId),
        isNull(previews.closedAt),
      ),
    )
  if (!p) return refuse(`没有这个预览：${previewId}`)
  await closePreview(ctx, p)
  return `预览「${p.title}」已关闭`
}

/** A member who is the bot owner or a group admin (plan §6 sidebar). */
export async function requireManager(ctx: Ctx, groupId: string, botId: string, userId: string) {
  await requireMember(ctx, groupId, userId)
  const [bot] = await ctx.db.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, botId))
  if (!bot || !(await canManage(ctx, groupId, bot.ownerId, userId)))
    fail('forbidden', '仅 Bot 主人或群管理员可操作')
}

/** Plan P11: previews nobody opened for `previewIdleHours` close; services left without an open preview stop. */
export async function reapIdlePreviews(ctx: Ctx) {
  const { previewIdleHours } = await sysParams(ctx.db)
  const before = new Date(ctx.now().getTime() - previewIdleHours * 3600_000)
  const idle = await ctx.db
    .select()
    .from(previews)
    .where(
      and(
        isNull(previews.closedAt),
        sql`coalesce(${previews.lastAccessAt}, ${previews.createdAt}) < ${before.toISOString()}`,
      ),
    )
  for (const p of idle) {
    await closePreview(ctx, p)
    if (!p.serviceId) continue
    const [still] = await ctx.db
      .select({ id: previews.id })
      .from(previews)
      .where(and(eq(previews.serviceId, p.serviceId), isNull(previews.closedAt)))
    if (!still) ctx.hub.send(p.machineId, { t: 'service.stop', serviceId: p.serviceId })
  }
}

export function startPreviewReaper(ctx: Ctx) {
  const timer = setInterval(
    () => void reapIdlePreviews(ctx).catch((err) => console.error('preview reaper:', err)),
    REAP_EVERY_MS,
  )
  return async () => clearInterval(timer)
}
