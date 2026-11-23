import type {
  ConnectorDto,
  ConnectorList,
  MarketListingDetailDto,
  MyListingDto,
  PluginDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, machines, messages, personalSecrets, runs, secrets } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { buildRunStart } from '../src/modules/runs/scheduler.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

type Spec = { name: string; mode?: string; required?: boolean; title?: string }

/** A skill-only plugin: no code, so nothing but its secrets can hold it back. */
const plugin = (name: string, title: string, specs: Spec[], connector = true) => [
  {
    path: 'gonggong-plugin.json',
    content: JSON.stringify({
      name,
      version: '1.0.0',
      title,
      description: `${title}的说明`,
      category: connector ? 'connector' : 'tool',
      agents: ['claude'],
      minDaemon: '0.5.0',
      entry: name,
      secrets: specs,
      ...(connector && { connector: { examples: ['查一下昨天的订单量'] } }),
    }),
  },
  { path: `skills/${name}/SKILL.md`, content: `---\nname: ${name}\ndescription: ${name} helper\n---\nGo.\n` },
]

/** Li administers the group; Zhao is a member; Wang owns the bot's machine; Out is in the team but not the group. */
async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const out = await t.seed.user({ name: '路人' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  const { machine, token } = await t.seed.machine(wang.id, { daemonVersion: '0.9.0' })
  const bot = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: li.id, memberIds: [wang.id, zhao.id], botIds: [bot.id] })
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  const api = { li: await as(li), zhao: await as(zhao), out: await as(out), root: await as(root) }
  await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
  const upload = async (files: ReturnType<typeof plugin>) => {
    const res = await api.root.post<PluginDto>('/api/admin/plugins', { files })
    expect(res.status).toBeLessThan(300)
    await api.li.put(`/api/groups/${group.id}/plugins/${res.body.id}`, { enabled: true })
    return res.body
  }
  const base = `/api/groups/${group.id}/connectors`
  const list = async (who: keyof typeof api = 'zhao') =>
    (await api[who].get<ConnectorList>(base)).body.connectors
  /** A run Zhao started, and a gonggong tool call from its agent. */
  const call = async (name: string, args: unknown) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: zhao.id, body: '@Claude 查数', meta: {} })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        originUserId: zhao.id,
        status: 'running',
      })
      .returning()
    return (
      await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${r!.id}/tools/${name}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { arguments: args },
      })
    ).json<{ text: string; isError?: boolean }>()
  }
  return { wang, li, zhao, bot, group, api, upload, base, list, call }
}

const brief = (c: ConnectorDto) => ({
  name: c.manifest.name,
  personal: c.personal,
  connected: c.connected,
  missing: c.missing,
  sharedWith: c.sharedWith,
})

describe('connectors', () => {
  it('lists the group connectors with the caller’s connection, and only to members', async () => {
    const w = await world()
    await w.upload(plugin('dw', '数仓', [{ name: 'DW_KEY', mode: 'personal' }]))
    await w.upload(plugin('modao', '墨刀', [{ name: 'MODAO_TOKEN' }]))
    await w.upload(plugin('dw-report', '数仓日报', [{ name: 'DW_KEY', mode: 'personal' }], false))
    await w.api.li.post(`/api/groups/${w.group.id}/skills`, {
      files: [
        {
          path: 'SKILL.md',
          content:
            '---\nname: dw-query\ndescription: q\nsecrets:\n  - name: DW_KEY\n    mode: personal\n---\nGo.\n',
          encoding: 'utf8',
        },
      ],
    })

    expect((await w.list()).map(brief)).toEqual([
      {
        name: 'dw',
        personal: true,
        connected: false,
        missing: ['DW_KEY'],
        sharedWith: ['数仓日报', 'dw-query'],
      },
      { name: 'modao', personal: false, connected: false, missing: [], sharedWith: [] },
    ])
    await w.api.root.post('/api/admin/secrets', { name: 'MODAO_TOKEN', value: 'modao-secret-1' })
    expect((await w.list()).find((c) => c.manifest.name === 'modao')).toMatchObject({ connected: true })
    expect((await w.api.out.get(w.base)).status).toBe(404)
    await saveSysParams(t.ctx, { pluginsEnabled: false }, w.li.id)
    expect(await w.list()).toEqual([])
  })

  it('connects with the caller’s own values usable on others’ machines, then disconnects with an audit', async () => {
    const w = await world()
    const dw = await w.upload(
      plugin('dw', '数仓', [
        { name: 'DW_KEY', mode: 'personal' },
        { name: 'DW_TEST_KEY', mode: 'personal', required: false },
      ]),
    )
    const url = `${w.base}/${dw.id}/connect`
    expect((await w.api.zhao.post(url, { values: { OTHER_KEY: 'x-value-1' } })).status).toBe(400)
    expect((await w.api.out.post(url, { values: { DW_KEY: 'dw-zhao-1' } })).status).toBe(404)

    const done = await w.api.zhao.post<ConnectorDto>(url, { values: { DW_KEY: 'dw-zhao-1' } })
    expect(done.status).toBe(200)
    expect(brief(done.body)).toMatchObject({ connected: true, missing: [] })
    const [def] = await t.db.select().from(secrets).where(eq(secrets.name, 'DW_KEY'))
    expect(def).toMatchObject({ scope: 'team', teamId: w.group.teamId, mode: 'personal' })
    const [mine] = await t.db.select().from(personalSecrets).where(eq(personalSecrets.userId, w.zhao.id))
    expect(mine).toMatchObject({ name: 'DW_KEY', allowForeignMachines: true })
    // A second member connects their own account against the definition the first one made.
    expect((await w.list('li'))[0]).toMatchObject({ connected: false, missing: ['DW_KEY'] })
    await w.api.li.post(url, { values: { DW_KEY: 'dw-li-1' } })
    expect((await w.list('li'))[0]).toMatchObject({ connected: true })

    const gone = await w.api.zhao.del<ConnectorDto>(`${w.base}/${dw.id}/connection`)
    expect(gone.status).toBe(200)
    expect(brief(gone.body)).toMatchObject({ connected: false, missing: ['DW_KEY'] })
    expect(await t.db.select().from(personalSecrets).where(eq(personalSecrets.userId, w.zhao.id))).toEqual([])
    expect((await w.list('li'))[0]).toMatchObject({ connected: true })
    const cleared = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'secret.clear'), eq(auditLogs.actorUserId, w.zhao.id)))
    expect(cleared.map((a) => a.detail)).toEqual([
      expect.objectContaining({ name: 'DW_KEY', connector: 'dw' }),
    ])
  })

  it('refuses personal values for a shared connector: a team admin fills it', async () => {
    const w = await world()
    const modao = await w.upload(plugin('modao', '墨刀', [{ name: 'MODAO_TOKEN' }]))
    const res = await w.api.zhao.post(`${w.base}/${modao.id}/connect`, {
      values: { MODAO_TOKEN: 'mine-1234' },
    })
    expect(res.status).toBe(400)
    expect(await t.db.select().from(personalSecrets)).toEqual([])
  })

  it('tells the run’s agent about connectors held back only for want of the originator’s connection', async () => {
    const w = await world()
    const dw = await w.upload(plugin('dw', '数仓', [{ name: 'DW_KEY', mode: 'personal' }]))
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: w.group.id, kind: 'user', authorUserId: w.zhao.id, body: '@Claude 查数', meta: {} })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: w.group.id,
        botId: w.bot.id,
        triggerMessageId: m!.id,
        originUserId: w.zhao.id,
        status: 'running',
      })
      .returning()
    await t.db.update(machines).set({ daemonVersion: '0.9.0' })
    const build = () =>
      t.db.transaction(
        async (tx) => (await buildRunStart(tx, w.bot, run!, false, new Date(), ['plugins'])).msg,
      )

    const before = await build()
    expect(before.plugins).toEqual([])
    expect(before.bot.systemPrompt).toContain('未连接的连接器')
    expect(before.bot.systemPrompt).toContain('数仓（dw）')
    expect(before.bot.systemPrompt).toContain('DW_KEY')
    expect(before.bot.systemPrompt).toContain('secret_request')

    await w.api.zhao.post(`${w.base}/${dw.id}/connect`, { values: { DW_KEY: 'dw-zhao-1' } })
    const after = await build()
    expect(after.plugins.map((p) => p.name)).toEqual(['dw'])
    expect(after.bot.systemPrompt).not.toContain('未连接的连接器')
    expect(after.bot.systemPrompt).toContain('已连接的连接器')
    expect(after.bot.systemPrompt).toContain('Claude、CodeBuddy 用 dw:dw')
  })

  it('lets the agent ask the originator to connect a personal connector the team has no definition for yet', async () => {
    const w = await world()
    await w.upload(plugin('dw', '数仓', [{ name: 'DW_KEY', mode: 'personal' }]))
    await w.upload(plugin('modao', '墨刀', [{ name: 'MODAO_TOKEN' }]))

    const asked = await w.call('secret_request', { names: ['DW_KEY'] })
    expect(asked.isError, asked.text).toBeFalsy()
    expect(asked.text).toContain('请发起人填写：DW_KEY')
    const [def] = await t.db.select().from(secrets).where(eq(secrets.name, 'DW_KEY'))
    expect(def).toMatchObject({ scope: 'team', teamId: w.group.teamId, mode: 'personal' })
    const card = (await t.db.select().from(messages).where(eq(messages.kind, 'event'))).map(
      (m) => (m.meta as { secretCard?: { audience: string; names: string[] } }).secretCard,
    )
    expect(card).toEqual([expect.objectContaining({ audience: 'origin', names: ['DW_KEY'] })])
    // Filling the card connects as the 连接器 dialog does: usable by the group's bots wherever they run.
    const id = (card[0] as unknown as { id: string }).id
    expect(
      (await w.api.zhao.post(`/api/secret-requests/${id}`, { values: { DW_KEY: 'dw-zhao-1' } })).status,
    ).toBe(200)
    expect((await w.list())[0]).toMatchObject({ connected: true, missing: [] })
    // Asked again once it is there: no empty card.
    expect((await w.call('secret_request', { names: ['DW_KEY'] })).text).toContain('本轮已可用')

    const shared = await w.call('secret_request', { names: ['MODAO_TOKEN'] })
    expect(shared).toMatchObject({ isError: true })
    expect(shared.text).toContain('团队共享密钥')
  })

  it('shows a connector listing’s examples in its market detail', async () => {
    const w = await world()
    const files = plugin('dw', '数仓', [{ name: 'DW_KEY', mode: 'personal' }]).map((f) => ({
      ...f,
      encoding: 'utf8',
    }))
    const made = await w.api.zhao.post<{ listing: MyListingDto }>('/api/market', {
      teamId: w.group.teamId,
      visibility: 'team',
      files,
    })
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    const detail = await w.api.zhao.get<MarketListingDetailDto>(`/api/market/${made.body.listing.id}`)
    expect(detail.body.connector).toEqual({ examples: ['查一下昨天的订单量'] })
  })
})
