import type { GroupDto, GroupFeishuView } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuIdentities, groupMembers, messages, systemParams } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { forgetSysParams } from '../src/modules/admin/params.js'
import { MAIN_EVENTS } from '../src/modules/feishu/client.js'
import { createTestApp, type TestApp } from './support/app.js'
import type { FakeUser } from './support/feishu.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = 'cli_main'
const CHAT = 'oc_chat1'
const BASE = 'https://gg.example.com'

/** Main app in CHAT, a group whose admin (owner) is linked and in CHAT. */
async function setup() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const owner = await t.seed.user({ name: '王磊' })
  const group = await t.seed.group({ createdBy: owner.id })
  const ownerHttp = client(t, await t.seed.cookie(owner.id))
  t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群', avatar: null }])
  await t.db.insert(systemParams).values({ key: 'publicUrl', value: BASE })
  forgetSysParams(t.db)
  const adminHttp = client(t, await t.seed.cookie(admin.id))
  expect((await adminHttp.put('/api/admin/feishu', { appId: MAIN, appSecret: 's' })).status).toBe(200)
  const ownerFs = await link(owner.id)
  t.feishu.members.set(CHAT, [ownerFs.unionId])
  const bind = () => ownerHttp.put<GroupFeishuView>(`/api/groups/${group.id}/feishu`, { chatId: CHAT })
  return { owner, group, ownerHttp, ownerFs, bind }
}

async function link(userId: string): Promise<FakeUser> {
  const fu = t.feishu.user()
  await t.db.insert(feishuIdentities).values({
    userId,
    unionId: fu.unionId,
    openId: fu.openId,
    name: fu.name,
    accessToken: seal('u'),
  })
  return fu
}

const memberIds = async (groupId: string) =>
  (await t.db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId)))
    .map((m) => m.userId)
    .sort()

const events = async (groupId: string) =>
  (
    await t.db
      .select()
      .from(messages)
      .where(and(eq(messages.groupId, groupId), eq(messages.kind, 'event')))
  ).map((m) => m.body)

describe('飞书群 → 共工群 members', () => {
  it('binding pulls in linked team members of the chat; strangers and unlinked users are skipped', async () => {
    const { owner, group, bind } = await setup()
    const mate = await t.seed.user({ name: '李娜' })
    const outsider = await t.seed.user({ name: '外人', teamId: null })
    const mateFs = await link(mate.id)
    const outsiderFs = await link(outsider.id)
    t.feishu.members.set(CHAT, [
      ...(t.feishu.members.get(CHAT) ?? []),
      mateFs.unionId,
      outsiderFs.unionId,
      'on_x',
    ])

    expect((await bind()).status).toBe(200)
    expect(await memberIds(group.id)).toEqual([owner.id, mate.id].sort())
    expect(await events(group.id)).toContain('李娜 随飞书群加入群')
  })

  it('users joining or leaving the chat join or leave the group; the only admin stays', async () => {
    const { owner, ownerFs, group, bind } = await setup()
    await bind()
    const mate = await t.seed.user({ name: '李娜' })
    const mateFs = await link(mate.id)

    await t.feishu.memberEvent(MAIN, 'im.chat.member.user.added_v1', CHAT, [mateFs])
    expect(await memberIds(group.id)).toEqual([owner.id, mate.id].sort())

    await t.feishu.memberEvent(MAIN, 'im.chat.member.user.withdrawn_v1', CHAT, [mateFs])
    expect(await memberIds(group.id)).toEqual([owner.id])
    expect(await events(group.id)).toContain('李娜 已退出飞书群，移出群')

    await t.feishu.memberEvent(MAIN, 'im.chat.member.user.deleted_v1', CHAT, [ownerFs])
    expect(await memberIds(group.id)).toEqual([owner.id])
  })

  it('ignores member events of chats not bound to a group', async () => {
    const { group } = await setup()
    const mate = await t.seed.user()
    await t.feishu.memberEvent(MAIN, 'im.chat.member.user.added_v1', CHAT, [await link(mate.id)])
    expect(await memberIds(group.id)).not.toContain(mate.id)
  })

  it('linking Feishu later joins the bound groups whose chat the user is in', async () => {
    const { group, bind } = await setup()
    await bind()
    const mate = await t.seed.user({ name: '李娜' })
    const fu = t.feishu.user()
    t.feishu.members.set(CHAT, [...(t.feishu.members.get(CHAT) ?? []), fu.unionId])

    const cookie = await t.seed.cookie(mate.id)
    const start = await t.app.inject({
      method: 'GET',
      url: '/api/auth/feishu/start?mode=link',
      headers: { cookie },
    })
    const state = new URL(start.headers.location as string).searchParams.get('state') as string
    const cb = await t.app.inject({
      method: 'GET',
      url: `/api/auth/feishu/callback?${new URLSearchParams({ code: t.feishu.authorize(fu), state })}`,
    })
    expect(cb.headers.location).toContain('feishu=linked')
    expect(await memberIds(group.id)).toContain(mate.id)
  })
})

describe('共工群 → 飞书群 members', () => {
  it('adding a linked member pulls them into the bound chat; unlinked members are not', async () => {
    const { group, ownerHttp, bind } = await setup()
    await bind()
    const mate = await t.seed.user({ name: '李娜' })
    const plain = await t.seed.user({ name: '赵六' })
    const mateFs = await link(mate.id)

    expect((await ownerHttp.post(`/api/groups/${group.id}/members`, { userIds: [mate.id] })).status).toBe(200)
    expect((await ownerHttp.post(`/api/groups/${group.id}/members`, { userIds: [plain.id] })).status).toBe(
      200,
    )
    expect(t.feishu.usersAdded).toEqual([{ appId: MAIN, chatId: CHAT, unionIds: [mateFs.unionId] }])
  })

  it('a member already in the chat is not added again; removing in 共工 leaves the chat alone', async () => {
    const { group, ownerHttp, bind } = await setup()
    const mate = await t.seed.user({ name: '李娜' })
    const mateFs = await link(mate.id)
    t.feishu.members.set(CHAT, [...(t.feishu.members.get(CHAT) ?? []), mateFs.unionId])
    await bind()

    expect((await ownerHttp.del(`/api/groups/${group.id}/members/${mate.id}`)).status).toBe(200)
    expect(t.feishu.members.get(CHAT)).toContain(mateFs.unionId)
    expect((await ownerHttp.post(`/api/groups/${group.id}/members`, { userIds: [mate.id] })).status).toBe(200)
    expect(t.feishu.usersAdded).toEqual([])
  })

  it('a Feishu refusal keeps the 共工 member and says why in the group', async () => {
    const { group, ownerHttp, bind } = await setup()
    await bind()
    const mate = await t.seed.user({ name: '李娜' })
    await link(mate.id)
    t.feishu.addUsersError = 'only owner or admin can add members'

    expect((await ownerHttp.post(`/api/groups/${group.id}/members`, { userIds: [mate.id] })).status).toBe(200)
    expect(await memberIds(group.id)).toContain(mate.id)
    expect(await events(group.id)).toContain('未能将 李娜 拉入飞书群：only owner or admin can add members')
  })

  it('the main app subscribes to member events over its long connection', async () => {
    await setup()
    expect(t.feishu.configs.at(-1)).toEqual({
      appId: MAIN,
      config: {
        websocket: { events: MAIN_EVENTS, callbacks: [] },
        redirectUrls: [`${BASE}/api/auth/feishu/callback`],
      },
    })
  })
})

describe('the bound chat on the group', () => {
  it('GroupDto names the bound chat until unbound; the name follows Feishu', async () => {
    const { group, ownerHttp, bind } = await setup()
    expect((await ownerHttp.get<GroupDto>(`/api/groups/${group.id}`)).body.feishu).toBeUndefined()

    await bind()
    expect((await ownerHttp.get<GroupDto>(`/api/groups/${group.id}`)).body.feishu).toEqual({
      chatId: CHAT,
      name: '研发群',
    })

    t.feishu.chats.set(MAIN, [{ chatId: CHAT, name: '研发群（新）', avatar: null }])
    const view = await ownerHttp.get<GroupFeishuView>(`/api/groups/${group.id}/feishu`)
    expect(view.body.chat?.name).toBe('研发群（新）')
    expect((await ownerHttp.get<GroupDto>(`/api/groups/${group.id}`)).body.feishu?.name).toBe('研发群（新）')

    await ownerHttp.del(`/api/groups/${group.id}/feishu`)
    expect((await ownerHttp.get<GroupDto>(`/api/groups/${group.id}`)).body.feishu).toBeUndefined()
  })
})
