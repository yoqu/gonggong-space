import type { FeishuIdentityView } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { feishuIdentities, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { notify } from '../src/modules/notifications/notify.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import type { FakeUser } from './support/feishu.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const BASE = 'https://gg.example.com'

async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const user = await t.seed.user({ name: '王磊' })
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
  forgetSysParams(t.db)
  const group = await t.seed.group({ createdBy: user.id, name: '研发群' })
  return { user, group, http: client(t, await t.seed.cookie(user.id)) }
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

const settle = () => new Promise((r) => setTimeout(r, 50))

describe('飞书通知', () => {
  it('is off by default and toggled through /api/me/feishu/notify', async () => {
    const { user, http } = await setup()
    await link(user.id)
    expect((await http.get<FeishuIdentityView>('/api/me/feishu')).body.identity?.notify).toBe(false)
    expect((await http.put('/api/me/feishu/notify', { notify: true })).status).toBe(204)
    expect((await http.get<FeishuIdentityView>('/api/me/feishu')).body.identity?.notify).toBe(true)
  })

  it('refuses to turn on without a linked Feishu identity', async () => {
    const { http } = await setup()
    expect((await http.put('/api/me/feishu/notify', { notify: true })).status).toBe(400)
  })

  it('sends pushed notifications as a card to the user’s Feishu DM through the main app', async () => {
    const { user, group, http } = await setup()
    const fu = await link(user.id)
    await http.put('/api/me/feishu/notify', { notify: true })
    await notify(t.ctx, user.id, 'question', { groupId: group.id, runId: 'r1', botName: 'codex', count: 2 })
    await vi.waitFor(() => expect(t.feishu.sent).toHaveLength(1))
    const [sent] = t.feishu.sent
    expect(sent).toMatchObject({
      appId: MAIN,
      chatId: fu.openId,
      receiveIdType: 'open_id',
      msgType: 'interactive',
    })
    const card = JSON.stringify(sent!.content)
    expect(card).toContain('待回答')
    expect(card).toContain('研发群')
    expect(card).toContain('codex 向你提了 2 个问题')
    expect(card).toContain(`${BASE}/g/${group.id}?run=r1`)
  })

  it('stays quiet when off, for types that are not pushed, and for users without Feishu', async () => {
    const { user, group, http } = await setup()
    const other = await t.seed.user()
    await link(user.id)
    // Sending is fire-and-forget and reads the setting later: turn it off before the notice, not after.
    await http.put('/api/me/feishu/notify', { notify: true })
    await notify(t.ctx, user.id, 'bot_shared', { groupId: group.id })
    await notify(t.ctx, other.id, 'chain_done', { groupId: group.id, hops: 1 })
    await http.put('/api/me/feishu/notify', { notify: false })
    await notify(t.ctx, user.id, 'chain_done', { groupId: group.id, hops: 1 })
    await settle()
    expect(t.feishu.sent).toEqual([])
  })

  it('skips the card while the user is reading that group on a visible, focused page', async () => {
    const { user, group, http } = await setup()
    await link(user.id)
    await http.put('/api/me/feishu/notify', { notify: true })
    const ws = t.ws('/ws/web', {
      cookie: await t.seed.cookie(user.id),
      origin: `http://${new URL(t.url('/')).host}`,
    })
    await inbox(ws).opened
    await expect.poll(() => t.ctx.bus.isConnected(user.id)).toBe(true)
    const say = async (msg: object) => {
      ws.send(JSON.stringify(msg))
      await new Promise((r) => {
        ws.once('pong', r)
        ws.ping()
      })
    }
    const ask = () =>
      notify(t.ctx, user.id, 'question', { groupId: group.id, runId: 'r1', botName: 'codex', count: 1 })

    await say({ t: 'focus', groupId: group.id })
    await say({ t: 'visible', visible: true })
    await ask()
    await settle()
    expect(t.feishu.sent).toEqual([])

    await say({ t: 'visible', visible: false })
    await ask()
    await vi.waitFor(() => expect(t.feishu.sent).toHaveLength(1))

    await say({ t: 'visible', visible: true })
    await say({ t: 'focus', groupId: 'other' })
    await ask()
    await vi.waitFor(() => expect(t.feishu.sent).toHaveLength(2))
    ws.close()
  })
})
