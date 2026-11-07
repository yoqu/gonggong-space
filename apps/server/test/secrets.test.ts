import {
  type MessageDto,
  type MySecretDto,
  PROTOCOL_VERSION,
  type RunDto,
  type RunStart,
  type SecretCard,
  type SecretDto,
  type ToolCallRes,
  type WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  auditLogs,
  groupBots,
  mcpServers,
  messages,
  personalSecrets,
  runs,
  secretRequests,
  secrets,
} from '../src/db/schema.js'
import { migrateMcpSecrets } from '../src/modules/mcp/secrets.js'
import { MASK } from '../src/modules/runs/redact.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { forgetRedactors, resolveSecrets, runRedactors } from '../src/modules/secrets/resolve.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

const NOW = new Date('2026-10-19T03:00:00Z')
let t: TestApp
beforeEach(async () => {
  t = await createTestApp({ now: () => NOW })
})
afterEach(() => {
  forgetRedactors()
  return t.close()
})

/** Wang owns the team and the bot's machine, Li administers the group, Zhao is a member, Root a sysadmin. */
async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const other = await t.seed.bot({ ownerId: wang.id, name: 'Codex', machineId: machine.id })
  const group = await t.seed.group({
    createdBy: li.id,
    name: '研发群',
    memberIds: [wang.id, zhao.id, root.id],
    botIds: [bot.id, other.id],
  })
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  const runOf = async (user: { id: string }, botId = bot.id) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: user.id, body: '@Claude 干活', meta: {} })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({ groupId: group.id, botId, triggerMessageId: m!.id, originUserId: user.id, status: 'running' })
      .returning()
    const call = async (name: string, args: unknown = {}) => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${r!.id}/tools/${name}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { arguments: args },
      })
      return res.json<ToolCallRes>()
    }
    return { run: r!, call }
  }
  const teamUrl = `/api/teams/${group.teamId}/secrets`
  const groupUrl = `/api/groups/${group.id}/secrets`
  return { wang, li, zhao, root, bot, other, group, machine, token, as, runOf, teamUrl, groupUrl }
}

const resolve = (w: Awaited<ReturnType<typeof world>>, originUserId: string, botId = w.bot.id) =>
  resolveSecrets(t.db, { groupId: w.group.id, botId, originUserId }, NOW)

describe('secret definitions', () => {
  it('lets each layer be written only by its admins, never returns values and audits names only', async () => {
    const w = await world()
    const [wang, li, zhao, root] = await Promise.all([w.as(w.wang), w.as(w.li), w.as(w.zhao), w.as(w.root)])
    const body = { name: 'FEISHU_DEVOPS_TOKEN', description: 'devops', value: 'tok-team-123456' }

    expect((await zhao.post('/api/admin/secrets', body)).status).toBe(403)
    expect((await root.post<SecretDto>('/api/admin/secrets', { ...body, name: 'PLATFORM_KEY' })).status).toBe(
      201,
    )
    expect((await li.post(w.teamUrl, body)).status).toBe(403)
    const team = await wang.post<SecretDto>(w.teamUrl, body)
    expect(team.status).toBe(201)
    expect(team.body).toMatchObject({
      scope: 'team',
      teamId: w.group.teamId,
      name: 'FEISHU_DEVOPS_TOKEN',
      mode: 'shared',
      botIds: null,
      value: { last4: '3456', updatedBy: '王磊' },
      personalFilled: [],
    })
    expect((await wang.post(w.teamUrl, body)).status).toBe(409)
    expect((await zhao.post(w.groupUrl, body)).status).toBe(403)
    const grp = await li.post<SecretDto>(w.groupUrl, { ...body, value: 'tok-group-654321' })
    expect(grp.status).toBe(201)

    // Members read names and states; the team layer lists its own rows.
    expect((await zhao.get<SecretDto[]>(w.teamUrl)).body.map((s) => s.name)).toEqual(['FEISHU_DEVOPS_TOKEN'])
    expect((await zhao.post(w.teamUrl, { name: 'X_TOKEN' })).status).toBe(403)
    const seen = await zhao.get<SecretDto[]>(w.groupUrl)
    expect(seen.body.map((s) => [s.name, s.scope, s.overridden])).toEqual([
      ['FEISHU_DEVOPS_TOKEN', 'team', true],
      ['FEISHU_DEVOPS_TOKEN', 'group', false],
      ['PLATFORM_KEY', 'platform', false],
    ])
    const outsider = await w.as(await t.seed.user({ name: '路人', teamId: null }))
    expect((await outsider.get(w.groupUrl)).status).toBe(404)
    expect((await outsider.get(w.teamUrl)).status).toBe(404)

    // PATCH / DELETE by the row's layer.
    expect((await li.patch(`/api/secrets/${team.body.id}`, { description: 'x' })).status).toBe(404)
    expect((await zhao.patch(`/api/secrets/${grp.body.id}`, { enabled: false })).status).toBe(404)
    const patched = await wang.patch<SecretDto>(`/api/secrets/${team.body.id}`, {
      description: '团队 devops',
      botIds: [w.bot.id],
      value: null,
    })
    expect(patched.body).toMatchObject({ description: '团队 devops', botIds: [w.bot.id], value: null })
    expect(
      (await wang.patch(`/api/secrets/${team.body.id}`, { botIds: ['00000000-0000-4000-8000-000000000000'] }))
        .status,
    ).toBe(400)
    expect((await li.del(`/api/secrets/${grp.body.id}`)).status).toBe(204)
    expect((await li.del(`/api/secrets/${grp.body.id}`)).status).toBe(404)

    const everything = JSON.stringify([
      team.body,
      seen.body,
      await t.db.select().from(auditLogs),
      await t.db.select().from(secrets),
    ])
    expect(everything).not.toMatch(/tok-team-123456|tok-group-654321/)
    const actions = (await t.db.select().from(auditLogs)).map((l) => [
      l.action,
      (l.detail as { layer: string }).layer,
    ])
    expect(actions).toEqual([
      ['secret.define', 'platform'],
      ['secret.set', 'platform'],
      ['secret.define', 'team'],
      ['secret.set', 'team'],
      ['secret.define', 'group'],
      ['secret.set', 'group'],
      ['secret.update', 'team'],
      ['secret.clear', 'team'],
      ['secret.delete', 'group'],
    ])
  })

  it('rejects reserved names, short values and a shared value for personal secrets', async () => {
    const w = await world()
    const wang = await w.as(w.wang)
    for (const name of [
      'PATH',
      'HOME',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_X',
      'GG_LANG',
      'GIT_SSH_COMMAND',
      'MCP_TOOL_TIMEOUT',
    ])
      expect((await wang.post(w.teamUrl, { name })).status).toBe(400)
    expect((await wang.post(w.teamUrl, { name: 'lower' })).status).toBe(400)
    expect((await wang.post(w.teamUrl, { name: 'SHORT_KEY', value: 'short' })).status).toBe(400)
    expect(
      (await wang.post(w.teamUrl, { name: 'JIRA_TOKEN', mode: 'personal', value: 'abcdefgh123' })).status,
    ).toBe(400)
    const p = await wang.post<SecretDto>(w.teamUrl, { name: 'JIRA_TOKEN', mode: 'personal' })
    expect((await wang.patch(`/api/secrets/${p.body.id}`, { value: 'abcdefgh123' })).status).toBe(400)
    const s = await wang.post<SecretDto>(w.teamUrl, { name: 'WIKI_TOKEN', value: 'abcdefgh123' })
    const turned = await wang.patch<SecretDto>(`/api/secrets/${s.body.id}`, { mode: 'personal' })
    expect(turned.body).toMatchObject({ mode: 'personal', value: null })
    expect((await wang.patch(`/api/secrets/${s.body.id}`, { name: 'PATH' })).status).toBe(400)
  })
})

describe('my secrets', () => {
  it('stores my own value per team, only I can write it and nobody reads it back', async () => {
    const w = await world()
    const [wang, zhao, li] = await Promise.all([w.as(w.wang), w.as(w.zhao), w.as(w.li)])
    const shared = await wang.post<SecretDto>(w.teamUrl, { name: 'TEAM_TOKEN', value: 'team-value-1' })
    const jira = await wang.post<SecretDto>(w.teamUrl, { name: 'JIRA_TOKEN', mode: 'personal' })
    const plat = await (await w.as(w.root)).post<SecretDto>('/api/admin/secrets', {
      name: 'GH_TOKEN',
      mode: 'shared_overridable',
      value: 'platform-gh-1',
    })

    const list = await zhao.get<MySecretDto[]>('/api/me/secrets')
    expect(list.body.map((m) => [m.secret.name, m.where, m.mine])).toEqual([
      ['GH_TOKEN', '默认团队', null],
      ['JIRA_TOKEN', '默认团队', null],
    ])
    expect((await zhao.put(`/api/me/secrets/${shared.body.id}`, { value: 'mine-value-1' })).status).toBe(400)
    const set = await zhao.put<MySecretDto>(`/api/me/secrets/${jira.body.id}`, { value: 'zhao-jira-777' })
    expect(set.body.mine).toMatchObject({ last4: '-777', allowForeignMachines: false })
    const allow = await zhao.put<MySecretDto>(`/api/me/secrets/${jira.body.id}`, {
      allowForeignMachines: true,
    })
    expect(allow.body.mine).toMatchObject({ last4: '-777', allowForeignMachines: true })
    // Changing the value keeps the setting unless sent.
    await zhao.put(`/api/me/secrets/${jira.body.id}`, { value: 'zhao-jira-888' })
    await zhao.put(`/api/me/secrets/${plat.body.id}`, { value: 'zhao-gh-value' })
    const [row] = await t.db.select().from(personalSecrets).where(eq(personalSecrets.name, 'JIRA_TOKEN'))
    expect(row).toMatchObject({ userId: w.zhao.id, teamId: w.group.teamId, allowForeignMachines: true })
    expect(row!.value).not.toContain('zhao-jira')

    // Admins only learn who filled it.
    const team = await wang.get<SecretDto[]>(w.teamUrl)
    expect(team.body.find((s) => s.name === 'JIRA_TOKEN')!.personalFilled).toEqual([
      { userId: w.zhao.id, name: '赵敏' },
    ])
    const view = await li.get<SecretDto[]>(w.groupUrl)
    expect(view.body.find((s) => s.name === 'GH_TOKEN')!.personalFilled).toEqual([
      { userId: w.zhao.id, name: '赵敏' },
    ])
    expect(JSON.stringify([team.body, view.body, await t.db.select().from(auditLogs)])).not.toMatch(/zhao-/)

    expect((await zhao.del(`/api/me/secrets/${jira.body.id}`)).status).toBe(204)
    expect(
      (await zhao.get<MySecretDto[]>('/api/me/secrets')).body.find((m) => m.secret.name === 'JIRA_TOKEN')!
        .mine,
    ).toBeNull()
    const outsider = await w.as(await t.seed.user({ name: '路人', teamId: null }))
    expect((await outsider.put(`/api/me/secrets/${jira.body.id}`, { value: 'x-value-123' })).status).toBe(404)
  })
})

describe('run injection', () => {
  it('picks personal over group over team over platform, within mode, machine and bot limits', async () => {
    const w = await world()
    const [wang, li, root] = await Promise.all([w.as(w.wang), w.as(w.li), w.as(w.root)])
    await root.post('/api/admin/secrets', { name: 'A_TOKEN', value: 'platform-a-1' })
    await wang.post(w.teamUrl, { name: 'A_TOKEN', value: 'team-a-12345' })
    await li.post(w.groupUrl, { name: 'A_TOKEN', value: 'group-a-1234' })
    await wang.post(w.teamUrl, { name: 'B_TOKEN', mode: 'shared_overridable', value: 'team-b-12345' })
    const c = await wang.post<SecretDto>(w.teamUrl, { name: 'C_TOKEN', mode: 'personal' })
    await wang.post(w.teamUrl, { name: 'ONLY_OTHER', value: 'other-only-1', botIds: [w.other.id] })
    await wang.post(w.teamUrl, { name: 'OLD_TOKEN', value: 'expired-123', expiresAt: '2026-10-01T00:00:00Z' })
    await wang.post(w.teamUrl, { name: 'OFF_TOKEN', value: 'disabled-123', enabled: false })
    // A disabled group row does not hide the team's.
    await wang.post(w.teamUrl, { name: 'D_TOKEN', value: 'team-d-12345' })
    await li.post(w.groupUrl, { name: 'D_TOKEN', value: 'group-d-1234', enabled: false })

    const zhao = await w.as(w.zhao)
    await zhao.put(`/api/me/secrets/${c.body.id}`, { value: 'zhao-c-12345' })
    const b = (await zhao.get<MySecretDto[]>('/api/me/secrets')).body.find(
      (m) => m.secret.name === 'B_TOKEN',
    )!
    await zhao.put(`/api/me/secrets/${b.secret.id}`, { value: 'zhao-b-12345' })
    await wang.put(`/api/me/secrets/${c.body.id}`, { value: 'wang-c-12345' })

    // Wang owns the bot's machine: his own values are used.
    const byWang = await resolve(w, w.wang.id)
    expect(byWang.env).toEqual({
      A_TOKEN: 'group-a-1234',
      B_TOKEN: 'team-b-12345',
      C_TOKEN: 'wang-c-12345',
      D_TOKEN: 'team-d-12345',
    })
    expect(byWang.secrets).toEqual([
      { name: 'A_TOKEN', source: 'group' },
      { name: 'B_TOKEN', source: 'team' },
      { name: 'C_TOKEN', source: 'personal' },
      { name: 'D_TOKEN', source: 'team' },
    ])
    // Zhao's values stay off Wang's machine until he allows others' machines.
    expect((await resolve(w, w.zhao.id)).env).toEqual({
      A_TOKEN: 'group-a-1234',
      B_TOKEN: 'team-b-12345',
      D_TOKEN: 'team-d-12345',
    })
    await zhao.put(`/api/me/secrets/${b.secret.id}`, { allowForeignMachines: true })
    await zhao.put(`/api/me/secrets/${c.body.id}`, { allowForeignMachines: true })
    const byZhao = await resolve(w, w.zhao.id)
    expect(byZhao.env).toMatchObject({ B_TOKEN: 'zhao-b-12345', C_TOKEN: 'zhao-c-12345' })
    expect((await resolve(w, w.zhao.id, w.other.id)).env.ONLY_OTHER).toBe('other-only-1')
  })

  it('sends env and resolved MCP servers in run.start and records the names on the run', async () => {
    const w = await world()
    const wang = await w.as(w.wang)
    await wang.post(w.teamUrl, { name: 'WIKI_TOKEN', value: 'wiki-token-123' })
    const root = await w.as(w.root)
    const stdio = (name: string, env: Record<string, string>) => ({
      transport: 'stdio' as const,
      name,
      command: 'npx',
      args: [],
      env,
    })
    await root.post('/api/admin/mcp', {
      enabled: true,
      config: stdio('wiki', { TOKEN: '${secret:WIKI_TOKEN}' }),
    })
    await root.post('/api/admin/mcp', {
      enabled: true,
      config: stdio('jira', { TOKEN: '${secret:JIRA_TOKEN}' }),
    })

    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token: w.token,
        daemonVersion: '0.1.0',
        machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
        agents: [],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: w.group.id,
        kind: 'user',
        authorUserId: w.wang.id,
        body: '@Claude hi',
        meta: { mentions: [w.bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const start = await box.next<RunStart>()
    expect(start.env).toEqual({ WIKI_TOKEN: 'wiki-token-123' })
    // jira's secret has no value: not sent this run.
    expect(start.mcpServers).toEqual([stdio('wiki', { TOKEN: 'wiki-token-123' })])
    const [run] = await t.db.select().from(runs).where(eq(runs.id, start.runId))
    expect(run!.secrets).toEqual([{ name: 'WIKI_TOKEN', source: 'team' }])
    const dto = await wang.get<{ run: RunDto }>(`/api/runs/${start.runId}`)
    expect(dto.body.run.secrets).toEqual([{ name: 'WIKI_TOKEN', source: 'team' }])
    ws.close()
  })
})

describe('redaction', () => {
  it("masks a run's injected values and the group's shared values in its output and in what its agent writes", async () => {
    const w = await world()
    const [wang, zhao] = await Promise.all([w.as(w.wang), w.as(w.zhao)])
    await wang.post(w.teamUrl, { name: 'TEAM_TOKEN', value: 'team-secret-value' })
    const p = await wang.post<SecretDto>(w.teamUrl, { name: 'MY_TOKEN', mode: 'personal' })
    await zhao.put(`/api/me/secrets/${p.body.id}`, {
      value: 'zhao-personal-value',
      allowForeignMachines: true,
    })
    const { run, call } = await w.runOf(w.zhao)
    await t.db
      .update(runs)
      .set({ secrets: [{ name: 'MY_TOKEN', source: 'personal' }] })
      .where(eq(runs.id, run.id))
    const r = await runRedactors(t.ctx, run.id)
    expect(r.redact('a team-secret-value b zhao-personal-value')).toBe(`a ${MASK} b ${MASK}`)
    expect(r.mask('export X=team-secret-value')).toBe(`export X=${MASK}`)
    // Known values only: content that merely looks like a credential stays.
    expect(r.mask('TOKEN=$TEAM_TOKEN')).toBe('TOKEN=$TEAM_TOKEN')

    const res = await call('hand_off', { bot: 'Codex', task: '用 zhao-personal-value 部署' })
    expect(res.isError).toBe(false)
    const [after] = await t.db.select().from(runs).where(eq(runs.id, run.id))
    expect(after!.handoffs).toEqual([{ botId: w.other.id, task: `用 ${MASK} 部署` }])
  })
})

describe('secret tools and cards', () => {
  it('lists secrets without values and collects them on cards for the right people', async () => {
    const w = await world()
    const [wang, li, zhao] = await Promise.all([w.as(w.wang), w.as(w.li), w.as(w.zhao)])
    await wang.post(w.teamUrl, { name: 'DEVOPS_TOKEN', description: 'fd 构建', value: 'devops-value-1' })
    await wang.post(w.teamUrl, { name: 'JIRA_TOKEN', mode: 'personal' })
    await li.post(w.groupUrl, { name: 'WIKI_TOKEN' })
    await t.db.update(groupBots).set({ sessionId: 'sess-1' }).where(eq(groupBots.groupId, w.group.id))
    const { run, call } = await w.runOf(w.zhao)
    await t.db
      .update(runs)
      .set({ secrets: [{ name: 'DEVOPS_TOKEN', source: 'team' }] })
      .where(eq(runs.id, run.id))

    expect((await call('secret_list')).text.split('\n')).toEqual([
      '本群可见的密钥（3 个，同名时群层覆盖团队层、团队层覆盖平台层；值不会显示，已注入的用 $名称 读取）：',
      '- DEVOPS_TOKEN · 团队层 · shared · 统一值已填写 · 本轮已注入（团队层） · 用途：fd 构建',
      '- JIRA_TOKEN · 团队层 · personal · 发起人未填写个人值 · 本轮未注入',
      '- WIKI_TOKEN · 群层 · shared · 统一值未填写 · 本轮未注入',
    ])
    expect((await call('secret_list')).text).not.toContain('devops-value-1')
    expect(await call('secret_request', { names: ['NOPE_TOKEN'] })).toMatchObject({ isError: true })

    const asked = await call('secret_request', { names: ['JIRA_TOKEN', 'WIKI_TOKEN'], forceNewSession: true })
    expect(asked.text).toContain('请发起人填写：JIRA_TOKEN；请管理员填写：WIKI_TOKEN')
    const cards = await t.db.select().from(messages).where(eq(messages.kind, 'event'))
    expect(cards.map((m) => m.body)).toEqual([
      'Claude 请 赵敏 填写自己的密钥：JIRA_TOKEN',
      'Claude 请管理员填写密钥：WIKI_TOKEN',
    ])
    const [origin, admins] = cards.map((m) => (m.meta as { secretCard: SecretCard }).secretCard)
    expect(origin).toMatchObject({
      names: ['JIRA_TOKEN'],
      audience: 'origin',
      userId: w.zhao.id,
      filled: false,
    })
    expect(admins).toMatchObject({ names: ['WIKI_TOKEN'], audience: 'admins', userId: null, filled: false })

    const pushed: WebEvent[] = []
    t.ctx.bus.attach(w.zhao.id, (e) => pushed.push(e))
    const url = (c: SecretCard) => `/api/secret-requests/${c!.id}`
    expect((await li.post(url(origin!), { values: { JIRA_TOKEN: 'li-jira-value' } })).status).toBe(403)
    expect((await zhao.post(url(origin!), { values: {} })).status).toBe(400)
    const filled = await zhao.post<SecretCard>(url(origin!), { values: { JIRA_TOKEN: 'zhao-jira-value' } })
    expect(filled.body).toMatchObject({ filled: true })
    expect((await zhao.post(url(origin!), { values: { JIRA_TOKEN: 'zhao-jira-value' } })).status).toBe(409)
    const [mine] = await t.db.select().from(personalSecrets)
    expect(mine).toMatchObject({
      userId: w.zhao.id,
      teamId: w.group.teamId,
      name: 'JIRA_TOKEN',
      allowForeignMachines: false,
    })

    expect((await zhao.post(url(admins!), { values: { WIKI_TOKEN: 'wiki-value-123' } })).status).toBe(403)
    expect((await wang.post(url(admins!), { values: { WIKI_TOKEN: 'wiki-value-123' } })).status).toBe(403)
    expect(
      (await li.post<SecretCard>(url(admins!), { values: { WIKI_TOKEN: 'wiki-value-123' } })).body,
    ).toMatchObject({
      filled: true,
    })
    expect((await resolve(w, w.zhao.id)).env.WIKI_TOKEN).toBe('wiki-value-123')
    const edited = pushed.flatMap((e) => (e.t === 'message.edited' ? [e.message as MessageDto] : []))
    expect(edited.map((m) => m.secretCard?.filled)).toEqual([true, true])
    const [gb] = await t.db.select().from(groupBots).where(eq(groupBots.botId, w.bot.id))
    expect(gb!.newSessionReason).toBe('config_changed')

    const fills = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'secret.fill'))
    expect(
      fills.map((l) => [(l.detail as { name: string }).name, (l.detail as { layer: string }).layer]),
    ).toEqual([
      ['JIRA_TOKEN', 'personal'],
      ['WIKI_TOKEN', 'group'],
    ])
    const everywhere = JSON.stringify([
      await t.db.select().from(messages),
      await t.db.select().from(auditLogs),
      await t.db.select().from(secretRequests),
      await t.db.select().from(secrets),
      (await call('secret_list')).text,
    ])
    expect(everywhere).not.toMatch(/zhao-jira-value|wiki-value-123|devops-value-1/)
  })
})

describe('filling a card carries the bot on', () => {
  it("marks a card from a bot on someone else's machine, lists my pending cards and reruns the bot once filled", async () => {
    const w = await world()
    const [wang, zhao, li] = await Promise.all([w.as(w.wang), w.as(w.zhao), w.as(w.li)])
    await wang.post(w.teamUrl, { name: 'JIRA_TOKEN', mode: 'personal' })
    const own = await w.runOf(w.wang)
    await own.call('secret_request', { names: ['JIRA_TOKEN'] })
    const { run, call } = await w.runOf(w.zhao)
    await call('secret_request', { names: ['JIRA_TOKEN'] })
    const cards = (await t.db.select().from(messages).where(eq(messages.kind, 'event'))).map(
      (m) => (m.meta as { secretCard: SecretCard }).secretCard,
    )
    expect(cards.map((c) => c.foreign)).toEqual([false, true])
    const zhaoCard = cards[1]!

    const pending = await zhao.get<SecretCard[]>(`/api/groups/${w.group.id}/secret-requests`)
    expect(pending.body.map((c) => [c.id, c.foreign])).toEqual([[zhaoCard.id, true]])
    expect((await li.get<SecretCard[]>(`/api/groups/${w.group.id}/secret-requests`)).body).toEqual([])
    const outsider = await w.as(await t.seed.user({ name: '路人' }))
    expect((await outsider.get(`/api/groups/${w.group.id}/secret-requests`)).status).toBe(404)

    const filled = await zhao.post<SecretCard>(`/api/secret-requests/${zhaoCard.id}`, {
      values: { JIRA_TOKEN: 'zhao-jira-value' },
      allowForeignMachines: true,
    })
    expect(filled.body).toMatchObject({ filled: true, foreign: true })
    expect((await resolve(w, w.zhao.id)).env.JIRA_TOKEN).toBe('zhao-jira-value')
    expect((await zhao.get<SecretCard[]>(`/api/groups/${w.group.id}/secret-requests`)).body).toEqual([])
    const stored = (await t.db.select().from(messages).where(eq(messages.kind, 'event'))).map(
      (m) => (m.meta as { secretCard?: SecretCard }).secretCard,
    )
    expect(stored.find((c) => c?.id === zhaoCard.id)).toMatchObject({ filled: true, foreign: true })

    const again = await t.db.select().from(runs).where(eq(runs.triggerMessageId, run.triggerMessageId))
    expect(again.map((r) => [r.botId, r.originUserId])).toEqual([
      [w.bot.id, w.zhao.id],
      [w.bot.id, w.zhao.id],
    ])
    const events = await t.db.select().from(messages).where(eq(messages.kind, 'event'))
    expect(events.at(-1)!.body).toBe('已填写密钥，Claude 继续处理')
  })

  it('tells the bot to ask again on a card instead of sending the user to settings', async () => {
    const w = await world()
    const [wang, zhao] = await Promise.all([w.as(w.wang), w.as(w.zhao)])
    await wang.post(w.teamUrl, { name: 'JIRA_TOKEN', mode: 'personal' })
    const mine = (await zhao.get<MySecretDto[]>('/api/me/secrets')).body[0]!
    await zhao.put(`/api/me/secrets/${mine.secret.id}`, { value: 'zhao-jira-value' })
    const { call } = await w.runOf(w.zhao)
    const text = (await call('secret_list')).text
    expect(text).toContain('未允许在他人机器上使用')
    expect(text).toContain('secret_request')
    expect(text).not.toContain('设置')
  })
})

describe('MCP migration', () => {
  it('turns plain values and old placeholders into secrets once', async () => {
    const w = await world()
    await t.db.insert(mcpServers).values([
      {
        scope: 'team',
        teamId: w.group.teamId,
        name: 'wiki',
        enabled: true,
        config: {
          transport: 'stdio',
          name: 'wiki',
          command: 'npx',
          args: [],
          env: { TOKEN: 'plain-wiki-123', region: '${secret:REGION}' },
        },
      },
      {
        scope: 'platform',
        name: 'my-docs',
        enabled: true,
        config: {
          transport: 'http',
          name: 'my-docs',
          url: 'https://d',
          headers: { Authorization: 'Bearer plain-docs-1' },
        },
      },
    ])
    await migrateMcpSecrets(t.ctx)
    const once = await t.db.select().from(mcpServers)
    const defs = await t.db.select().from(secrets)
    await migrateMcpSecrets(t.ctx)
    expect(await t.db.select().from(mcpServers)).toEqual(once)
    expect(await t.db.select().from(secrets)).toEqual(defs)

    expect(once.sort((a, b) => a.name.localeCompare(b.name)).map((r) => r.config)).toEqual([
      {
        transport: 'http',
        name: 'my-docs',
        url: 'https://d',
        headers: { Authorization: '${secret:MCP_MY_DOCS_AUTHORIZATION}' },
      },
      {
        transport: 'stdio',
        name: 'wiki',
        command: 'npx',
        args: [],
        env: { TOKEN: '${secret:MCP_WIKI_TOKEN}', region: '${secret:MCP_WIKI_REGION}' },
      },
    ])
    expect(defs.map((d) => [d.name, d.scope, d.value !== null]).sort()).toEqual([
      ['MCP_MY_DOCS_AUTHORIZATION', 'platform', true],
      ['MCP_WIKI_REGION', 'team', false],
      ['MCP_WIKI_TOKEN', 'team', true],
    ])
    expect(JSON.stringify([once, defs])).not.toMatch(/plain-/)
    expect((await resolve(w, w.wang.id)).env).toEqual({
      MCP_MY_DOCS_AUTHORIZATION: 'Bearer plain-docs-1',
      MCP_WIKI_TOKEN: 'plain-wiki-123',
    })
  })
})
