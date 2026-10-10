import type { AdminGroupDto, GroupDto, NotificationDto, SearchResultDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages } from '../src/db/schema.js'
import { notify } from '../src/modules/notifications/notify.js'
import { updateBotState } from '../src/modules/workspaces/state.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const admin = await t.seed.user({ name: '系统管理员', role: 'sysadmin' })
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
  const dm = await t.seed.group({ createdBy: wang.id, kind: 'dm', name: '123123123', botIds: [bot.id] })
  return {
    wang,
    bot,
    dm,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asAdmin: client(t, await t.seed.cookie(admin.id)),
  }
}

const dmOf = async (w: Awaited<ReturnType<typeof world>>) =>
  (await w.asWang.get<GroupDto[]>('/api/groups')).body.find((g) => g.id === w.dm.id)

describe('DM title follows its Bot', () => {
  it('ignores the stored name and uses the current Bot name', async () => {
    const w = await world()
    expect((await dmOf(w))?.name).toBe('小王的 Claude')
    expect((await w.asWang.get<GroupDto>(`/api/groups/${w.dm.id}`)).body.name).toBe('小王的 Claude')
  })

  it('renaming the Bot retitles the DM and pushes the update', async () => {
    const w = await world()
    const seen = events(t, w.wang.id)
    expect((await w.asWang.patch(`/api/bots/${w.bot.id}`, { name: '代码助手' })).status).toBe(200)
    expect((await dmOf(w))?.name).toBe('代码助手')
    expect(seen).toContainEqual({
      t: 'group.updated',
      group: expect.objectContaining({ id: w.dm.id, name: '代码助手' }),
    })
  })

  it('falls back to 已删除的 Bot once the Bot is deleted', async () => {
    const w = await world()
    const seen = events(t, w.wang.id)
    expect((await w.asWang.del(`/api/bots/${w.bot.id}`)).status).toBe(204)
    expect((await dmOf(w))?.name).toBe('已删除的 Bot')
    expect(seen).toContainEqual({
      t: 'group.updated',
      group: expect.objectContaining({ id: w.dm.id, name: '已删除的 Bot' }),
    })
  })

  it('a renamed DM keeps its own name over the Bot name', async () => {
    const w = await world()
    const res = await w.asWang.patch<GroupDto>(`/api/groups/${w.dm.id}`, { name: '重构登录' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('重构登录')
    await w.asWang.patch(`/api/bots/${w.bot.id}`, { name: '代码助手' })
    expect((await dmOf(w))?.name).toBe('重构登录')
  })

  it("carries the Bot's workspace path", async () => {
    const w = await world()
    expect((await dmOf(w))?.workspacePath).toBeNull()
    await updateBotState(t.ctx, w.dm.id, w.bot.id, { workspacePath: '/Users/wang/code/pay' })
    expect((await dmOf(w))?.workspacePath).toBe('/Users/wang/code/pay')
  })

  it('shows as <owner> ⇄ <Bot> material in the admin list', async () => {
    const w = await world()
    const rows = (await w.asAdmin.get<AdminGroupDto[]>('/api/admin/groups')).body
    expect(rows.find((g) => g.id === w.dm.id)).toMatchObject({ name: '小王的 Claude', ownerName: '王磊' })
  })

  it('search results name the DM by its Bot', async () => {
    const w = await world()
    await t.db
      .insert(messages)
      .values({ groupId: w.dm.id, kind: 'user', authorUserId: w.wang.id, body: '迁移退款接口' })
    const res = await w.asWang.get<SearchResultDto[]>(`/api/search?q=${encodeURIComponent('退款')}&tab=msg`)
    expect(res.body[0]?.sub).toBe('王磊 · 小王的 Claude')
  })

  it('notifications name the DM by its current Bot', async () => {
    const w = await world()
    const seen = events(t, w.wang.id)
    await notify(t.ctx, w.wang.id, 'chain_done', { groupId: w.dm.id, groupName: '123123123', hops: 1 })
    expect(seen).toContainEqual({
      t: 'notification.new',
      notification: expect.objectContaining({
        payload: expect.objectContaining({ groupName: '小王的 Claude' }),
      }),
    })
    await w.asWang.patch(`/api/bots/${w.bot.id}`, { name: '代码助手' })
    const list = (await w.asWang.get<NotificationDto[]>('/api/notifications')).body
    expect(list[0]?.payload.groupName).toBe('代码助手')
  })
})
