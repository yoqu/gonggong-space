import {
  type ConnectorDto,
  type ConnectorList,
  type ConnectorStatus,
  ConnectorSwitchReq,
  ConnectReq,
  CreateSecretReq,
  type PluginManifest,
  type SecretRequirement,
  secretSpecsOf,
} from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { connectorStates, groupMembers, personalSecrets } from '../../db/schema.js'
import { fail, HttpError } from '../../lib/errors.js'
import { open } from '../../lib/seal.js'
import { refuse, type ToolOutput } from '../agent-tools/service.js'
import { requireUser } from '../auth/session.js'
import { cliSpec } from '../connectors/sync.js'
import { cliMachines, cliView, legacyStatus } from '../connectors/view.js'
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
export async function connectorDtos(ctx: Ctx, groupId: string, teamId: string, userId: string) {
  const now = ctx.now()
  const [plugins, defs, skills, [member], states] = await Promise.all([
    groupPluginDtos(ctx, groupId, userId),
    visibleSecrets(ctx.db, groupId),
    enabledSkills(ctx.db, groupId, userId),
    ctx.db
      .select({ off: groupMembers.connectorsOff })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))),
    ctx.db
      .select()
      .from(connectorStates)
      .where(and(eq(connectorStates.userId, userId), eq(connectorStates.teamId, teamId))),
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
  const machines = connectors.some((c) => c.manifest.connector?.cli)
    ? await cliMachines(ctx, groupId, userId)
    : null
  return connectors.map((c): ConnectorDto => {
    const spec = cliSpec(c.manifest.name, c.manifest)
    const cli = spec && machines?.featured ? cliView(ctx, machines, spec) : null
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
    const connected = needs.every((n) => n.ok)
    const state = states.find((x) => x.name === c.manifest.name)
    // A check made before the keys last changed says nothing about the ones in use now.
    const keyedAt = Math.max(0, ...mine.filter((m) => personal.includes(m.name)).map((m) => +m.updatedAt))
    const fresh = state && +state.checkedAt >= keyedAt ? state : undefined
    const status: ConnectorStatus = c.manifest.connector?.login
      ? (state?.status ?? 'unchecked')
      : !connected
        ? 'unconnected'
        : !c.manifest.connector?.check
          ? 'ok'
          : (fresh?.status ?? 'unchecked')
    return {
      ...c,
      personal: personal.length > 0,
      connected,
      on: !(member?.off ?? []).includes(c.manifest.name),
      status,
      account: (c.manifest.connector?.login ? state : fresh)?.account ?? null,
      checkedAt: (c.manifest.connector?.login ? state : fresh)?.checkedAt.toISOString() ?? null,
      ...(cli && legacyStatus(cli)),
      cli,
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
  await ctx.db
    .delete(connectorStates)
    .where(
      and(
        eq(connectorStates.userId, userId),
        eq(connectorStates.teamId, teamId),
        eq(connectorStates.name, plugin.name),
      ),
    )
  return plugin.id
}

type State = { status: 'ok' | 'expired' | 'error'; account?: string | null; detail?: string | null }

async function saveState(ctx: Ctx, key: { userId: string; teamId: string; name: string }, s: State) {
  const set = { status: s.status, account: s.account ?? null, detail: s.detail ?? null, checkedAt: ctx.now() }
  await ctx.db
    .insert(connectorStates)
    .values({ ...key, ...set })
    .onConflictDoUpdate({
      target: [connectorStates.userId, connectorStates.teamId, connectorStates.name],
      set,
    })
}

const CHECK_TIMEOUT_MS = 8000
const SECRET_REF = /\$\{secret:([A-Z][A-Z0-9_]{1,63})\}/g

/**
 * Checks the caller's connection with the connector's `check` request (连通性), their own key or the shared one
 * filled in, and keeps the answer; nothing for connectors without a check or not connected.
 */
async function check(ctx: Ctx, groupId: string, teamId: string, userId: string, pluginId: string) {
  const { plugin, version } = await connectorOf(ctx, groupId, pluginId)
  const spec = version.manifest.connector?.check
  if (!spec) return plugin.id
  const names = secretSpecsOf(version.manifest).map((s) => s.name)
  const [defs, mine] = await Promise.all([
    visibleSecrets(ctx.db, groupId),
    names.length
      ? ctx.db
          .select()
          .from(personalSecrets)
          .where(
            and(
              eq(personalSecrets.userId, userId),
              eq(personalSecrets.teamId, teamId),
              inArray(personalSecrets.name, names),
            ),
          )
      : [],
  ])
  const value = (name: string) => {
    const own = mine.find((m) => m.name === name)
    if (own && nearest(defs, name)?.mode !== 'shared') return open(own.value)
    const def = nearest(defs, name)
    return def?.value && def.mode !== 'personal' ? open(def.value) : null
  }
  let missing = false
  const fill = (v: string) =>
    v.replace(SECRET_REF, (_, n: string) => {
      const got = value(n)
      if (got === null) missing = true
      return got ?? ''
    })
  const headers = Object.fromEntries(Object.entries(spec.headers).map(([k, v]) => [k, fill(v)]))
  const body = spec.body === undefined ? undefined : fill(spec.body)
  if (missing) return plugin.id
  const key = { userId, teamId, name: plugin.name }
  try {
    const res = await fetch(spec.url, {
      method: spec.method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    await res.body?.cancel()
    await saveState(
      ctx,
      key,
      res.ok
        ? { status: 'ok' }
        : res.status === 401 || res.status === 403
          ? { status: 'expired', detail: `HTTP ${res.status}` }
          : { status: 'error', detail: `HTTP ${res.status}` },
    )
  } catch (e) {
    await saveState(ctx, key, { status: 'error', detail: e instanceof Error ? e.message.slice(0, 300) : '' })
  }
  return plugin.id
}

async function setSwitch(ctx: Ctx, groupId: string, userId: string, pluginId: string, on: boolean) {
  const { plugin } = await connectorOf(ctx, groupId, pluginId)
  const [m] = await ctx.db
    .select({ off: groupMembers.connectorsOff })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  const off = new Set(m?.off ?? [])
  if (on) off.delete(plugin.name)
  else off.add(plugin.name)
  await ctx.db
    .update(groupMembers)
    .set({ connectorsOff: [...off].sort() })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  return plugin.id
}

/** connector_status: a bot reports the originator's CLI login to a CLI-login connector of the group. */
export async function connectorStatusTool(
  ctx: Ctx,
  run: { groupId: string; originUserId: string },
  teamId: string,
  a: { connector: string; status: 'ok' | 'expired' | 'error'; account?: string; detail?: string },
): Promise<ToolOutput> {
  const found = (await groupPluginList(ctx.db, run.groupId)).find(
    (r) => r.plugin.name === a.connector && isConnector(r.version.manifest),
  )
  if (!found) return refuse(`本群没有连接器 ${a.connector}`)
  if (!found.version.manifest.connector?.login)
    return refuse(`${a.connector} 用密钥连接，平台会自己检测，不用报告`)
  await saveState(ctx, { userId: run.originUserId, teamId, name: a.connector }, a)
  return { text: `已记录：发起人的${found.version.manifest.title}连接状态为 ${a.status}`, groups: [] }
}

const loginLine = (c: { login?: boolean; cli?: { account: string | null } }) =>
  c.cli
    ? c.cli.account !== null
      ? ` 已由共工连接（以 ${c.cli.account || '电脑主人'} 登录）：命令行工具已安装，用的是这台电脑主人的账号（不论谁触发都用它），直接用，不要自己安装或登录；命令提示未登录、登录过期或缺少权限时，调用 gonggong 的 connector_request 后结束本轮。`
      : ' 由共工连接，但这台电脑的主人还没连接：需要时调用 connector_request（不要自己安装或登录），然后结束本轮。'
    : c.login
      ? ' 用命令行工具登录，没登录时按 Skill 用设备码请发起人授权。'
      : ''

/**
 * What the run's agent is told about the group's connectors (agent-facing: not translated): the ones it gets this turn
 * and how to reach them, and the ones held back for want of the originator's connection; null when there are none.
 */
export function connectorHint(
  connected: {
    name: string
    title: string
    description: string
    entry: string | null
    login?: boolean
    /** CLI connectors on a daemon with `connectors`: the originator's login there (account null: not connected). */
    cli?: { account: string | null }
  }[],
  unconnected: { name: string; title: string; description: string; missing: string[] }[],
) {
  const out: string[] = []
  if (connected.length)
    out.push(
      '已连接的连接器：本群可用以下外部系统，相关请求优先用它们（不要在对话里索要密钥）：',
      ...connected.map(
        (c) =>
          `- ${c.title}（${c.name}）：${c.description}${c.entry ? ` ${skillLine(c.name, c.entry)}` : ''}${loginLine(c)}`,
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
    const id = await connect(ctx, m.groupId, m.teamId, m.me.id, req.params.pluginId, body)
    // Tells right away whether the key just filled works.
    await check(ctx, m.groupId, m.teamId, m.me.id, id)
    return one(m, id)
  })

  app.post<P>('/api/groups/:id/connectors/:pluginId/check', async (req) => {
    const m = await member(req)
    await requirePluginsOn(ctx.db)
    return one(m, await check(ctx, m.groupId, m.teamId, m.me.id, req.params.pluginId))
  })

  app.put<P>('/api/groups/:id/connectors/:pluginId/switch', async (req) => {
    const m = await member(req)
    await requirePluginsOn(ctx.db)
    const { on } = ConnectorSwitchReq.parse(req.body)
    return one(m, await setSwitch(ctx, m.groupId, m.me.id, req.params.pluginId, on))
  })

  app.delete<P>('/api/groups/:id/connectors/:pluginId/connection', async (req) => {
    const m = await member(req)
    await requirePluginsOn(ctx.db)
    return one(m, await disconnect(ctx, m.groupId, m.teamId, m.me.id, req.params.pluginId))
  })
}
