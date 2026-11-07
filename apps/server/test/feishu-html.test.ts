import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HtmlRenderRef, MessageDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, messages, runs, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { feishuIdle } from '../src/modules/feishu/mirror.js'
import { publishRun } from '../src/modules/runs/dto.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const BOT_APP = 'cli_bot1'
const CHAT = 'oc_chat1'
const BASE = 'https://gg.example.com'
const PAGE = '<!doctype html><html><body><h1>CPU 78%</h1></body></html>'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

/** A bound group whose bot has its own app; the owner's mirrored @ started a run that is working. */
async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
  const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  await client(t, await t.seed.cookie(admin.id)).put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })
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
  await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })
  const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
    body: '@codex 画个图',
    clientId: 'client-1',
  })
  await feishuIdle(t.ctx)
  const [run] = await t.db
    .update(runs)
    .set({ status: 'running' })
    .where(eq(runs.triggerMessageId, sent.body.id))
    .returning()
  const publish = async (snapshot?: Buffer) => {
    const form = new FormData()
    form.set('title', 'CPU 面板')
    form.set('height', '480')
    form.set('html', new Blob([PAGE], { type: 'text/html' }), 'page.html')
    if (snapshot)
      form.set('snapshot', new Blob([new Uint8Array(snapshot)], { type: 'image/png' }), 'page.png')
    const res = await fetch(t.url(`/api/daemon/runs/${run!.id}/html-renders`), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })
    return { status: res.status, body: (await res.json()) as HtmlRenderRef }
  }
  /** Ends the run with a reply that places the pages. */
  const finish = async (pages: HtmlRenderRef[]) => {
    const [reply] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'bot',
        authorBotId: bot.id,
        body: '面板如下',
        runId: run!.id,
        meta: { htmlRenders: pages },
      })
      .returning()
    const [done] = await t.db
      .update(runs)
      .set({ status: 'completed', step: '' })
      .where(eq(runs.id, run!.id))
      .returning()
    await publishRun(t.ctx, done!)
    await feishuIdle(t.ctx)
    return reply!
  }
  const finalCard = () => {
    const msg = t.feishu.sent.find((s) => s.msgType === 'interactive')!
    const cardId = (msg.content.data as { card_id: string }).card_id
    return JSON.stringify(t.feishu.cards.get(cardId)!.card)
  }
  return { group, publish, finish, finalCard }
}

describe('html_render pages in Feishu', () => {
  it("shows the page's snapshot in the final card with a button to the full page", async () => {
    const { group, publish, finish, finalCard } = await setup()
    const page = await publish(PNG)
    expect(page.status).toBe(200)
    const reply = await finish([page.body])
    expect(t.feishu.images).toEqual([{ appId: BOT_APP, key: 'img_1', data: PNG }])
    const json = finalCard()
    expect(json).toContain('"img_key":"img_1"')
    expect(json).toContain('在共工查看完整页面')
    expect(json).toContain(`${BASE}/g/${group.id}?msg=${reply.id}`)
  })

  it('keeps the title line when an older daemon sent no snapshot', async () => {
    const { publish, finish, finalCard } = await setup()
    const page = await publish()
    await finish([page.body])
    expect(t.feishu.images).toEqual([])
    const json = finalCard()
    expect(json).toContain('📄 CPU 面板')
    expect(json).not.toContain('img_key')
  })

  it('refuses a snapshot that is not a PNG', async () => {
    const { publish } = await setup()
    expect((await publish(Buffer.from('<svg/>'))).status).toBe(400)
  })
})
