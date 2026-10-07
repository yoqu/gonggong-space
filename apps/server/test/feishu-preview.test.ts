import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MessageDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, feishuMessageLinks, previews, runs, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { feishuIdle } from '../src/modules/feishu/mirror.js'
import { publishPreviews, snapshotFile } from '../src/modules/previews/service.js'
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
const BASE = 'https://gg.example.com'

/** A bound group whose bot has its own app; the owner's web @ is mirrored and started a run. */
async function setup(o: { bind?: boolean } = {}) {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const { machine } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
  const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })
  await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })
  await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
  forgetSysParams(t.db)
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
  if (o.bind !== false) await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })
  const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
    body: '@codex 起个预览',
    clientId: 'client-1',
  })
  await feishuIdle(t.ctx)
  const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
  const [preview] = await t.db
    .insert(previews)
    .values({
      slug: randomUUID().slice(0, 16),
      kind: 'http',
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      port: 3000,
      title: '登录页',
      createdByRunId: run!.id,
    })
    .returning()
  return { group, preview: preview!, mirroredAt: t.feishu.sent.find((s) => s.msgType === 'text')?.messageId }
}

async function publish(groupId: string) {
  await publishPreviews(t.ctx, groupId)
  await feishuIdle(t.ctx)
}

const previewCards = () => t.feishu.sent.filter((s) => JSON.stringify(s.content).includes('登录页'))

describe('preview cards in Feishu', () => {
  it('the bot app replies to the trigger with the preview and links that open it in 共工', async () => {
    const { group, preview, mirroredAt } = await setup()
    await publish(group.id)
    const [card] = previewCards()
    expect(card).toMatchObject({ appId: BOT_APP, chatId: CHAT, msgType: 'interactive', replyTo: mirroredAt })
    const json = JSON.stringify(card!.content)
    const url = `${BASE}/g/${group.id}?preview=${preview.id}`
    expect(json).toContain(url)
    expect(json).toContain(
      `https://applink.feishu.cn/client/web_url/open?mode=sidebar-semi&url=${encodeURIComponent(url)}`,
    )
    expect(json).toContain('codex · 网页 · 机器离线')
    const [l] = await t.db
      .select()
      .from(feishuMessageLinks)
      .where(and(eq(feishuMessageLinks.kind, 'preview'), eq(feishuMessageLinks.refId, preview.id)))
    expect(l?.feishuMessageId).toBe(card!.messageId)

    await publish(group.id)
    expect(previewCards()).toHaveLength(1)
    expect(t.feishu.cardUpdates).toEqual([])
  })

  it('shows the snapshot, uploaded once per snapshot', async () => {
    const { group, preview } = await setup()
    await publish(group.id)
    const file = snapshotFile(preview.id)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, Buffer.from('png-1'))
    await t.db.update(previews).set({ snapshotAt: new Date() }).where(eq(previews.id, preview.id))
    await publish(group.id)
    await publish(group.id)
    expect(t.feishu.images.map((i) => [i.appId, i.data.toString()])).toEqual([[BOT_APP, 'png-1']])
    const update = t.feishu.cardUpdates.at(-1)
    expect(t.feishu.cardUpdates).toHaveLength(1)
    expect(JSON.stringify(update?.card)).toContain('"img_key":"img_1"')
  })

  it('a devtools login code is not sent to Feishu', async () => {
    const { group, preview } = await setup()
    const file = snapshotFile(preview.id)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, Buffer.from('qr'))
    await t.db
      .update(previews)
      .set({ snapshotAt: new Date(), awaiting: 'login' })
      .where(eq(previews.id, preview.id))
    await publish(group.id)
    expect(t.feishu.images).toEqual([])
    expect(JSON.stringify(previewCards()[0]?.content)).toContain('等待开发者工具登录')
  })

  it('a closed preview updates its card once and drops the links', async () => {
    const { group, preview } = await setup()
    await publish(group.id)
    await t.db.update(previews).set({ closedAt: new Date() }).where(eq(previews.id, preview.id))
    await publish(group.id)
    await publish(group.id)
    expect(t.feishu.cardUpdates).toHaveLength(1)
    const json = JSON.stringify(t.feishu.cardUpdates[0]?.card)
    expect(json).toContain('已关闭')
    expect(json).not.toContain('open_url')
  })

  it('does nothing for a group not bound to Feishu', async () => {
    const { group } = await setup({ bind: false })
    await publish(group.id)
    expect(previewCards()).toEqual([])
  })

  it('stays out of Feishu in demo mode', async () => {
    const { group } = await setup()
    await t.db.insert(systemParams).values({ key: 'demoMode', value: true })
    forgetSysParams(t.db)
    await publish(group.id)
    expect(previewCards()).toEqual([])
  })
})
