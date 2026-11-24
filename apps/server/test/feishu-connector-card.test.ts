import type { MessageDto, PluginDto, ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, feishuMessageLinks, runs, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams, saveSysParams } from '../src/modules/admin/params.js'
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

const feishuPlugin = [
  {
    path: 'gonggong-plugin.json',
    content: JSON.stringify({
      name: 'feishu',
      version: '1.0.0',
      title: '飞书',
      description: '飞书的说明',
      category: 'connector',
      agents: ['claude'],
      minDaemon: '0.5.0',
      entry: 'feishu',
      connector: { cli: { driver: 'lark-cli', npm: '@larksuite/cli' } },
    }),
  },
  { path: 'skills/feishu/SKILL.md', content: '---\nname: feishu\ndescription: feishu helper\n---\nGo.\n' },
]

describe('connect cards in Feishu', () => {
  it('asks in Feishu with only a link back to the group', async () => {
    const admin = await t.seed.user({ role: 'sysadmin' })
    const owner = await t.seed.user({ name: '王磊' })
    const { machine, token } = await t.seed.machine(owner.id, { daemonVersion: '0.9.0' })
    const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: '部署 Bot' })
    const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
    const ownerHttp = client(t, await t.seed.cookie(owner.id))
    const adminHttp = client(t, await t.seed.cookie(admin.id))
    await saveSysParams(t.ctx, { pluginsEnabled: true }, admin.id)
    const plugin = await adminHttp.post<PluginDto>('/api/admin/plugins', { files: feishuPlugin })
    await ownerHttp.put(`/api/groups/${group.id}/plugins/${plugin.body.id}`, { enabled: true })
    t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
    await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })
    await ownerHttp.put(`/api/bots/${bot.id}/feishu`, { appId: BOT_APP, appSecret: 's' })
    await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
    forgetSysParams(t.db)
    const fu = t.feishu.user()
    const tokens = await t.feishu.api.exchangeCode(
      { appId: MAIN, appSecret: 's' },
      t.feishu.authorize(fu),
      '',
    )
    await t.db.insert(feishuIdentities).values({
      userId: owner.id,
      unionId: fu.unionId,
      openId: fu.openId,
      feishuUserId: 'u_wang',
      name: fu.name,
      accessToken: seal(tokens.accessToken),
      expiresAt: tokens.expiresAt,
    })
    t.feishu.members.set(CHAT, [fu.unionId])
    await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })
    const sent = await ownerHttp.post<MessageDto>(`/api/groups/${group.id}/messages`, {
      body: '@部署 Bot 看日程',
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
      url: `/api/daemon/runs/${run!.id}/tools/connector_request`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: { connector: 'feishu', reason: 'unconnected' } },
    })
    expect(res.json<ToolCallRes>().isError).toBe(false)
    await feishuIdle(t.ctx)

    const card = t.feishu.sent.find((s) => JSON.stringify(s.content).includes('连接飞书'))
    expect(card).toMatchObject({ appId: BOT_APP, chatId: CHAT, msgType: 'interactive' })
    const json = JSON.stringify(card!.content)
    expect(json).toContain('<at id=u_wang></at>')
    expect(json).toContain('去连接')
    expect(json).toContain(`${BASE}/g/${group.id}`)
    const [link] = await t.db
      .select()
      .from(feishuMessageLinks)
      .where(eq(feishuMessageLinks.kind, 'connector'))
    expect(link).toMatchObject({ appId: BOT_APP })
  })
})
