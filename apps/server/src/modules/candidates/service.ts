import { randomUUID } from 'node:crypto'
import type {
  CommandCandidatesDto,
  DaemonToServer,
  FileCandidatesDto,
  ServerToDaemon,
} from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { commandPrefix, commands } from '../commands/index.js'
import { activeBots } from '../groups/service.js'
import { currentRepo, onlineMachine } from '../workspaces/provision.js'
import { pick } from './match.js'
import type { Mirrors } from './mirror.js'

const LIMIT = 50
/** A slow or silent daemon must not stall the popover: past this the mirror answers instead. */
const DAEMON_TIMEOUT_MS = 2_000

type FilesList = Extract<ServerToDaemon, { t: 'files.list' }>
type FilesResult = Extract<DaemonToServer, { t: 'files.result' }>
type CommandsUpdate = Extract<DaemonToServer, { t: 'commands.update' }>
type AgentCommand = CommandsUpdate['commands'][number]

const waiting = new Map<string, { machineId: string; resolve: (r: FilesResult | null) => void }>()

/** Asks the bot's daemon for workspace entries; null when it is offline, errs or times out. */
async function askDaemon(ctx: Ctx, machineId: string, req: Omit<FilesList, 't' | 'requestId'>) {
  const requestId = randomUUID()
  const answer = new Promise<FilesResult | null>((resolve) => {
    waiting.set(requestId, { machineId, resolve })
    setTimeout(() => settle(requestId, null), DAEMON_TIMEOUT_MS).unref()
  })
  if (!ctx.hub.send(machineId, { t: 'files.list', requestId, ...req })) settle(requestId, null)
  const res = await answer
  return res && !res.error ? res.entries : null
}

function settle(requestId: string, res: FilesResult | null) {
  const w = waiting.get(requestId)
  waiting.delete(requestId)
  w?.resolve(res)
}

function ago(from: Date, now: Date) {
  const min = Math.floor((now.getTime() - from.getTime()) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  return min < 1440 ? `${Math.floor(min / 60)} 小时前` : `${Math.floor(min / 1440)} 天前`
}

/**
 * @ file candidates (spec §8.7): the mentioned bot's workspace (incl. uncommitted) when its daemon answers, with
 * base-branch files it lacks marked notInWorkspace; else the base-branch mirror; nothing for repo-less groups.
 */
export async function fileCandidates(
  ctx: Ctx,
  mirrors: Mirrors,
  groupId: string,
  botId: string | undefined,
  query: string,
): Promise<FileCandidatesDto> {
  const bot = botId
    ? ((await activeBots(ctx, groupId)).find((b) => b.id === botId) ?? fail('not_found', 'Bot 不在本群'))
    : null
  const repo = await currentRepo(ctx, groupId)
  const mirror = repo ? mirrors.get(repo) : null
  const machineId = bot && onlineMachine(ctx, bot.machineId)
  if (bot && machineId) {
    const [gb] = await ctx.db
      .select({ cdPath: groupBots.cdPath })
      .from(groupBots)
      .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, bot.id)))
    const workspace = { repo, cdPath: gb?.cdPath ?? null }
    const entries = await askDaemon(ctx, machineId, {
      groupId,
      botId: bot.id,
      workspace,
      query,
      limit: LIMIT,
    })
    if (entries) {
      const have = new Set(entries.map((e) => e.path))
      const missing = (mirror ? (await mirror).entries : []).filter((e) => !have.has(e.path))
      return {
        source: 'workspace',
        label: `${bot.name} 工作区 · 含未提交`,
        entries: pick(
          [
            ...entries.map((e) => ({ ...e, notInWorkspace: false })),
            ...missing.map((e) => ({ ...e, uncommitted: false, notInWorkspace: true })),
          ],
          query,
          LIMIT,
        ),
      }
    }
  }
  if (!repo || !mirror) return { source: 'none', label: '', entries: [] }
  const m = await mirror
  return {
    source: 'mirror',
    label: m.updatedAt
      ? `${repo.branch} 镜像 · ${ago(m.updatedAt, ctx.now())}更新`
      : `${repo.branch} 镜像不可用 · 服务端无法访问该仓库`,
    entries: pick(
      m.entries.map((e) => ({ ...e, uncommitted: false, notInWorkspace: false })),
      query,
      LIMIT,
    ),
  }
}

/** Stores the agent commands a daemon reports for one of its own bots. */
async function onCommandsUpdate(ctx: Ctx, machineId: string, msg: CommandsUpdate) {
  const [own] = await ctx.db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.id, msg.botId), eq(bots.machineId, machineId)))
  if (!own) return
  await ctx.db
    .update(groupBots)
    .set({ agentCommands: msg.commands.map(({ name, description }) => ({ name, description })) })
    .where(and(eq(groupBots.groupId, msg.groupId), eq(groupBots.botId, msg.botId)))
}

/**
 * / candidates (spec §8.7): system commands first; agent commands of the given bots, a name taken by a system
 * command shown as `/bot名:命令`. Server-side skill layers are P3.
 */
export async function commandCandidates(
  ctx: Ctx,
  groupId: string,
  botIds: string[],
): Promise<CommandCandidatesDto> {
  const system = commands.list()
  const reserved = new Set(system.map((c) => c.name))
  const ids = botIds.filter(isUuid)
  const rows = ids.length
    ? await ctx.db
        .select({ id: bots.id, name: bots.name, commands: groupBots.agentCommands })
        .from(groupBots)
        .innerJoin(bots, eq(bots.id, groupBots.botId))
        .where(
          and(
            eq(groupBots.groupId, groupId),
            inArray(groupBots.botId, ids),
            isNull(groupBots.removedAt),
            isNull(bots.deletedAt),
          ),
        )
    : []
  rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  const agent = rows.flatMap((b) =>
    (b.commands as AgentCommand[]).map((c) => ({
      ...(reserved.has(c.name)
        ? { name: `${commandPrefix(b.name)}:${c.name}`, hint: '与系统命令重名' }
        : { name: c.name, hint: c.description }),
      botId: b.id,
      botName: b.name,
    })),
  )
  return { system, agent }
}

/** Wires files.result and commands.update from daemons. Returns a drain-and-detach fn. */
export function startCandidates(ctx: Ctx) {
  let chain = Promise.resolve()
  const onMessage = (machineId: string, msg: DaemonToServer) => {
    if (msg.t === 'files.result' && waiting.get(msg.requestId)?.machineId === machineId)
      settle(msg.requestId, msg)
    if (msg.t === 'commands.update')
      chain = chain
        .then(() => onCommandsUpdate(ctx, machineId, msg))
        .catch((err) => console.error('commands.update:', err))
  }
  ctx.hub.on('message', onMessage)
  return async () => {
    ctx.hub.off('message', onMessage)
    await chain
  }
}
