import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GroupPreviewsDto, PreviewDto, ServiceDto } from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupMembers, groups, previews, type runs, services } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { refuse } from '../agent-tools/service.js'
import { dataDir } from '../attachments/service.js'
import { requireMember } from '../groups/service.js'
import { castState, syncCasts } from '../live/service.js'
import { memberIds, postMessage } from '../messages/service.js'
import { closePortListener, openPortListener } from './gateway.js'
import { restartService, syncPreviews } from './services.js'

type Run = typeof runs.$inferSelect
type Preview = typeof previews.$inferSelect
const LIVE = ['starting', 'running']
const REAP_EVERY_MS = 10 * 60_000
/** A login code scanned shows as the simulator within this. */
const LOGIN_WATCH_MS = 5_000
const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024

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

/** Open previews and live services of a group (as `userId` may manage them) or of a machine (its owner's). */
async function listPreviews(
  ctx: Ctx,
  scope: { groupId: string } | { machineId: string },
  manages: (botOwnerId: string) => boolean,
  manageableBotIds: string[],
): Promise<GroupPreviewsDto> {
  const inPreviews =
    'groupId' in scope ? eq(previews.groupId, scope.groupId) : eq(previews.machineId, scope.machineId)
  const inServices =
    'groupId' in scope ? eq(services.groupId, scope.groupId) : eq(services.machineId, scope.machineId)
  const open = await ctx.db
    .select({
      p: previews,
      botName: bots.name,
      ownerId: bots.ownerId,
      groupName: groups.name,
      serviceName: services.name,
      serviceStatus: services.status,
    })
    .from(previews)
    .innerJoin(bots, eq(bots.id, previews.botId))
    .innerJoin(groups, eq(groups.id, previews.groupId))
    .leftJoin(services, eq(services.id, previews.serviceId))
    .where(and(inPreviews, isNull(previews.closedAt)))
    .orderBy(desc(previews.createdAt))
  const live = await ctx.db
    .select({ s: services, botName: bots.name, ownerId: bots.ownerId, groupName: groups.name })
    .from(services)
    .innerJoin(bots, eq(bots.id, services.botId))
    .innerJoin(groups, eq(groups.id, services.groupId))
    .where(and(inServices, inArray(services.status, LIVE)))
    .orderBy(desc(services.createdAt))
  return {
    previews: open.map(
      ({ p, botName, ownerId, groupName, serviceName, serviceStatus }): PreviewDto => ({
        id: p.id,
        groupId: p.groupId,
        groupName,
        botId: p.botId,
        botName,
        kind: p.kind as PreviewDto['kind'],
        title: p.title,
        path: p.path,
        serviceId: p.serviceId,
        serviceName,
        port: p.port,
        snapshotAt: p.snapshotAt?.toISOString() ?? null,
        awaiting: p.awaiting as PreviewDto['awaiting'],
        snapshotError: p.snapshotError,
        live: castState(ctx, p.id),
        status: !ctx.tunnels.get(p.machineId)
          ? 'offline'
          : serviceStatus && !LIVE.includes(serviceStatus)
            ? 'stopped'
            : 'online',
        canManage: manages(ownerId),
        createdAt: p.createdAt.toISOString(),
      }),
    ),
    services: live.map(
      ({ s, botName, ownerId, groupName }): ServiceDto => ({
        id: s.id,
        groupId: s.groupId,
        groupName,
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
    manageableBotIds,
  }
}

export async function groupPreviews(ctx: Ctx, groupId: string, userId: string) {
  const [member] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  const manages = (ownerId: string) => ownerId === userId || !!member?.isAdmin
  const inGroup = await ctx.db
    .select({ id: bots.id, ownerId: bots.ownerId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt)))
  const manageable = inGroup.filter((b) => manages(b.ownerId)).map((b) => b.id)
  return listPreviews(ctx, { groupId }, manages, manageable)
}

/** The desktop app's view: a machine's bots all belong to its owner, who manages everything on it. */
export async function machinePreviews(ctx: Ctx, machineId: string) {
  const own = await ctx.db.select({ id: bots.id }).from(bots).where(eq(bots.machineId, machineId))
  return listPreviews(
    ctx,
    { machineId },
    () => true,
    own.map((b) => b.id),
  )
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
  a: { port?: number; service?: string; miniprogram?: string; title: string; path?: string },
) {
  const [bot] = await ctx.db.select().from(bots).where(eq(bots.id, run.botId))
  if (!bot?.machineId) return refuse('bot 未绑定机器')
  if (a.miniprogram) return exposeMiniprogram(ctx, run, bot.machineId, { ...a, miniprogram: a.miniprogram })
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
  await announce(ctx, run, preview)
  await syncPreviews(ctx, bot.machineId)
  await publishPreviews(ctx, run.groupId)
  void takeSnapshot(ctx, preview).catch(() => {})
  const link = publicLink(ctx, preview)
  return [
    `已发布预览「${a.title}」（id ${preview.id}），群里已出现它的卡片，群成员可直接打开。`,
    link ? `地址：${link}（需通过共工登录，外部人员需要群管理员生成公开链接）` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** `preview_gui`: a hosted service's window, streamed while members watch; one open card per service. */
export async function exposeGui(ctx: Ctx, run: Run, a: { service: string; title: string }) {
  const [bot] = await ctx.db.select().from(bots).where(eq(bots.id, run.botId))
  if (!bot?.machineId) return refuse('bot 未绑定机器')
  const [svc] = await ctx.db
    .select()
    .from(services)
    .where(
      and(
        eq(services.groupId, run.groupId),
        eq(services.botId, run.botId),
        eq(services.name, a.service),
        inArray(services.status, LIVE),
      ),
    )
    .orderBy(desc(services.createdAt))
    .limit(1)
  if (!svc) return refuse(`服务 ${a.service} 不在运行，请先用 service_start 启动`)
  const [existing] = await ctx.db
    .select()
    .from(previews)
    .where(and(eq(previews.serviceId, svc.id), eq(previews.kind, 'gui'), isNull(previews.closedAt)))
  if (existing)
    return `服务 ${a.service} 已发布过预览「${existing.title}」（id ${existing.id}），群里已有它的卡片。`
  const [p] = await ctx.db
    .insert(previews)
    .values({
      slug: newSlug(),
      kind: 'gui',
      machineId: bot.machineId,
      groupId: run.groupId,
      botId: run.botId,
      serviceId: svc.id,
      title: a.title,
      createdByRunId: run.id,
    })
    .returning()
  const preview = p as Preview
  await announce(ctx, run, preview)
  await publishPreviews(ctx, run.groupId)
  return `已发布桌面应用预览「${a.title}」（id ${preview.id}），群里已出现它的卡片，群成员打开后能看到窗口的实时画面。`
}

/** Posts the preview's card in its group. */
async function announce(ctx: Ctx, run: Run, preview: Preview) {
  const card = await postMessage(ctx, {
    groupId: run.groupId,
    kind: 'bot',
    authorBotId: run.botId,
    body: `预览：${preview.title}`,
    meta: { preview: preview.id },
  })
  await ctx.db.update(previews).set({ messageId: card.id }).where(eq(previews.id, preview.id))
}

/** A mini program in the machine's devtools (plan §13): one open card per (group, bot, project), moved by republishing. */
async function exposeMiniprogram(
  ctx: Ctx,
  run: Run,
  machineId: string,
  a: { miniprogram: string; title: string; path?: string },
) {
  const path = a.path ?? '/'
  const [existing] = await ctx.db
    .select()
    .from(previews)
    .where(
      and(
        eq(previews.groupId, run.groupId),
        eq(previews.botId, run.botId),
        eq(previews.project, a.miniprogram),
        isNull(previews.closedAt),
      ),
    )
  if (existing) {
    const [moved] = await ctx.db
      .update(previews)
      .set({ title: a.title, path })
      .where(eq(previews.id, existing.id))
      .returning()
    await publishPreviews(ctx, run.groupId)
    void takeSnapshot(ctx, moved as Preview).catch(() => {})
    return `小程序预览「${a.title}」（id ${existing.id}）已切换到 ${path}，群里已有它的卡片。`
  }
  const [p] = await ctx.db
    .insert(previews)
    .values({
      slug: newSlug(),
      kind: 'miniprogram',
      machineId,
      groupId: run.groupId,
      botId: run.botId,
      project: a.miniprogram,
      path,
      title: a.title,
      createdByRunId: run.id,
    })
    .returning()
  const preview = p as Preview
  await announce(ctx, run, preview)
  await publishPreviews(ctx, run.groupId)
  void takeSnapshot(ctx, preview).catch(() => {})
  return `已发布预览「${a.title}」（id ${preview.id}），群里已出现带模拟器截图的卡片。`
}

export const snapshotFile = (previewId: string) => join(dataDir(), 'previews', `${previewId}.png`)

/**
 * Its first screen through the tunnel: a web page rendered by the machine's headless Chrome, or a mini program's
 * simulator in the machine's devtools; fails with the machine's reason.
 */
export async function takeSnapshot(ctx: Ctx, p: Preview) {
  const conn = ctx.tunnels.get(p.machineId)
  const target = p.project
    ? { previewId: p.id, miniprogram: p.project }
    : p.port !== null
      ? { previewId: p.id, port: p.port }
      : null
  if (!conn || !target) return fail('conflict', '预览所在的机器离线')
  let png: Buffer
  let status: number
  try {
    const stream = conn.open({
      snapshot: target,
      method: 'GET',
      path: p.path,
      headers: [],
      upgrade: false,
    })
    stream.end()
    const head = await stream.head
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of stream) {
      size += (c as Buffer).length
      if (size > SNAPSHOT_MAX_BYTES) throw new Error('截图过大')
      chunks.push(c as Buffer)
    }
    png = Buffer.concat(chunks)
    status = head.status
    if (status !== 200 && status !== 202) throw new Error(png.toString() || `截图失败（${status}）`)
  } catch (err) {
    const reason = (err as Error).message
    if (p.snapshotError !== reason) {
      await ctx.db.update(previews).set({ snapshotError: reason }).where(eq(previews.id, p.id))
      await publishPreviews(ctx, p.groupId)
    }
    return fail('conflict', reason)
  }
  // 202: the machine's devtools want a login first; their QR code stands in for the picture.
  const awaiting = status === 202 ? 'login' : null
  const file = snapshotFile(p.id)
  const unchanged = awaiting && p.awaiting === awaiting && !p.snapshotError
  if (unchanged && (await readFile(file).catch(() => null))?.equals(png)) return
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, png)
  await ctx.db
    .update(previews)
    .set({ snapshotAt: ctx.now(), awaiting, snapshotError: null })
    .where(eq(previews.id, p.id))
  await publishPreviews(ctx, p.groupId)
}

const retaking = new Set<string>()

/** Mini program cards waiting for their devtools' login: asks again, so a scanned code turns into the simulator. */
export async function retakeAwaitingLogin(ctx: Ctx) {
  const waiting = await ctx.db
    .select()
    .from(previews)
    .where(and(eq(previews.awaiting, 'login'), isNull(previews.closedAt)))
  await Promise.all(
    waiting
      .filter((p) => !retaking.has(p.id) && ctx.tunnels.get(p.machineId))
      .map(async (p) => {
        retaking.add(p.id)
        try {
          await takeSnapshot(ctx, p)
        } catch {
          // offline or failing machine: the next round tries again
        } finally {
          retaking.delete(p.id)
        }
      }),
  )
}

export function startLoginWatch(ctx: Ctx) {
  const timer = setInterval(
    () => void retakeAwaitingLogin(ctx).catch((err) => console.error('preview login watch:', err)),
    LOGIN_WATCH_MS,
  )
  return async () => clearInterval(timer)
}

/** Asks the machine to stop a live service; its exit report closes the service's previews. */
export function stopService(ctx: Ctx, svc: { id: string; machineId: string }) {
  if (!ctx.hub.send(svc.machineId, { t: 'service.stop', serviceId: svc.id }))
    fail('conflict', '服务所在的机器离线')
}

/** 停止: closes the tunnel and, with `withService`, stops the live service behind it first. */
export async function stopPreview(ctx: Ctx, preview: Preview, withService: boolean) {
  if (withService && preview.serviceId) {
    const [svc] = await ctx.db
      .select({ id: services.id, machineId: services.machineId })
      .from(services)
      .where(and(eq(services.id, preview.serviceId), inArray(services.status, LIVE)))
    if (svc) stopService(ctx, svc)
  }
  await closePreview(ctx, preview)
}

/**
 * 启动 on a card: restarts the stopped service behind the preview as it was started, then reopens the preview if it
 * was closed (the service's report has moved it onto the restarted one by then).
 */
export async function startPreview(ctx: Ctx, p: Preview) {
  const same = p.project
    ? eq(previews.project, p.project)
    : p.port !== null
      ? eq(previews.port, p.port)
      : null
  if (p.closedAt && same) {
    const [taken] = await ctx.db
      .select({ title: previews.title })
      .from(previews)
      .where(
        and(eq(previews.groupId, p.groupId), eq(previews.botId, p.botId), same, isNull(previews.closedAt)),
      )
    if (taken)
      fail('conflict', `${p.project ? '这个小程序' : `端口 ${p.port}`} 已有新的预览「${taken.title}」`)
  }
  const [svc] = p.serviceId ? await ctx.db.select().from(services).where(eq(services.id, p.serviceId)) : []
  if (svc && !LIVE.includes(svc.status)) await restartService(ctx, svc)
  if (p.closedAt) {
    const [now] = svc
      ? await ctx.db
          .select({ id: services.id, port: services.port })
          .from(services)
          .where(
            and(
              eq(services.groupId, svc.groupId),
              eq(services.botId, svc.botId),
              eq(services.name, svc.name),
              inArray(services.status, LIVE),
            ),
          )
          .orderBy(desc(services.createdAt))
          .limit(1)
      : []
    await ctx.db
      .update(previews)
      .set({ closedAt: null, ...(now ? { serviceId: now.id, port: now.port ?? p.port } : {}) })
      .where(eq(previews.id, p.id))
    if (!ctx.config.preview.domain && p.port !== null) await openPortListener(ctx, p.id)
    await syncPreviews(ctx, p.machineId)
  }
  await publishPreviews(ctx, p.groupId)
  const [fresh] = await ctx.db.select().from(previews).where(eq(previews.id, p.id))
  if (fresh) void takeSnapshot(ctx, fresh).catch(() => {})
}

export async function closePreview(ctx: Ctx, preview: Preview) {
  await ctx.db.update(previews).set({ closedAt: ctx.now() }).where(eq(previews.id, preview.id))
  await closePortListener(ctx, preview.id)
  await syncPreviews(ctx, preview.machineId)
  await syncCasts(ctx, preview.machineId)
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
