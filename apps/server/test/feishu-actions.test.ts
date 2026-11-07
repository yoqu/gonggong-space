import type { MessageDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  botShareRequests,
  botShares,
  feishuIdentities,
  feishuMessageLinks,
  messages,
  runs,
  systemParams,
} from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { feishuIdle, mirrorDelta } from '../src/modules/feishu/mirror.js'
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

type Res = { toast: { type: string; content: string }; card?: { data: unknown } }

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

async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '李娜' })
  const outsider = await t.seed.user({ name: '赵敏' })
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
  forgetSysParams(t.db)
  const ownerFs = await link(owner.id)
  t.feishu.members.set(CHAT, [ownerFs.unionId])
  expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(200)
  return { owner, member, outsider, bot, group, ownerHttp, ownerFs }
}

const fence = (json: object) => `\`\`\`actions\n${JSON.stringify(json)}\n\`\`\``
const ENV = fence({
  id: 'env',
  prompt: '发布到哪里？',
  options: [
    { label: '测试环境', value: 'test', style: 'primary' },
    { label: '生产', style: 'danger' },
  ],
})
const CHECKS = fence({ id: 'checks', options: [{ label: 'lint' }, { label: 'e2e' }], multiple: true })

/** A completed run whose final reply carries ENV and CHECKS, mirrored to CHAT as a CardKit card. */
async function answeredRun() {
  const s = await setup()
  const sent = await s.ownerHttp.post<MessageDto>(`/api/groups/${s.group.id}/messages`, {
    body: '@codex 跑',
    clientId: 'client-1',
  })
  await feishuIdle(t.ctx)
  const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
  const msg = t.feishu.sent.find((m) => m.msgType === 'interactive')!
  const cardId = (msg.content.data as { card_id: string }).card_id
  const [reply] = await t.db
    .insert(messages)
    .values({
      groupId: s.group.id,
      kind: 'bot',
      authorBotId: s.bot.id,
      body: `选一个：\n\n${ENV}\n\n然后检查：\n\n${CHECKS}`,
      runId: run!.id,
    })
    .returning()
  const [done] = await t.db
    .update(runs)
    .set({ status: 'completed', step: '' })
    .where(eq(runs.id, run!.id))
    .returning()
  await publishRun(t.ctx, done!)
  await feishuIdle(t.ctx)
  const card = () => JSON.stringify(t.feishu.cards.get(cardId)!.card)
  const click = (operator: FakeUser, value: object, formValue?: Record<string, unknown>) =>
    t.feishu.cardAction(BOT_APP, {
      messageId: msg.messageId,
      chatId: CHAT,
      operator,
      value,
      formValue,
    }) as Promise<Res>
  return { ...s, run: run!, reply: reply!, card, click }
}

const userMessages = (groupId: string) =>
  t.db
    .select()
    .from(messages)
    .where(and(eq(messages.groupId, groupId), eq(messages.kind, 'user')))

describe('飞书卡片里的 actions 按钮', () => {
  it('renders single-choice blocks as buttons and multi-choice ones as a form', async () => {
    const { card, reply } = await answeredRun()
    const json = card()
    expect(json).toContain('选一个：')
    expect(json).toContain('**发布到哪里？**')
    expect(json).not.toContain('```actions')
    expect(json).not.toContain('请选择：')
    const env = JSON.stringify({ k: 'act', m: reply.id, b: 'env', o: 1 })
    expect(json).toContain(env)
    expect(json).toMatch(/"type":"danger","text":\{"tag":"plain_text","content":"生产"\}/)
    expect(json).toMatch(/"type":"primary","text":\{"tag":"plain_text","content":"测试环境"\}/)
    expect(json).toContain('"multi_select_static"')
    expect(json).toContain(JSON.stringify({ k: 'act', m: reply.id, b: 'checks' }))
  })

  it('a click answers as the clicker the same way as on the web; the card shows who chose', async () => {
    const { card, click, ownerFs, reply, group } = await answeredRun()
    const res = await click(ownerFs, { k: 'act', m: reply.id, b: 'env', o: 0 })
    expect(res.toast.type).toBe('success')
    await feishuIdle(t.ctx)
    const [row] = await t.db.select().from(messages).where(eq(messages.id, reply.id))
    expect(row!.meta).toMatchObject({ actions: { env: { name: '王磊', labels: ['测试环境'] } } })
    expect((await userMessages(group.id)).map((m) => m.body)).toContain('@codex 选择了「test」')
    const json = card()
    expect(json).toContain('已选择：测试环境（by 王磊）')
    expect(json).not.toContain(JSON.stringify({ k: 'act', m: reply.id, b: 'env', o: 0 }))
    expect(json).toContain('"disabled":true')
    expect(json).toContain(JSON.stringify({ k: 'act', m: reply.id, b: 'checks' }))
  })

  it('submits a multi-choice form', async () => {
    const { card, click, ownerFs, reply, group } = await answeredRun()
    const res = await click(ownerFs, { k: 'act', m: reply.id, b: 'checks' }, { opts: ['0', '1'] })
    expect(res.toast.type).toBe('success')
    await feishuIdle(t.ctx)
    expect((await userMessages(group.id)).map((m) => m.body)).toContain('@codex 选择了「lint、e2e」')
    expect(card()).toContain('已选择：lint、e2e（by 王磊）')
  })

  it('a second click, from Feishu or the web, is refused; a web answer updates the card', async () => {
    const { card, click, ownerFs, member, reply } = await answeredRun()
    const memberHttp = client(t, await t.seed.cookie(member.id))
    expect(
      (await memberHttp.post(`/api/messages/${reply.id}/actions`, { blockId: 'env', options: [1] })).status,
    ).toBe(200)
    await feishuIdle(t.ctx)
    expect(card()).toContain('已选择：生产（by 李娜）')
    const again = await click(ownerFs, { k: 'act', m: reply.id, b: 'env', o: 0 })
    expect(again.toast).toEqual({ type: 'error', content: '已有人作答' })
  })

  it('refuses a clicker without a 共工 account or outside the group', async () => {
    const { click, outsider, reply, group } = await answeredRun()
    const stranger = t.feishu.user()
    expect((await click(stranger, { k: 'act', m: reply.id, b: 'env', o: 0 })).toast).toEqual({
      type: 'error',
      content: '请先认证共工账号',
    })
    const outsiderFs = await link(outsider.id)
    expect((await click(outsiderFs, { k: 'act', m: reply.id, b: 'env', o: 0 })).toast).toEqual({
      type: 'error',
      content: '群不存在或你已不在群内',
    })
    expect(await userMessages(group.id)).toHaveLength(1)
  })
})

describe('流式运行卡片里的组件代码块', () => {
  it('shows a one-line placeholder instead of actions / html-page sources, open or closed', async () => {
    const { ownerFs, bot } = await setup()
    const { done } = t.feishu.message(BOT_APP, { chatId: CHAT, from: ownerFs, text: '帮我' })
    await done
    const [run] = await t.db.select().from(runs).where(eq(runs.botId, bot.id))
    const [live] = await t.db.update(runs).set({ status: 'running' }).where(eq(runs.id, run!.id)).returning()
    await publishRun(t.ctx, live!)
    await feishuIdle(t.ctx)
    const msg = t.feishu.sent.find((m) => (m.content.data as { card_id?: string } | undefined)?.card_id)!
    const cardId = (msg.content.data as { card_id: string }).card_id
    const reply = () => t.feishu.cardText(cardId, 'reply')

    mirrorDelta(t.ctx, run!.id, '选一个：\n\n```actions\n{"options":[{"lab')
    await feishuIdle(t.ctx)
    expect(reply()).toBe('选一个：\n\n选项生成中…')

    mirrorDelta(t.ctx, run!.id, 'el":"A"}]}\n```\n\n看页面：\n\n```html-page\n{"id":')
    await feishuIdle(t.ctx)
    expect(reply()).toBe('选一个：\n\n选项生成中…\n\n看页面：\n\n页面生成中…')

    mirrorDelta(t.ctx, run!.id, '"x"}\n```\n\n```ts\nconst a = 1\n```')
    await feishuIdle(t.ctx)
    expect(reply()).toBe('选一个：\n\n选项生成中…\n\n看页面：\n\n页面生成中…\n\n```ts\nconst a = 1\n```')
  })
})

describe('飞书里的共享申请', () => {
  async function requested() {
    const owner = await t.seed.user({ name: '王磊' })
    const li = await t.seed.user({ name: '李娜' })
    const zhao = await t.seed.user({ name: '赵敏' })
    const { machine } = await t.seed.machine(owner.id)
    const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
    const admin = await t.seed.user({ role: 'sysadmin' })
    const adminHttp = client(t, await t.seed.cookie(admin.id))
    expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
    await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
    forgetSysParams(t.db)
    const ownerFs = await link(owner.id)
    const ownerHttp = client(t, await t.seed.cookie(owner.id))
    expect((await ownerHttp.put('/api/me/feishu/notify', { notify: true })).status).toBe(204)
    const res = await client(t, await t.seed.cookie(li.id)).post<{ id: string }>(
      `/api/bots/${bot.id}/share-requests`,
      { reason: '写周报' },
    )
    expect(res.status).toBe(200)
    await expect.poll(() => t.feishu.sent.length).toBe(1)
    const [sent] = t.feishu.sent
    const click = (operator: FakeUser, ok: boolean) =>
      t.feishu.cardAction(MAIN, {
        messageId: sent!.messageId,
        chatId: ownerFs.openId,
        operator,
        value: { k: 'share', r: res.body.id, ok },
      }) as Promise<Res>
    return {
      owner,
      li,
      zhao,
      bot,
      ownerFs,
      ownerHttp,
      requestId: res.body.id,
      sentId: sent!.messageId,
      card: JSON.stringify(sent!.content),
      click,
    }
  }

  it('a decision on the web settles the Feishu card too', async () => {
    const { ownerHttp, requestId, sentId } = await requested()
    await expect
      .poll(async () => (await t.db.select().from(feishuMessageLinks)).map((l) => l.feishuMessageId))
      .toContain(sentId)
    expect((await ownerHttp.post(`/api/share-requests/${requestId}/reject`)).status).toBe(204)
    await vi.waitFor(() => expect(t.feishu.cardUpdates.map((u) => u.messageId)).toContain(sentId))
    const update = t.feishu.cardUpdates.find((u) => u.messageId === sentId)
    expect(JSON.stringify(update?.card)).toContain('已由 王磊 拒绝')
    expect(JSON.stringify(update?.card)).not.toContain('"callback"')
  })

  const shares = (botId: string) => t.db.select().from(botShares).where(eq(botShares.botId, botId))

  it('the card has 同意 and 拒绝; 同意 shares the bot and settles the card', async () => {
    const { card, click, ownerFs, requestId, bot, li } = await requested()
    expect(card).toContain('李娜 申请使用 codex：写周报')
    expect(card).toContain(JSON.stringify({ k: 'share', r: requestId, ok: true }))
    expect(card).toContain(JSON.stringify({ k: 'share', r: requestId, ok: false }))
    const res = await click(ownerFs, true)
    expect(res.toast.type).toBe('success')
    const settled = JSON.stringify(res.card?.data)
    expect(settled).toContain('已由 王磊 同意')
    expect(settled).not.toContain('"callback"')
    expect((await shares(bot.id)).map((s) => s.userId)).toEqual([li.id])

    expect((await click(ownerFs, false)).toast).toEqual({ type: 'error', content: '申请不存在或已处理' })
  })

  it('拒绝 declines; only the owner may decide', async () => {
    const { click, ownerFs, zhao, requestId, bot } = await requested()
    const zhaoFs = await link(zhao.id)
    expect((await click(zhaoFs, true)).toast).toEqual({
      type: 'error',
      content: '只有 Bot 主人或系统管理员可以处理共享申请',
    })
    const res = await click(ownerFs, false)
    expect(JSON.stringify(res.card?.data)).toContain('已由 王磊 拒绝')
    const [row] = await t.db.select().from(botShareRequests).where(eq(botShareRequests.id, requestId))
    expect(row?.status).toBe('rejected')
    expect(await shares(bot.id)).toEqual([])
  })
})
