import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, feishuMessageLinks, messages, runs } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
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
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const card = (img = 'chart') => ({
  schema: '2.0',
  header: { title: { tag: 'plain_text', content: '周报' } },
  body: {
    elements: [
      { tag: 'markdown', content: '**本周进展**' },
      { tag: 'img', img_key: img, alt: { tag: 'plain_text', content: '趋势图' } },
    ],
  },
})

/** A bot with its own app in a group bound to CHAT, and a live run triggered from a Feishu message. */
async function setup(o: { bind?: boolean; botApp?: boolean } = {}) {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(owner.id)
  const { token: other } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
  const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  t.feishu.chats.set(BOT_APP, [{ chatId: CHAT, name: '研发群', avatar: null }])
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  if (o.botApp !== false)
    expect(
      (await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })).status,
    ).toBe(200)
  const fu = t.feishu.user()
  const tokens = await t.feishu.api.exchangeCode({ appId: MAIN, appSecret: 's' }, t.feishu.authorize(fu), '')
  await t.db.insert(feishuIdentities).values({
    userId: owner.id,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal(tokens.accessToken),
    refreshToken: tokens.refreshToken && seal(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  })
  t.feishu.members.set(CHAT, [fu.unionId])
  if (o.bind !== false)
    expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(200)
  const [msg] = await t.db
    .insert(messages)
    .values({ groupId: group.id, kind: 'user', authorUserId: owner.id, body: '@codex 发周报' })
    .returning()
  await t.db.insert(feishuMessageLinks).values({
    feishuMessageId: 'om_trigger',
    chatId: CHAT,
    appId: MAIN,
    direction: 'in',
    kind: 'message',
    messageId: msg!.id,
  })
  const run = async (status = 'running') =>
    (
      await t.db
        .insert(runs)
        .values({
          groupId: group.id,
          botId: bot.id,
          triggerMessageId: msg!.id,
          originUserId: owner.id,
          status,
        })
        .returning()
    )[0]!
  return { token, other, run }
}

async function send(
  runId: string,
  bearer: string,
  body: unknown,
  images: Record<string, { name: string; data: Buffer }> = {},
) {
  const form = new FormData()
  form.set('card', typeof body === 'string' ? body : JSON.stringify(body))
  for (const [key, img] of Object.entries(images))
    form.set(`image.${key}`, new Blob([new Uint8Array(img.data)]), img.name)
  const res = await fetch(t.url(`/api/daemon/runs/${runId}/feishu-card`), {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: form,
  })
  return { status: res.status, body: (await res.json()) as { chat?: string; message?: string } }
}

describe('gonggong MCP feishu_send_card', () => {
  it("uploads the card's images with the bot's own app and replies to the trigger in the bound chat", async () => {
    const { token, run } = await setup()
    const r = await run()
    const res = await send(r.id, token, card(), { chart: { name: 'chart.png', data: PNG } })
    expect(res).toEqual({ status: 200, body: { chat: '研发群' } })
    expect(t.feishu.images).toEqual([{ appId: BOT_APP, key: 'img_1', data: PNG }])
    const sent = t.feishu.sent.at(-1)!
    expect(sent).toMatchObject({
      appId: BOT_APP,
      chatId: CHAT,
      msgType: 'interactive',
      replyTo: 'om_trigger',
    })
    expect(sent.content).toEqual(card('img_1'))
    const [link] = await t.db
      .select()
      .from(feishuMessageLinks)
      .where(eq(feishuMessageLinks.kind, 'custom_card'))
    expect(link).toMatchObject({
      feishuMessageId: sent.messageId,
      runId: r.id,
      appId: BOT_APP,
      direction: 'out',
    })
  })

  it('falls back to the main app for a bot without its own', async () => {
    const { token, run } = await setup({ botApp: false })
    expect((await send((await run()).id, token, card('img_v3_x'))).status).toBe(200)
    expect(t.feishu.sent.at(-1)).toMatchObject({ appId: MAIN, content: card('img_v3_x') })
  })

  it('refuses with the reason: another machine, an ended run, an unbound group, a bad card or bad images', async () => {
    const { token, other, run } = await setup()
    const r = await run()
    const sent = t.feishu.sent.length
    expect((await send(r.id, other, card())).status).toBe(404)
    expect((await send((await run('completed')).id, token, card())).status).toBe(404)
    const bad = async (body: unknown, images = {}) => (await send(r.id, token, body, images)).body.message
    expect(await bad('{oops')).toBe('卡片不是合法的 JSON')
    expect(await bad({ elements: [] })).toBe(
      '卡片须是飞书卡片 JSON 2.0：schema 为 "2.0"，内容放在 body.elements',
    )
    expect(await bad(card(), { chart: { name: 'notes.txt', data: PNG } })).toBe(
      '图片 notes.txt 的格式飞书不支持，可用 png、jpg、jpeg、gif、webp、bmp、tiff、ico',
    )
    expect(await bad(card(), { logo: { name: 'logo.png', data: PNG } })).toBe('卡片里没有用到图片占位符 logo')
    expect(await bad(card(), { chart: { name: 'big.png', data: Buffer.alloc(10 * 1024 * 1024 + 1) } })).toBe(
      '图片 big.png 超过飞书的 10 MB 上限',
    )
    expect(t.feishu.sent.length).toBe(sent)
    expect(t.feishu.images).toEqual([])
  })

  it('refuses when the group is not bound to a Feishu chat', async () => {
    const { token, run } = await setup({ bind: false })
    const res = await send((await run()).id, token, card())
    expect(res).toEqual({
      status: 409,
      body: expect.objectContaining({ message: '本群未关联飞书群，无法发送飞书卡片' }),
    })
  })
})
