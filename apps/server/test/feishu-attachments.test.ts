import type { MessageDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, feishuMessageLinks, runs, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { feishuIdle } from '../src/modules/feishu/mirror.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

type Upload = { id: string }

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const BOT_APP = 'cli_bot1'
const CHAT = 'oc_chat1'
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '李娜' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
  const group = await t.seed.group({ createdBy: owner.id, memberIds: [member.id], botIds: [bot.id] })
  const ownerCookie = await t.seed.cookie(owner.id)
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  const ownerHttp = client(t, ownerCookie)
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  t.feishu.chats.set(BOT_APP, [{ chatId: CHAT, name: '研发群', avatar: null }])
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  expect((await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })).status).toBe(
    200,
  )
  await t.db.insert(systemParams).values({ key: 'publicUrl', value: 'https://gg.example.com' })
  forgetSysParams(t.db)
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
  expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(200)
  return { owner, member, group, token, ownerHttp, ownerCookie }
}

async function upload(cookie: string, groupId: string, name: string, data: Buffer, type: string) {
  const form = new FormData()
  form.set('groupId', groupId)
  form.set('file', new Blob([new Uint8Array(data)], { type }), name)
  const res = await fetch(t.url('/api/uploads'), { method: 'POST', headers: { cookie }, body: form })
  expect(res.status).toBe(200)
  return (await res.json()) as Upload
}

describe('共工 → 飞书 attachments', () => {
  it('a mirrored web message sends its images and files after the text, as its author', async () => {
    const { ownerHttp, ownerCookie, group } = await setup()
    const img = await upload(ownerCookie, group.id, 'shot.png', PNG, 'image/png')
    const doc = await upload(ownerCookie, group.id, '方案.pdf', Buffer.from('%PDF'), 'application/pdf')
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 看图',
      clientId: 'client-1',
      attachmentIds: [img.id, doc.id],
    })
    expect(sent.status).toBe(200)
    await feishuIdle(t.ctx)
    const out = t.feishu.sent.filter((s) => s.msgType !== 'interactive')
    expect(out.map((s) => [s.appId, s.msgType, s.content])).toEqual([
      [MAIN, 'text', { text: '@codex 看图' }],
      [MAIN, 'image', { image_key: 'img_1' }],
      [MAIN, 'file', { file_key: 'file_1' }],
    ])
    expect(out.every((s) => s.userToken)).toBe(true)
    expect(t.feishu.images[0]?.data).toEqual(PNG)
    expect(t.feishu.uploads).toEqual([
      { appId: MAIN, key: 'file_1', name: '方案.pdf', type: 'pdf', data: Buffer.from('%PDF') },
    ])
    // The run card still replies to the text; recalling the message recalls every copy.
    expect(t.feishu.sent.find((s) => s.msgType === 'interactive')?.replyTo).toBe(out[0]?.messageId)
    await ownerHttp.post(`/api/messages/${sent.body.id}/recall`)
    await feishuIdle(t.ctx)
    expect(t.feishu.recalls.map((r) => r.messageId).sort()).toEqual(out.map((s) => s.messageId).sort())
  })

  it('a member without Feishu has the files sent by the app after 「名字：…」', async () => {
    const { member, group } = await setup()
    const cookie = await t.seed.cookie(member.id)
    const img = await upload(cookie, group.id, 'a.png', PNG, 'image/png')
    await client(t, cookie).post(`/api/groups/${group.id}/messages`, {
      body: '@codex 看',
      clientId: 'client-1',
      attachmentIds: [img.id],
    })
    await feishuIdle(t.ctx)
    const out = t.feishu.sent.filter((s) => s.msgType !== 'interactive')
    expect(out.map((s) => [s.msgType, s.content, s.userToken])).toEqual([
      ['text', { text: '李娜：@codex 看' }, undefined],
      ['image', { image_key: 'img_1' }, undefined],
    ])
  })

  it('a file over Feishu’s limit is named with a link instead', async () => {
    const { ownerHttp, ownerCookie, group } = await setup()
    const big = await upload(
      ownerCookie,
      group.id,
      'big.zip',
      Buffer.alloc(31 * 1024 * 1024),
      'application/zip',
    )
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@codex 大文件',
      clientId: 'client-1',
      attachmentIds: [big.id],
    })
    await feishuIdle(t.ctx)
    const texts = t.feishu.sent.filter((s) => s.msgType === 'text').map((s) => s.content.text)
    expect(texts).toEqual([
      '@codex 大文件',
      `big.zip（31 MB，超过飞书上限，请在共工查看）https://gg.example.com/g/${group.id}?msg=${sent.body.id}`,
    ])
    expect(t.feishu.uploads).toEqual([])
  })

  it('files a bot sends in a run mirrored to Feishu go to the chat through its app', async () => {
    const { ownerHttp, group, token } = await setup()
    await ownerHttp.post(`/api/groups/${group.id}/messages`, { body: '@codex 截图', clientId: 'client-1' })
    await feishuIdle(t.ctx)
    const trigger = t.feishu.sent.find((s) => s.msgType === 'text')
    const [run] = await t.db.update(runs).set({ status: 'running' }).returning()
    const form = new FormData()
    form.set('text', '截图如下')
    form.append('files', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'shot.png')
    const res = await fetch(t.url(`/api/daemon/runs/${run!.id}/attachments`), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })
    expect(res.status).toBe(200)
    const message = (await res.json()) as MessageDto
    await feishuIdle(t.ctx)
    const out = t.feishu.sent.filter((s) => s.msgType !== 'interactive' && s !== trigger)
    expect(out.map((s) => [s.appId, s.msgType, s.content, s.replyTo])).toEqual([
      [BOT_APP, 'text', { text: '截图如下' }, trigger?.messageId],
      [BOT_APP, 'image', { image_key: 'img_1' }, trigger?.messageId],
    ])
    const links = await t.db
      .select()
      .from(feishuMessageLinks)
      .where(eq(feishuMessageLinks.messageId, message.id))
    expect(links.map((l) => [l.direction, l.kind])).toEqual([
      ['out', 'attachment'],
      ['out', 'attachment'],
    ])
  })
})
