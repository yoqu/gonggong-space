import type {
  GroupDto,
  MessageDto,
  ThreadDto,
  ThreadInboxDto,
  ThreadStateDto,
  ThreadUnreadDto,
  TimelineDto,
} from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postEvent } from '../src/modules/messages/service.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

vi.mock('../src/modules/runs/trigger.js', () => ({ triggerRuns: vi.fn(async () => {}) }))

let t: TestApp
beforeEach(async () => {
  vi.mocked(triggerRuns).mockClear()
  t = await createTestApp()
})
afterEach(() => t.close())

async function setup() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id, zhao.id], botIds: [claude.id] })
  return {
    wang,
    li,
    zhao,
    claude,
    g,
    asWang: client(t, await t.seed.cookie(wang.id)),
    asLi: client(t, await t.seed.cookie(li.id)),
    asZhao: client(t, await t.seed.cookie(zhao.id)),
  }
}

let n = 0
type C = ReturnType<typeof client>
const send = (c: C, groupId: string, body: string, o: { threadRootId?: string; alsoSent?: boolean } = {}) =>
  c.post<MessageDto>(`/api/groups/${groupId}/messages`, { body, clientId: `client-${++n}-x`, ...o })
const timeline = async (c: C, groupId: string) =>
  (await c.get<TimelineDto>(`/api/groups/${groupId}/timeline`)).body.messages
const groupOf = async (c: C, groupId: string) =>
  (await c.get<GroupDto[]>('/api/groups')).body.find((g) => g.id === groupId)!

describe('thread replies', () => {
  it('keeps replies out of the main timeline and summarizes them on the root', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '发版前要不要先冻结主干？')).body
    const reply = await send(s.asLi, s.g.id, '要，周四开始', { threadRootId: root.id })
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ threadRootId: root.id, authorId: s.li.id })
    await send(s.asZhao, s.g.id, '同意', { threadRootId: root.id })
    await send(s.asLi, s.g.id, '我来发通知', { threadRootId: root.id })

    const main = await timeline(s.asWang, s.g.id)
    expect(main.map((m) => m.body)).toEqual(['发版前要不要先冻结主干？'])
    expect(main[0]!.thread).toMatchObject({ replyCount: 3, participants: [s.li.id, s.zhao.id] })

    const thread = await s.asZhao.get<ThreadDto>(`/api/messages/${root.id}/thread`)
    expect(thread.status).toBe(200)
    expect(thread.body.root.id).toBe(root.id)
    expect(thread.body.replies.map((m) => m.body)).toEqual(['要，周四开始', '同意', '我来发通知'])
  })

  it('shows a reply sent to the group too in the main timeline', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    await send(s.asLi, s.g.id, '也发到群里', { threadRootId: root.id, alsoSent: true })
    const main = await timeline(s.asWang, s.g.id)
    expect(main.map((m) => [m.body, m.alsoSent ?? false])).toEqual([
      ['根', false],
      ['也发到群里', true],
    ])
  })

  it('refuses replies to replies, events and messages of other groups', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    const reply = (await send(s.asLi, s.g.id, '回复', { threadRootId: root.id })).body
    expect((await send(s.asLi, s.g.id, '套娃', { threadRootId: reply.id })).status).toBe(400)
    const event = await postEvent(t.ctx, s.g.id, '{user} 修改了群名称与公告', { user: '王磊' })
    expect((await send(s.asLi, s.g.id, '事件', { threadRootId: event.id })).status).toBe(400)
    const other = await t.seed.group({ createdBy: s.li.id })
    expect((await send(s.asLi, other.id, '跨群', { threadRootId: root.id })).status).toBe(404)
  })

  it('pushes the new summary to the members', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    const seen = events(t, s.zhao.id)
    await send(s.asLi, s.g.id, '回复', { threadRootId: root.id })
    expect(seen).toContainEqual(
      expect.objectContaining({
        t: 'thread.updated',
        groupId: s.g.id,
        rootId: root.id,
        thread: expect.objectContaining({ replyCount: 1, participants: [s.li.id] }),
      }),
    )
  })
})

describe('thread unread', () => {
  it('counts replies in the thread, not in the group', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    await s.asWang.post(`/api/groups/${s.g.id}/read`, {})
    await send(s.asLi, s.g.id, '回复一', { threadRootId: root.id })
    await send(s.asLi, s.g.id, '回复二', { threadRootId: root.id })
    expect(await groupOf(s.asWang, s.g.id)).toMatchObject({ unread: 0, last: '王磊：根' })

    const { body: state } = await s.asWang.get<ThreadDto>(`/api/messages/${root.id}/thread`)
    expect(state.state).toMatchObject({ following: true, unread: 2, mentioned: false })
    expect((await s.asWang.get<ThreadUnreadDto>('/api/threads/unread')).body).toEqual({
      unread: 1,
      mentioned: 0,
    })

    const read = await s.asWang.put<ThreadStateDto>(`/api/messages/${root.id}/thread/read`, {})
    expect(read.body).toMatchObject({ unread: 0 })
    expect((await s.asWang.get<ThreadUnreadDto>('/api/threads/unread')).body).toEqual({
      unread: 0,
      mentioned: 0,
    })
  })

  it('auto-follows the root author, repliers and members @-ed in the thread', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    await send(s.asLi, s.g.id, '@赵敏 看下', { threadRootId: root.id })
    const zhao = (await s.asZhao.get<ThreadDto>(`/api/messages/${root.id}/thread`)).body.state
    expect(zhao).toMatchObject({ following: true, unread: 1, mentioned: true })
    expect((await s.asZhao.get<ThreadUnreadDto>('/api/threads/unread')).body).toEqual({
      unread: 1,
      mentioned: 1,
    })
    expect((await s.asLi.get<ThreadDto>(`/api/messages/${root.id}/thread`)).body.state).toMatchObject({
      following: true,
      unread: 0,
    })
  })

  it('does not settle a thread @ when the group is read', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    await send(s.asLi, s.g.id, '@赵敏 看下', { threadRootId: root.id })
    await s.asZhao.post(`/api/groups/${s.g.id}/read`, {})
    expect(await groupOf(s.asZhao, s.g.id)).toMatchObject({ mentionCount: 0 })
    expect((await s.asZhao.get<ThreadUnreadDto>('/api/threads/unread')).body).toEqual({
      unread: 1,
      mentioned: 1,
    })
  })

  it('stops counting a thread once unfollowed', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    const off = await s.asWang.put<ThreadStateDto>(`/api/messages/${root.id}/thread/follow`, {
      following: false,
    })
    expect(off.body).toMatchObject({ following: false })
    await send(s.asLi, s.g.id, '回复', { threadRootId: root.id })
    expect((await s.asWang.get<ThreadUnreadDto>('/api/threads/unread')).body).toEqual({
      unread: 0,
      mentioned: 0,
    })
    expect((await s.asWang.get<ThreadInboxDto>('/api/threads')).body.threads).toEqual([])
  })
})

describe('thread inbox', () => {
  it('lists followed threads, latest reply first, with their last two replies', async () => {
    const s = await setup()
    const a = (await send(s.asWang, s.g.id, '话题 A')).body
    const b = (await send(s.asWang, s.g.id, '话题 B')).body
    await send(s.asLi, s.g.id, 'B1', { threadRootId: b.id })
    await send(s.asLi, s.g.id, 'A1', { threadRootId: a.id })
    await send(s.asZhao, s.g.id, 'A2', { threadRootId: a.id })
    await send(s.asLi, s.g.id, 'A3', { threadRootId: a.id })

    const { body } = await s.asWang.get<ThreadInboxDto>('/api/threads')
    expect(body.threads.map((x) => [x.root.body, x.latest.map((m) => m.body), x.state.unread])).toEqual([
      ['话题 A', ['A2', 'A3'], 3],
      ['话题 B', ['B1'], 1],
    ])
    expect(body.threads[0]).toMatchObject({ groupId: s.g.id, groupName: s.g.name })
    // A member who never took part follows nothing.
    const outsider = await t.seed.user({ name: '旁观者' })
    expect(
      (await client(t, await t.seed.cookie(outsider.id)).get<ThreadInboxDto>('/api/threads')).body,
    ).toEqual({
      threads: [],
    })
  })

  it('hides threads of groups the viewer left', async () => {
    const s = await setup()
    const root = (await send(s.asWang, s.g.id, '根')).body
    await send(s.asZhao, s.g.id, '回复', { threadRootId: root.id })
    expect((await s.asZhao.get<ThreadInboxDto>('/api/threads')).body.threads).toHaveLength(1)
    expect((await s.asZhao.post(`/api/groups/${s.g.id}/leave`)).status).toBeLessThan(300)
    expect((await s.asZhao.get<ThreadInboxDto>('/api/threads')).body.threads).toEqual([])
    expect((await s.asZhao.get(`/api/messages/${root.id}/thread`)).status).toBe(404)
  })
})
