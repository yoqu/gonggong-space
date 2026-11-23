import {
  type ConnectorDto,
  type ConnectorList,
  ConnectReq,
  CreateSecretReq,
  type PluginManifest,
  type SecretRequirement,
  secretSpecsOf,
} from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { personalSecrets } from '../../db/schema.js'
import { fail, HttpError } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { nearest, specDescription } from '../secrets/needs.js'
import { visibleSecrets } from '../secrets/resolve.js'
import { clearPersonal, createSecret, setPersonal } from '../secrets/service.js'
import { enabledSkills } from '../skills/service.js'
import { groupPluginDtos, groupPluginList, pluginsOn, requirePluginsOn, skillLine } from './service.js'

const isConnector = (m: PluginManifest) => m.category === 'connector'

/**
 * The group's connectors as `userId` sees them (plan 连接器-方案 §3.1): connected when a run they start gets every
 * required secret on a bot's machine that is not theirs, i.e. their own value allowed on others' machines or a shared
 * value. Bot grants are left out, as in the member's secret needs.
 */
async function connectorDtos(ctx: Ctx, groupId: string, teamId: string, userId: string) {
  const now = ctx.now()
  const [plugins, defs, skills] = await Promise.all([
    groupPluginDtos(ctx, groupId, userId),
    visibleSecrets(ctx.db, groupId),
    enabledSkills(ctx.db, groupId, userId),
  ])
  const connectors = plugins.filter((p) => isConnector(p.manifest))
  const names = [...new Set(connectors.flatMap((c) => secretSpecsOf(c.manifest).map((s) => s.name)))]
  const mine = names.length
    ? await ctx.db
        .select()
        .from(personalSecrets)
        .where(
          and(
            eq(personalSecrets.userId, userId),
            eq(personalSecrets.teamId, teamId),
            inArray(personalSecrets.name, names),
          ),
        )
    : []
  const live = defs.filter((r) => r.enabled && !(r.expiresAt && r.expiresAt <= now))
  return connectors.map((c): ConnectorDto => {
    const needs = secretSpecsOf(c.manifest)
      .filter((s) => s.required)
      .map((spec) => {
        const def = nearest(live, spec.name)
        const mode = def?.mode ?? spec.mode
        const own = mode === 'shared' ? undefined : mine.find((m) => m.name === spec.name)
        const ok = !!def && (!!own?.allowForeignMachines || (mode !== 'personal' && !!def.value))
        return { name: spec.name, personal: mode !== 'shared', ok }
      })
    const personal = needs.filter((n) => n.personal).map((n) => n.name)
    const reads = (specs: { name: string }[]) => specs.some((s) => personal.includes(s.name))
    return {
      ...c,
      personal: personal.length > 0,
      connected: needs.every((n) => n.ok),
      missing: needs.filter((n) => n.personal && !n.ok).map((n) => n.name),
      sharedWith: [
        ...new Set([
          ...plugins
            .filter((p) => p.id !== c.id && p.enabledInGroup && reads(secretSpecsOf(p.manifest)))
            .map((p) => p.manifest.title),
          ...skills.filter((s) => reads(s.secretSpecs)).map((s) => s.name),
        ]),
      ],
    }
  })
}

async function connectorOf(ctx: Ctx, groupId: string, pluginId: string) {
  const found = (await groupPluginList(ctx.db, groupId)).find(
    (r) => r.plugin.id === pluginId && isConnector(r.version.manifest),
  )
  return found ?? fail('not_found', '连接器不存在')
}

/**
 * Saves the caller's own values of the connector's personal secrets, usable on others' machines. A name the team has
 * no definition of yet gets a per-member one in the team from the declaration, as filling a personal skill's does.
 */
async function connect(
  ctx: Ctx,
  groupId: string,
  teamId: string,
  userId: string,
  pluginId: string,
  body: ConnectReq,
) {
  const { plugin, version } = await connectorOf(ctx, groupId, pluginId)
  const specs = secretSpecsOf(version.manifest)
  const defs = await visibleSecrets(ctx.db, groupId)
  const entries = Object.entries(body.values)
  if (!entries.length) fail('invalid', '请填写密钥')
  const plan = entries.map(([name, value]) => {
    const spec =
      specs.find((s) => s.name === name) ??
      fail('invalid', '连接器「{title}」没有声明密钥 {name}', { title: version.manifest.title, name })
    const def = nearest(defs, name)
    if ((def?.mode ?? spec.mode) === 'shared')
      fail('invalid', '{name} 是团队共享密钥，请团队管理员填写', { name })
    return { spec, def, value }
  })
  const extra = { connector: plugin.name }
  for (const { spec, def, value } of plan) {
    if (!def) await defineFor(ctx, teamId, userId, spec, plugin.name)
    await setPersonal(ctx, { userId, teamId, name: spec.name }, value, true, 'secret.set', extra)
  }
  return plugin.id
}

/** The team's per-member definition of a connector's personal secret, made from its declaration. */
async function defineFor(
  ctx: Ctx,
  teamId: string,
  userId: string,
  spec: SecretRequirement,
  connector: string,
) {
  await createSecret(
    ctx,
    { scope: 'team', teamId, groupId: null },
    CreateSecretReq.parse({ name: spec.name, description: specDescription(spec), mode: spec.mode }),
    userId,
    { connector },
  ).catch((e) => {
    // A concurrent connect may have made it first: then it is there to fill.
    if (!(e instanceof HttpError && e.code === 'conflict')) throw e
  })
}

/** Secret names the group's enabled connectors declare. */
export async function connectorSecretNames(db: Ctx['db'], groupId: string) {
  return new Set(
    (await groupPluginList(db, groupId))
      .filter((r) => r.enabledInGroup && isConnector(r.version.manifest))
      .flatMap((r) => secretSpecsOf(r.version.manifest).map((s) => s.name)),
  )
}

/**
 * For secret_request: a secret `name` the team has no definition of, declared by a connector enabled in the group.
 * A personal one gets its per-member definition in the team so the originator can be asked for their value (as
 * connecting would make it); a shared one is for a team admin. Null when no connector declares it.
 */
export async function defineConnectorSecret(
  ctx: Ctx,
  run: { groupId: string; originUserId: string },
  teamId: string,
  name: string,
): Promise<{ title: string; shared: boolean } | null> {
  const found = (await groupPluginList(ctx.db, run.groupId))
    .filter((r) => r.enabledInGroup && isConnector(r.version.manifest))
    .flatMap((r) => {
      const spec = secretSpecsOf(r.version.manifest).find((s) => s.name === name)
      return spec ? [{ plugin: r.plugin, title: r.version.manifest.title, spec }] : []
    })[0]
  if (!found) return null
  if (found.spec.mode === 'shared') return { title: found.title, shared: true }
  await defineFor(ctx, teamId, run.originUserId, found.spec, found.plugin.name)
  return { title: found.title, shared: false }
}

async function disconnect(ctx: Ctx, groupId: string, teamId: string, userId: string, pluginId: string) {
  const { plugin, version } = await connectorOf(ctx, groupId, pluginId)
  for (const s of secretSpecsOf(version.manifest))
    await clearPersonal(ctx, { userId, teamId, name: s.name }, { connector: plugin.name })
  return plugin.id
}

/**
 * What the run's agent is told about the group's connectors (agent-facing: not translated): the ones it gets this turn
 * and how to reach them, and the ones held back for want of the originator's connection; null when there are none.
 */
export function connectorHint(
  connected: { name: string; title: string; description: string; entry: string | null; login?: boolean }[],
  unconnected: { name: string; title: string; description: string; missing: string[] }[],
) {
  const out: string[] = []
  if (connected.length)
    out.push(
      '已连接的连接器：本群可用以下外部系统，相关请求优先用它们（不要在对话里索要密钥）：',
      ...connected.map(
        (c) =>
          `- ${c.title}（${c.name}）：${c.description}${c.entry ? ` ${skillLine(c.name, c.entry)}` : ''}${c.login ? ' 用命令行工具登录，没登录时按 Skill 用设备码请发起人授权。' : ''}`,
      ),
    )
  if (unconnected.length)
    out.push(
      '未连接的连接器：本群开启了以下连接器，但发起人还没连接（缺少密钥），本轮用不了：',
      ...unconnected.map((c) => `- ${c.title}（${c.name}）：${c.description} 缺少：${c.missing.join('、')}`),
      '需要用到时，调用 gonggong 的 secret_request（names 填缺少的密钥名）给发起人发连接卡片，填完后下一轮即可使用；也可以请发起人点输入框的「连接器」按钮自己连接。',
    )
  return out.length ? out.join('\n') : null
}

export function connectorRoutes(ctx: Ctx, app: FastifyInstance) {
  type P = { Params: { id: string; pluginId: string } }
  const member = async (req: FastifyRequest<P>) => {
    const me = await requireUser(ctx, req)
    const { group } = await requireMember(ctx, req.params.id, me.id)
    return { me, groupId: group.id, teamId: group.teamId }
  }
  const one = async (m: Awaited<ReturnType<typeof member>>, pluginId: string) =>
    (await connectorDtos(ctx, m.groupId, m.teamId, m.me.id)).find((c) => c.id === pluginId) ??
    fail('not_found', '连接器不存在')

  app.get<P>('/api/groups/:id/connectors', async (req): Promise<ConnectorList> => {
    const m = await member(req)
    if (!(await pluginsOn(ctx.db))) return { connectors: [] }
    return { connectors: await connectorDtos(ctx, m.groupId, m.teamId, m.me.id) }
  })

  app.post<P>('/api/groups/:id/connectors/:pluginId/connect', async (req) => {
    const m = await member(req)
    await requirePluginsOn(ctx.db)
    const body = ConnectReq.parse(req.body)
    return one(m, await connect(ctx, m.groupId, m.teamId, m.me.id, req.params.pluginId, body))
  })

  app.delete<P>('/api/groups/:id/connectors/:pluginId/connection', async (req) => {
    const m = await member(req)
    await requirePluginsOn(ctx.db)
    return one(m, await disconnect(ctx, m.groupId, m.teamId, m.me.id, req.params.pluginId))
  })
}
