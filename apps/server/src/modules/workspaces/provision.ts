import { randomUUID } from 'node:crypto'
import type { DaemonToServer, WorkspaceState } from '@aiws/protocol'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupRepos, groups } from '../../db/schema.js'
import { postEvent } from '../messages/service.js'
import { schedule } from '../runs/scheduler.js'
import { updateBotState } from './state.js'

type BotRef = { id: string; name: string; machineId: string | null }

/** An ensure / cd request awaiting its daemon's answer. Only the latest ensure per (group, bot) is kept. */
interface Pending {
  kind: 'ensure' | 'cd'
  machineId: string
  groupId: string
  botId: string
  repoId: string
  /** cd target; null = back to managed. */
  cdPath: string | null
  /** The ensure was part of the bot joining the group (event wording). */
  joined: boolean
  resolve?: (s: WorkspaceState | null) => void
}
const pending = new Map<string, Pending>()

const MANAGED = {
  workspaceKind: 'managed',
  cdPath: null,
  workspacePath: null,
  gitStatus: null,
  workspaceError: null,
} as const

export async function currentRepo(ctx: Ctx, groupId: string) {
  const [repo] = await ctx.db
    .select({ id: groupRepos.id, url: groupRepos.url, branch: groupRepos.baseBranch })
    .from(groupRepos)
    .where(eq(groupRepos.groupId, groupId))
    .orderBy(asc(groupRepos.createdAt))
    .limit(1)
  return repo ?? null
}

const onlineMachine = (ctx: Ctx, machineId: string | null) =>
  machineId && ctx.hub.isOnline(machineId) ? machineId : null

function settle(requestId: string, state: WorkspaceState | null) {
  const req = pending.get(requestId)
  pending.delete(requestId)
  req?.resolve?.(state)
}

/**
 * Makes the bot's managed workspace match the group's current repo: repo-less groups are ready at once (the daemon
 * creates `_empty` on first run); otherwise the owner's daemon is asked to clone, or the bot waits as `pending` until
 * its machine comes online. `reset` also drops any /cd binding (bot (re)joining).
 */
export async function ensureWorkspace(
  ctx: Ctx,
  groupId: string,
  bot: BotRef,
  o: { joined: boolean; reset?: boolean },
) {
  const repo = await currentRepo(ctx, groupId)
  const base = o.reset ? MANAGED : {}
  if (!repo) return void (await updateBotState(ctx, groupId, bot.id, { ...base, workspaceState: 'ready' }))
  const machineId = onlineMachine(ctx, bot.machineId)
  // Written before sending so a fast answer can't be overwritten by this state.
  await updateBotState(ctx, groupId, bot.id, { ...base, workspaceState: machineId ? 'cloning' : 'pending' })
  if (!machineId) return
  for (const [id, p] of pending)
    if (p.kind === 'ensure' && p.groupId === groupId && p.botId === bot.id) pending.delete(id)
  const requestId = randomUUID()
  pending.set(requestId, {
    kind: 'ensure',
    machineId,
    groupId,
    botId: bot.id,
    repoId: repo.id,
    cdPath: null,
    joined: o.joined,
  })
  if (!ctx.hub.send(machineId, { t: 'workspace.ensure', requestId, groupId, botId: bot.id, repo })) {
    pending.delete(requestId)
    await updateBotState(ctx, groupId, bot.id, { workspaceState: 'pending' })
  }
}

/**
 * /cd: asks the owner's daemon to bind the bot to a local directory (`path: null` = back to managed). Returns right
 * after sending; `reply` resolves with the daemon's answer (null if the machine went offline or the request became
 * stale). A refused /cd leaves the current workspace untouched. Returns null when the group has no repo or the
 * machine is offline.
 */
export async function requestCd(ctx: Ctx, o: { groupId: string; botId: string; path: string | null }) {
  const repo = await currentRepo(ctx, o.groupId)
  const [bot] = await ctx.db.select({ machineId: bots.machineId }).from(bots).where(eq(bots.id, o.botId))
  const machineId = onlineMachine(ctx, bot?.machineId ?? null)
  if (!repo || !machineId) return null
  const requestId = randomUUID()
  const reply = new Promise<WorkspaceState | null>((resolve) =>
    pending.set(requestId, {
      kind: 'cd',
      machineId,
      ...o,
      repoId: repo.id,
      cdPath: o.path,
      joined: false,
      resolve,
    }),
  )
  if (
    !ctx.hub.send(machineId, {
      t: 'workspace.cd',
      requestId,
      groupId: o.groupId,
      botId: o.botId,
      repo,
      path: o.path,
    })
  ) {
    settle(requestId, null)
    return null
  }
  return { requestId, reply }
}

async function onState(ctx: Ctx, machineId: string, msg: WorkspaceState) {
  const req = msg.requestId ? pending.get(msg.requestId) : undefined
  if (msg.requestId && !req) return
  if (req && (req.machineId !== machineId || req.groupId !== msg.groupId || req.botId !== msg.botId)) return
  const [row] = await ctx.db
    .select({ name: bots.name, error: groupBots.workspaceError })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(
      and(
        eq(groupBots.groupId, msg.groupId),
        eq(groupBots.botId, msg.botId),
        eq(bots.machineId, machineId),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
      ),
    )
  if (!row) return
  if (req && (await currentRepo(ctx, msg.groupId))?.id !== req.repoId)
    return settle(msg.requestId as string, null)
  if (req && msg.state !== 'cloning') settle(msg.requestId as string, msg)
  if (req?.kind === 'cd' && req.cdPath && msg.state !== 'ready') return

  await updateBotState(ctx, msg.groupId, msg.botId, {
    workspaceState: msg.state,
    workspaceError: msg.error,
    ...(msg.path && { workspacePath: msg.path }),
    ...(msg.git && { gitStatus: msg.git }),
    ...(req?.kind === 'cd' &&
      msg.state === 'ready' && { workspaceKind: req.cdPath ? 'cd' : 'managed', cdPath: req.cdPath }),
  })
  if (req?.kind === 'ensure' && msg.state === 'ready')
    await postEvent(
      ctx,
      msg.groupId,
      `${row.name}${req.joined ? ' 加入' : ''} · daemon 已 clone 到托管工作区`,
    )
  // A retry failing the same way (e.g. on every reconnect) is not announced again.
  if (req?.kind === 'ensure' && msg.state === 'failed' && msg.error !== row.error)
    await postEvent(ctx, msg.groupId, `${row.name} 工作区创建失败：${msg.error ?? '未知错误'}`)
  if (msg.state === 'ready') await schedule(ctx, msg.botId)
}

/** Workspaces not ready for their group's current repo are (re)ensured whenever the owner's machine connects. */
async function onOnline(ctx: Ctx, machineId: string) {
  const rows = await ctx.db
    .select({ groupId: groupBots.groupId, id: bots.id, name: bots.name, machineId: bots.machineId })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(
      and(
        eq(bots.machineId, machineId),
        isNull(bots.deletedAt),
        isNull(groupBots.removedAt),
        isNull(groups.archivedAt),
        ne(groupBots.workspaceState, 'ready'),
      ),
    )
  for (const { groupId, ...bot } of rows) await ensureWorkspace(ctx, groupId, bot, { joined: false })
}

/** Wires daemon workspace reports and machine presence; handled in arrival order. Returns a drain-and-detach fn. */
export function startWorkspaceEngine(ctx: Ctx) {
  let chain = Promise.resolve()
  const enqueue = (job: () => Promise<void>) => {
    chain = chain.then(job).catch((err) => console.error('workspace engine:', err))
  }
  const onMessage = (machineId: string, msg: DaemonToServer) => {
    if (msg.t === 'workspace.state') enqueue(() => onState(ctx, machineId, msg))
  }
  const online = (machineId: string) => enqueue(() => onOnline(ctx, machineId))
  const offline = (machineId: string) => {
    for (const [id, p] of pending) if (p.machineId === machineId) settle(id, null)
  }
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', online)
  ctx.hub.on('offline', offline)
  return async () => {
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', online)
    ctx.hub.off('offline', offline)
    await chain
  }
}
