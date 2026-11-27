import type { GroupDto, MeDto, MessageDto, ThreadDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatLayout } from '../src/app/ChatLayout'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { threadTitle } from '../src/features/chat/snippet'
import { ThreadView } from '../src/features/chat/ThreadView'
import { mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}
const meDto = (o: Partial<MeDto> = {}): MeDto => ({
  ...me,
  teams: [],
  singleTeamMode: true,
  canCreateTeam: false,
  demoMode: false,
  pluginsEnabled: false,
  notifyPrefs: {},
  uiPrefs: {},
  ...o,
})

const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: [],
  unread: 0,
  lastSeq: 9,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const at = '2026-09-23T02:00:00.000Z'
const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u2',
  authorName: '李建国',
  body: '',
  mentions: [],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
  ...o,
})
const root = msg({
  seq: 1,
  body: '**发版前**要不要冻结主干？\n第二行细节',
  thread: { replyCount: 1, lastReplyAt: at, participants: ['u2'] },
})
const threadDto = (r: MessageDto = root): ThreadDto => ({
  root: r,
  replies: [msg({ seq: 2, body: '要，周四开始', threadRootId: 'm1' })],
  runs: [],
  state: { rootId: 'm1', groupId: 'g1', following: true, lastReadSeq: 2, unread: 0, mentioned: false },
})

class FakeSocket {
  close() {}
}

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })

beforeEach(() => {
  setWidth(1440)
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.getState().setUser(meDto())
  useWorkspace.setState({ groups: [group], bots: [], machines: [], activeGroupId: 'g1' })
})
afterEach(() => vi.unstubAllGlobals())

const view = (onClose = vi.fn()) =>
  render(
    <MemoryRouter>
      <ThreadView group={group} rootId="m1" onClose={onClose} />
    </MemoryRouter>,
  )

describe('threadTitle', () => {
  it('is the set name, else the first line of the root as plain text, cut at 40 characters', () => {
    expect(threadTitle(root)).toBe('发版前要不要冻结主干？')
    expect(threadTitle({ ...root, threadTitle: '冻结主干安排' })).toBe('冻结主干安排')
    expect(threadTitle({ ...root, body: '长'.repeat(50) })).toBe(`${'长'.repeat(40)}…`)
    expect(threadTitle({ ...root, body: '\n\n  \n第三行才有字' })).toBe('第三行才有字')
  })
})

describe('thread title in the thread header', () => {
  it('names the thread after its root and says which group it is in', async () => {
    mockApi({ 'GET /messages/m1/thread?limit=50': threadDto() })
    view()
    expect(
      await screen.findByRole('button', { name: '话题名称：发版前要不要冻结主干？，点击修改' }),
    ).toBeTruthy()
    expect(screen.getByText('# 退款 v2 迁移')).toBeTruthy()
  })

  it('renames in place: Enter saves, and the new name shows', async () => {
    const calls = mockApi({
      'GET /messages/m1/thread?limit=50': threadDto(),
      'PUT /messages/m1/thread/title': (body: unknown) => ({
        ...root,
        threadTitle: (body as { title: string }).title,
      }),
    })
    view()
    fireEvent.click(await screen.findByRole('button', { name: /^话题名称/ }))
    const input = screen.getByRole('textbox', { name: '话题名称' }) as HTMLInputElement
    expect(input.value).toBe('发版前要不要冻结主干？')
    fireEvent.change(input, { target: { value: '冻结主干安排' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: '话题名称：冻结主干安排，点击修改' })).toBeTruthy()
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ body: { title: '冻结主干安排' } })
  })

  it('cancels with Esc without closing the thread', async () => {
    const calls = mockApi({ 'GET /messages/m1/thread?limit=50': threadDto() })
    const onClose = vi.fn()
    view(onClose)
    fireEvent.click(await screen.findByRole('button', { name: /^话题名称/ }))
    const input = screen.getByRole('textbox', { name: '话题名称' })
    fireEvent.change(input, { target: { value: '不要了' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '话题名称' })).toBeNull()
    expect(screen.getByRole('button', { name: '话题名称：发版前要不要冻结主干？，点击修改' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('saves nothing when the name is left unchanged', async () => {
    const calls = mockApi({ 'GET /messages/m1/thread?limit=50': threadDto() })
    view()
    fireEvent.click(await screen.findByRole('button', { name: /^话题名称/ }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: '话题名称' }), { key: 'Enter' })
    expect(screen.queryByRole('textbox', { name: '话题名称' })).toBeNull()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})

describe('thread layout switch', () => {
  it('keeps the choice on the account', async () => {
    const calls = mockApi({
      'GET /messages/m1/thread?limit=50': threadDto(),
      'PATCH /me': meDto({ uiPrefs: { threadLayout: 'replace' } }),
    })
    view()
    fireEvent.click(await screen.findByRole('button', { name: '顶掉群聊查看' }))
    await waitFor(() => expect(useSession.getState().tenancy?.uiPrefs?.threadLayout).toBe('replace'))
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      body: { uiPrefs: { threadLayout: 'replace' } },
    })
    expect(screen.getByRole('button', { name: '在右侧并排查看' })).toBeTruthy()
  })

  it('in the chat’s place it leads back to the group chat', async () => {
    useSession.getState().setUser(meDto({ uiPrefs: { threadLayout: 'replace' } }))
    mockApi({ 'GET /messages/m1/thread?limit=50': threadDto() })
    const onClose = vi.fn()
    view(onClose)
    fireEvent.click(await screen.findByRole('button', { name: '返回群聊' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('has no switch where the thread cannot sit beside the chat', async () => {
    setWidth(1000)
    mockApi({ 'GET /messages/m1/thread?limit=50': threadDto() })
    view()
    await screen.findByRole('button', { name: /^话题名称/ })
    expect(screen.queryByRole('button', { name: '顶掉群聊查看' })).toBeNull()
    expect(screen.getByRole('button', { name: '返回群聊' })).toBeTruthy()
  })
})

const layout = (o: { railKind?: 'thread' | 'run'; railReplace?: boolean; bench?: boolean } = {}) => (
  <ChatLayout
    sidebar={<div />}
    rail={<div>话题内容</div>}
    railOpen
    railKind={o.railKind ?? 'thread'}
    railReplace={o.railReplace}
    workbench={o.bench ? <div>工作台内容</div> : undefined}
    mobileView="chat"
  >
    <div>聊天内容</div>
  </ChatLayout>
)
const chat = () => screen.getByText('聊天内容').closest('main') as HTMLElement
const rail = () => screen.getByText('话题内容').closest('aside') as HTMLElement

describe('thread rail layout', () => {
  it('sits beside the chat by default on wide windows', () => {
    render(layout())
    expect(chat().hidden).toBe(false)
    expect(rail().className).not.toContain('chat__rail--replace')
    expect(screen.getByRole('separator', { name: '调整侧栏宽度' })).toBeTruthy()
  })

  it('takes the chat’s place when asked to', () => {
    render(layout({ railReplace: true }))
    expect(chat().hidden).toBe(true)
    expect(rail().className).toContain('chat__rail--replace')
    expect(screen.queryByRole('separator', { name: '调整侧栏宽度' })).toBeNull()
  })

  it('takes the chat’s place instead of covering it on narrow windows', () => {
    setWidth(1000)
    render(layout())
    expect(chat().hidden).toBe(true)
    expect(rail().className).toContain('chat__rail--replace')
  })

  it('leaves other rails floating over a narrow chat', () => {
    setWidth(1000)
    render(layout({ railKind: 'run' }))
    expect(chat().hidden).toBe(false)
    expect(rail().className).not.toContain('chat__rail--replace')
  })

  it('opens in the chat’s column beside the workbench when asked to', () => {
    render(layout({ railReplace: true, bench: true }))
    expect(chat().hidden).toBe(true)
    expect(rail().className).toContain('chat__dock--in-chat')
    expect(screen.getByText('工作台内容')).toBeTruthy()
  })
})
