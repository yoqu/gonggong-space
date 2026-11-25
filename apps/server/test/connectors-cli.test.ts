import type {
  ConnectorDto,
  ConnectorList,
  ConnectorProbe,
  PluginDto,
  ServerToDaemon,
  WebEvent,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, notifications, runs } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { probesOf } from '../src/modules/connectors/state.js'
import { buildRunStart } from '../src/modules/runs/scheduler.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const feishuPlugin = [
  {
    path: 'gonggong-plugin.json',
    content: JSON.stringify({
      name: 'feishu',
      version: '1.0.0',
      title: '飞书',
      description: '飞书的说明',
      category: 'connector',
      agents: ['claude'],
      minDaemon: '0.5.0',
      entry: 'feishu',
      connector: { login: '帮我连接飞书', cli: { driver: 'lark-cli', npm: '@larksuite/cli' } },
    }),
  },
  { path: 'skills/feishu/SKILL.md', content: '---\nname: feishu\ndescription: feishu helper\n---\nGo.\n' },
]

const probe = (o: Partial<ConnectorProbe>): ConnectorProbe => ({
  connector: 'feishu',
  driver: 'lark-cli',
  profile: 'default',
  state: 'ready',
  account: null,
  feishuUserId: null,
  expiresAt: null,
  refreshExpiresAt: null,
  version: '1.0.96',
  detail: null,
  ...o,
})

/** Wang owns the bot's machine; Zhao is a member without a machine; Li administers the group. */
async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  const { machine, token } = await t.seed.machine(wang.id, { daemonVersion: '0.9.0' })
  const bot = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: li.id, memberIds: [wang.id, zhao.id], botIds: [bot.id] })
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  const api = { li: await as(li), zhao: await as(zhao), wang: await as(wang), root: await as(root) }
  await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
  const sent: ServerToDaemon[] = []
  /** Answers connectors.cmd with this, when set. */
  let answer: ((m: Extract<ServerToDaemon, { t: 'connectors.cmd' }>) => unknown) | undefined
  const online = (features = ['plugins', 'connectors']) =>
    t.ctx.hub.register(
      machine.id,
      {
        send: (m) => {
          sent.push(m)
          if (m.t === 'connectors.cmd' && answer) {
            const reply = answer(m)
            if (reply) setImmediate(() => t.ctx.hub.emit('message', machine.id, reply as never))
          }
        },
        close() {},
      },
      features,
    )
  const daemon = (msg: unknown) => t.ctx.hub.emit('message', machine.id, msg as never)
  const upload = async () => {
    const res = await api.root.post<PluginDto>('/api/admin/plugins', { files: feishuPlugin })
    expect(res.status).toBeLessThan(300)
    await api.li.put(`/api/groups/${group.id}/plugins/${res.body.id}`, { enabled: true })
    return res.body
  }
  const base = `/api/groups/${group.id}/connectors`
  const feishu = async (who: 'zhao' | 'wang' = 'zhao') =>
    (await api[who].get<ConnectorList>(base)).body.connectors.find((c) => c.manifest.name === 'feishu')!
  const events = (userId: string) => {
    const got: WebEvent[] = []
    t.ctx.bus.attach(userId, (e) => got.push(e))
    return got
  }
  const startRun = async (userId: string) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: userId, body: '@Claude 看日程', meta: {} })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        originUserId: userId,
        status: 'running',
      })
      .returning()
    return run!
  }
  const build = (run: typeof runs.$inferSelect, features = ['plugins', 'connectors']) =>
    t.db.transaction(
      async (tx) =>
        (await buildRunStart(tx, bot, run, false, new Date(), features, probesOf(t.ctx, machine.id))).msg,
    )
  const tool = async (run: typeof runs.$inferSelect, name: string, args: unknown) =>
    (
      await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${run.id}/tools/${name}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { arguments: args },
      })
    ).json<{ text: string; isError?: boolean }>()
  return {
    wang,
    li,
    zhao,
    machine,
    bot,
    group,
    api,
    sent,
    online,
    daemon,
    upload,
    base,
    feishu,
    events,
    startRun,
    build,
    tool,
    setAnswer: (f: typeof answer) => (answer = f),
  }
}

const until = async (ok: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await ok()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('timed out')
}

describe('CLI connectors', () => {
  it('sends the machine the CLI connectors enabled where its bots run, on connect and when they change', async () => {
    const w = await world()
    const plugin = await w.upload()
    w.online()
    await until(() => w.sent.some((m) => m.t === 'connectors.sync'))
    expect(w.sent.filter((m) => m.t === 'connectors.sync').at(-1)).toEqual({
      t: 'connectors.sync',
      connectors: [{ connector: 'feishu', driver: 'lark-cli', npm: '@larksuite/cli' }],
    })
    await w.api.li.put(`/api/groups/${w.group.id}/plugins/${plugin.id}`, { enabled: false })
    await until(() => {
      const last = w.sent.filter((m) => m.t === 'connectors.sync').at(-1)
      return last?.t === 'connectors.sync' && last.connectors.length === 0
    })
  })

  it('leaves old daemons on the in-chat connect', async () => {
    const w = await world()
    await w.upload()
    w.online(['plugins'])
    expect(w.sent.some((m) => m.t === 'connectors.sync')).toBe(false)
    expect(await w.feishu()).toMatchObject({ cli: null, status: 'unchecked' })
  })

  it('shows everyone the owner’s login on the bot’s machine; only the owner may connect there', async () => {
    const w = await world()
    await w.upload()
    w.online()
    w.daemon({ t: 'connectors.update', probes: [probe({ account: '王磊', feishuUserId: 'u_other' })] })

    const machine = {
      machineId: w.machine.id,
      machineName: w.machine.name,
      profile: 'default',
      state: 'ready',
      account: '王磊',
      verified: null,
      botIds: [w.bot.id],
    }
    // Whatever account the owner signed in with is the machine's: no matching against Feishu ids.
    const mine = await w.feishu('wang')
    expect(mine.cli).toEqual({
      state: 'ready',
      target: w.machine.id,
      readyBotIds: [w.bot.id],
      machines: [{ ...machine, own: true }],
    })
    expect(mine).toMatchObject({ status: 'ok', account: '王磊' })
    // Zhao uses it as is, with nowhere to connect.
    expect((await w.feishu()).cli).toEqual({
      state: 'ready',
      target: null,
      readyBotIds: [w.bot.id],
      machines: [{ ...machine, own: false }],
    })
    expect((await w.feishu()).status).toBe('ok')

    w.daemon({ t: 'connectors.update', probes: [] })
    expect((await w.feishu()).cli).toMatchObject({ state: 'not_installed', target: null })
  })

  it('connects on the machine, streaming progress and links to the owner only', async () => {
    const w = await world()
    const plugin = await w.upload()
    w.online()
    w.daemon({ t: 'connectors.update', probes: [probe({ state: 'needs_init' })] })
    const zhaoGot = w.events(w.zhao.id)
    const wangGot = w.events(w.wang.id)

    // A member cannot log in on someone else's machine.
    expect((await w.api.zhao.post(`${w.base}/${plugin.id}/cli`, { action: 'connect' })).status).toBe(409)
    const denied = await w.api.zhao.post(`${w.base}/${plugin.id}/cli`, {
      action: 'connect',
      machineId: w.machine.id,
    })
    expect(denied.status).toBe(403)

    const res = await w.api.wang.post<{ requestId: string; machineId: string }>(
      `${w.base}/${plugin.id}/cli`,
      {
        action: 'connect',
      },
    )
    expect(res.status).toBe(202)
    expect(res.body.machineId).toBe(w.machine.id)
    const { requestId } = res.body
    expect(w.sent.filter((m) => m.t === 'connectors.cmd')).toEqual([
      {
        t: 'connectors.cmd',
        requestId,
        action: 'connect',
        spec: { connector: 'feishu', driver: 'lark-cli', npm: '@larksuite/cli' },
        profile: 'default',
        domains: [],
      },
    ])
    w.daemon({ t: 'connectors.progress', requestId, stage: 'install', line: 'added 1 package' })
    w.daemon({
      t: 'connectors.auth',
      requestId,
      step: 'login',
      url: 'https://accounts.feishu.cn/oauth/device?code=SECRET',
      userCode: 'ABCD',
      expiresAt: null,
    })
    w.daemon({ t: 'connectors.result', requestId, ok: true, error: null, probe: probe({ account: '王磊' }) })
    await until(() => wangGot.some((e) => e.t === 'connector.cli.result'))
    const cliGot = wangGot.filter((e) => e.t.startsWith('connector.cli'))
    expect(cliGot.map((e) => e.t)).toEqual([
      'connector.cli.progress',
      'connector.cli.auth',
      'connector.cli.result',
    ])
    expect(cliGot[1]).toMatchObject({
      url: 'https://accounts.feishu.cn/oauth/device?code=SECRET',
      userCode: 'ABCD',
    })
    const end = cliGot[2] as Extract<WebEvent, { t: 'connector.cli.result' }>
    expect(end).toMatchObject({ ok: true, connector: { id: plugin.id } })
    expect(end.connector?.cli).toMatchObject({ state: 'ready', readyBotIds: [w.bot.id] })
    expect(zhaoGot.filter((e) => e.t.startsWith('connector.cli'))).toEqual([])
    // The link never lands in a message.
    const bodies = await t.db.select({ body: messages.body }).from(messages)
    expect(JSON.stringify(bodies)).not.toContain('SECRET')
  })

  it('detects and logs out, answering the connector', async () => {
    const w = await world()
    const plugin = await w.upload()
    w.online()
    w.setAnswer((m) => ({
      t: 'connectors.result',
      requestId: m.requestId,
      ok: true,
      error: null,
      probe: probe({ state: m.action === 'logout' ? 'needs_login' : 'ready', account: '王磊' }),
    }))
    const detected = await w.api.wang.post<ConnectorDto>(`${w.base}/${plugin.id}/cli`, { action: 'detect' })
    expect(detected.status).toBe(200)
    expect(detected.body.cli).toMatchObject({ state: 'ready' })
    const out = await w.api.wang.post<ConnectorDto>(`${w.base}/${plugin.id}/cli`, { action: 'logout' })
    expect(out.body.cli?.machines[0]).toMatchObject({ profile: 'default', state: 'needs_login' })
    expect(out.body.status).toBe('expired')
    expect(
      w.sent.filter((m) => m.t === 'connectors.cmd').map((m) => m.t === 'connectors.cmd' && m.profile),
    ).toEqual(['default', 'default'])
    expect(
      (await w.api.zhao.post(`${w.base}/${plugin.id}/cli`, { action: 'logout', machineId: w.machine.id }))
        .status,
    ).toBe(403)
  })

  it('runs the CLIs with the owner’s login whoever started the turn', async () => {
    const w = await world()
    await w.upload()
    w.online()
    w.daemon({ t: 'connectors.update', probes: [probe({ account: '王磊' })] })

    for (const who of [w.wang, w.zhao]) {
      const msg = await w.build(await w.startRun(who.id))
      expect(msg.cliProfiles).toEqual([{ driver: 'lark-cli', profile: 'default' }])
      expect(msg.bot.systemPrompt).toContain(
        '已由共工连接（以 王磊 登录）：命令行工具已安装，用的是这台电脑主人的账号',
      )
      expect(msg.hiddenTools).not.toContain('connector_request')
    }

    w.daemon({ t: 'connectors.update', probes: [probe({ state: 'needs_login' })] })
    const zhaoRun = await w.startRun(w.zhao.id)
    expect((await w.build(zhaoRun)).bot.systemPrompt).toContain(
      '由共工连接，但这台电脑的主人还没连接：需要时调用 connector_request',
    )
    const old = await w.build(zhaoRun, ['plugins'])
    expect(old.cliProfiles).toEqual([])
    expect(old.hiddenTools).toContain('connector_request')
    expect(old.bot.systemPrompt).toContain('用命令行工具登录')
  })

  it('asks the machine owner to connect in place, and carries the run on once they did', async () => {
    const w = await world()
    const plugin = await w.upload()
    w.online()
    const run = await w.startRun(w.zhao.id)
    const out = await w.tool(run, 'connector_request', { connector: 'feishu', reason: 'expired' })
    expect(out.isError).toBeFalsy()
    expect(out.text).toContain('王磊')
    const [card] = await t.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, w.group.id), eq(messages.kind, 'event')))
    expect(card!.body).toBe('Claude 请 王磊 连接飞书')
    expect((card!.meta as { connectorCard: unknown }).connectorCard).toMatchObject({
      pluginId: plugin.id,
      connector: 'feishu',
      title: '飞书',
      userId: w.wang.id,
      machineId: w.machine.id,
      reason: 'expired',
      resolved: false,
    })

    const { body } = await w.api.wang.post<{ requestId: string }>(`${w.base}/${plugin.id}/cli`, {
      action: 'connect',
      machineId: w.machine.id,
    })
    w.daemon({
      t: 'connectors.result',
      requestId: body.requestId,
      ok: true,
      error: null,
      probe: probe({ account: '王磊' }),
    })
    await until(async () => {
      const [m] = await t.db.select().from(messages).where(eq(messages.id, card!.id))
      return (m!.meta as { connectorCard: { resolved: boolean } }).connectorCard.resolved
    })
    await until(
      async () =>
        (await t.db.select().from(runs).where(eq(runs.triggerMessageId, run.triggerMessageId))).length === 2,
    )
    // Reported again: not run a second time.
    w.daemon({ t: 'connectors.update', probes: [probe({ account: '王磊' })] })
    await new Promise((r) => setTimeout(r, 50))
    expect(
      await t.db.select().from(runs).where(eq(runs.triggerMessageId, run.triggerMessageId)),
    ).toHaveLength(2)
  })

  it('reminds the owner once when the login runs out within two days; old member profiles are ignored', async () => {
    const w = await world()
    await w.upload()
    w.online()
    const soon = new Date(Date.now() + 24 * 3600_000).toISOString()
    const update = {
      t: 'connectors.update',
      probes: [
        probe({ account: '王磊', refreshExpiresAt: soon }),
        probe({ profile: `gg-${w.zhao.id}`, account: '赵敏', refreshExpiresAt: soon }),
      ],
    }
    w.daemon(update)
    w.daemon(update)
    await until(
      async () =>
        (await t.db.select().from(notifications).where(eq(notifications.userId, w.wang.id))).length > 0,
    )
    await new Promise((r) => setTimeout(r, 50))
    const got = await t.db.select().from(notifications).where(eq(notifications.userId, w.wang.id))
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ type: 'connector_expiring' })
    expect(got[0]!.payload).toMatchObject({ connectorTitle: '飞书', machineName: w.machine.name })
    expect(await t.db.select().from(notifications).where(eq(notifications.userId, w.zhao.id))).toEqual([])
  })
})
