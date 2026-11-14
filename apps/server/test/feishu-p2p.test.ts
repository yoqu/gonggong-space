import type { GroupDto, MessageDto } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  botShares,
  bots,
  feishuChats,
  feishuIdentities,
  groupBots,
  groups,
  messages,
  runs,
  systemParams,
} from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { feishuIdle } from '../src/modules/feishu/mirror.js'
import { createTestApp, type TestApp } from './support/app.js'
import type { FakeUser } from './support/feishu.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const BOT_APP = 'cli_bot1'
const P2P = 'oc_p2p1'
const BASE = 'https://gg.example.com'

/** Main app, a bot with its own app, its owner linked to Feishu; no 共工 DM yet. */
async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const { machine } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
  // A DM opened from Feishu uses the owner's default directory, as one opened on the web.
  await t.db.update(bots).set({ defaultWorkspace: '/work/codex' }).where(eq(bots.id, bot.id))
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  expect((await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })).status).toBe(
    200,
  )
  await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
  forgetSysParams(t.db)
  const ownerFs = await link(owner.id)
  return { owner, bot, ownerHttp, ownerFs }
}

async function link(userId: string): Promise<FakeUser> {
  const fu = t.feishu.user()
  const tokens = await t.feishu.api.exchangeCode({ appId: MAIN, appSecret: 's' }, t.feishu.authorize(fu), '')
  await t.db.insert(feishuIdentities).values({
    userId,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal(tokens.accessToken),
    expiresAt: tokens.expiresAt,
  })
  return fu
}

const say = async (from: FakeUser, text: string, app = BOT_APP, chatId = P2P) => {
  const sent = t.feishu.message(app, { chatId, from, text, chatType: 'p2p' })
  await sent.done
  await feishuIdle(t.ctx)
  return sent.messageId
}

const dmsOf = (userId: string) =>
  t.db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.kind, 'dm'), eq(groups.createdBy, userId), isNull(groups.archivedAt)))

const lastText = () => JSON.stringify(t.feishu.sent.at(-1)?.content)

describe('飞书单聊 Bot', () => {
  it('the owner messages the bot app without @: a 共工 DM is opened, the bot runs, its card replies there', async () => {
    const { owner, bot, ownerFs, ownerHttp } = await setup()
    const first = await say(ownerFs, '修一下登录')

    const [dm] = await dmsOf(owner.id)
    expect(dm).toBeDefined()
    const [m] = await t.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, dm!.id), eq(messages.kind, 'user')))
    expect(m).toMatchObject({ authorUserId: owner.id, body: '修一下登录' })
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, m!.id))
    expect(run?.botId).toBe(bot.id)
    expect(t.feishu.sent.at(-1)).toMatchObject({
      appId: BOT_APP,
      chatId: P2P,
      msgType: 'interactive',
      replyTo: first,
    })
    const [chat] = await t.db.select().from(feishuChats).where(eq(feishuChats.chatId, P2P))
    expect(chat?.groupId).toBe(dm!.id)

    await say(ownerFs, '再看看')
    expect(await dmsOf(owner.id)).toHaveLength(1)
    expect(
      await t.db
        .select()
        .from(messages)
        .where(and(eq(messages.groupId, dm!.id), eq(messages.kind, 'user'))),
    ).toHaveLength(2)

    // A DM's single chat is not a bound Feishu group.
    const list = await ownerHttp.get<GroupDto[]>('/api/groups')
    expect(list.body.find((g) => g.id === dm!.id)?.feishu).toBeUndefined()
  })

  it('reuses the DM the user already has with the bot', async () => {
    const { owner, bot, ownerFs } = await setup()
    const dm = await t.seed.group({ createdBy: owner.id, kind: 'dm', botIds: [bot.id] })
    await say(ownerFs, 'hi')
    expect(await dmsOf(owner.id)).toEqual([{ id: dm.id }])
    expect(
      await t.db
        .select()
        .from(messages)
        .where(and(eq(messages.groupId, dm.id), eq(messages.kind, 'user'))),
    ).toHaveLength(1)
  })

  it('a user the bot is shared with gets their own DM; others are told to request a share', async () => {
    const { owner, bot } = await setup()
    const friend = await t.seed.user({ name: '李娜' })
    const friendFs = await link(friend.id)
    await say(friendFs, 'hi', BOT_APP, 'oc_p2p2')
    expect(await dmsOf(friend.id)).toEqual([])
    expect(lastText()).toContain('申请共享')

    await t.db.insert(botShares).values({ botId: bot.id, userId: friend.id, createdBy: owner.id })
    await say(friendFs, 'hi again', BOT_APP, 'oc_p2p2')
    const [dm] = await dmsOf(friend.id)
    expect(dm).toBeDefined()
    expect(await t.db.select().from(groupBots).where(eq(groupBots.groupId, dm!.id))).toMatchObject([
      { botId: bot.id },
    ])
  })

  it('an unlinked Feishu user gets the verify card; nothing is stored', async () => {
    await setup()
    await say(t.feishu.user(), 'hi', BOT_APP, 'oc_p2p3')
    expect(await t.db.select().from(messages)).toHaveLength(0)
    expect(lastText()).toContain('绑定飞书账号')
    expect(lastText()).toContain(`${BASE}/api/auth/feishu/start`)
  })

  it('web messages in the DM go to the single chat through the bot app; recalls follow', async () => {
    const { owner, ownerFs, ownerHttp } = await setup()
    await say(ownerFs, 'hi')
    const [dm] = await dmsOf(owner.id)
    t.feishu.sent.length = 0

    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${dm!.id}/messages`, {
      body: '继续',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    const mirrored = t.feishu.sent.find((s) => s.msgType === 'text')
    expect(mirrored).toMatchObject({ appId: BOT_APP, chatId: P2P, content: { text: '王磊：继续' } })
    expect(mirrored?.userToken).toBeUndefined()
    expect(t.feishu.sent.find((s) => s.msgType === 'interactive')).toMatchObject({
      appId: BOT_APP,
      replyTo: mirrored?.messageId,
    })

    await ownerHttp.post(`/api/messages/${sent.body.id}/recall`)
    await feishuIdle(t.ctx)
    expect(t.feishu.recalls).toEqual([{ appId: BOT_APP, messageId: mirrored?.messageId }])
  })
})
