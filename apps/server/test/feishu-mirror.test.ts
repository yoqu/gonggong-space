import type { GroupFeishuView, MessageDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approvals,
  feishuIdentities,
  feishuMessageLinks,
  messages,
  questionSets,
  runs,
  systemParams,
} from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { onApprovalRequest } from '../src/modules/approvals/service.js'
import { feishuIdle, mirrorDelta } from '../src/modules/feishu/mirror.js'
import { onQuestionAsk } from '../src/modules/questions/service.js'
import { publishRun } from '../src/modules/runs/dto.js'
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
const CHAT = 'oc_chat1'
const BASE = 'https://gg.example.com'

/** Main app, a bound bot with its own app in a group bound to CHAT, and the owner linked to Feishu. */
async function setup(o: { bind?: boolean } = {}) {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '李娜' })
  const { machine } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
  const group = await t.seed.group({ createdBy: owner.id, memberIds: [member.id], botIds: [bot.id] })
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  t.feishu.chats.set(BOT_APP, [{ chatId: CHAT, name: '研发群', avatar: null }])
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  expect((await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })).status).toBe(
    200,
  )
  await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
  if (o.bind !== false)
    expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(200)
  const ownerFs = await link(owner.id)
  return { owner, member, bot, group, machine, ownerHttp, ownerFs }
}

/** Links a 共工 user to a fresh Feishu user with a valid main-app token. */
async function link(userId: string): Promise<FakeUser> {
  const fu = t.feishu.user()
  const tokens = await t.feishu.api.exchangeCode({ appId: MAIN, appSecret: 's' }, t.feishu.authorize(fu), '')
  await t.db.insert(feishuIdentities).values({
    userId,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal(tokens.accessToken),
    refreshToken: tokens.refreshToken && seal(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  })
  return fu
}

const lastSent = () => t.feishu.sent.at(-1)

async function setRun(runId: string, values: Partial<typeof runs.$inferInsert>) {
  const [run] = await t.db.update(runs).set(values).where(eq(runs.id, runId)).returning()
  await publishRun(t.ctx, run!)
  await feishuIdle(t.ctx)
}

describe('群设置 · 飞书 binding', () => {
  it('a group admin picks one of the main app chats; bots show whether their app is in it', async () => {
    const { ownerHttp, group, bot } = await setup({ bind: false })
    const before = await ownerHttp.get<GroupFeishuView>(`/api/groups/${group.id}/feishu`)
    expect(before.body).toMatchObject({
      available: true,
      chat: null,
      chats: [{ chatId: CHAT, name: '研发群' }],
    })

    const bound = await ownerHttp.put<GroupFeishuView>(`/api/groups/${group.id}/feishu`, { chatId: CHAT })
    expect(bound.body.chat).toMatchObject({ chatId: CHAT, name: '研发群' })
    expect(bound.body.bots).toEqual([{ botId: bot.id, name: 'codex', appId: BOT_APP, inChat: true }])

    expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(409)
    expect((await ownerHttp.del(`/api/groups/${group.id}/feishu`)).status).toBe(204)
    expect((await ownerHttp.get<GroupFeishuView>(`/api/groups/${group.id}/feishu`)).body.chat).toBeNull()
  })

  it('refuses non-admins, chats the main app is not in, and a chat bound to another group', async () => {
    const { ownerHttp, member, owner, group } = await setup({ bind: false })
    const memberHttp = client(t, await t.seed.cookie(member.id))
    expect((await memberHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(403)
    expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: 'oc_other' })).status).toBe(400)

    const other = await t.seed.group({ createdBy: owner.id })
    await ownerHttp.put(`/api/groups/${other.id}/feishu`, { chatId: CHAT })
    const view = await ownerHttp.get<GroupFeishuView>(`/api/groups/${group.id}/feishu`)
    expect(view.body.chats).toEqual([])
    expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(409)
  })

  it('adds a bot app missing from the chat through the main app', async () => {
    const { ownerHttp, group, bot } = await setup()
    t.feishu.chats.set(BOT_APP, [])
    const view = await ownerHttp.get<GroupFeishuView>(`/api/groups/${group.id}/feishu`)
    expect(view.body.bots[0]?.inChat).toBe(false)
    // Feishu's chat list lags behind the add: the response must not wait for it.
    const added = await ownerHttp.post<GroupFeishuView>(`/api/groups/${group.id}/feishu/bots/${bot.id}`)
    expect(added.status).toBe(200)
    expect(added.body.bots[0]?.inChat).toBe(true)
    expect(t.feishu.botsAdded).toEqual([{ appId: MAIN, chatId: CHAT, botAppId: BOT_APP }])
  })

  it('is unavailable until the main app is configured', async () => {
    const owner = await t.seed.user()
    const group = await t.seed.group({ createdBy: owner.id })
    const http = client(t, await t.seed.cookie(owner.id))
    expect((await http.get<GroupFeishuView>(`/api/groups/${group.id}/feishu`)).body).toEqual({
      available: false,
      chat: null,
      chats: [],
      bots: [],
    })
  })
})

describe('飞书 → 共工', () => {
  it('an @ from a linked member is stored as theirs and runs the bot; the run card replies to it', async () => {
    const { owner, bot, ownerFs, group } = await setup()
    const at = [{ key: '@_user_1', name: 'codex', openId: 'ou_bot' }]
    const { messageId, done } = t.feishu.message(BOT_APP, {
      chatId: CHAT,
      from: ownerFs,
      text: '@_user_1 修一下登录',
      mentions: at,
    })
    await done
    await feishuIdle(t.ctx)

    const [m] = await t.db.select().from(messages).where(eq(messages.groupId, group.id))
    expect(m).toMatchObject({ authorUserId: owner.id, body: '@codex 修一下登录' })
    expect(m!.meta).toMatchObject({ mentions: [bot.id] })
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, m!.id))
    expect(run?.botId).toBe(bot.id)
    expect(lastSent()).toMatchObject({
      appId: BOT_APP,
      chatId: CHAT,
      msgType: 'interactive',
      replyTo: messageId,
    })
  })

  it('reminds an unlinked Feishu user to verify, without storing or running anything', async () => {
    const { group } = await setup()
    const stranger = t.feishu.user()
    await t.feishu.message(BOT_APP, { chatId: CHAT, from: stranger, text: 'hi' }).done
    expect(await t.db.select().from(messages).where(eq(messages.groupId, group.id))).toEqual([])
    const card = JSON.stringify(lastSent()?.content)
    expect(card).toContain('认证共工账号')
    expect(card).toContain(`${BASE}/api/auth/feishu/start?next=${encodeURIComponent(`/g/${group.id}`)}`)
  })

  it('tells a linked user who is not in the group that they are not a member', async () => {
    const { group } = await setup()
    const outsider = await t.seed.user()
    const fu = await link(outsider.id)
    await t.feishu.message(BOT_APP, { chatId: CHAT, from: fu, text: 'hi' }).done
    expect(await t.db.select().from(messages).where(eq(messages.groupId, group.id))).toEqual([])
    expect(JSON.stringify(lastSent()?.content)).toContain('不是对应共工群的成员')
  })

  it('one message @-ing two bots, delivered by both apps, is stored once and runs both', async () => {
    const { owner, bot, machine, group, ownerHttp, ownerFs } = await setup()
    const bot2 = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'claude' })
    await t.db
      .insert((await import('../src/db/schema.js')).groupBots)
      .values({ groupId: group.id, botId: bot2.id })
    await ownerHttp.put(`/api/bots/${bot2.id}/feishu`, { appId: 'cli_bot2', appSecret: 's' })
    const first = t.feishu.message(BOT_APP, { chatId: CHAT, from: ownerFs, text: 'both' })
    const second = t.feishu.message('cli_bot2', {
      chatId: CHAT,
      from: ownerFs,
      text: 'both',
      messageId: first.messageId,
    })
    await Promise.all([first.done, second.done])
    await t.feishu.message('cli_bot2', {
      chatId: CHAT,
      from: ownerFs,
      text: 'both',
      messageId: first.messageId,
    }).done

    const stored = await t.db.select().from(messages).where(eq(messages.groupId, group.id))
    expect(stored).toHaveLength(1)
    expect(new Set((stored[0]!.meta as { mentions: string[] }).mentions)).toEqual(new Set([bot.id, bot2.id]))
    const started = await t.db.select().from(runs).where(eq(runs.triggerMessageId, stored[0]!.id))
    expect(started.map((r) => r.botId).sort()).toEqual([bot.id, bot2.id].sort())
  })

  it('stores images of the message as attachments', async () => {
    const { ownerFs, group } = await setup()
    t.feishu.files.set('img_1', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
    await t.feishu.emit(BOT_APP, 'im.message.receive_v1', {
      sender: { sender_id: { union_id: ownerFs.unionId, open_id: ownerFs.openId }, sender_type: 'user' },
      message: {
        message_id: 'om_post',
        create_time: '0',
        chat_id: CHAT,
        chat_type: 'group',
        message_type: 'post',
        content: JSON.stringify({
          title: '',
          content: [
            [
              { tag: 'text', text: '看图' },
              { tag: 'img', image_key: 'img_1' },
            ],
          ],
        }),
      },
    } as never)
    const [m] = await t.db.select().from(messages).where(eq(messages.groupId, group.id))
    expect(m?.body).toBe('看图')
    expect((m!.meta as { attachments: unknown[] }).attachments).toMatchObject([
      { name: 'image.png', mime: 'image/png', size: 7 },
    ])
  })

  it('ignores messages from apps and messages 共工 itself sent', async () => {
    const { group, ownerFs } = await setup()
    await t.db
      .insert(feishuMessageLinks)
      .values({ feishuMessageId: 'om_out', chatId: CHAT, appId: MAIN, direction: 'out', kind: 'message' })
    await t.feishu.message(BOT_APP, { chatId: CHAT, from: ownerFs, text: 'echo', messageId: 'om_out' }).done
    await t.feishu.emit(BOT_APP, 'im.message.receive_v1', {
      sender: { sender_id: { open_id: 'ou_x' }, sender_type: 'app' },
      message: {
        message_id: 'om_app',
        create_time: '0',
        chat_id: CHAT,
        chat_type: 'group',
        message_type: 'text',
        content: '{"text":"x"}',
      },
    } as never)
    expect(await t.db.select().from(messages).where(eq(messages.groupId, group.id))).toEqual([])
  })

  it('a Feishu recall recalls the 共工 copy and voids its queued run', async () => {
    const { ownerFs, group } = await setup()
    const { messageId, done } = t.feishu.message(BOT_APP, { chatId: CHAT, from: ownerFs, text: 'oops' })
    await done
    const [m] = await t.db.select().from(messages).where(eq(messages.groupId, group.id))
    await t.db.update(runs).set({ status: 'queued' }).where(eq(runs.triggerMessageId, m!.id))
    await t.feishu.recalled(BOT_APP, { messageId, chatId: CHAT })
    const [after] = await t.db.select().from(messages).where(eq(messages.id, m!.id))
    expect(after?.recalledAt).not.toBeNull()
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, m!.id))
    expect(run?.status).toBe('expired')
  })
})

describe('共工 → 飞书', () => {
  it('a web @ is sent by the main app as its author, a run card replies to it', async () => {
    const { ownerHttp, group } = await setup()
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 你好',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    const mirrored = t.feishu.sent.find((s) => s.msgType === 'text')
    expect(mirrored).toMatchObject({ appId: MAIN, chatId: CHAT, content: { text: '@codex 你好' } })
    expect(mirrored?.userToken).toBeTruthy()
    const [l] = await t.db
      .select()
      .from(feishuMessageLinks)
      .where(eq(feishuMessageLinks.messageId, sent.body.id))
    expect(l).toMatchObject({ direction: 'out', feishuMessageId: mirrored?.messageId })
    expect(t.feishu.sent.find((s) => s.msgType === 'interactive')).toMatchObject({
      appId: BOT_APP,
      replyTo: mirrored?.messageId,
    })
  })

  it('an author without Feishu is sent as 「名字：…」; plain messages are not mirrored', async () => {
    const { member, group } = await setup()
    const http = client(t, await t.seed.cookie(member.id))
    await http.post(`/api/groups/${group.id}/messages`, { body: '闲聊', clientId: 'client-0' })
    await http.post(`/api/groups/${group.id}/messages`, { body: '@codex 看看', clientId: 'client-1' })
    await feishuIdle(t.ctx)
    const texts = t.feishu.sent.filter((s) => s.msgType === 'text')
    expect(texts).toEqual([expect.objectContaining({ content: { text: '李娜：@codex 看看' } })])
    expect(texts[0]?.userToken).toBeUndefined()
  })

  it('recalling a mirrored message recalls it on Feishu with the author token', async () => {
    const { ownerHttp, group } = await setup()
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 撤回我',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    await ownerHttp.post(`/api/messages/${sent.body.id}/recall`)
    await feishuIdle(t.ctx)
    const mirrored = t.feishu.sent.find((s) => s.msgType === 'text')
    expect(t.feishu.recalls).toEqual([
      { appId: MAIN, messageId: mirrored?.messageId, userToken: expect.any(String) },
    ])
  })

  it('editing a mirrored message edits it on Feishu; a proxied one keeps its 「名字：」', async () => {
    const { member, group } = await setup()
    const http = client(t, await t.seed.cookie(member.id))
    const sent = await http.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 旧',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    expect((await http.patch(`/api/messages/${sent.body.id}`, { body: '@codex 新' })).status).toBe(200)
    await feishuIdle(t.ctx)
    const mirrored = t.feishu.sent.find((s) => s.msgType === 'text')
    expect(t.feishu.edits).toEqual([
      {
        appId: MAIN,
        messageId: mirrored?.messageId,
        body: { msgType: 'text', content: JSON.stringify({ text: '李娜：@codex 新' }) },
      },
    ])
  })

  it('the run card streams the agent text and steps, then ends with the reply and a link to its process', async () => {
    const { ownerHttp, group, bot } = await setup()
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 跑',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
    const msg = t.feishu.sent.find((s) => s.msgType === 'interactive')!
    expect(msg.content).toMatchObject({ type: 'card', data: { card_id: expect.any(String) } })
    const cardId = (msg.content.data as { card_id: string }).card_id
    expect(t.feishu.cards.get(cardId)).toMatchObject({ appId: BOT_APP, streaming: true })

    await setRun(run!.id, { status: 'running', step: '读取文件' })
    mirrorDelta(t.ctx, run!.id, '正在')
    mirrorDelta(t.ctx, run!.id, '修复')
    await feishuIdle(t.ctx)
    mirrorDelta(t.ctx, run!.id, '登录')
    await feishuIdle(t.ctx)
    const texts = t.feishu.cardOps.filter((o) => o.op === 'text').map((o) => o.text)
    expect(texts).toEqual(['正在修复', '正在修复登录'])
    expect(t.feishu.cardText(cardId, 'reply')).toBe('正在修复登录')
    expect(JSON.stringify(t.feishu.cards.get(cardId)!.card)).toContain('读取文件')

    await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'bot', authorBotId: bot.id, body: '已修复登录', runId: run!.id })
    await setRun(run!.id, { status: 'completed', step: '' })
    const json = JSON.stringify(t.feishu.cards.get(cardId)!.card)
    expect(json).toContain('已修复登录')
    expect(json).toContain(`${BASE}/g/${group.id}?run=${run!.id}`)
    expect(t.feishu.cards.get(cardId)!.streaming).toBe(false)
    const seqs = t.feishu.cardOps.map((o) => o.sequence)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(t.feishu.cardUpdates).toEqual([])
  })

  it('the message a bot works on shows Typing until the run ends; a completed run leaves DONE', async () => {
    const { ownerHttp, group } = await setup()
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 跑',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    const target = t.feishu.sent.find((s) => s.msgType === 'text')!.messageId
    expect(t.feishu.reactions).toEqual([
      expect.objectContaining({ appId: BOT_APP, messageId: target, emoji: 'Typing' }),
    ])
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
    await setRun(run!.id, { status: 'running' })
    expect(t.feishu.reactions).toHaveLength(1)
    await setRun(run!.id, { status: 'completed' })
    expect(t.feishu.reactions.map((r) => [r.emoji, r.removed])).toEqual([
      ['Typing', true],
      ['DONE', false],
    ])
  })

  it('an interrupted run only takes its Typing reaction back', async () => {
    const { ownerHttp, group } = await setup()
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 跑',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
    await setRun(run!.id, { status: 'interrupted' })
    expect(t.feishu.reactions.map((r) => [r.emoji, r.removed])).toEqual([['Typing', true]])
  })

  it('an app without CardKit falls back to a patched run card', async () => {
    const { ownerHttp, group } = await setup()
    t.feishu.cardkitError = 'cardkit:card:write required'
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 跑',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
    const card = t.feishu.sent.find((s) => s.msgType === 'interactive')!
    expect(card.content).toHaveProperty('schema', '2.0')
    mirrorDelta(t.ctx, run!.id, '不会流式')
    await setRun(run!.id, { status: 'completed', step: '' })
    expect(t.feishu.cardUpdates.at(-1)?.messageId).toBe(card.messageId)
    expect(t.feishu.cardOps).toEqual([])
  })

  it('turns streaming back on before Feishu ends it after 10 minutes', async () => {
    const { ownerHttp, group } = await setup()
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 跑',
      clientId: 'client-1',
    })
    await feishuIdle(t.ctx)
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 9.5 * 60_000)
      mirrorDelta(t.ctx, run!.id, '还在跑')
      await feishuIdle(t.ctx)
    } finally {
      vi.useRealTimers()
    }
    expect(t.feishu.cardOps.map((o) => o.op)).toEqual(['settings', 'text'])
    expect(t.feishu.cardOps[0]?.data).toEqual({ config: { streaming_mode: true } })
  })
})

describe('question and approval cards', () => {
  async function liveRun() {
    const s = await setup()
    const { done } = t.feishu.message(BOT_APP, { chatId: CHAT, from: s.ownerFs, text: '帮我' })
    await done
    const [run] = await t.db.select().from(runs).where(eq(runs.botId, s.bot.id))
    await t.db.update(runs).set({ status: 'running' }).where(eq(runs.id, run!.id))
    await feishuIdle(t.ctx)
    return { ...s, run: run! }
  }

  it('questions arrive as a form; the trigger user answers from Feishu', async () => {
    const { machine, run, ownerFs } = await liveRun()
    await onQuestionAsk(t.ctx, machine.id, {
      t: 'question.ask',
      runId: run.id,
      requestId: 'r1',
      questions: [
        { id: 'a', type: 'single', title: '用哪个库？', options: ['zod', 'yup'], recommended: 0 },
        { id: 'b', type: 'text', title: '备注', options: [], recommended: null },
      ],
    })
    await feishuIdle(t.ctx)
    const card = t.feishu.sent.at(-1)!
    expect(JSON.stringify(card.content)).toContain('用哪个库？')

    const [q] = await t.db.select().from(questionSets).where(eq(questionSets.runId, run.id))
    const res = (await t.feishu.cardAction(BOT_APP, {
      messageId: card.messageId,
      chatId: CHAT,
      operator: ownerFs,
      value: { k: 'answer', q: q!.id },
      formValue: { q0: '1', q1: '尽快' },
    })) as { toast: { type: string }; card: { data: unknown } }
    expect(res.toast.type).toBe('success')
    const settled = JSON.stringify(res.card.data)
    expect(settled).toContain('已由 王磊 处理')
    expect(settled).toContain('→ yup')
    expect(settled).toContain('→ 尽快')
    const [after] = await t.db.select().from(questionSets).where(eq(questionSets.id, q!.id))
    expect(after).toMatchObject({
      status: 'answered',
      answers: [
        { questionId: 'a', choices: [1], text: null },
        { questionId: 'b', choices: [], text: '尽快' },
      ],
    })
  })

  it('refuses an operator without the right to answer', async () => {
    const { machine, run, member } = await liveRun()
    const memberFs = await link(member.id)
    await onQuestionAsk(t.ctx, machine.id, {
      t: 'question.ask',
      runId: run.id,
      requestId: 'r1',
      questions: [{ id: 'a', type: 'yesno', title: '继续？', options: ['是', '否'], recommended: 0 }],
    })
    await feishuIdle(t.ctx)
    const [q] = await t.db.select().from(questionSets).where(eq(questionSets.runId, run.id))
    const res = (await t.feishu.cardAction(BOT_APP, {
      messageId: t.feishu.sent.at(-1)!.messageId,
      chatId: CHAT,
      operator: memberFs,
      value: { k: 'answer', q: q!.id },
      formValue: { q0: '0' },
    })) as { toast: { type: string; content: string } }
    expect(res.toast).toEqual({ type: 'error', content: '仅触发人或 Bot 主人可以回答' })
  })

  it('approvals arrive with one button per option; the owner decides from Feishu; web decisions update the card', async () => {
    const { machine, run, ownerFs, ownerHttp } = await liveRun()
    const options = [
      { optionId: 'ok', name: '允许', kind: 'allow_once' as const },
      { optionId: 'no', name: '拒绝', kind: 'reject_once' as const },
    ]
    const ask = (requestId: string) =>
      onApprovalRequest(t.ctx, machine.id, {
        t: 'approval.request',
        runId: run.id,
        requestId,
        title: '执行命令',
        toolKind: 'execute',
        detail: 'rm -rf build',
        options,
      })
    await ask('r1')
    await feishuIdle(t.ctx)
    const card = t.feishu.sent.at(-1)!
    expect(JSON.stringify(card.content)).toContain('rm -rf build')
    const [a] = await t.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, run.id), eq(approvals.requestId, 'r1')))
    const res = (await t.feishu.cardAction(BOT_APP, {
      messageId: card.messageId,
      chatId: CHAT,
      operator: ownerFs,
      value: { k: 'approve', a: a!.id, o: 'ok' },
    })) as { toast: { type: string } }
    expect(res.toast.type).toBe('success')
    expect((await t.db.select().from(approvals).where(eq(approvals.id, a!.id)))[0]?.status).toBe('approved')

    await ask('r2')
    await feishuIdle(t.ctx)
    const second = t.feishu.sent.at(-1)!
    const [b] = await t.db.select().from(approvals).where(eq(approvals.requestId, 'r2'))
    await ownerHttp.post(`/api/runs/${run.id}/approvals/${b!.id}`, { optionId: 'no' })
    await feishuIdle(t.ctx)
    const update = t.feishu.cardUpdates.find((u) => u.messageId === second.messageId)
    expect(JSON.stringify(update?.card)).toContain('已由 王磊 拒绝')
  })
})
