import { randomUUID } from 'node:crypto'
import type {
  DaemonFeature,
  GitActionArgs,
  GitActionDetail,
  GitActionKind,
  GitActionReq,
  GitOperationDto,
  GitOperationStatus,
  GitRemote,
} from '@gonggong/protocol'
import { and, eq, inArray, lte, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, gitOperations, groupBots, type groups, runs, users } from '../../db/schema.js'
import { translator } from '../../i18n/index.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { startSweep } from '../../lib/sweep.js'
import { gitIdentity } from '../bots/git.js'
import { activeBots } from '../groups/service.js'
import { memberIds, postEvent } from '../messages/service.js'
import { resolveNotifications } from '../notifications/notify.js'
import { MASK } from '../runs/redact.js'
import { groupRedactor } from '../secrets/resolve.js'
import { currentRepo, onlineMachine } from '../workspaces/provision.js'

export type GitOperation = typeof gitOperations.$inferSelect
type Group = typeof groups.$inferSelect
export type GitTarget = Awaited<ReturnType<typeof gitTarget>>
type Columns = Pick<GitOperation, 'repo' | 'action' | 'branch' | 'remote' | 'message' | 'paths' | 'args'>

export const PENDING_MS = 30 * 60_000
/** The daemon gives network git 120 s. */
const ACTION_TIMEOUT_MS = 130_000
const REFS_TIMEOUT_MS = 15_000
const SWEEP_MS = 30_000
const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']
/** Stored once for every reader. */
const zh = translator('zh')
const LEGACY: readonly string[] = ['checkout', 'pull', 'commit', 'push']

/** The entries set (neither undefined nor false); undefined when none is. */
export function setOnly<T extends Record<string, unknown>>(o: T): Partial<T> | undefined {
  const set = Object.entries(o).filter(([, v]) => v !== undefined && v !== false)
  return set.length ? (Object.fromEntries(set) as Partial<T>) : undefined
}

/** A new action, an option of an older one, or a pull of another branch than the current one. */
const needsOps3 = (op: Pick<Columns, 'action' | 'branch' | 'args'>) =>
  !LEGACY.includes(op.action) || !!op.args || (op.action === 'pull' && !!op.branch)

/**
 * add / ignore, the stash guard, keeping added files, a push to another remote branch than its own name, reverting
 * hunks, a remote branch's checkout told what to do with local commits, a pull of another remote branch, a branch
 * replaced, or a push only up to a commit.
 */
const needsOps4 = ({ action, branch, args }: Pick<Columns, 'action' | 'branch' | 'args'>) =>
  action === 'add' ||
  action === 'ignore' ||
  !!args?.expect ||
  !!args?.keepAdded ||
  (!!args?.target && args.target !== branch) ||
  (action === 'push' && !!args?.commit) ||
  !!args?.patch ||
  !!args?.localCommits ||
  (action === 'pull' && !!args?.from) ||
  (action === 'branch-create' && !!args?.force)

/**
 * What the bot's daemon must support for an operation: committing chosen paths came with gitOps2, sub-repos with
 * gitRepos, the other actions and every option (`args`) with gitOps3, those of the second IDEA pass with gitOps4.
 */
export const featureFor = (
  op: Pick<Columns, 'action' | 'branch' | 'paths' | 'repo' | 'args'>,
): DaemonFeature =>
  needsOps4(op)
    ? 'gitOps4'
    : needsOps3(op)
      ? 'gitOps3'
      : op.repo
        ? 'gitRepos'
        : op.action === 'commit' && op.paths
          ? 'gitOps2'
          : 'gitOps'

/** The bot's workspace in a partition group with a repo: the only place manual git is offered. */
export async function gitTarget(ctx: Ctx, group: Group, rawBotId: string, feature: DaemonFeature = 'gitOps') {
  const botId = idParam(rawBotId, 'Bot 不存在')
  const repo = group.mode === 'partition' ? await currentRepo(ctx, group.id, botId) : null
  if (!repo) return fail('conflict', '仅绑定了仓库的分区模式群可以使用 Git 操作')
  const active = (await activeBots(ctx, group.id)).find((b) => b.id === botId)
  if (!active) return fail('not_found', '该 Bot 不在群内')
  const [row] = await ctx.db
    .select({
      bot: bots,
      cdPath: groupBots.cdPath,
      state: groupBots.workspaceState,
      path: groupBots.workspacePath,
      extraDirs: groupBots.extraDirs,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, active.id)))
  if (!row) return fail('not_found', '该 Bot 不在群内')
  if (row.state === 'unbound' || row.state === 'confirm')
    return fail('conflict', '{bot} 尚未设置工作区', { bot: row.bot.name })
  assertFeature(ctx, row.bot, feature)
  return {
    group,
    bot: row.bot,
    workspacePath: row.path,
    workspace: { repo, cdPath: row.cdPath, extraDirs: row.extraDirs },
  }
}

/** A daemon predating the feature ignores its messages: say so now rather than after the request times out. */
export function assertFeature(
  ctx: Ctx,
  bot: Pick<typeof bots.$inferSelect, 'machineId' | 'name'>,
  feature: DaemonFeature,
) {
  const machineId = bot.machineId
  if (machineId && ctx.hub.isOnline(machineId) && !ctx.hub.features(machineId).includes(feature))
    fail('conflict', '{bot} 所在机器的客户端版本过旧，升级后才能使用 Git 操作', { bot: bot.name })
}

/**
 * `args.expect` (gitOps4) keeps an operation from acting on what changed while it awaited the owner's approval: another
 * stash at that index, another HEAD to undo or reword. The owner's own operation runs at once, with no such wait: a
 * daemon without gitOps4 gets it without the guard, as before, instead of refusing it as too old. A member's request
 * keeps it, so approving it needs gitOps4.
 */
export function unguarded(ctx: Ctx, op: Columns, t: GitTarget): Columns {
  const machineId = t.bot.machineId
  if (!op.args?.expect || (machineId && ctx.hub.features(machineId).includes('gitOps4'))) return op
  const { expect: _, ...args } = op.args
  return { ...op, args: setOnly(args) ?? null }
}

/** A live run of the bot here, or of any bot working in the same directory of the same machine (plan W10). */
export async function assertIdle(ctx: Ctx, t: GitTarget) {
  const sameDir =
    t.workspacePath && t.bot.machineId
      ? and(eq(bots.machineId, t.bot.machineId), eq(groupBots.workspacePath, t.workspacePath))
      : undefined
  const [live] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(groupBots, and(eq(groupBots.groupId, runs.groupId), eq(groupBots.botId, runs.botId)))
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(
      and(
        inArray(runs.status, LIVE),
        or(and(eq(runs.groupId, t.group.id), eq(runs.botId, t.bot.id)), sameDir),
      ),
    )
    .limit(1)
  if (live) busy(t.bot.name)
}

const busy = (bot: string) => fail('conflict', '{bot} 正在运行，等运行结束后再操作', { bot })

const subject = (message: string | null) => {
  const line = (message ?? '').split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

/** One line naming the action, for the owner's notification (git verbs read the same in both languages). */
export function summary(op: Columns) {
  return op.repo ? `${op.repo}: ${verb(op)}` : verb(op)
}

const short = (rev: string) => (/^[0-9a-f]{8,}$/.test(rev) ? rev.slice(0, 7) : rev)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const files = (n: number) => count(n, 'file', 'files')
const words = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')
/** A `git diff` patch's hunks, each headed by an `@@ -` line. */
const hunks = (patch: string) =>
  count(patch.split('\n').filter((l) => l.startsWith('@@ -')).length, 'hunk', 'hunks')

function verb(op: Omit<Columns, 'repo'>) {
  const a = op.args ?? {}
  const branch = op.branch ?? ''
  const n = op.paths?.length ?? 0
  const chosen = n ? ` (${files(n)})` : ''
  switch (op.action as GitActionKind) {
    case 'checkout':
      return words(
        'checkout',
        a.mode === 'force' && '--force',
        a.detach && '--detach',
        short(branch),
        a.localCommits && `(${a.localCommits} local commits)`,
      )
    case 'pull':
      return words(
        'pull',
        a.mode === 'rebase' && '--rebase',
        a.mode === 'merge' && '--no-rebase',
        op.branch,
        a.from && `from ${a.from}`,
      )
    case 'commit':
      return `commit${a.amend ? ' --amend' : ''}「${subject(op.message)}」${chosen}`
    case 'push':
      return words(
        'push',
        a.force && '--force-with-lease',
        a.tags && '--tags',
        branch,
        a.commit && `(up to ${short(a.commit)})`,
        '→',
        a.target && a.target !== branch ? `${op.remote}/${a.target}` : op.remote,
      )
    case 'branch-create':
      return words(
        a.checkout ? `checkout ${a.force ? '-B' : '-b'}` : a.force ? 'branch -f' : 'branch',
        branch,
        a.from && short(a.from),
      )
    case 'branch-rename':
      return words('branch -m', branch, a.name)
    case 'branch-delete':
      return words('branch', a.force ? '-D' : '-d', branch)
    case 'merge':
      return words('merge', a.mode !== 'default' && `--${a.mode}`, a.noCommit && '--no-commit', short(branch))
    case 'rebase':
      return words('rebase', op.branch, 'onto', short(a.onto ?? ''))
    case 'cherry-pick':
    case 'revert': {
      const [first = '', ...more] = a.commits ?? []
      return words(op.action, short(first), more.length > 0 && `(+${more.length})`)
    }
    case 'reset':
      // The HEAD it must still be at: the commit an Undo Commit takes back, else where the branch moves from.
      return words(
        'reset',
        `--${a.mode}`,
        short(a.commit ?? ''),
        a.expect && `(${a.commit === 'HEAD~1' ? 'undo' : 'from'} ${short(a.expect)})`,
      )
    case 'discard':
      return a.patch
        ? `rollback ${hunks(a.patch)} in ${op.paths?.[0]}`
        : `rollback ${n === 1 ? op.paths?.[0] : files(n)}`
    case 'add':
      return `add ${n === 1 ? op.paths?.[0] : files(n)}`
    case 'ignore':
      return `ignore ${n === 1 ? op.paths?.[0] : files(n)}`
    case 'stash':
      return `stash push${a.untracked ? ' -u' : ''}${op.message ? `「${subject(op.message)}」` : ''}${chosen}`
    case 'unstash':
      return op.branch
        ? `stash branch ${op.branch} stash@{${a.stash}}`
        : words('stash', a.pop ? 'pop' : 'apply', a.index && '--index', `stash@{${a.stash}}`)
    case 'stash-drop':
      return a.stash === undefined ? 'stash clear' : `stash drop stash@{${a.stash}}`
    case 'tag-create':
      return words('tag', op.message && '-a', a.name, a.from && short(a.from))
    case 'tag-delete':
      return words('tag -d', a.name, op.remote && `(local + ${op.remote})`)
    case 'tag-push':
      return words('push tag', a.name, '→', op.remote)
    case 'resolve':
      return words('resolve', n ? files(n) : a.path, a.side && `--${a.side}`)
    case 'apply':
      return words(
        a.reverse ? 'revert' : 'cherry-pick',
        short(a.commit ?? ''),
        '--',
        n === 1 ? op.paths?.[0] : files(n),
      )
    case 'restore':
      return words('checkout', short(a.commit ?? ''), '--', n === 1 ? op.paths?.[0] : files(n))
    default:
      return op.action
  }
}

/**
 * An action's columns: `branch`, `remote`, `message` and `paths` as GitAction reads them, the rest in `args`. The four
 * older actions leave their defaults out, so without new options they reach an older daemon as before (args null).
 */
export function fields(req: GitActionReq): Columns {
  const row = (c: Partial<Columns>, args: GitActionArgs = {}): Columns => ({
    repo: req.repo ?? null,
    action: req.action,
    branch: c.branch ?? null,
    remote: c.remote ?? null,
    message: c.message ?? null,
    paths: c.paths ?? null,
    args: setOnly(args) ?? null,
  })
  switch (req.action) {
    case 'checkout':
      return row(
        { branch: req.branch },
        {
          detach: req.detach,
          mode: req.mode === 'keep' ? undefined : req.mode,
          localCommits: req.localCommits,
        },
      )
    case 'pull':
      return row(
        { branch: req.branch },
        { mode: req.mode === 'ff-only' ? undefined : req.mode, from: req.from },
      )
    case 'commit':
      return row({ message: req.message, paths: req.paths }, { amend: req.amend, expect: req.expectHead })
    case 'push':
      return row(
        { branch: req.branch, remote: req.remote },
        { force: req.force, tags: req.tags, target: req.target, commit: req.commit },
      )
    case 'branch-create':
      return row({ branch: req.name }, { from: req.from, checkout: req.checkout, force: req.overwrite })
    case 'branch-rename':
      return row({ branch: req.branch }, { name: req.name })
    case 'branch-delete':
      return row({ branch: req.branch }, { force: req.force })
    case 'merge':
      return row({ branch: req.branch, message: req.message }, { mode: req.mode, noCommit: req.noCommit })
    case 'rebase':
      return row({ branch: req.branch }, { onto: req.onto, todo: req.todo })
    case 'cherry-pick':
    case 'revert':
      return row({}, { commits: req.commits })
    case 'reset':
      return row({}, { commit: req.commit, mode: req.mode, expect: req.expectHead })
    case 'discard':
      return row({ paths: req.paths }, { keepAdded: req.keepAdded, patch: req.patch })
    case 'add':
    case 'ignore':
      return row({ paths: req.paths })
    case 'stash':
      return row({ message: req.message, paths: req.paths }, { untracked: req.untracked })
    case 'unstash':
      return row(
        { branch: req.branch },
        { stash: req.stash, expect: req.expect, pop: req.pop, index: req.index },
      )
    case 'stash-drop':
      return row({}, { stash: req.stash, expect: req.expect })
    case 'tag-create':
      return row({ message: req.message }, { name: req.name, from: req.commit })
    case 'tag-delete':
    case 'tag-push':
      return row({ remote: req.remote }, { name: req.name })
    case 'continue':
      return row({ message: req.message })
    case 'abort':
    case 'skip':
      return row({})
    case 'resolve':
      return row({ paths: req.paths }, { path: req.path, side: req.side, content: req.content })
    case 'apply':
      return row({ paths: req.paths }, { commit: req.commit, reverse: req.reverse })
    case 'restore':
      return row({ paths: req.paths }, { commit: req.commit })
  }
}

/** What the request schema alone cannot refuse. */
export function assertValid(req: GitActionReq) {
  if (req.action === 'commit' && req.paths?.length === 0 && !req.amend) fail('invalid', '请选择要提交的文件')
  // A guard names one stash: without it (see unguarded), an older daemon would clear them all.
  if (req.action === 'stash-drop' && req.expect !== undefined && req.stash === undefined)
    fail('invalid', '请选择要删除的贮藏')
  // What the owner approves names the hunks of one file.
  if (req.action === 'discard' && req.patch !== undefined && req.paths.length !== 1)
    fail('invalid', '逐块回滚只能针对一个文件')
  if (req.action !== 'resolve') return
  if ((req.side === undefined) === (req.content === undefined))
    fail('invalid', '请选择保留哪一方或填写合并结果')
  // Conflicts are shown redacted: writing a mask back would destroy what it hides.
  if (req.content?.includes(MASK)) fail('invalid', '合并结果含有已脱敏的内容，请保留一方或在本机解决')
}

/**
 * The protected base branch is never force-pushed nor deleted on a remote, and a push landing on it needs a second
 * confirmation (`pushesBase`). Judged by where the operation lands on the remote, which the bot's daemon is asked
 * about when the request doesn't say; returns the operation as it is to run, a push's target pinned (see pinTarget).
 */
export async function guardBase(ctx: Ctx, op: Columns, t: GitTarget) {
  if (!t.group.protectBase) return { op, pushesBase: false }
  const base = t.workspace.repo.branch
  if (op.action === 'push') {
    const pinned = await pinTarget(ctx, op, t)
    const pushesBase = (pinned.args?.target ?? pinned.branch) === base
    if (pushesBase && op.args?.force) fail('conflict', '受保护的基准分支不能强制推送')
    return { op: pinned, pushesBase }
  }
  if (op.action === 'branch-delete' && (await deletesRemote(ctx, op, t, base)))
    fail('conflict', '受保护的基准分支不能在远程删除')
  return { op, pushesBase: false }
}

/**
 * A push without a target lands on the branch's upstream when that is on `remote` (gitOps4; an older daemon pushes
 * the same name). An online gitOps4 daemon is asked (git.refs) and the push pinned to that branch, or to its own name
 * when the daemon can't tell, so the checks, the owner's approval and the push itself all go by the same one. An
 * offline daemon can't push either: the push is taken to land on its own name until the approval asks again.
 */
async function pinTarget(ctx: Ctx, op: Columns, t: GitTarget): Promise<Columns> {
  const machineId = onlineMachine(ctx, t.bot.machineId)
  if (op.args?.target || !op.branch || !machineId || !ctx.hub.features(machineId).includes('gitOps4'))
    return op
  const refs = await refsNow(ctx, t, op.repo)
  const upstream = refs?.branches.find((b) => b.kind === 'local' && b.name === op.branch)?.upstream
  const tracked = upstream && refs && remoteOf(upstream, refs.remotes) === op.remote
  const target = tracked ? upstream.slice(`${op.remote}/`.length) : op.branch
  return { ...op, args: { ...op.args, target } }
}

/**
 * Whether deleting `op.branch` deletes `base` on a remote: the daemon deletes a local branch of that name when there
 * is one, else the remote-tracking `<remote>/<x>`'s x on that remote. When the daemon can't tell, any `<x>/<base>`
 * counts.
 */
async function deletesRemote(ctx: Ctx, op: Columns, t: GitTarget, base: string) {
  const branch = op.branch ?? ''
  if (!branch.endsWith(`/${base}`)) return false
  const refs = await refsNow(ctx, t, op.repo)
  if (!refs) return /^[^/]+\/(.+)$/.exec(branch)?.[1] === base
  if (refs.branches.some((b) => b.kind === 'local' && b.name === branch)) return false
  return refs.remotes.some((r) => branch === `${r.name}/${base}`)
}

/** The remote a remote-tracking name (`origin/feat`) belongs to: the longest remote name it starts with. */
const remoteOf = (name: string, remotes: GitRemote[]) =>
  remotes.filter((r) => name.startsWith(`${r.name}/`)).sort((a, b) => b.name.length - a.name.length)[0]?.name

/** The bot's branches and remotes as its daemon has them now; null when it can't tell. */
async function refsNow(ctx: Ctx, t: GitTarget, repo: string | null) {
  const machineId = onlineMachine(ctx, t.bot.machineId)
  const msg = {
    t: 'git.refs',
    requestId: randomUUID(),
    groupId: t.group.id,
    botId: t.bot.id,
    workspace: t.workspace,
    ...(repo && { repo }),
  } as const
  const res = machineId && (await ctx.hub.request(machineId, msg, 'git.refs.result', REFS_TIMEOUT_MS))
  return res && !res.error ? res : null
}

/**
 * The operation's audit detail; `files` counts the chosen paths, a resolution's text and a reverted patch are left
 * out.
 */
export const auditDetail = (op: GitOperation) => {
  const { content: _, patch: __, ...args } = op.args ?? {}
  return {
    operationId: op.id,
    botId: op.botId,
    repo: op.repo,
    action: op.action,
    branch: op.branch,
    remote: op.remote,
    ...(op.paths && { files: op.paths.length }),
    ...(op.args && { args }),
  }
}

export async function operationDtos(ctx: Ctx, rows: GitOperation[]): Promise<GitOperationDto[]> {
  const ids = [
    ...new Set(rows.flatMap((r) => (r.decidedBy ? [r.requestedBy, r.decidedBy] : [r.requestedBy]))),
  ]
  const names = new Map(
    ids.length
      ? (
          await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
        ).map((u) => [u.id, u.name])
      : [],
  )
  const who = (id: string) => ({ id, name: names.get(id) ?? '' })
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    botId: r.botId,
    repo: r.repo,
    action: r.action as GitOperationDto['action'],
    branch: r.branch,
    remote: r.remote,
    message: r.message,
    paths: r.paths,
    // A resolution's merged text (up to 2 MiB) and a reverted hunk's patch stay server-side: every member gets this DTO
    // with each update.
    args: r.args && (({ content: _, patch: __, ...rest }) => rest)(r.args),
    pushesBase: r.pushesBase,
    status: r.status as GitOperationStatus,
    requestedBy: who(r.requestedBy),
    decidedBy: r.decidedBy ? who(r.decidedBy) : null,
    output: r.output,
    error: r.error,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }))
}

export async function publishOperation(ctx: Ctx, row: GitOperation) {
  const [operation] = await operationDtos(ctx, [row])
  if (operation)
    ctx.bus.publish(await memberIds(ctx, row.groupId), {
      t: 'group.gitOperation',
      groupId: row.groupId,
      operation,
    })
  return operation as GitOperationDto
}

/**
 * Sends a `running` operation to the bot's daemon and records git's answer (redacted). `busy` is true when the daemon
 * refused because a turn holds the directory.
 */
export async function execute(ctx: Ctx, op: GitOperation, t: GitTarget) {
  await publishOperation(ctx, op)
  const machineId = onlineMachine(ctx, t.bot.machineId)
  const res = machineId
    ? await ctx.hub.request(
        machineId,
        {
          t: 'git.action',
          requestId: randomUUID(),
          groupId: t.group.id,
          botId: t.bot.id,
          workspace: t.workspace,
          ...(op.repo && { repo: op.repo }),
          action: op.action as GitActionKind,
          branch: op.branch,
          remote: op.remote,
          message: op.message,
          paths: op.paths,
          // Merges, picks, stashes and annotated tags make commits too.
          identity: gitIdentity(t.bot),
          ...(op.args && { args: op.args }),
        },
        'git.action.result',
        ACTION_TIMEOUT_MS,
      )
    : undefined
  const error = !machineId
    ? zh('{bot} 离线，无法执行 Git 操作', { bot: t.bot.name })
    : !res
      ? zh('{bot} 未响应，Git 操作结果未知', { bot: t.bot.name })
      : res.busy
        ? zh('{bot} 正在运行，等运行结束后再操作', { bot: t.bot.name })
        : res.ok
          ? null
          : (res.error ?? zh('未知错误'))
  const redact = await groupRedactor(ctx, t.group.id)
  const [done] = (await ctx.db
    .update(gitOperations)
    .set({
      status: error ? 'failed' : 'succeeded',
      output: res?.output ? redact(res.output) : null,
      error: error && redact(error),
      detail: res?.detail ?? null,
      finishedAt: ctx.now(),
    })
    .where(eq(gitOperations.id, op.id))
    .returning()) as [GitOperation]
  await audit(ctx, {
    category: 'admin',
    actorUserId: op.decidedBy ?? op.requestedBy,
    groupId: op.groupId,
    action: 'git.run',
    detail: { ...auditDetail(op), status: done.status },
  })
  const operation = await publishOperation(ctx, done)
  // With its args whole: the summary counts the hunks of a reverted patch, which the DTO leaves out.
  if (done.status === 'succeeded') await announce(ctx, { ...operation, args: done.args }, t.bot.name)
  return { operation, busy: !!res?.busy }
}

/** What a write came to beyond its verb (gitOps4): what a pull brought in, conflicts restoring the changes stashed. */
function outcome(detail: GitActionDetail | null) {
  const parts = [
    detail?.updated &&
      `${count(detail.updated.commits, 'commit', 'commits')}, ${files(detail.updated.files)}`,
    detail?.code === 'conflicts' && `local changes restored with conflicts in ${files(detail.paths.length)}`,
  ].filter(Boolean)
  return parts.length ? ` (${parts.join('; ')})` : ''
}

/**
 * Tells the whole group what a manual write changed in the bot's workspace: what an older daemon could do keeps its own
 * text unless the daemon told more (see outcome), anything else is named by its git verb; resolving one conflicting
 * file is left out (plan decision 3).
 */
function announce(ctx: Ctx, op: GitOperationDto, bot: string) {
  if (op.action === 'resolve') return
  const who = {
    user: op.requestedBy.name,
    bot,
    approval: op.decidedBy ? { key: '（{owner} 批准）', params: { owner: op.decidedBy.name } } : '',
  }
  const more = outcome(op.detail)
  if (needsOps3(op) || more) {
    const ran = { ...who, summary: `${verb(op)}${more}` }
    return op.repo
      ? postEvent(ctx, op.groupId, '{user} 在 {bot} 的 {repo} 执行了 {summary}{approval}', {
          ...ran,
          repo: op.repo,
        })
      : postEvent(ctx, op.groupId, '{user} 在 {bot} 的工作区执行了 {summary}{approval}', ran)
  }
  const branch = op.branch ?? ''
  const remote = op.remote ?? ''
  const commit = { ...who, subject: subject(op.message) }
  if (op.repo) {
    const at = { ...who, repo: op.repo }
    if (op.action === 'checkout')
      return postEvent(ctx, op.groupId, '{user} 将 {bot} 的 {repo} 切换到 {branch}{approval}', {
        ...at,
        branch,
      })
    if (op.action === 'pull')
      return postEvent(ctx, op.groupId, '{user} 为 {bot} 的 {repo} 拉取了更新{approval}', at)
    if (op.action === 'commit')
      return postEvent(ctx, op.groupId, '{user} 提交了 {bot} 的 {repo} 改动：{subject}{approval}', {
        ...commit,
        repo: op.repo,
      })
    return postEvent(ctx, op.groupId, '{user} 将 {bot} 的 {repo} 的 {branch} 推送到 {remote}{approval}', {
      ...at,
      branch,
      remote,
    })
  }
  if (op.action === 'checkout')
    return postEvent(ctx, op.groupId, '{user} 将 {bot} 切换到 {branch}{approval}', { ...who, branch })
  if (op.action === 'pull') return postEvent(ctx, op.groupId, '{user} 为 {bot} 拉取了更新{approval}', who)
  if (op.action === 'commit')
    return postEvent(ctx, op.groupId, '{user} 提交了 {bot} 的改动：{subject}{approval}', commit)
  return postEvent(ctx, op.groupId, '{user} 将 {bot} 的 {branch} 推送到 {remote}{approval}', {
    ...who,
    branch,
    remote,
  })
}

/** Overdue requests the owner never decided. */
export async function expireGitOperations(ctx: Ctx) {
  const expired = await ctx.db
    .update(gitOperations)
    .set({ status: 'expired', finishedAt: ctx.now() })
    .where(and(eq(gitOperations.status, 'pending_approval'), lte(gitOperations.expiresAt, ctx.now())))
    .returning()
  await resolveNotifications(
    ctx,
    'git_operation_request',
    'operationId',
    expired.map((o) => o.id),
  )
  for (const o of expired) await publishOperation(ctx, o)
}

export function startGitOperationSweep(ctx: Ctx) {
  return startSweep('git operation expiry', () => expireGitOperations(ctx), SWEEP_MS)
}
