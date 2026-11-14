import type { FeishuChatChoicesDto, GroupFromFeishuDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, feishuChats, feishuIdentities, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const BOT_APP = 'cli_bot1'
const CHAT = 'oc_chat1'

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

/** CHAT has me, a linked teammate, a linked outsider, an unlinked user and my bot's app; the main app is in it. */
async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const me = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李娜' })
  const outsider = await t.seed.user({ name: '外人', teamId: null })
  const bot = await t.seed.bot({ ownerId: me.id, name: 'codex' })
  const http = client(t, await t.seed.cookie(me.id))
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  expect((await http.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })).status).toBe(200)
  const mine = await link(me.id)
  t.feishu.chats.set(MAIN, [
    { chatId: CHAT, name: '研发群', avatar: null },
    { chatId: 'oc_other', name: '别的团队群', avatar: null },
  ])
  t.feishu.chats.set(BOT_APP, [{ chatId: CHAT, name: '研发群', avatar: null }])
  t.feishu.members.set(CHAT, [mine, await link(li.id), await link(outsider.id), 'on_unlinked'])
  t.feishu.members.set('oc_other', ['on_unlinked'])
  return { me, li, bot, http }
}

describe('从飞书群创建群', () => {
  it('lists only chats I am in, then creates the group bound to it with its users and bots', async () => {
    const s = await setup()
    const choices = await s.http.get<FeishuChatChoicesDto>('/api/feishu/chats')
    expect(choices.body).toEqual({
      available: true,
      mainAppName: null,
      chats: [{ chatId: CHAT, name: '研发群' }],
    })

    const res = await s.http.post<GroupFromFeishuDto>('/api/groups/from-feishu', {
      chatId: CHAT,
      name: '研发',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ added: 1, skippedUnlinked: 1, skippedNotInTeam: 1 })
    expect(res.body.group).toMatchObject({ name: '研发', kind: 'group', botIds: [s.bot.id] })
    expect(res.body.group.members.map((m) => [m.name, m.isAdmin])).toEqual([
      ['王磊', true],
      ['李娜', false],
    ])
    expect(res.body.group.feishu).toMatchObject({ chatId: CHAT })
    const [bound] = await t.db.select().from(feishuChats).where(eq(feishuChats.chatId, CHAT))
    expect(bound?.groupId).toBe(res.body.group.id)
    expect(
      await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'feishu.chat.create_group')),
    ).toHaveLength(1)

    expect((await s.http.get<FeishuChatChoicesDto>('/api/feishu/chats')).body.chats).toEqual([])
    expect((await s.http.post('/api/groups/from-feishu', { chatId: CHAT, name: '再来' })).status).toBe(409)
  })

  it('refuses a chat I am not in and needs my Feishu account', async () => {
    const s = await setup()
    const notIn = await s.http.post('/api/groups/from-feishu', { chatId: 'oc_other', name: 'x' })
    expect(notIn.body).toMatchObject({ message: '你不在该飞书群中，不能关联' })
    await t.db.delete(feishuIdentities).where(eq(feishuIdentities.userId, s.me.id))
    expect((await s.http.get<FeishuChatChoicesDto>('/api/feishu/chats')).body.chats).toEqual([])
    const unlinked = await s.http.post('/api/groups/from-feishu', { chatId: CHAT, name: 'x' })
    expect(unlinked.body).toMatchObject({ message: '请先在个人设置中绑定飞书账号' })
  })
})

describe('主应用进群卡片', () => {
  it('invites an unbound chat to create its group in 共工; a bound chat gets nothing', async () => {
    const s = await setup()
    await t.db.insert(systemParams).values({ key: 'publicUrl', value: 'https://gg.example.com' })
    forgetSysParams(t.db)
    await t.feishu.botAdded(MAIN, 'oc_new', '新群')
    const [card] = t.feishu.sent.filter((m) => m.chatId === 'oc_new')
    expect(card).toMatchObject({ appId: MAIN, msgType: 'interactive' })
    expect(JSON.stringify(card?.content)).toContain('在共工创建对应群')
    expect(JSON.stringify(card?.content)).toContain('https://gg.example.com/?feishuChat=oc_new')

    await s.http.post('/api/groups/from-feishu', { chatId: CHAT, name: '研发' })
    await t.feishu.botAdded(MAIN, CHAT, '研发群')
    expect(t.feishu.sent.filter((m) => m.chatId === CHAT)).toEqual([])
    await t.feishu.botAdded(BOT_APP, 'oc_bot', 'x')
    expect(t.feishu.sent.filter((m) => m.chatId === 'oc_bot')).toEqual([])
  })
})
