import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentKind, CreateGroupReq, type InstallBuildDto } from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groups, type machines, teamMembers, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { publishBot } from '../bots/dto.js'
import { createGroup } from '../groups/create.js'
import { teamParams } from '../groups/params.js'
import { daemonRelease } from '../releases/routes.js'

// Agent 自助接入: a local agent reads install.md, runs install.sh, and `gg login --create-bot` leaves a bot and a DM.

const AGENT_TITLE: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  codebuddy: 'CodeBuddy',
  pi: 'pi',
  deepseek: 'DeepSeek Harness',
  antigravity: 'Antigravity CLI',
}

/** The sentence the 绑定新机器 dialog offers to paste to a local agent (agent-facing words in Chinese on purpose). */
export const agentPrompt = (origin: string, code: string) =>
  `帮我接入共工空间：读取 ${origin}/api/install.md 并按步骤执行，接入码 ${code}。`

/**
 * The server as a client outside the browser reaches it: the configured public URL, else the request's host with the
 * scheme the TLS-terminating proxy saw (plain http here would downgrade the checksum and the bind code).
 */
/** The public address: the configured one, else as the request reached us (behind a proxy, its protocol). */
export async function serverUrl(ctx: Ctx, req: FastifyRequest) {
  const configured = (await sysParams(ctx.db)).publicUrl.replace(/\/+$/, '')
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]
  return configured || `${proto}://${req.host}`
}

/**
 * The owner's bot of `agent` on the machine and its DM, made once: a second login of the same agent gets the same
 * pair back. The bot works in its managed directory, so the DM answers at once.
 */
export async function onboardBot(ctx: Ctx, machine: typeof machines.$inferSelect, agent: AgentKind) {
  const [owner] = await ctx.db.select().from(users).where(eq(users.id, machine.ownerId))
  if (!owner) return fail('not_found', '用户不存在')
  const [existing] = await ctx.db
    .select()
    .from(bots)
    .where(
      and(
        eq(bots.ownerId, owner.id),
        eq(bots.machineId, machine.id),
        eq(bots.agentKind, agent),
        isNull(bots.deletedAt),
      ),
    )
    .orderBy(asc(bots.createdAt))
    .limit(1)
  const bot = existing ?? (await makeBot(ctx, owner, machine.id, agent))
  const [dm] = await ctx.db
    .select({ id: groups.id })
    .from(groups)
    .innerJoin(groupBots, and(eq(groupBots.groupId, groups.id), eq(groupBots.botId, bot.id)))
    .where(and(eq(groups.kind, 'dm'), eq(groups.createdBy, owner.id), isNull(groups.archivedAt)))
    .limit(1)
  const groupId =
    dm?.id ??
    (await createGroup(
      ctx,
      owner,
      bot.teamId,
      CreateGroupReq.parse({ name: bot.name, kind: 'dm', botIds: [bot.id] }),
    ))
  ctx.bus.publish([owner.id], { t: 'machine.onboarded', machineId: machine.id, botId: bot.id, groupId })
  return { id: bot.id, name: bot.name, groupId }
}

async function makeBot(ctx: Ctx, owner: { id: string; name: string }, machineId: string, agent: AgentKind) {
  const [team] = await ctx.db
    .select({ id: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, owner.id))
    .orderBy(asc(teamMembers.joinedAt))
    .limit(1)
  if (!team) return fail('invalid', '你还没有加入团队，不能新建 Bot')
  const base = `${owner.name}的 ${AGENT_TITLE[agent]}`
  const taken = new Set(
    (
      await ctx.db
        .select({ name: bots.name })
        .from(bots)
        .where(
          and(
            inArray(bots.name, [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base} ${n}`)]),
            isNull(bots.deletedAt),
          ),
        )
    ).map((b) => b.name),
  )
  const name = [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base} ${n}`)].find((n) => !taken.has(n))
  if (!name) return fail('conflict', '名称「{name}」已被占用', { name: base })
  const [bot] = await ctx.db
    .insert(bots)
    .values({
      teamId: team.id,
      name,
      ownerId: owner.id,
      agentKind: agent,
      machineId,
      binding: 'bound',
      concurrency: (await teamParams(ctx.db, team.id)).botConcurrencyDefault,
      createdBy: owner.id,
    })
    .returning()
  await audit(ctx, {
    category: 'admin',
    actorUserId: owner.id,
    teamId: team.id,
    action: 'bot.create',
    detail: { botId: bot!.id, name, via: 'onboard' },
  })
  await publishBot(ctx, bot!.id)
  return bot!
}

const FILES = join(import.meta.dirname, '../../../install')
const read = (name: string) => readFileSync(join(FILES, name), 'utf8')

/** Public: install.md (for the agent), install.sh (the steps) and where gg is for a platform. */
export function onboardRoutes(ctx: Ctx, app: FastifyInstance) {
  app.get('/api/install.md', async (req, reply) =>
    reply
      .type('text/markdown; charset=utf-8')
      .send(read('install.md').replaceAll('{{SERVER}}', await serverUrl(ctx, req))),
  )
  app.get('/api/install.sh', async (req, reply) =>
    reply
      .type('text/x-shellscript; charset=utf-8')
      .send(read('install.sh').replaceAll('{{SERVER}}', await serverUrl(ctx, req))),
  )
  app.get<{ Querystring: { platform?: string } }>(
    '/api/install/gg',
    async (req): Promise<InstallBuildDto> => {
      const release = await daemonRelease(ctx)
      const build = release?.builds[req.query.platform ?? '']
      if (!release || !build) return fail('not_found', '这个平台还没有发布 gg')
      const url = build.url.startsWith('/') ? `${await serverUrl(ctx, req)}${build.url}` : build.url
      return { version: release.version, url, sha256: build.sha256 }
    },
  )
}
