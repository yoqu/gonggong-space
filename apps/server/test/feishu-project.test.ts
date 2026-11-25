import type { FeishuProjectChatDto, GroupDto, SidebarSectionDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, feishuChats, feishuIdentities, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { inviteDelay, settleInvites } from '../src/modules/feishu/invite.js'
import { integrationTokens } from '../src/modules/integrations/tokens.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const BOT_APP = 'cli_bot1'
const CHAT = 'oc_req1'
const TOKEN = 'fp-token-for-tests-0123456789'
const URL_ = '/api/integrations/feishu-project/chats'
const body = (o: Record<string, unknown> = {}) => ({
  feishuChatId: CHAT,
  section: '需求迭代开发',
  workItem: { id: 123, name: '登录改版', url: 'https://project.feishu.cn/x/story/detail/123' },
  ...o,
})

const call = (payload: unknown, token = TOKEN) =>
  t.app
    .inject({
      method: 'POST',
      url: URL_,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as object,
    })
    .then((r) => ({ status: r.statusCode, body: r.json() as FeishuProjectChatDto & { error?: string } }))

async function link(userId: string) {
  const fu = t.feishu.user()
  await t.db.insert(feishuIdentities).values({
    userId,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal('u'),
  })
  return fu.unionId
}

/** CHAT (owned by 李娜) has the team owner, 李娜, an unlinked user, the main app and the team bot's app. */
async function setup() {
  const sys = await t.seed.user({ role: 'sysadmin' })
  const li = await t.seed.user({ name: '李娜' })
  const zhao = await t.seed.user({ name: '赵六' })
  const bot = await t.seed.bot({ ownerId: zhao.id, name: 'codex' })
  const adminHttp = client(t, await t.seed.cookie(sys.id))
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  expect(
    (
      await client(t, await t.seed.cookie(zhao.id)).put(`/api/bots/${bot.id}/feishu`, {
        appId: BOT_APP,
        appSecret: 's',
      })
    ).status,
  ).toBe(200)
  const liUnion = await link(li.id)
  const teamId = bot.teamId
  t.ctx.config.feishuProjectTokens = integrationTokens(`${teamId}:${TOKEN}`)
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '登录改版需求群', avatar: null, ownerUnionId: liUnion }])
  t.feishu.chats.set(BOT_APP, [{ chatId: CHAT, name: '登录改版需求群', avatar: null }])
  t.feishu.members.set(CHAT, [await link(sys.id), liUnion, 'on_unlinked'])
  return { sys, li, zhao, bot, teamId, liHttp: client(t, await t.seed.cookie(li.id)) }
}

describe('飞书项目 · 需求群建群接口', () => {
  it('creates the group bound to the chat with its linked members and bots, owned by the chat owner; then is idempotent', async () => {
    const s = await setup()
    const res = await call(body())
    expect(res.status).toBe(200)
    expect(res.body.created).toBe(true)
    const group = (await s.liHttp.get<GroupDto>(`/api/groups/${res.body.groupId}`)).body
    expect(group).toMatchObject({ name: '登录改版需求群', botIds: [s.bot.id], feishu: { chatId: CHAT } })
    expect(group.notice).toBe('需求：登录改版\nhttps://project.feishu.cn/x/story/detail/123')
    expect(group.members.map((m) => [m.name, m.isAdmin]).sort()).toEqual(
      [
        ['李娜', true],
        ['赵六', false],
        [s.sys.name, false],
      ].sort(),
    )
    expect(
      await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'feishu.project.create_group')),
    ).toHaveLength(1)

    const again = await call(body())
    expect(again).toEqual({ status: 200, body: { groupId: res.body.groupId, created: false } })
    expect(await t.db.select().from(feishuChats).where(eq(feishuChats.chatId, CHAT))).toHaveLength(1)
  })

  it('falls back to the team owner when the chat owner is not in 共工', async () => {
    const s = await setup()
    t.feishu.chats.set(MAIN, [
      { chatId: CHAT, name: '登录改版需求群', avatar: null, ownerUnionId: 'on_stranger' },
    ])
    const res = await call(body())
    expect(res.status).toBe(200)
    const [bound] = await t.db.select().from(feishuChats).where(eq(feishuChats.chatId, CHAT))
    expect(bound?.boundBy).toBe(s.sys.id)
  })

  it('refuses a missing or wrong token and a bad body', async () => {
    await setup()
    expect((await call(body(), 'nope-nope-nope-nope-nope-nope')).status).toBe(401)
    const none = await t.app.inject({ method: 'POST', url: URL_, payload: body() })
    expect(none.statusCode).toBe(401)
    expect((await call({ feishuChatId: CHAT })).status).toBe(400)
  })

  it('answers 409 while the main app is not in the chat, and succeeds once it is', async () => {
    await setup()
    t.feishu.chats.set(MAIN, [])
    expect((await call(body())).status).toBe(409)
    t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '登录改版需求群', avatar: null }])
    expect((await call(body())).body.created).toBe(true)
  })

  it('keeps teams apart: a chat bound in another team is refused, and the token only creates in its team', async () => {
    const s = await setup()
    const other = await t.seed.user({ name: '外队', teamId: null })
    const otherTeam = await t.seed.team({ ownerId: other.id })
    t.ctx.config.feishuProjectTokens = integrationTokens(`${s.teamId}:${TOKEN},${otherTeam.id}:${TOKEN}x`)
    await link(other.id)
    const res = await call(body(), `${TOKEN}x`)
    expect(res.status).toBe(200)
    const [g] = await t.db.select().from(feishuChats).where(eq(feishuChats.chatId, CHAT))
    expect(g?.boundBy).toBe(other.id)
    expect((await call(body())).status).toBe(403)
  })
})

describe('需求群默认分区', () => {
  it('files the group under each member’s own section of that name until they move it', async () => {
    const s = await setup()
    const liEvents = events(t, s.li.id)
    const { groupId } = (await call(body())).body
    const sections = (await s.liHttp.get<SidebarSectionDto[]>('/api/sidebar-sections')).body
    expect(sections.map((x) => x.name)).toEqual(['需求迭代开发'])
    expect((await s.liHttp.get<GroupDto>(`/api/groups/${groupId}`)).body.sectionId).toBe(sections[0]!.id)
    expect(liEvents.some((e) => e.t === 'sections.changed')).toBe(true)

    // A second requirement group lands in the same section, not a new one.
    t.feishu.chats.set(MAIN, [
      ...(t.feishu.chats.get(MAIN) ?? []),
      { chatId: 'oc_req2', name: '第二个需求', avatar: null },
    ])
    t.feishu.members.set('oc_req2', t.feishu.members.get(CHAT) ?? [])
    const second = (await call(body({ feishuChatId: 'oc_req2' }))).body
    expect((await s.liHttp.get<SidebarSectionDto[]>('/api/sidebar-sections')).body).toHaveLength(1)
    expect((await s.liHttp.get<GroupDto>(`/api/groups/${second.groupId}`)).body.sectionId).toBe(
      sections[0]!.id,
    )

    // Moved back to the default list by hand: it stays there on the next push.
    await s.liHttp.put(`/api/groups/${groupId}/prefs`, { sectionId: null })
    await call(body())
    expect((await s.liHttp.get<GroupDto>(`/api/groups/${groupId}`)).body.sectionId).toBeNull()
  })

  it('deleting the section does not bring it back', async () => {
    const s = await setup()
    const { groupId } = (await call(body())).body
    const [sec] = (await s.liHttp.get<SidebarSectionDto[]>('/api/sidebar-sections')).body
    expect((await s.liHttp.del(`/api/sidebar-sections/${sec!.id}`)).status).toBe(204)
    await call(body())
    expect((await s.liHttp.get<SidebarSectionDto[]>('/api/sidebar-sections')).body).toEqual([])
    expect((await s.liHttp.get<GroupDto>(`/api/groups/${groupId}`)).body.sectionId).toBeNull()
  })

  it('an already bound group gets the section on the next call', async () => {
    const s = await setup()
    const { groupId } = (await call(body({ section: undefined }))).body
    expect((await s.liHttp.get<GroupDto>(`/api/groups/${groupId}`)).body.sectionId).toBeNull()
    expect((await call(body())).body).toEqual({ groupId, created: false })
    expect((await s.liHttp.get<GroupDto>(`/api/groups/${groupId}`)).body.sectionId).not.toBeNull()
  })
})

describe('主应用进群卡片等待集成建群', () => {
  it('sends no card when the chat got bound during the delay', async () => {
    await setup()
    await t.db.insert(systemParams).values({ key: 'publicUrl', value: 'https://gg.example.com' })
    forgetSysParams(t.db)
    let open = () => {}
    inviteDelay.wait = () => new Promise<void>((r) => (open = r))
    await t.feishu.botAdded(MAIN, CHAT, '登录改版需求群')
    expect((await call(body())).status).toBe(200)
    open()
    await settleInvites()
    expect(t.feishu.sent.filter((m) => m.chatId === CHAT)).toEqual([])
  })
})
