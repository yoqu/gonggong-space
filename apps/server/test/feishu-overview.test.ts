import type { FeishuOverviewDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, systemParams } from '../src/db/schema.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { setBotIssue } from '../src/modules/feishu/issues.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const CHAT = 'oc_chat1'

async function link(userId: string) {
  const fu = t.feishu.user()
  await t.db
    .insert(feishuIdentities)
    .values({ userId, unionId: fu.unionId, openId: fu.openId, name: fu.name })
  return fu
}

describe('管理后台 · 飞书总览', () => {
  it('is for sysadmins only', async () => {
    const member = await t.seed.user()
    const res = await client(t, await t.seed.cookie(member.id)).get('/api/admin/feishu/overview')
    expect(res.status).toBe(403)
  })

  it('shows the setup progress, every bot with its app, and every linked chat', async () => {
    const admin = await t.seed.user({ role: 'sysadmin', name: '管理员' })
    const owner = await t.seed.user({ name: '王磊' })
    const adminHttp = client(t, await t.seed.cookie(admin.id))
    const ownerHttp = client(t, await t.seed.cookie(owner.id))
    const empty = await adminHttp.get<FeishuOverviewDto>('/api/admin/feishu/overview')
    expect(empty.body).toMatchObject({
      publicUrl: '',
      main: null,
      linkedUsers: 0,
      othersLinked: false,
      chats: [],
    })

    await t.db.insert(systemParams).values({ key: 'publicUrl', value: 'https://gg.example.com' })
    forgetSysParams(t.db)
    expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
    const { machine } = await t.seed.machine(owner.id)
    const codex = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'codex' })
    const claude = await t.seed.bot({ ownerId: owner.id, machineId: machine.id, name: 'claude' })
    expect(
      (await ownerHttp.put(`/api/bots/${codex.id}/feishu`, { appId: 'cli_bot1', appSecret: 's' })).status,
    ).toBe(200)
    const group = await t.seed.group({ createdBy: owner.id, name: '研发', botIds: [codex.id, claude.id] })
    t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '飞书研发群', avatar: null }])
    const ownerFs = await link(owner.id)
    t.feishu.members.set(CHAT, [ownerFs.unionId])
    expect((await ownerHttp.put(`/api/groups/${group.id}/feishu`, { chatId: CHAT })).status).toBe(200)
    setBotIssue(t.ctx, group.id, claude.id, { code: 232017, message: 'no permission' })

    const view = (await adminHttp.get<FeishuOverviewDto>('/api/admin/feishu/overview')).body
    expect(view).toMatchObject({
      publicUrl: 'https://gg.example.com',
      main: { appId: MAIN, review: 'approved' },
      linkedUsers: 1,
      othersLinked: true,
    })
    expect(view.bots.map((b) => [b.name, b.ownerName, b.app?.appId ?? null])).toEqual([
      ['codex', '王磊', 'cli_bot1'],
      ['claude', '王磊', null],
    ])
    expect(view.chats).toEqual([
      {
        groupId: group.id,
        groupName: '研发',
        teamName: expect.any(String),
        chatName: '飞书研发群',
        boundAt: expect.any(String),
        botsInChat: null,
        botsTotal: 2,
        issue: { code: 232017, message: 'no permission' },
        member: false,
      },
    ])
  })

  it('does not count the one who connected the main app as members being able to use it', async () => {
    const admin = await t.seed.user({ role: 'sysadmin' })
    const http = client(t, await t.seed.cookie(admin.id))
    expect((await http.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
    await link(admin.id)
    const view = (await http.get<FeishuOverviewDto>('/api/admin/feishu/overview')).body
    expect(view).toMatchObject({ linkedUsers: 1, othersLinked: false })
  })
})
