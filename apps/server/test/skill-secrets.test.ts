import {
  type InstallDto,
  type MySecretDto,
  PROTOCOL_VERSION,
  type PublishRes,
  type RunStart,
  type SecretCard,
  type SecretDto,
  type SecretNeedDto,
  type ToolCallRes,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  groupMembers,
  messages,
  personalSecrets,
  runs,
  secretRequests,
  secrets,
  teamMembers,
} from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { runNeeds, runNeedsNote } from '../src/modules/secrets/needs.js'
import { resolveSecrets } from '../src/modules/secrets/resolve.js'
import { enabledSkills } from '../src/modules/skills/service.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

const NOW = new Date('2026-11-18T03:00:00Z')
let t: TestApp
beforeEach(async () => {
  t = await createTestApp({ now: () => NOW })
})
afterEach(() => t.close())

const DW = `secrets:
  - name: DW_KEY
    title: 数仓 Key（正式）
    description: 在 Manager 个人中心签发
    url: https://dw.example.com/keys
    mode: personal
  - name: DW_TEST_KEY
    mode: personal
    required: false
  - name: DW_SHARED
    mode: shared
`
const skill = (name: string, extra = '') => [
  {
    path: 'SKILL.md',
    content: `---\nname: ${name}\ndescription: ${name} helper\n${extra}---\nDo it.\n`,
    encoding: 'utf8',
  },
]

/** Wang owns the team and the bot's machine, Li administers the group, Zhao is a member. */
async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const group = await t.seed.group({
    createdBy: li.id,
    name: '研发群',
    memberIds: [wang.id, zhao.id],
    botIds: [bot.id],
  })
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  const api = { wang: await as(wang), li: await as(li), zhao: await as(zhao) }
  const runOf = async (user: { id: string }) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: user.id, body: '@Claude 查数', meta: {} })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        originUserId: user.id,
        status: 'running',
      })
      .returning()
    return async (name: string, args: unknown = {}) =>
      (
        await t.app.inject({
          method: 'POST',
          url: `/api/daemon/runs/${r!.id}/tools/${name}`,
          headers: { authorization: `Bearer ${token}` },
          payload: { arguments: args },
        })
      ).json<ToolCallRes>()
  }
  const needs = async (who: keyof typeof api) =>
    (await api[who].get<SecretNeedDto[]>(`/api/groups/${group.id}/secret-needs`)).body
  return { wang, li, zhao, bot, group, token, api, needs, runOf }
}

const brief = (ns: SecretNeedDto[]) => ns.map((n) => [n.spec.name, n.status, n.action])

describe('skill secret declarations', () => {
  it('reads frontmatter secrets on upload and rejects bad ones', async () => {
    const w = await world()
    const url = `/api/groups/${w.group.id}/skills`
    const bad = await w.api.li.post(url, {
      files: skill('dw', 'secrets:\n  - name: DW_KEY\n    url: http://x.example.com\n'),
    })
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ message: expect.stringContaining('SKILL.md 的 secrets 不合法') })
    expect((await w.api.li.post(url, { files: skill('dw', 'secrets: [PATH]\n') })).status).toBe(400)
    expect((await w.api.li.post(url, { files: skill('dw', DW) })).status).toBe(201)
    const [dw] = await enabledSkills(t.db, w.group.id)
    expect(dw!.secretSpecs.map((s) => [s.name, s.mode, s.required])).toEqual([
      ['DW_KEY', 'personal', true],
      ['DW_TEST_KEY', 'personal', false],
      ['DW_SHARED', 'shared', true],
    ])
  })

  it('tells each member what is missing and what they can do about it', async () => {
    const w = await world()
    await w.api.li.post(`/api/groups/${w.group.id}/skills`, { files: skill('dw', DW) })

    expect(brief(await w.needs('zhao'))).toEqual([
      ['DW_KEY', 'missing_def', null],
      ['DW_TEST_KEY', 'missing_def', null],
      ['DW_SHARED', 'missing_def', null],
    ])
    const admin = await w.needs('li')
    expect(brief(admin).map((n) => n[2])).toEqual(['create', 'create', 'create'])
    expect(admin[0]!.target).toMatchObject({ scope: 'group', groupId: w.group.id, mode: 'personal' })

    const groupUrl = `/api/groups/${w.group.id}/secrets`
    await w.api.li.post(groupUrl, { name: 'DW_KEY', mode: 'personal' })
    const shared = (await w.api.li.post<SecretDto>(groupUrl, { name: 'DW_SHARED' })).body
    expect(brief(await w.needs('zhao'))).toEqual([
      ['DW_KEY', 'unfilled', 'fill_personal'],
      ['DW_TEST_KEY', 'missing_def', null],
      ['DW_SHARED', 'unfilled', null],
    ])
    expect((await w.needs('li'))[2]).toMatchObject({ status: 'unfilled', action: 'fill_shared' })

    const key = (await w.needs('zhao'))[0]!.def!.id
    await w.api.zhao.put<MySecretDto>(`/api/me/secrets/${key}`, { value: 'zhao-dw-key-1234' })
    await w.api.li.patch(`/api/secrets/${shared.id}`, { value: 'shared-dw-5678' })
    const done = await w.needs('zhao')
    expect(brief(done)).toEqual([
      ['DW_KEY', 'ok', null],
      ['DW_TEST_KEY', 'missing_def', null],
      ['DW_SHARED', 'ok', null],
    ])
    expect(done[0]!.mine).toMatchObject({ last4: '1234', allowForeignMachines: false })

    await w.api.li.patch(`/api/secrets/${shared.id}`, { enabled: false })
    expect((await w.needs('zhao'))[2]).toMatchObject({ status: 'blocked', reason: '已停用', action: null })
    expect((await w.api.zhao.get(`/api/groups/${w.group.id}/secret-needs`)).status).toBe(200)
    const outsider = await t.seed.user({ name: '外人' })
    const out = await client(t, await t.seed.cookie(outsider.id))
    expect((await out.get(`/api/groups/${w.group.id}/secret-needs`)).status).toBe(404)
  })

  it('makes the team a per-member definition when someone fills their personal skill secret first', async () => {
    const w = await world()
    await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, w.li.id))
    const listing = (
      await w.api.wang.post<PublishRes>('/api/market', {
        teamId: w.group.teamId,
        visibility: 'team',
        files: skill('dw', DW),
      })
    ).body.listing
    await w.api.wang.post(`/api/market/${listing.id}/versions/${listing.latest.id}/submit`, {
      changelog: '首版',
    })
    await w.api.li.post(`/api/market/${listing.id}/versions/${listing.latest.id}/review`, { approve: true })
    expect(
      (await w.api.zhao.put<InstallDto>(`/api/me/installs/${listing.id}`, { enabled: true })).status,
    ).toBe(200)

    const mine = await w.needs('zhao')
    expect(brief(mine)).toEqual([
      ['DW_KEY', 'missing_def', 'fill_new'],
      ['DW_TEST_KEY', 'missing_def', 'fill_new'],
      ['DW_SHARED', 'missing_def', 'fill_new'],
    ])
    expect(mine[2]!.target).toMatchObject({ scope: 'team', teamId: w.group.teamId, mode: 'personal' })
    // Others do not have the skill.
    expect(await w.needs('li')).toEqual([])

    const url = `/api/groups/${w.group.id}/secret-needs/personal`
    expect((await w.api.li.post(url, { name: 'DW_KEY', value: 'li-dw-key-0000' })).status).toBe(409)
    expect((await w.api.zhao.post(url, { name: 'OTHER_KEY', value: 'zhao-dw-key-1234' })).status).toBe(409)
    expect((await w.api.zhao.post(url, { name: 'DW_KEY', value: 'zhao-dw-key-1234' })).status).toBe(204)

    const [def] = await t.db.select().from(secrets).where(eq(secrets.name, 'DW_KEY'))
    expect(def).toMatchObject({
      scope: 'team',
      teamId: w.group.teamId,
      mode: 'personal',
      description: '数仓 Key（正式）：在 Manager 个人中心签发',
      value: null,
    })
    const vals = await t.db
      .select()
      .from(personalSecrets)
      .where(and(eq(personalSecrets.userId, w.zhao.id), eq(personalSecrets.name, 'DW_KEY')))
    expect(vals).toHaveLength(1)
    expect((await w.needs('zhao'))[0]).toMatchObject({ status: 'ok', action: null })
  })
})

describe('run-start note', () => {
  it('names each missing required secret with what the agent should do', async () => {
    const w = await world()
    await w.api.li.post(`/api/groups/${w.group.id}/skills`, { files: skill('dw', DW) })
    const groupUrl = `/api/groups/${w.group.id}/secrets`
    await w.api.li.post(groupUrl, { name: 'DW_KEY', mode: 'personal' })
    await w.api.li.post(groupUrl, { name: 'DW_SHARED', botIds: [] })
    const key = (await w.needs('zhao'))[0]!.def!.id
    await w.api.zhao.put(`/api/me/secrets/${key}`, { value: 'zhao-dw-key-1234' })

    const ofRun = async (userId: string) => {
      const [skills, resolved] = await Promise.all([
        enabledSkills(t.db, w.group.id, userId),
        resolveSecrets(t.db, { groupId: w.group.id, botId: w.bot.id, originUserId: userId }, NOW),
      ])
      return runNeeds(skills, resolved, w.bot.id, NOW)
    }
    // Zhao's value may not go to Wang's machine; the shared one is not granted to the bot; the test key is optional.
    expect((await ofRun(w.zhao.id)).map((n) => [n.name, n.status, n.reason])).toEqual([
      ['DW_KEY', 'foreign', undefined],
      ['DW_SHARED', 'blocked', '未授权给本 Bot'],
    ])
    expect((await ofRun(w.wang.id)).map((n) => [n.name, n.status])).toEqual([
      ['DW_KEY', 'unfilled'],
      ['DW_SHARED', 'blocked'],
    ])
    const note = runNeedsNote(await ofRun(w.zhao.id))!
    expect(note).toContain('dw 需要 DW_KEY（personal）：发起人已填写，但没允许运行在他人电脑上的 Bot 使用')
    expect(note).toContain('dw 需要 DW_SHARED（shared）：密钥定义未授权给本 Bot；不要发卡')
    expect(runNeedsNote([])).toBeNull()
    const personal = runNeedsNote([
      { skill: 'dw', personal: true, name: 'DW_KEY', mode: 'personal', status: 'missing_def' },
    ])
    expect(personal).toContain('来自发起人的个人 Skill，团队还没有这个密钥；不要发卡')
  })

  it('goes into run.start as context', async () => {
    const w = await world()
    await w.api.li.post(`/api/groups/${w.group.id}/skills`, { files: skill('dw', DW) })
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
        body: '@Claude 查数',
        meta: { mentions: [w.bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const start = await box.next<RunStart>()
    const bodies = start.prompt.context.map((c) => c.body)
    expect(bodies.some((b) => b.includes('dw 需要 DW_KEY（personal）：本群还没有这个密钥定义'))).toBe(true)
  })
})

const cards = async () =>
  (await t.db.select().from(messages).where(eq(messages.kind, 'event'))).map((m) => ({
    body: m.body,
    card: (m.meta as { secretCard: SecretCard }).secretCard,
  }))

describe('secret_request for declared secrets', () => {
  it('asks the layer admins to make the definitions, then the originator for the value', async () => {
    const w = await world()
    await w.api.li.post(`/api/groups/${w.group.id}/skills`, { files: skill('dw', DW) })
    const call = await w.runOf(w.zhao)

    expect(await call('secret_request', { names: ['NOPE_TOKEN'] })).toMatchObject({ isError: true })
    const asked = await call('secret_request', { names: ['DW_KEY'] })
    expect(asked.text).toContain('请管理员按 Skill dw 的声明创建：DW_KEY')
    // Asked again before anyone acts: the same card.
    await call('secret_request', { names: ['DW_KEY'] })
    const [define] = await cards()
    expect((await cards()).length).toBe(1)
    expect(define!.body).toBe('Claude 请管理员按 Skill「dw」的声明创建密钥：DW_KEY')
    expect(define!.card).toMatchObject({
      audience: 'define',
      names: ['DW_KEY'],
      define: { skill: 'dw', layer: { scope: 'group', groupId: w.group.id }, admins: ['李建国'] },
    })
    expect(await t.db.select().from(secrets)).toEqual([])

    const url = `/api/secret-requests/${define!.card.id}`
    expect((await w.api.zhao.post(url, { values: {} })).status).toBe(403)
    expect((await w.api.li.post<SecretCard>(url, { values: {} })).body).toMatchObject({ filled: true })
    expect((await w.api.li.post(url, { values: {} })).status).toBe(409)
    const [def] = await t.db.select().from(secrets)
    expect(def).toMatchObject({
      scope: 'group',
      groupId: w.group.id,
      name: 'DW_KEY',
      mode: 'personal',
      description: '数仓 Key（正式）：在 Manager 个人中心签发',
    })
    const fill = (await cards())[1]!
    expect(fill.body).toBe('Claude 请 赵敏 填写自己的密钥：DW_KEY')
    expect(fill.card).toMatchObject({ audience: 'origin', defs: { DW_KEY: def!.id } })
  })

  it('does not ask again for a value the originator already filled in the team', async () => {
    const w = await world()
    await w.api.li.post(`/api/groups/${w.group.id}/skills`, { files: skill('dw', DW) })
    // Wang's own value from another group of the team; the bot runs on his machine.
    await t.db.insert(personalSecrets).values({
      userId: w.wang.id,
      teamId: w.group.teamId,
      name: 'DW_KEY',
      value: seal('wang-dw-key-1234'),
      last4: '1234',
    })
    const call = await w.runOf(w.wang)
    await call('secret_request', { names: ['DW_KEY'] })
    const [define] = await cards()
    await w.api.li.post(`/api/secret-requests/${define!.card.id}`, { values: {} })
    expect((await cards()).length).toBe(1)
    expect((await w.needs('wang'))[0]).toMatchObject({ status: 'ok', action: null })
  })

  it('lets a define card go stale when the skill changes or the name appears meanwhile', async () => {
    const w = await world()
    const made = await w.api.li.post<{ id: string }>(`/api/groups/${w.group.id}/skills`, {
      files: skill('dw', DW),
    })
    const call = await w.runOf(w.zhao)
    await call('secret_request', { names: ['DW_KEY'] })
    await call('secret_request', { names: ['DW_SHARED'] })
    const [first, second] = await cards()
    expect(second!.card.id).not.toBe(first!.card.id)

    await w.api.li.post(`/api/groups/${w.group.id}/secrets`, { name: 'DW_SHARED' })
    const stale = await w.api.li.post(`/api/secret-requests/${second!.card.id}`, { values: {} })
    expect([stale.status, stale.body]).toEqual([
      409,
      expect.objectContaining({ message: expect.stringContaining('期间已出现同名密钥 DW_SHARED') }),
    ])

    await w.api.li.patch(`/api/groups/${w.group.id}/skills/${made.body.id}`, {
      files: skill('dw', `${DW}# v2\n`),
    })
    const upgraded = await w.api.li.post(`/api/secret-requests/${first!.card.id}`, { values: {} })
    expect(upgraded.status).toBe(409)
    expect(upgraded.body).toMatchObject({ message: expect.stringContaining('Skill dw 已升级或移除') })
  })

  it('refuses names of personal and platform skills with where they get filled', async () => {
    const w = await world()
    const root = await t.seed.user({ name: '根', role: 'sysadmin' })
    const sys = await client(t, await t.seed.cookie(root.id))
    await sys.post('/api/admin/skills', { files: skill('dw', DW) })
    const call = await w.runOf(w.zhao)
    const r = await call('secret_request', { names: ['DW_KEY'] })
    expect(r).toMatchObject({ isError: true })
    expect(JSON.stringify(r)).toContain('请平台管理员在设置里添加')
  })
})

describe('fill cards bound to a definition', () => {
  it('refuses a card whose definition was deleted and made again, and cards from before binding', async () => {
    const w = await world()
    const groupUrl = `/api/groups/${w.group.id}/secrets`
    const first = (await w.api.li.post<SecretDto>(groupUrl, { name: 'JIRA_TOKEN', mode: 'personal' })).body
    const call = await w.runOf(w.zhao)
    await call('secret_request', { names: ['JIRA_TOKEN'] })
    const [ask] = await cards()
    expect(ask!.card.defs).toEqual({ JIRA_TOKEN: first.id })

    await w.api.li.del(`/api/secrets/${first.id}`)
    await w.api.li.post(groupUrl, { name: 'JIRA_TOKEN', mode: 'personal' })
    const url = `/api/secret-requests/${ask!.card.id}`
    const res = await w.api.zhao.post(url, { values: { JIRA_TOKEN: 'zhao-jira-value' } })
    expect([res.status, res.body]).toEqual([
      409,
      expect.objectContaining({ message: '密钥 JIRA_TOKEN 的定义已变更，请让 Bot 重新申请' }),
    ])
    expect(await t.db.select().from(personalSecrets)).toEqual([])
    const [req] = await t.db.select().from(secretRequests)
    expect(req!.filledAt).toBeNull()

    // A card posted before definitions were bound.
    const [m] = await t.db.select().from(messages).where(eq(messages.id, req!.messageId!))
    const meta = m!.meta as { secretCard: SecretCard }
    const { defs: _, ...old } = meta.secretCard
    await t.db
      .update(messages)
      .set({ meta: { ...meta, secretCard: old } })
      .where(eq(messages.id, m!.id))
    const legacy = await w.api.zhao.post(url, { values: { JIRA_TOKEN: 'zhao-jira-value' } })
    expect(legacy.body).toMatchObject({ message: expect.stringContaining('还没有绑定密钥定义') })
  })

  it('refuses members who left the group', async () => {
    const w = await world()
    await w.api.li.post(`/api/groups/${w.group.id}/secrets`, { name: 'JIRA_TOKEN', mode: 'personal' })
    const call = await w.runOf(w.zhao)
    await call('secret_request', { names: ['JIRA_TOKEN'] })
    const [ask] = await cards()
    await t.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, w.group.id), eq(groupMembers.userId, w.zhao.id)))
    const res = await w.api.zhao.post(`/api/secret-requests/${ask!.card.id}`, {
      values: { JIRA_TOKEN: 'zhao-jira-value' },
    })
    expect(res.status).toBe(404)
  })
})
