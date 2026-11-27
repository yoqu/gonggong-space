import type {
  GroupThreadsDto,
  MeDto,
  MessageDto,
  NotificationDto,
  ThreadDto,
  ThreadInboxDto,
  TimelineDto,
} from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

vi.mock('../src/modules/runs/trigger.js', () => ({ triggerRuns: vi.fn(async () => {}) }))

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

let n = 0
type C = ReturnType<typeof client>
const send = (c: C, groupId: string, body: string, threadRootId?: string) =>
  c.post<MessageDto>(`/api/groups/${groupId}/messages`, { body, clientId: `title-${++n}-x`, threadRootId })

async function setup() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '路人' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id] })
  const asWang = client(t, await t.seed.cookie(wang.id))
  const asLi = client(t, await t.seed.cookie(li.id))
  const root = (await send(asWang, g.id, '发版前要不要先冻结主干？')).body
  await send(asLi, g.id, '要，周四开始', root.id)
  return { wang, li, g, root, asWang, asLi, asOutsider: client(t, await t.seed.cookie(outsider.id)) }
}

const rename = (c: C, rootId: string, title: string) =>
  c.put<MessageDto>(`/api/messages/${rootId}/thread/title`, { title })

describe('thread title', () => {
  it('lets any member rename a thread, shows it everywhere the root goes and notes it in the thread', async () => {
    const s = await setup()
    const seen = events(t, s.wang.id)
    const res = await rename(s.asLi, s.root.id, '  冻结主干安排  ')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: s.root.id, threadTitle: '冻结主干安排' })
    expect(seen).toContainEqual(
      expect.objectContaining({
        t: 'message.edited',
        message: expect.objectContaining({ id: s.root.id, threadTitle: '冻结主干安排' }),
      }),
    )

    const thread = (await s.asWang.get<ThreadDto>(`/api/messages/${s.root.id}/thread`)).body
    expect(thread.root.threadTitle).toBe('冻结主干安排')
    expect(thread.replies.map((m) => [m.kind, m.body])).toEqual([
      ['user', '要，周四开始'],
      ['event', '李建国 把话题改名为「冻结主干安排」'],
    ])
    const main = (await s.asWang.get<TimelineDto>(`/api/groups/${s.g.id}/timeline`)).body.messages
    expect(main.find((m) => m.id === s.root.id)?.threadTitle).toBe('冻结主干安排')
    // The rename note does not count as a reply.
    expect(main.find((m) => m.id === s.root.id)?.thread?.replyCount).toBe(1)
    const list = (await s.asWang.get<GroupThreadsDto>(`/api/groups/${s.g.id}/threads`)).body
    expect(list.threads[0]?.root.threadTitle).toBe('冻结主干安排')
    await s.asWang.put(`/api/messages/${s.root.id}/thread/follow`, { following: true })
    await send(s.asLi, s.g.id, '通知已发', s.root.id)
    const inbox = (await s.asWang.get<ThreadInboxDto>('/api/threads')).body
    expect(inbox.threads[0]?.root.threadTitle).toBe('冻结主干安排')
  })

  it('names the thread in the @ notifications sent from it', async () => {
    const s = await setup()
    await rename(s.asWang, s.root.id, '冻结主干安排')
    await send(s.asWang, s.g.id, '@李建国 周四前发通知', s.root.id)
    const notes = (await s.asLi.get<NotificationDto[]>('/api/notifications')).body
    expect(notes[0]).toMatchObject({
      type: 'mention',
      payload: { threadRootId: s.root.id, threadTitle: '冻结主干安排' },
    })
  })

  it('goes back to the first line of the root when cleared', async () => {
    const s = await setup()
    await rename(s.asWang, s.root.id, '冻结主干安排')
    const res = await rename(s.asWang, s.root.id, '   ')
    expect(res.status).toBe(200)
    expect(res.body.threadTitle).toBeUndefined()
    const thread = (await s.asWang.get<ThreadDto>(`/api/messages/${s.root.id}/thread`)).body
    expect(thread.replies.at(-1)?.body).toBe('王磊 恢复了话题的默认名称')
  })

  it('posts nothing when the title does not change', async () => {
    const s = await setup()
    await rename(s.asWang, s.root.id, '冻结主干安排')
    await rename(s.asLi, s.root.id, '冻结主干安排')
    const thread = (await s.asWang.get<ThreadDto>(`/api/messages/${s.root.id}/thread`)).body
    expect(thread.replies.filter((m) => m.kind === 'event')).toHaveLength(1)
  })

  it('refuses outsiders, replies and overlong titles', async () => {
    const s = await setup()
    expect((await rename(s.asOutsider, s.root.id, '偷改')).status).toBe(404)
    const reply = (await send(s.asLi, s.g.id, '回复', s.root.id)).body
    expect((await rename(s.asWang, reply.id, '改回复')).status).toBe(400)
    expect((await rename(s.asWang, s.root.id, '长'.repeat(81))).status).toBe(400)
  })
})

describe('ui prefs', () => {
  it('keeps the thread layout on the account', async () => {
    const u = await t.seed.user({ name: '王磊' })
    const c = client(t, await t.seed.cookie(u.id))
    expect((await c.get<MeDto>('/api/me')).body.uiPrefs).toEqual({})
    const res = await c.patch<MeDto>('/api/me', { uiPrefs: { threadLayout: 'replace' } })
    expect(res.status).toBe(200)
    expect(res.body.uiPrefs).toEqual({ threadLayout: 'replace' })
    expect((await c.get<MeDto>('/api/me')).body.uiPrefs).toEqual({ threadLayout: 'replace' })
    expect((await c.patch('/api/me', { uiPrefs: { threadLayout: 'float' } })).status).toBe(400)
  })
})
