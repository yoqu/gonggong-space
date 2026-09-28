import { randomUUID } from 'node:crypto'
import {
  type DaemonToServer,
  type GitProtocol,
  publicRepoUrl,
  type RepoAccessReason,
  type WorkspaceState,
} from '@gonggong/protocol'
import { and, asc, eq, isNull, notInArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupRepos, groups, users } from '../../db/schema.js'
import { onCdResult } from '../commands/cd.js'
import { postEvent } from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import { forgetLocalPath, recordRepo } from '../repos/service.js'
import { schedule } from '../runs/scheduler.js'
import { updateBotState } from './state.js'

type BotRef = { id: string; name: string; machineId: string | null }

/**
 * An ensure / cd request awaiting its daemon's answer. Only the latest ensure per (group, bot) is kept.
 * 'default' = a cd to the bot's default workspace made on join (plan W2–W4).
 */
export interface Pending {
  kind: 'ensure' | 'cd' | 'default'
  machineId: string
  groupId: string
  botId: string
  /** The group's repo when sent; null for repo-less groups. */
  repoId: string | null
  /** cd target; null = back to managed. */
  cdPath: string | null
  /** The request was part of the bot joining the group (event wording). */
  joined: boolean
}
const pending = new Map<string, Pending>()

/** Registers a request about to be sent; returns its requestId. */
export function track(p: Pending) {
  const requestId = randomUUID()
  pending.set(requestId, p)
  return requestId
}

export const forget = (requestId: string) => pending.delete(requestId)

const MANAGED = {
  workspaceKind: 'managed',
  cdPath: null,
  workspacePath: null,
  gitStatus: null,
  workspaceError: null,
  workspaceReason: null,
} as const

/** Reasons that pause a bot: its machine cannot reach the repo (a missing branch is the group's problem). */
export const PAUSING: readonly RepoAccessReason[] = ['denied', 'network', 'timeout']
const REASON_TEXT: Record<RepoAccessReason, string> = {
  denied: '无权限或仓库不存在',
  branch_missing: '分支不存在',
  network: '网络或证书问题',
  timeout: '连接超时',
}
export const reasonText = (r: RepoAccessReason) => REASON_TEXT[r]

/** The group's repo as sent to daemons; `protocol` is the bot owner's preference when a bot is given. */
export async function currentRepo(ctx: Ctx, groupId: string, botId?: string) {
  const [repo] = await ctx.db
    .select({ id: groupRepos.id, url: groupRepos.url, branch: groupRepos.baseBranch })
    .from(groupRepos)
    .where(eq(groupRepos.groupId, groupId))
    .orderBy(asc(groupRepos.createdAt))
    .limit(1)
  if (!repo) return null
  return { ...repo, protocol: botId ? await ownerProtocol(ctx, botId) : ('auto' as const) }
}

export async function ownerProtocol(ctx: Ctx, botId: string) {
  const [row] = await ctx.db
    .select({ protocol: users.gitProtocol })
    .from(bots)
    .innerJoin(users, eq(users.id, bots.ownerId))
    .where(eq(bots.id, botId))
  return (row?.protocol ?? 'auto') as GitProtocol
}

export const onlineMachine = (ctx: Ctx, machineId: string | null) =>
  machineId && ctx.hub.isOnline(machineId) ? machineId : null

async function ownerName(ctx: Ctx, botId: string) {
  const [row] = await ctx.db
    .select({ name: users.name })
    .from(bots)
    .innerJoin(users, eq(users.id, bots.ownerId))
    .where(eq(bots.id, botId))
  return row?.name ?? ''
}

/** Asks the owner's daemon to validate and bind the default directory; false when the machine is offline. */
async function sendDefault(ctx: Ctx, groupId: string, bot: BotRef, path: string, joined: boolean) {
  const machineId = onlineMachine(ctx, bot.machineId)
  if (!machineId) return false
  const repo = await currentRepo(ctx, groupId, bot.id)
  const requestId = track({
    kind: 'default',
    machineId,
    groupId,
    botId: bot.id,
    repoId: repo?.id ?? null,
    cdPath: path,
    joined,
  })
  const sent = ctx.hub.send(machineId, {
    t: 'workspace.cd',
    requestId,
    groupId,
    botId: bot.id,
    repo,
    path,
    force: false,
  })
  if (!sent) forget(requestId)
  return sent
}

/**
 * Picks a joining bot's workspace (plan W2–W5): its default directory, validated against the group repo by the
 * owner's daemon; without one the bot stays `unbound` until the owner binds it. Also used after a repo change.
 */
export async function joinWorkspace(ctx: Ctx, groupId: string, bot: BotRef, o: { joined: boolean }) {
  const [row] = await ctx.db.select({ path: bots.defaultWorkspace }).from(bots).where(eq(bots.id, bot.id))
  const lead = `${bot.name}${o.joined ? ' 加入' : ''}`
  const path = row?.path
  if (!path) {
    await updateBotState(ctx, groupId, bot.id, { ...MANAGED, workspaceState: 'unbound' })
    return void (await postEvent(ctx, groupId, `${lead} · 等待 ${await ownerName(ctx, bot.id)} 绑定工作区`))
  }
  await updateBotState(ctx, groupId, bot.id, {
    ...MANAGED,
    workspaceKind: 'cd',
    cdPath: path,
    workspaceState: 'pending',
  })
  if (!(await sendDefault(ctx, groupId, bot, path, o.joined)))
    await postEvent(ctx, groupId, `${lead} · daemon 离线，上线后使用默认工作区`)
}

async function onDefault(ctx: Ctx, req: Pending, msg: WorkspaceState, name: string) {
  if (msg.state === 'cloning') return
  if (msg.state === 'failed') {
    if (req.cdPath) await forgetLocalPath(ctx, req.machineId, req.cdPath)
    await updateBotState(ctx, msg.groupId, msg.botId, {
      ...MANAGED,
      workspaceState: 'unbound',
      workspaceError: msg.error,
    })
    const owner = await ownerName(ctx, msg.botId)
    return void (await postEvent(
      ctx,
      msg.groupId,
      `${name} 默认工作区不可用：${msg.error ?? '未知错误'}，等待 ${owner} 绑定工作区`,
    ))
  }
  await updateBotState(ctx, msg.groupId, msg.botId, {
    workspaceKind: 'cd',
    cdPath: req.cdPath,
    workspaceState: 'ready',
    workspacePath: msg.path,
    gitStatus: msg.git,
    workspaceError: null,
    workspaceReason: null,
  })
  await rememberDir(ctx, req, msg)
  await postEvent(
    ctx,
    msg.groupId,
    `${name}${req.joined ? ' 加入' : ''} · 使用默认工作区 ${req.cdPath}（主人可改绑）`,
  )
  await schedule(ctx, msg.botId)
}

/**
 * Re-requests the managed workspace the owner chose, after its machine reconnected: repo-less groups are ready at once
 * (the daemon creates `_empty` on first run); otherwise the daemon is asked to clone.
 */
export async function ensureWorkspace(ctx: Ctx, groupId: string, bot: BotRef) {
  const repo = await currentRepo(ctx, groupId, bot.id)
  if (!repo) return void (await updateBotState(ctx, groupId, bot.id, { workspaceState: 'ready' }))
  const machineId = onlineMachine(ctx, bot.machineId)
  // Written before sending so a fast answer can't be overwritten by this state.
  await updateBotState(ctx, groupId, bot.id, { workspaceState: machineId ? 'cloning' : 'pending' })
  if (!machineId) return
  for (const [id, p] of pending)
    if (p.kind === 'ensure' && p.groupId === groupId && p.botId === bot.id) pending.delete(id)
  const requestId = track({
    kind: 'ensure',
    machineId,
    groupId,
    botId: bot.id,
    repoId: repo.id,
    cdPath: null,
    joined: false,
  })
  if (!ctx.hub.send(machineId, { t: 'workspace.ensure', requestId, groupId, botId: bot.id, repo })) {
    forget(requestId)
    await updateBotState(ctx, groupId, bot.id, { workspaceState: 'pending' })
  }
}

async function onState(ctx: Ctx, machineId: string, msg: WorkspaceState) {
  const req = msg.requestId ? pending.get(msg.requestId) : undefined
  if (msg.requestId && !req) return
  if (req && (req.machineId !== machineId || req.groupId !== msg.groupId || req.botId !== msg.botId)) return
  const [row] = await ctx.db
    .select({ name: bots.name, ownerId: bots.ownerId, error: groupBots.workspaceError })
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
  if (req && msg.state !== 'cloning') forget(msg.requestId as string)
  // Answers for the group's previous repo are stale.
  if (req && ((await currentRepo(ctx, msg.groupId))?.id ?? null) !== req.repoId) return
  if (req?.kind === 'default') return onDefault(ctx, req, msg, row.name)

  // A refused /cd leaves the current workspace untouched.
  if (!(req?.kind === 'cd' && req.cdPath && msg.state !== 'ready'))
    await updateBotState(ctx, msg.groupId, msg.botId, {
      workspaceState: msg.state,
      // A retry's `cloning` keeps the last error, so the same failure is not announced again.
      ...(msg.state !== 'cloning' && { workspaceError: msg.error }),
      workspaceReason: msg.state === 'failed' ? msg.reason : null,
      ...(msg.path && { workspacePath: msg.path }),
      ...(msg.git && { gitStatus: msg.git }),
      ...(req?.kind === 'cd' &&
        msg.state === 'ready' && { workspaceKind: req.cdPath ? 'cd' : 'managed', cdPath: req.cdPath }),
    })
  if (req?.kind === 'cd' && msg.state === 'ready') await rememberDir(ctx, req, msg)
  if (req?.kind === 'cd' && req.cdPath && msg.state === 'failed')
    await forgetLocalPath(ctx, machineId, req.cdPath)
  if (req?.kind === 'cd' && msg.state !== 'cloning') await onCdResult(ctx, msg, req.cdPath === null)
  if (req?.kind === 'ensure' && msg.state === 'ready')
    await postEvent(ctx, msg.groupId, `${row.name} · daemon 已 clone 到托管工作区`)
  // A retry failing the same way (e.g. on every reconnect) is not announced again.
  if (req?.kind === 'ensure' && msg.state === 'failed' && msg.error !== row.error)
    await postEvent(ctx, msg.groupId, `${row.name} 工作区创建失败：${msg.error ?? '未知错误'}`)
  // Clones fail from ensure and from `/cd --reset` alike.
  if (msg.state === 'failed' && msg.reason && PAUSING.includes(msg.reason) && msg.error !== row.error)
    await notifyPaused(ctx, msg, row)
  if (msg.state === 'ready') await schedule(ctx, msg.botId)
}

/** A ready /cd directory: its remotes go to the repo history, with where they live on this machine. */
async function rememberDir(ctx: Ctx, req: Pending, msg: WorkspaceState) {
  if (!req.cdPath) return
  const [bot] = await ctx.db.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, req.botId))
  for (const url of msg.remotes)
    await recordRepo(ctx, { url, userId: bot?.ownerId, machineId: req.machineId, path: req.cdPath })
}

async function notifyPaused(ctx: Ctx, msg: WorkspaceState, bot: { name: string; ownerId: string }) {
  const [group] = await ctx.db.select({ name: groups.name }).from(groups).where(eq(groups.id, msg.groupId))
  const repo = await currentRepo(ctx, msg.groupId)
  await notify(ctx, bot.ownerId, 'repo_access', {
    groupId: msg.groupId,
    groupName: group?.name ?? '',
    botId: msg.botId,
    botName: bot.name,
    repo: repo ? publicRepoUrl(repo.url) : '',
    reason: msg.reason ? reasonText(msg.reason) : '',
  })
}

/**
 * Workspaces not ready yet are (re)ensured whenever the owner's machine connects: managed clones, and default
 * directories that could not be checked while it was offline. Unbound ones wait for their owner.
 */
async function onOnline(ctx: Ctx, machineId: string) {
  const rows = await ctx.db
    .select({
      groupId: groupBots.groupId,
      id: bots.id,
      name: bots.name,
      machineId: bots.machineId,
      cdPath: groupBots.cdPath,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(
      and(
        eq(bots.machineId, machineId),
        isNull(bots.deletedAt),
        isNull(groupBots.removedAt),
        isNull(groups.archivedAt),
        notInArray(groupBots.workspaceState, ['ready', 'unbound']),
      ),
    )
  for (const { groupId, cdPath, ...bot } of rows)
    if (cdPath) await sendDefault(ctx, groupId, bot, cdPath, false)
    else await ensureWorkspace(ctx, groupId, bot)
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
    for (const [id, p] of pending) if (p.machineId === machineId) pending.delete(id)
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
