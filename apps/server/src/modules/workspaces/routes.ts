import { randomUUID } from 'node:crypto'
import {
  BindWorkspaceReq,
  DefaultWorkspaceReq,
  DirCreateReq,
  type DirListingDto,
  GroupBotExtraDirsReq,
  GroupBotRepoPathReq,
  type RepoAccessReason,
  type RepoCandidatesDto,
  repoKey,
  repoName,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupRepos, machines } from '../../db/schema.js'
import type { MessageKey } from '../../i18n/index.js'
import { fail, HttpError } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { publishBot } from '../bots/dto.js'
import { activeBots, requireMember } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { groupLocalPaths } from '../repos/service.js'
import { ABSOLUTE, announceCd, requestCd } from './cd.js'
import { daemonWorkspaceRoutes } from './daemon.js'
import { workspaceDiffRoutes } from './diff.js'
import { listDirs, setRepoPath } from './dirs.js'
import { workspaceFileRoutes } from './files.js'
import { currentRepo, ensureWorkspace, onlineMachine, PAUSING } from './provision.js'
import { listBotStates, RESET_SESSION, updateBotState } from './state.js'

const DIR_TIMEOUT_MS = 10_000
/** repo.find walks the home dir: allow it longer than one directory listing. */
const FIND_TIMEOUT_MS = 20_000

/** A live bot the caller owns: its machine's directories are only ever shown to or bound by its owner (plan W7). */
async function ownBot(ctx: Ctx, userId: string, rawId: string) {
  const [bot] = await ctx.db
    .select()
    .from(bots)
    .where(and(eq(bots.id, idParam(rawId, 'Bot 不存在')), isNull(bots.deletedAt)))
  if (!bot) return fail('not_found', 'Bot 不存在')
  return bot.ownerId === userId ? bot : fail('forbidden', '只有 Bot 主人可以操作其工作区')
}

/** Only a machine's owner browses or changes its directories. */
async function ownMachine(ctx: Ctx, userId: string, rawId: string) {
  const [m] = await ctx.db
    .select()
    .from(machines)
    .where(and(eq(machines.id, idParam(rawId, '机器不存在')), isNull(machines.revokedAt)))
  if (!m) return fail('not_found', '机器不存在')
  return m.ownerId === userId ? m : fail('forbidden', '只能浏览自己机器上的目录')
}

export function workspaceRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>('/api/groups/:id/bot-states', async (req) => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      return listBotStates(ctx, req.params.id)
    })

    app.get<{ Params: { id: string }; Querystring: { path?: string; hidden?: string } }>(
      '/api/machines/:id/dirs',
      async (req): Promise<DirListingDto> => {
        const m = await ownMachine(ctx, (await requireUser(ctx, req)).id, req.params.id)
        const { path, entries, git, unusable, roots, places, canCreate } = await listDirs(
          ctx,
          { name: m.name, machineId: m.id },
          req.query.path || null,
          '{name} 离线，无法浏览目录',
          req.query.hidden === '1',
        )
        return { path, entries, git, unusable, roots, places, canCreate }
      },
    )

    app.post<{ Params: { id: string } }>('/api/machines/:id/dirs', async (req) => {
      const m = await ownMachine(ctx, (await requireUser(ctx, req)).id, req.params.id)
      const { parent, name } = DirCreateReq.parse(req.body)
      if (!name.trim() || /[\\/]/.test(name) || name === '.' || name === '..')
        fail('invalid', '文件夹名称不合法')
      const machineId =
        onlineMachine(ctx, m.id) ?? fail('conflict', '{name} 离线，无法新建文件夹', { name: m.name })
      const ask = { t: 'dir.create', requestId: randomUUID(), parent, name } as const
      const res =
        (await ctx.hub.request(machineId, ask, 'dir.create.result', DIR_TIMEOUT_MS)) ??
        fail('conflict', '{name} 未响应，请稍后重试', { name: m.name })
      if (res.error) throw new HttpError('invalid', res.error)
      return { path: res.path ?? fail('conflict', '新建文件夹失败') }
    })

    app.put<{ Params: { id: string } }>('/api/bots/:id/default-workspace', async (req) => {
      const me = await requireUser(ctx, req)
      const bot = await ownBot(ctx, me.id, req.params.id)
      const { path } = DefaultWorkspaceReq.parse(req.body)
      if (path !== null) {
        if (!ABSOLUTE.test(path)) fail('invalid', '需要本机绝对路径')
        const { unusable } = await listDirs(ctx, bot, path, '{name} 离线，无法设置默认工作区')
        if (unusable) throw new HttpError('invalid', unusable)
      }
      await ctx.db.update(bots).set({ defaultWorkspace: path }).where(eq(bots.id, bot.id))
      return publishBot(ctx, bot.id)
    })

    app.put<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/workspace',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const bot = await ownBot(ctx, me.id, req.params.botId)
        if (!(await activeBots(ctx, group.id)).some((b) => b.id === bot.id))
          fail('not_found', '该 Bot 不在群内')
        const { path, force } = BindWorkspaceReq.parse(req.body)
        if (path !== null && group.mode !== 'partition') fail('conflict', '强制同步群只能使用托管工作区')
        if (path !== null && !ABSOLUTE.test(path)) fail('invalid', '需要本机绝对路径')
        if (!(await requestCd(ctx, { groupId: group.id, botId: bot.id, path, force })))
          fail('conflict', '{bot} 离线，无法绑定工作区', { bot: bot.name })
        await announceCd(ctx, { groupId: group.id, userId: me.id, bot, path })
        return reply.status(204).send()
      },
    )

    /** The session's additional directories; a change starts a new session from the next turn on. */
    app.put<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/extra-dirs',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const bot = await ownBot(ctx, me.id, req.params.botId)
        const [gb] = await ctx.db
          .select({ extraDirs: groupBots.extraDirs })
          .from(groupBots)
          .where(
            and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id), isNull(groupBots.removedAt)),
          )
        if (!gb) return fail('not_found', '该 Bot 不在群内')
        const { dirs } = GroupBotExtraDirsReq.parse(req.body)
        if (dirs.some((d) => !ABSOLUTE.test(d))) fail('invalid', '需要本机绝对路径')
        const extraDirs = [...new Set(dirs.map((d) => d.replace(/(.)[\\/]+$/, '$1')))]
        if (extraDirs.join('\n') === gb.extraDirs.join('\n')) return reply.status(204).send()
        await updateBotState(ctx, group.id, bot.id, {
          extraDirs,
          ...RESET_SESSION,
          newSessionReason: 'config_changed',
        })
        await postEvent(
          ctx,
          group.id,
          extraDirs.length
            ? '{user} 将 {bot} 在本群的自带目录设为 {dirs}'
            : '{user} 清空了 {bot} 在本群的自带目录',
          { user: me.name, bot: bot.name, dirs: extraDirs.join('、') },
        )
        return reply.status(204).send()
      },
    )

    /** Which clone of an extra repo the bot uses here: the owner's own (same remote) or, with null, a managed one. */
    app.put<{ Params: { id: string; botId: string; repoId: string } }>(
      '/api/groups/:id/bots/:botId/repos/:repoId',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const bot = await ownBot(ctx, me.id, req.params.botId)
        if (!(await activeBots(ctx, group.id)).some((b) => b.id === bot.id))
          fail('not_found', '该 Bot 不在群内')
        const [repo] = await ctx.db
          .select()
          .from(groupRepos)
          .where(
            and(
              eq(groupRepos.groupId, group.id),
              eq(groupRepos.id, idParam(req.params.repoId, '附加仓库不存在')),
              eq(groupRepos.isPrimary, false),
            ),
          )
        if (!repo) return fail('not_found', '附加仓库不存在')
        const path = GroupBotRepoPathReq.parse(req.body).path
        if (path !== null) {
          if (!ABSOLUTE.test(path)) fail('invalid', '需要本机绝对路径')
          const { git, unusable } = await listDirs(ctx, bot, path, '{name} 离线，无法浏览目录')
          if (unusable) throw new HttpError('invalid', unusable)
          if (!git) return fail('invalid', '该目录不是 git 仓库')
          if (!git.remotes.some((u) => repoKey(u) === repoKey(repo.url)))
            fail('invalid', '该目录的 remote 与附加仓库 {repo} 不一致', { repo: repoName(repo.url) })
        }
        await setRepoPath(ctx, { groupId: group.id, user: me, bot, repo, path })
        return reply.status(204).send()
      },
    )

    // A paused bot's owner fixed its machine's git access: clone again (group admins may ask too).
    app.post<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/recheck',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const { group, member } = await requireMember(ctx, req.params.id, me.id)
        const bot = (await activeBots(ctx, group.id)).find((b) => b.id === req.params.botId)
        if (!bot) return fail('not_found', '该 Bot 不在群内')
        if (bot.ownerId !== me.id && !member.isAdmin)
          return fail('forbidden', '只有 Bot 主人或群管理员可以重新检查')
        const [gb] = await ctx.db
          .select({ state: groupBots.workspaceState, reason: groupBots.workspaceReason })
          .from(groupBots)
          .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
        const reason = gb?.reason as RepoAccessReason | null | undefined
        if (gb?.state !== 'failed' || !reason || !PAUSING.includes(reason))
          return fail('conflict', '{bot} 未处于暂停状态', { bot: bot.name })
        if (!onlineMachine(ctx, bot.machineId))
          return fail('conflict', '{bot} 离线，上线后会自动重新检查', { bot: bot.name })
        await ensureWorkspace(ctx, group.id, bot)
        return reply.status(204).send()
      },
    )

    /** Local clones of the group repo the bot's machine finds, and where a managed clone would go (owner only). */
    app.get<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/repo-candidates',
      async (req): Promise<RepoCandidatesDto> => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const bot = await ownBot(ctx, me.id, req.params.botId)
        const repo = (await currentRepo(ctx, group.id, bot.id)) ?? fail('invalid', '该群未绑定仓库')
        const machineId = onlineMachine(ctx, bot.machineId)
        if (!machineId) return fail('conflict', '{bot} 离线，无法绑定工作区', { bot: bot.name })
        const ask = {
          t: 'repo.find',
          requestId: randomUUID(),
          groupId: group.id,
          botId: bot.id,
          repo,
          names: { group: group.name, bot: bot.name },
        } as const
        const res =
          (await ctx.hub.request(machineId, ask, 'repo.found', FIND_TIMEOUT_MS)) ??
          fail('conflict', '{name} 未响应，请稍后重试', { name: bot.name })
        return { managedPath: res.managedPath, paths: res.paths }
      },
    )

    /** Where the caller's machines already hold the group's repo (suggested instead of a fresh clone). */
    app.get<{ Params: { id: string } }>('/api/groups/:id/local-paths', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      return groupLocalPaths(ctx, me.id, group.id)
    })

    await app.register(daemonWorkspaceRoutes(ctx))
    await app.register(workspaceDiffRoutes(ctx))
    await app.register(workspaceFileRoutes(ctx))
  }
}
