import type { GroupFeishuView } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, feishuIdentities, messages } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { createTestApp, type TestApp } from './support/app.js'
import type { FakeUser } from './support/feishu.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'

async function link(userId: string): Promise<FakeUser> {
  const fu = t.feishu.user()
  await t.db.insert(feishuIdentities).values({
    userId,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal('u'),
  })
  return fu
}

/** A group with a linked owner, a linked and an unlinked member, and `appBots` bots with a Feishu app plus one without. */
async function setup(appBots = 1) {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李娜' })
  const chen = await t.seed.user({ name: '陈晨' })
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  const bots = []
  for (let i = 0; i < appBots; i++) bots.push(await t.seed.bot({ ownerId: owner.id, name: `Bot${i}` }))
  const plain = await t.seed.bot({ ownerId: owner.id, name: '无应用 Bot' })
  const group = await t.seed.group({
    createdBy: owner.id,
    name: '支付重构',
    memberIds: [li.id, chen.id],
    botIds: [...bots.map((b) => b.id), plain.id],
  })
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  for (const [i, b] of bots.entries())
    expect(
      (await ownerHttp.put(`/api/bots/${b.id}/feishu`, { appId: `cli_bot${i}`, appSecret: 's' })).status,
    ).toBe(200)
  const ownerFs = await link(owner.id)
  const liFs = await link(li.id)
  const create = () => ownerHttp.post<GroupFeishuView>(`/api/groups/${group.id}/feishu/chat`, {})
  return { owner, li, chen, group, ownerHttp, ownerFs, liFs, create }
}

describe('创建飞书群', () => {
  it('previews who can be pulled in, then creates the chat with them and binds it', async () => {
    const s = await setup()
    const before = (await s.ownerHttp.get<GroupFeishuView>(`/api/groups/${s.group.id}/feishu`)).body
    expect(before.members).toEqual([
      { userId: s.owner.id, name: '王磊', linked: true },
      { userId: s.li.id, name: '李娜', linked: true },
      { userId: s.chen.id, name: '陈晨', linked: false },
    ])
    const res = await s.create()
    expect(res.status).toBe(200)
    expect(t.feishu.chatsCreated).toEqual([
      {
        appId: MAIN,
        chatId: expect.any(String),
        name: '支付重构',
        ownerUnionId: s.ownerFs.unionId,
        unionIds: [s.liFs.unionId],
      },
    ])
    expect(t.feishu.botsAdded).toEqual([
      { appId: MAIN, chatId: t.feishu.chatsCreated[0]?.chatId, botAppId: 'cli_bot0' },
    ])
    expect(res.body.chat).toMatchObject({ chatId: t.feishu.chatsCreated[0]?.chatId, name: '支付重构' })
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'feishu.chat.create'))
    expect(audits).toHaveLength(1)
    expect((await s.create()).status).toBe(409)
  })

  it('creates the chat even when a bot cannot join, and tells the group why', async () => {
    const s = await setup(2)
    t.feishu.addBotError = 'unavailable ids: [cli_bot0]'
    t.feishu.addBotErrorCode = 232043
    const res = await s.create()
    expect(res.status).toBe(200)
    expect(res.body.chat?.chatId).toBe(t.feishu.chatsCreated[0]?.chatId)
    expect(res.body.bots.filter((b) => b.appId).map((b) => b.issue?.code)).toEqual([232043, 232043])
    const events = (await t.db.select().from(messages).where(eq(messages.groupId, s.group.id))).filter((m) =>
      m.body.includes('没能自动拉入飞书群'),
    )
    expect(events.map((e) => e.body).sort()).toEqual(
      ['Bot0', 'Bot1'].map(
        (n) =>
          `${n} 没能自动拉入飞书群：飞书应用还没发布，或相关成员不在它的可用范围内。请应用管理员在飞书开放平台发布应用版本，并在飞书管理后台把可用范围设为需要的成员。`,
      ),
    )
  })

  it('needs my linked Feishu account and explains a missing scope', async () => {
    const s = await setup()
    const liHttp = client(t, await t.seed.cookie(s.li.id))
    expect((await liHttp.post(`/api/groups/${s.group.id}/feishu/chat`, {})).status).toBe(403)
    await t.db.delete(feishuIdentities).where(eq(feishuIdentities.userId, s.owner.id))
    expect((await s.create()).body).toMatchObject({ message: '请先在个人设置中绑定飞书账号' })
    await link(s.owner.id)
    t.feishu.createChatError = 99991672
    const res = await s.create()
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ message: expect.stringContaining('im:chat:create') })
  })
})
