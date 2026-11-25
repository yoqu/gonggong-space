import type { BotDto, GroupDto, MessageDto, ThreadDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { CanvasChat, CanvasComposer } from '../src/features/artifacts/CanvasChat'
import { mockApi } from './mockApi'

// 作品权限: someone given 可协作 on a work, outside its group, talks in its 画布 AI 对话 with the group the server sends.

const at = '2026-11-25T02:00:00.000Z'
const group = {
  id: 'g9',
  kind: 'group',
  name: '湖山俱乐部需求',
  members: [],
  botIds: ['b1'],
} as unknown as GroupDto
const bots = [
  {
    id: 'b1',
    name: '设计助手',
    presence: 'online',
    avatar: 'role-no',
    systemPrompt: '',
    agentKind: 'claude',
  },
] as BotDto[]
const reply = {
  id: 'm2',
  seq: 2,
  groupId: 'g9',
  kind: 'bot',
  authorId: 'b1',
  authorName: '设计助手',
  body: '标题已经改大',
  mentions: [],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
  threadRootId: 'root1',
} as MessageDto
const thread: ThreadDto = {
  root: { ...reply, id: 'root1', seq: 1, kind: 'event', body: '画布 AI 对话：产物「湖山俱乐部」' },
  replies: [reply],
  runs: [],
  state: { rootId: 'root1', groupId: 'g9', following: false, lastReadSeq: 0, unread: 0, mentioned: false },
}

class NoopSocket {
  close() {}
}
beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useWorkspace.setState({ groups: [], bots })
})
afterEach(() => vi.unstubAllGlobals())

describe('画布 AI 对话 outside the group', () => {
  it('shows the conversation and posts to it with the group the server sent', async () => {
    const calls = mockApi({
      'POST /artifacts/a9/chat': { rootId: 'root1', group },
      'GET /messages/root1/thread?limit=50': thread,
      'POST /groups/g9/messages': (b: unknown) => ({ ...reply, id: 'm3', kind: 'user', ...(b as object) }),
    })
    render(
      <MemoryRouter>
        <CanvasChat artifactId="a9" groupId="g9" />
        <CanvasComposer groupId="g9" chat={{ rootId: 'root1', artifactId: 'a9', botId: 'b1' }} />
      </MemoryRouter>,
    )
    await screen.findByText('标题已经改大')
    const input = (await screen.findByRole('combobox')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '按钮换成蓝色' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/groups/g9/messages')?.body).toMatchObject({
        body: '按钮换成蓝色',
        threadRootId: 'root1',
      }),
    )
  })
})
