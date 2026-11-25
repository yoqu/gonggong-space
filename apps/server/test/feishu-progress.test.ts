import type { MessageDto, ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, messages, runs } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { feishuIdle } from '../src/modules/feishu/mirror.js'
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

/** A group bound to a Feishu chat whose bot has its own app, and a run of that bot calling progress_card. */
async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: '部署 Bot' })
  const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  await client(t, await t.seed.cookie(admin.id)).put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })
  await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })
  const fu = t.feishu.user()
  const tokens = await t.feishu.api.exchangeCode({ appId: MAIN, appSecret: 's' }, t.feishu.authorize(fu), '')
  await t.db.insert(feishuIdentities).values({
    userId: owner.id,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal(tokens.accessToken),
    expiresAt: tokens.expiresAt,
  })
  t.feishu.members.set(CHAT, [fu.unionId])
  await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })
  const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
    body: '@部署 Bot 部署到 test',
    clientId: 'client-1',
  })
  await feishuIdle(t.ctx)
  const [run] = await t.db
    .update(runs)
    .set({ status: 'running' })
    .where(eq(runs.triggerMessageId, sent.body.id))
    .returning()
  const call = async (args: unknown) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${run!.id}/tools/progress_card`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
    await feishuIdle(t.ctx)
    return res.json<ToolCallRes>()
  }
  return { call, group, run: run! }
}

const STAGES = [
  { name: '构建', status: 'running' },
  { name: '部署', status: 'pending' },
]
const progressCards = () =>
  t.feishu.sent.filter((s) => JSON.stringify(s.content).includes('部署 luke-server'))

describe('progress cards in Feishu', () => {
  it('posts the card as the bot app, throttles running updates and sends the settled one at once', async () => {
    const { call } = await setup()
    const res = await call({ title: '部署 luke-server', stages: STAGES, percent: 30 })
    const id = /id：([0-9a-f-]{36})/.exec(res.text)?.[1]
    const [card] = progressCards()
    expect(card).toMatchObject({ appId: BOT_APP, chatId: CHAT, msgType: 'interactive' })
    const json = JSON.stringify(card!.content)
    expect(json).toContain('🔵 构建')
    expect(json).toContain('进度 30%')
    expect(json).toContain('"template":"blue"')

    await call({ id, percent: 60 })
    expect(t.feishu.cardUpdates).toEqual([])

    await call({
      id,
      stages: STAGES.map((s) => ({ ...s, status: 'done' })),
      link: { label: '预览二维码', url: 'https://example.com/qr.png' },
    })
    expect(progressCards()).toHaveLength(1)
    const update = JSON.stringify(t.feishu.cardUpdates.at(-1))
    expect(update).toContain('"template":"green"')
    expect(update).toContain('https://example.com/qr.png')
  })

  it('keeps a card of a run in an artifact chat out of Feishu', async () => {
    const { call, group, run } = await setup()
    const [chat] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'event', body: '画布 AI 对话' })
      .returning()
    await t.db.update(messages).set({ threadRootId: chat!.id }).where(eq(messages.id, chat!.id))
    await t.db.update(runs).set({ threadRootId: chat!.id }).where(eq(runs.id, run.id))
    const res = await call({ title: '部署 luke-server', stages: STAGES })
    expect(res.isError).toBeFalsy()
    expect(progressCards()).toEqual([])
  })
})
