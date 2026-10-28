import { randomUUID } from 'node:crypto'
import {
  type DaemonToServer,
  type GitProtocol,
  type ProtocolKey,
  publicRepoUrl,
  type RepoAccessReason,
  type WorkspaceState,
} from '@gonggong/protocol'
import { and, asc, eq, isNull, lt, notInArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupRepos, groups, machines, users } from '../../db/schema.js'
import { inSharedDm } from '../bots/shares.js'
import { onCdResult } from '../commands/cd.js'
import { postEvent } from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import { forgetLocalPath, recordRepo } from '../repos/service.js'
import { schedule } from '../runs/scheduler.js'
import { autoAlign } from '../sync/switch.js'
import { updateBotState } from './state.js'

type BotRef = { id: string; name: string; machineId: string | null }

/**
 * An ensure / cd request awaiting its daemon's answer. Only the latest request per (group, bot) is kept.
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
  for (const [id, active] of pending)
    if (active.groupId === p.groupId && active.botId === p.botId) pending.delete(id)
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
const REASON_TEXT: Record<RepoAccessReason, ProtocolKey> = {
  denied: '无权限或仓库不存在',
  branch_missing: '分支不存在',
  network: '网络或证书问题',
  timeout: '连接超时',
}
export const reasonText = (r: RepoAccessReason) => REASON_TEXT[r]

const joinedName = (bot: string, joined: boolean) => (joined ? { key: '{bot} 加入', params: { bot } } : bot)

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

/** Asks the owner's daemon to validate a directory; false when the machine is offline. */
async function sendCd(
  ctx: Ctx,
  groupId: string,
  bot: { id: string; machineId: string | null },
  path: string | null,
  kind: 'cd' | 'default',
  joined = false,
  force = false,
) {
  const machineId = onlineMachine(ctx, bot.machineId)
  if (!machineId) return false
  const repo = await currentRepo(ctx, groupId, bot.id)
  const requestId = track({
    kind,
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
    force,
  })
  if (!sent) forget(requestId)
  return sent
}

/** An explicit /cd or workspace picker choice, including a return to the managed clone. */
export async function requestCd(
  ctx: Ctx,
  o: { groupId: string; botId: string; path: string | null; force?: boolean },
) {
  const [bot] = await ctx.db.select({ machineId: bots.machineId }).from(bots).where(eq(bots.id, o.botId))
  return sendCd(
    ctx,
    o.groupId,
    { id: o.botId, machineId: bot?.machineId ?? null },
    o.path,
    'cd',
    false,
    o.force,
  )
}

/**
 * Picks a joining bot's workspace (plan W2–W5). In a partition repo group a bot joining while its owner is online
 * waits in `confirm` for the owner to choose a managed clone or a local one; otherwise (owner offline, force sync,
 * a shared DM, a repo change) it starts on a managed clone. A local directory, even the default one, is the
 * owner's explicit choice (/cd or the picker), never shared implicitly. Repo-less
 * groups use the bot's default directory, validated by the owner's daemon; without one the bot stays `unbound`
 * until the owner binds it. Also used after a repo change.
 */
export async function joinWorkspace(ctx: Ctx, groupId: string, bot: BotRef, o: { joined: boolean }) {
  const lead = joinedName(bot.name, o.joined)
  if (await currentRepo(ctx, groupId)) {
    if (o.joined && onlineMachine(ctx, bot.machineId) && (await confirmable(ctx, groupId, bot.id))) {
      await updateBotState(ctx, groupId, bot.id, { ...MANAGED, workspaceState: 'confirm' })
      return void (await postEvent(
        ctx,
        groupId,
        '{bot} · 等待 {owner} 确认工作区：托管克隆或使用本机已有目录',
        {
          bot: lead,
          owner: await ownerName(ctx, bot.id),
        },
      ))
    }
    await updateBotState(ctx, groupId, bot.id, MANAGED)
    await postEvent(
      ctx,
      groupId,
      onlineMachine(ctx, bot.machineId)
        ? '{bot} · 使用托管工作区，等待本机克隆…'
        : '{bot} · daemon 离线，上线后克隆托管工作区',
      { bot: lead },
    )
    return ensureWorkspace(ctx, groupId, bot)
  }
  // The owner's directories are theirs alone: a shared bot works apart in each DM opened with it.
  if (await inSharedDm(ctx, groupId, bot.id)) {
    await updateBotState(ctx, groupId, bot.id, MANAGED)
    await postEvent(ctx, groupId, '{bot} · 使用独立的托管工作区', { bot: lead })
    return ensureWorkspace(ctx, groupId, bot)
  }
  const [row] = await ctx.db.select({ path: bots.defaultWorkspace }).from(bots).where(eq(bots.id, bot.id))
  const path = row?.path
  if (!path) {
    await updateBotState(ctx, groupId, bot.id, { ...MANAGED, workspaceState: 'unbound' })
    return void (await postEvent(ctx, groupId, '{bot} · 等待 {owner} 绑定工作区', {
      bot: lead,
      owner: await ownerName(ctx, bot.id),
    }))
  }
  await updateBotState(ctx, groupId, bot.id, {
    ...MANAGED,
    workspaceKind: 'cd',
    cdPath: path,
    workspaceState: 'pending',
  })
  if (!(await sendCd(ctx, groupId, bot, path, 'default', o.joined)))
    await postEvent(ctx, groupId, '{bot} · daemon 离线，上线后使用默认工作区', { bot: lead })
}

/** Only partition groups may use a local directory, and a shared bot never touches its owner's directories. */
async function confirmable(ctx: Ctx, groupId: string, botId: string) {
  const [g] = await ctx.db.select({ mode: groups.mode }).from(groups).where(eq(groups.id, groupId))
  return g?.mode === 'partition' && !(await inSharedDm(ctx, groupId, botId))
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
      '{bot} 默认工作区不可用：{error}，等待 {owner} 绑定工作区',
      { bot: name, error: msg.error ?? { key: '未知错误' }, owner },
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
  await postEvent(ctx, msg.groupId, '{bot} · 使用默认工作区 {path}（主人可改绑）', {
    bot: joinedName(name, req.joined),
    path: req.cdPath ?? '',
  })
  await schedule(ctx, msg.botId)
}

/**
 * Re-requests the managed workspace the owner chose, after its machine reconnected: repo-less groups are ready at once
 * (the daemon creates `_empty` on first run); otherwise the daemon is asked to clone.
 */
export async function ensureWorkspace(ctx: Ctx, groupId: string, bot: BotRef, reconnect = false) {
  if (reconnect) {
    const [row] = await ctx.db
      .select({ state: groupBots.workspaceState })
      .from(groupBots)
      .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, bot.id)))
    if (!row || ['ready', 'unbound', 'confirm'].includes(row.state)) return
  }
  const repo = await currentRepo(ctx, groupId, bot.id)
  if (!repo) return void (await updateBotState(ctx, groupId, bot.id, { workspaceState: 'ready' }))
  const machineId = onlineMachine(ctx, bot.machineId)
  // Written before sending so a fast answer can't be overwritten by this state.
  await updateBotState(ctx, groupId, bot.id, { workspaceState: machineId ? 'cloning' : 'pending' })
  if (!machineId) return
  for (const [id, p] of pending)
    if (p.kind === 'ensure' && p.groupId === groupId && p.botId === bot.id) {
      // Already asked on this connection (going offline clears pending): a reconnect catch-up can race a join.
      if (p.machineId === machineId && p.repoId === repo.id) return
      pending.delete(id)
    }
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
    .select({
      name: bots.name,
      ownerId: bots.ownerId,
      machineId: bots.machineId,
      state: groupBots.workspaceState,
      error: groupBots.workspaceError,
    })
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
      ...(msg.state === 'ready' && { gitStatus: msg.git }),
      ...(req?.kind === 'cd' &&
        msg.state === 'ready' && { workspaceKind: req.cdPath ? 'cd' : 'managed', cdPath: req.cdPath }),
    })
  if (req?.kind === 'cd' && msg.state === 'ready') await rememberDir(ctx, req, msg)
  if (req?.kind === 'cd' && req.cdPath && msg.state === 'failed')
    await forgetLocalPath(ctx, machineId, req.cdPath)
  if (req?.kind === 'cd' && msg.state !== 'cloning') await onCdResult(ctx, msg, req.cdPath === null)
  // The daemon cancelled the superseded clone; a refused new directory must not leave a phantom clone in progress.
  if (req?.kind === 'cd' && req.cdPath && msg.state === 'failed' && row.state === 'cloning')
    await ensureWorkspace(ctx, msg.groupId, { id: msg.botId, name: row.name, machineId: row.machineId })
  if (req?.kind === 'ensure' && msg.state === 'ready')
    await postEvent(ctx, msg.groupId, '{bot} · daemon 已 clone 到托管工作区', { bot: row.name })
  // A retry failing the same way (e.g. on every reconnect) is not announced again.
  if (req?.kind === 'ensure' && msg.state === 'failed' && msg.error !== row.error)
    await postEvent(ctx, msg.groupId, '{bot} 工作区创建失败：{error}', {
      bot: row.name,
      error: msg.error ?? { key: '未知错误' },
    })
  // Clones fail from ensure and from `/cd --reset` alike.
  if (msg.state === 'failed' && msg.reason && PAUSING.includes(msg.reason) && msg.error !== row.error)
    await notifyPaused(ctx, msg, row)
  if (msg.state === 'ready') {
    await autoAlign(ctx, msg.groupId, msg.botId)
    await schedule(ctx, msg.botId)
  }
}

/** A ready /cd directory: its remotes go to the repo history, with where they live on this machine. */
async function rememberDir(ctx: Ctx, req: Pending, msg: WorkspaceState) {
  if (!req.cdPath) return
  const [bot] = await ctx.db
    .select({ ownerId: bots.ownerId, teamId: bots.teamId })
    .from(bots)
    .where(eq(bots.id, req.botId))
  if (!bot) return
  for (const url of msg.remotes)
    await recordRepo(ctx, {
      url,
      teamId: bot.teamId,
      userId: bot.ownerId,
      machineId: req.machineId,
      path: req.cdPath,
    })
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
 * directories that could not be checked while it was offline. Unbound and unconfirmed ones wait for their owner.
 */
async function onOnline(ctx: Ctx, machineId: string) {
  const rows = await ctx.db
    .select({
      groupId: groupBots.groupId,
      id: bots.id,
      name: bots.name,
      machineId: bots.machineId,
      cdPath: groupBots.cdPath,
      state: groupBots.workspaceState,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .innerJoin(machines, eq(machines.id, bots.machineId))
    .where(
      and(
        eq(bots.machineId, machineId),
        // Only recover workspaces that existed before this connection. Joining a bot during the hello handshake
        // belongs to its own workspace flow, not to reconnect recovery.
        lt(groupBots.addedAt, machines.lastSeenAt),
        isNull(bots.deletedAt),
        isNull(groupBots.removedAt),
        isNull(groups.archivedAt),
        notInArray(groupBots.workspaceState, ['ready', 'unbound', 'confirm']),
      ),
    )
  for (const { groupId, cdPath, state, ...bot } of rows) {
    // A request already sent on this connection is still being answered by the daemon.
    if (
      [...pending.values()].some(
        (p) => p.machineId === machineId && p.groupId === groupId && p.botId === bot.id,
      )
    )
      continue
    // The join flow may have asked the owner or selected a directory after the query above.
    const [current] = await ctx.db
      .select({ state: groupBots.workspaceState, cdPath: groupBots.cdPath })
      .from(groupBots)
      .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, bot.id)))
    if (!current || ['ready', 'unbound', 'confirm'].includes(current.state)) continue
    if (current.state !== state && current.cdPath)
      await requestCd(ctx, { groupId, botId: bot.id, path: current.cdPath })
    else if (cdPath) await sendCd(ctx, groupId, bot, cdPath, 'default')
    else await ensureWorkspace(ctx, groupId, bot, true)
  }
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
