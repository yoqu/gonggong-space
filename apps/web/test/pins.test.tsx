import type { MessageDto, PinnedMessageDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { type ActionTarget, MessageActions } from '../src/features/chat/MessageActions'
import { PinnedMessages } from '../src/features/chat/PinnedMessages'
import { mockApi } from './mockApi'

const pin = (o: Partial<PinnedMessageDto> = {}): PinnedMessageDto => ({
  messageId: 'm1',
  seq: 3,
  authorName: '王磊',
  text: '上线窗口：周四 20:00',
  attachments: 0,
  pinnedBy: { id: 'u2', name: '李建国' },
  pinnedAt: '2026-10-22T03:00:00.000Z',
  ...o,
})

const message = {
  id: 'm1',
  seq: 3,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '上线窗口：周四 20:00',
  mentions: [],
  runId: null,
  createdAt: new Date().toISOString(),
  attachments: [],
  quote: null,
} as unknown as MessageDto

const target = (): ActionTarget => ({ message, link: '', onQuote: () => {}, copyText: message.body })

function openMenu() {
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <MessageActions {...target()} />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: '更多' }))
}

beforeEach(() => useWorkspace.setState({ pins: {} }))

describe('消息置顶', () => {
  it('pins a message from its menu, and offers to unpin a pinned one', async () => {
    const calls = mockApi({
      'POST /groups/g1/pins': { pins: [pin()] },
      'DELETE /groups/g1/pins/m1': undefined,
    })
    openMenu()
    fireEvent.click(await screen.findByText('置顶'))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', path: '/groups/g1/pins', body: { messageId: 'm1' } }),
    )
    await waitFor(() => expect(useWorkspace.getState().pins.g1).toEqual([pin()]))
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('取消置顶'))
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/groups/g1/pins/m1' }))
  })

  it('shows the newest pin atop the chat, lists them all on demand and jumps to one', () => {
    useWorkspace.setState({
      pins: { g1: [pin({ messageId: 'm2', text: '', attachments: 2 }), pin()] },
    })
    const onLocate = vi.fn()
    render(<PinnedMessages groupId="g1" onLocate={onLocate} />)
    const bar = screen.getByTestId('pinned-messages')
    expect(bar.textContent).toContain('王磊：[2 个附件]')
    fireEvent.click(screen.getByRole('button', { name: '全部 2 条置顶' }))
    const items = screen.getAllByTestId('pinned-item')
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('[2 个附件]'),
      expect.stringContaining('上线窗口：周四 20:00'),
    ])
    fireEvent.click(screen.getByRole('button', { name: /上线窗口/ }))
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }))
  })

  it('opens a link in a pin by itself; the rest of the line still jumps to the message', () => {
    useWorkspace.setState({ pins: { g1: [pin({ text: '文档 https://ex.com/doc 请看' })] } })
    const onLocate = vi.fn()
    render(<PinnedMessages groupId="g1" onLocate={onLocate} />)
    const link = screen.getByRole('link', { name: 'https://ex.com/doc' })
    expect(link.getAttribute('target')).toBe('_blank')
    fireEvent.click(link)
    expect(onLocate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /文档/ }))
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }))
  })

  it('follows group.pins events and hides when nothing is pinned', () => {
    render(<PinnedMessages groupId="g1" onLocate={() => {}} />)
    expect(screen.queryByTestId('pinned-messages')).toBeNull()
    act(() => useWorkspace.getState().applyEvent({ t: 'group.pins', groupId: 'g1', pins: [pin()] }))
    expect(screen.getByTestId('pinned-messages').textContent).toContain('上线窗口：周四 20:00')
  })
})
