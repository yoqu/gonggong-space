import type { MessageDto, SecretRequestDto, ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, feishuMessageLinks, runs, secretRequests, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
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
const BASE = 'https://gg.example.com'

/** A bound group whose bot has its own app and a per-member secret; the owner's mirrored @ started a run. */
async function setup(o: { publicUrl?: boolean } = {}) {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const outsider = await t.seed.user({ name: '路人' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: '部署 Bot' })
  const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  await client(t, await t.seed.cookie(admin.id)).put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })
  await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })
  if (o.publicUrl !== false) {
    await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
    forgetSysParams(t.db)
  }
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
  await ownerHttp.post(`/api/groups/${group.id}/secrets`, { name: 'JIRA_TOKEN', mode: 'personal' })
  const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
    body: '@部署 Bot 查 Jira',
    clientId: 'client-1',
  })
  await feishuIdle(t.ctx)
  const [run] = await t.db
    .update(runs)
    .set({ status: 'running' })
    .where(eq(runs.triggerMessageId, sent.body.id))
    .returning()
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/daemon/runs/${run!.id}/tools/secret_request`,
    headers: { authorization: `Bearer ${token}` },
    payload: { arguments: { names: ['JIRA_TOKEN'] } },
  })
  expect(res.json<ToolCallRes>().isError).toBe(false)
  await feishuIdle(t.ctx)
  const [req] = await t.db.select().from(secretRequests)
  return { ownerHttp, outsiderHttp: client(t, await t.seed.cookie(outsider.id)), group, req: req! }
}

const secretCards = () => t.feishu.sent.filter((s) => JSON.stringify(s.content).includes('JIRA_TOKEN'))

describe('secret cards in Feishu', () => {
  it('asks in Feishu with a link to fill in 共工, then shows the card as filled', async () => {
    const { ownerHttp, req } = await setup()
    const [card] = secretCards()
    expect(card).toMatchObject({ appId: BOT_APP, chatId: CHAT, msgType: 'interactive' })
    const json = JSON.stringify(card!.content)
    expect(json).toContain('部署 Bot 请 王磊 填写自己的密钥：JIRA_TOKEN')
    expect(json).toContain('去填写')
    expect(json).toContain(`${BASE}/secret-requests/${req.id}`)
    // The value is only ever typed in 共工, never into the Feishu card.
    expect(json).not.toContain('"tag":"input"')
    const [link] = await t.db.select().from(feishuMessageLinks).where(eq(feishuMessageLinks.kind, 'secret'))
    expect(link).toMatchObject({ refId: req.id, appId: BOT_APP })

    await ownerHttp.post(`/api/secret-requests/${req.id}`, { values: { JIRA_TOKEN: 'jira-value-123' } })
    await feishuIdle(t.ctx)
    const update = JSON.stringify(t.feishu.cardUpdates.find((u) => JSON.stringify(u).includes('JIRA_TOKEN')))
    expect(update).toContain('已填写')
    expect(update).not.toContain('去填写')
    expect(JSON.stringify([t.feishu.sent, t.feishu.cardUpdates])).not.toContain('jira-value-123')
  })

  it('tells the chat to ask an admin when there is no public URL', async () => {
    await setup({ publicUrl: false })
    const json = JSON.stringify(secretCards()[0]!.content)
    expect(json).not.toContain('去填写')
    expect(json).toContain('系统管理员')
  })
})

describe('GET /api/secret-requests/:id', () => {
  it("returns the card to the group's members only", async () => {
    const { ownerHttp, outsiderHttp, group, req } = await setup()
    const res = await ownerHttp.get<SecretRequestDto>(`/api/secret-requests/${req.id}`)
    expect(res.body).toMatchObject({
      id: req.id,
      names: ['JIRA_TOKEN'],
      audience: 'origin',
      filled: false,
      groupId: group.id,
      bot: '部署 Bot',
    })
    expect((await outsiderHttp.get(`/api/secret-requests/${req.id}`)).status).toBe(404)
  })
})
