import {
  DEFAULT_ONBOARDING_EXAMPLES,
  type GroupDto,
  type TeamOnboardingDto,
  type UserOnboarding,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  feishuChats,
  feishuIdentities,
  groupMembers,
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
const EXAMPLES = ['怎么申请服务器？', '帮我写周报', '报销流程是什么？']

/** Team owner 王磊, a 新手群 with bot 小助手; nothing configured yet. */
async function setup() {
  const owner = await t.seed.user({ name: '王磊', role: 'sysadmin' })
  const { machine } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: '小助手' })
  const group = await t.seed.group({ createdBy: owner.id, name: '新手群', botIds: [bot.id] })
  const [team] = (await client(t, await t.seed.cookie(owner.id)).get<{ id: string }[]>('/api/teams')).body
  const http = client(t, await t.seed.cookie(owner.id), team!.id)
  return { owner, bot, group, teamId: team!.id, http }
}

async function configure(s: Awaited<ReturnType<typeof setup>>) {
  const res = await s.http.put(`/api/teams/${s.teamId}/onboarding`, {
    groupId: s.group.id,
    botId: s.bot.id,
    examples: EXAMPLES,
  })
  expect(res.status).toBe(200)
}

async function feishuApps(s: Awaited<ReturnType<typeof setup>>, botApp = true) {
  expect((await s.http.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  if (botApp)
    expect(
      (await s.http.put(`/api/bots/${s.bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })).status,
    ).toBe(200)
  await t.db.insert(systemParams).values({ key: 'publicUrl', value: 'https://gg.example.com' })
  forgetSysParams(t.db)
}

async function link(userId: string): Promise<FakeUser> {
  const fu = t.feishu.user()
  await t.db.insert(feishuIdentities).values({
    userId,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal('tok'),
  })
  return fu
}

/** A new account outside every team, added by the owner. */
async function newcomer(s: Awaited<ReturnType<typeof setup>>, linked = false) {
  const user = await t.seed.user({ name: '李雷', teamId: null })
  const fu = linked ? await link(user.id) : null
  expect((await s.http.post(`/api/teams/${s.teamId}/members`, { account: user.account })).status).toBe(201)
  return { user, fu }
}

const inGroup = async (groupId: string, userId: string) =>
  (
    await t.db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
  ).length > 0

describe('新手群与默认助手', () => {
  it('admins set the 新手群, its bot and examples; members read them, with defaults until set', async () => {
    const s = await setup()
    const member = await t.seed.user({ name: '韩梅梅' })
    const memberHttp = client(t, await t.seed.cookie(member.id), s.teamId)

    const empty = await memberHttp.get<TeamOnboardingDto>(`/api/teams/${s.teamId}/onboarding`)
    expect(empty.body).toMatchObject({ groupId: null, botId: null, examples: DEFAULT_ONBOARDING_EXAMPLES })
    expect(empty.body.options).toBeUndefined()
    expect(
      (
        await memberHttp.put(`/api/teams/${s.teamId}/onboarding`, {
          groupId: null,
          botId: null,
          examples: EXAMPLES,
        })
      ).status,
    ).toBe(403)

    const options = (await s.http.get<TeamOnboardingDto>(`/api/teams/${s.teamId}/onboarding`)).body.options
    expect(options).toEqual([{ id: s.group.id, name: '新手群', bots: [{ id: s.bot.id, name: '小助手' }] }])

    await configure(s)
    const set = await memberHttp.get<TeamOnboardingDto>(`/api/teams/${s.teamId}/onboarding`)
    expect(set.body).toMatchObject({
      groupId: s.group.id,
      groupName: '新手群',
      botId: s.bot.id,
      botName: '小助手',
      examples: EXAMPLES,
      feishuUrl: null,
    })
  })

  it('refuses a bot outside the 新手群 and a group of another team; team params keep the setting', async () => {
    const s = await setup()
    const other = await t.seed.bot({ ownerId: s.owner.id, name: '旁观者' })
    const res = await s.http.put(`/api/teams/${s.teamId}/onboarding`, {
      groupId: s.group.id,
      botId: other.id,
      examples: EXAMPLES,
    })
    expect(res.status).toBe(400)
    const team2 = await t.seed.team({ ownerId: s.owner.id })
    const foreign = await t.seed.group({ createdBy: s.owner.id, teamId: team2.id })
    expect(
      (
        await s.http.put(`/api/teams/${s.teamId}/onboarding`, {
          groupId: foreign.id,
          botId: null,
          examples: EXAMPLES,
        })
      ).status,
    ).toBe(404)

    await configure(s)
    expect((await s.http.patch(`/api/teams/${s.teamId}`, { params: { chainMaxHops: 3 } })).status).toBe(200)
    const after = await s.http.get<TeamOnboardingDto>(`/api/teams/${s.teamId}/onboarding`)
    expect(after.body.groupId).toBe(s.group.id)
  })

  it('a new team member joins the 新手群 with a welcome event', async () => {
    const s = await setup()
    await configure(s)
    const { user } = await newcomer(s)
    expect(await inGroup(s.group.id, user.id)).toBe(true)
    const events = await t.db.select().from(messages).where(eq(messages.groupId, s.group.id))
    expect(events.map((m) => m.body)).toContain('欢迎 李雷 加入团队，有问题直接 @小助手')
  })

  it('joining through an invite also lands in the 新手群', async () => {
    const s = await setup()
    await configure(s)
    const created = await s.http.post<{ token: string }>(`/api/teams/${s.teamId}/invites`, {
      role: 'member',
      expiresInDays: 7,
      maxUses: null,
    })
    const user = await t.seed.user({ name: '李雷', teamId: null })
    const http = client(t, await t.seed.cookie(user.id))
    expect((await http.post(`/api/invites/${created.body.token}/accept`)).status).toBe(200)
    expect(await inGroup(s.group.id, user.id)).toBe(true)
  })

  it('without a 新手群 nobody is added anywhere', async () => {
    const s = await setup()
    const { user } = await newcomer(s, true)
    expect(await inGroup(s.group.id, user.id)).toBe(false)
    expect(t.feishu.sent).toHaveLength(0)
  })

  it('sends a linked newcomer a welcome card through the bot app, with examples and the Feishu chat link', async () => {
    const s = await setup()
    await feishuApps(s)
    await t.db
      .insert(feishuChats)
      .values({ groupId: s.group.id, chatId: 'oc_new', name: '新手群', boundBy: s.owner.id })
    await configure(s)
    const { fu } = await newcomer(s, true)
    await feishuIdle(t.ctx)
    const card = t.feishu.sent.find((m) => m.msgType === 'interactive' && m.chatId === fu!.unionId)
    expect(card).toMatchObject({ appId: BOT_APP, receiveIdType: 'union_id' })
    const json = JSON.stringify(card!.content)
    expect(json).toContain('欢迎加入 默认团队')
    expect(json).toContain('有问题直接在群里 @小助手')
    for (const q of EXAMPLES) expect(json).toContain(q)
    expect(json).toContain('https://applink.feishu.cn/client/chat/open?openChatId=oc_new')
    const dto = await s.http.get<TeamOnboardingDto>(`/api/teams/${s.teamId}/onboarding`)
    expect(dto.body.feishuUrl).toBe('https://applink.feishu.cn/client/chat/open?openChatId=oc_new')
  })

  it('falls back to the main app (DM by open_id) when the bot has no app of its own', async () => {
    const s = await setup()
    await feishuApps(s, false)
    await configure(s)
    const { fu } = await newcomer(s, true)
    const card = t.feishu.sent.find((m) => m.msgType === 'interactive')
    expect(card).toMatchObject({ appId: MAIN, chatId: fu!.openId, receiveIdType: 'open_id' })
    expect(JSON.stringify(card!.content)).toContain(EXAMPLES[0])
  })

  it('an unlinked newcomer gets no card', async () => {
    const s = await setup()
    await feishuApps(s)
    await configure(s)
    await newcomer(s)
    expect(t.feishu.sent.filter((m) => m.msgType === 'interactive')).toHaveLength(0)
  })

  it('clicking an example asks the bot in the 新手群 as the newcomer', async () => {
    const s = await setup()
    await feishuApps(s)
    await configure(s)
    const { user, fu } = await newcomer(s, true)
    const card = t.feishu.sent.find((m) => m.msgType === 'interactive' && m.chatId === fu!.unionId)!
    const value = { k: 'ask', g: s.group.id, b: s.bot.id, q: EXAMPLES[1] }
    const res = (await t.feishu.cardAction(BOT_APP, {
      messageId: card.messageId,
      chatId: 'oc_dm',
      operator: fu!,
      value,
    })) as { toast?: { type: string } }
    expect(res.toast?.type).toBe('success')
    const [asked] = await t.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, s.group.id), eq(messages.authorUserId, user.id)))
    expect(asked?.body).toBe('@小助手 帮我写周报')
    expect((asked!.meta as { mentions: string[] }).mentions).toEqual([s.bot.id])
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, asked!.id))
    expect(run?.botId).toBe(s.bot.id)
  })

  it('refuses an example click from someone outside the group', async () => {
    const s = await setup()
    await feishuApps(s)
    await configure(s)
    const { fu } = await newcomer(s, true)
    const card = t.feishu.sent.find((m) => m.msgType === 'interactive')!
    await t.db.delete(groupMembers).where(eq(groupMembers.groupId, s.group.id))
    const res = (await t.feishu.cardAction(BOT_APP, {
      messageId: card.messageId,
      chatId: 'oc_dm',
      operator: fu!,
      value: { k: 'ask', g: s.group.id, b: s.bot.id, q: 'x' },
    })) as { toast?: { type: string } }
    expect(res.toast?.type).toBe('error')
  })
})

describe('首次登录引导进度', () => {
  it('starts unseen and records done or skipped with a time', async () => {
    const s = await setup()
    const user = await t.seed.user()
    const http = client(t, await t.seed.cookie(user.id))
    expect((await http.get<UserOnboarding>('/api/me/onboarding')).body).toEqual({})
    const saved = await http.patch<UserOnboarding>('/api/me/onboarding', { guide: 'skipped' })
    expect(saved.status).toBe(200)
    expect(saved.body.guide).toBe('skipped')
    expect(typeof saved.body.at).toBe('string')
    expect((await http.get<UserOnboarding>('/api/me/onboarding')).body.guide).toBe('skipped')
    expect((await http.patch('/api/me/onboarding', { guide: 'later' })).status).toBe(400)
    expect((await s.http.get<UserOnboarding>('/api/me/onboarding')).body).toEqual({})
  })

  it('the group a newcomer was added to shows in their group list', async () => {
    const s = await setup()
    await configure(s)
    const { user } = await newcomer(s)
    const groups = await client(t, await t.seed.cookie(user.id), s.teamId).get<GroupDto[]>('/api/groups')
    expect(groups.body.map((g) => g.name)).toContain('新手群')
  })
})
