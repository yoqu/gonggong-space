import type { GroupDto, GroupThreadsDto, MessageDto, ThreadInboxDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { GroupThreads } from '../src/features/chat/GroupThreads'
import { ThreadInbox } from '../src/features/chat/ThreadInbox'
import { api } from '../src/lib/api'

const GROUP: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '开发群',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [{ userId: 'u1', name: '张三', avatar: null, isAdmin: true }],
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

const msg = (id: string, body: string, seq: number): MessageDto => ({
  id,
  groupId: 'g1',
  seq,
  kind: 'bot',
  authorId: 'b1',
  authorName: '共字君',
  body,
  mentions: [],
  createdAt: '2026-11-21T06:00:00.000Z',
  editedAt: null,
  recalled: false,
  hidden: false,
  runId: null,
  quote: null,
  attachments: [],
  reactions: [],
  threadRootId: null,
  thread: { replyCount: 2, lastReplyAt: '2026-11-21T06:05:00.000Z', participants: [] },
})

describe('ThreadInbox & GroupThreads UX', () => {
  beforeEach(() => {
    useWorkspace.setState({ groups: [GROUP], bots: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('strips Markdown in ThreadInbox, avoids <p> inside <button>, and provides a close-reply button', async () => {
    const inbox: ThreadInboxDto = {
      threads: [
        {
          groupId: 'g1',
          groupName: '开发群',
          root: msg('m1', '## 发布检查\n- **单元测试** 通过，见 [日志](https://example.com)', 1),
          latest: [msg('m2', '已运行 `pnpm check` 全部通过', 2)],
          state: {
            rootId: 'm1',
            groupId: 'g1',
            following: true,
            lastReadSeq: 0,
            unread: 1,
            mentioned: false,
          },
        },
      ],
    }
    vi.spyOn(api, 'get').mockResolvedValue(inbox)

    const { container } = render(
      <MemoryRouter>
        <ThreadInbox />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText(/发布检查/)).toBeTruthy())
    expect(container.textContent).not.toContain('## ')
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).not.toContain('`pnpm check`')
    expect(container.textContent).not.toContain('https://example.com')
    expect(container.querySelector('button.thread-inbox__open p')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '回复' }))
    const closeReply = screen.getByRole('button', { name: '收起回复' })
    expect(closeReply).toBeTruthy()
    fireEvent.click(closeReply)
    expect(screen.getByRole('button', { name: '回复' })).toBeTruthy()
  })

  it('strips Markdown in GroupThreads and shows retry when loading more fails', async () => {
    const first: GroupThreadsDto = {
      threads: [
        {
          root: msg('m1', '## 架构讨论\n- **方案 A** 使用 `Redis`', 1),
          state: {
            rootId: 'm1',
            groupId: 'g1',
            following: true,
            lastReadSeq: 0,
            unread: 0,
            mentioned: false,
          },
          live: false,
        },
      ],
      next: 10,
    }
    const getSpy = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('cursor=')) throw new Error('network error')
      return first
    })

    const { container } = render(
      <MemoryRouter>
        <GroupThreads group={GROUP} onClose={() => {}} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText(/架构讨论/)).toBeTruthy())
    expect(container.textContent).not.toContain('## ')
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).not.toContain('`Redis`')

    const list = container.querySelector('.group-threads__list') as HTMLElement
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true })
    fireEvent.scroll(list)

    await waitFor(() => expect(screen.getByText('加载更多失败')).toBeTruthy())
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(getSpy).toHaveBeenCalledWith('/groups/g1/threads?cursor=10')
  })
  it('searches the group threads on the server and restores the list when cleared', async () => {
    const item = (id: string, body: string) => ({
      root: msg(id, body, 1),
      state: { rootId: id, groupId: 'g1', following: false, lastReadSeq: 0, unread: 0, mentioned: false },
      live: false,
    })
    const getSpy = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('q=')) return { threads: [item('m2', '发布计划')], next: 5 }
      return { threads: [item('m1', '架构讨论'), item('m2', '发布计划')], next: null }
    })
    const { container } = render(
      <MemoryRouter>
        <GroupThreads group={GROUP} onClose={() => {}} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('架构讨论')).toBeTruthy())

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索话题' }), { target: { value: ' 发布 ' } })
    await waitFor(() => expect(screen.getByText('发布计划')).toBeTruthy())
    expect(screen.queryByText('架构讨论')).toBeNull()
    expect(getSpy).toHaveBeenCalledWith(`/groups/g1/threads?q=${encodeURIComponent('发布')}`)

    const list = container.querySelector('.group-threads__list') as HTMLElement
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true })
    fireEvent.scroll(list)
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(`/groups/g1/threads?q=${encodeURIComponent('发布')}&cursor=5`),
    )

    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await waitFor(() => expect(screen.getByText('架构讨论')).toBeTruthy())
    expect(getSpy).toHaveBeenLastCalledWith('/groups/g1/threads')
  })

  it('says so when no thread matches', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path.includes('q=')
        ? { threads: [], next: null }
        : {
            threads: [
              {
                root: msg('m1', '架构讨论', 1),
                state: {
                  rootId: 'm1',
                  groupId: 'g1',
                  following: false,
                  lastReadSeq: 0,
                  unread: 0,
                  mentioned: false,
                },
                live: false,
              },
            ],
            next: null,
          },
    )
    render(
      <MemoryRouter>
        <GroupThreads group={GROUP} onClose={() => {}} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('架构讨论')).toBeTruthy())
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索话题' }), { target: { value: '不存在' } })
    await waitFor(() => expect(screen.getByText('没有匹配的话题')).toBeTruthy())
  })
})
