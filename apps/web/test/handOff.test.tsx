import type { BotDto, GroupDto, MessageDto } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { useCite } from '../src/features/chat/cite'
import { BotReply } from '../src/features/chat/TimelineItems'

const bot = (id: string, name: string) => ({ id, name, avatar: 'role-no' }) as BotDto
const reply = (o: Partial<MessageDto>): MessageDto => ({
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'bot',
  authorId: 'b1',
  authorName: 'MBP 的 CC',
  body: '',
  mentions: [],
  runId: null,
  createdAt: '2026-09-29T08:00:00Z',
  attachments: [],
  quote: null,
  reactions: [],
  ...o,
})

beforeEach(() => {
  useCite.setState({ pending: null })
  useWorkspace.setState({
    groups: [{ id: 'g1', botIds: ['b1', 'b2', 'b3'] } as GroupDto],
    bots: [bot('b1', 'MBP 的 CC'), bot('b2', 'CC专家'), bot('b3', '测试员'), bot('b4', '别群的 Bot')],
  })
})

describe('让它处理', () => {
  it('offers the group bots a reply mentions, and puts the @ into the composer', () => {
    render(
      <BotReply
        m={reply({ body: '1. 改好后 @MBP 的 CC\n2. 或者直接 @CC专家 发预览，@别群的 Bot 也行，@CC专家' })}
      />,
    )
    expect(screen.getAllByRole('button', { name: /处理$/ }).map((b) => b.textContent)).toEqual([
      '让 CC专家 处理',
    ])
    fireEvent.click(screen.getByRole('button', { name: '让 CC专家 处理' }))
    expect(useCite.getState().pending).toEqual({ groupId: 'g1', text: '@CC专家' })
  })

  it('offers nothing for a hand-off message, whose bot is already running', () => {
    render(<BotReply m={reply({ body: '@CC专家 发预览', mentions: ['b2'] })} />)
    expect(screen.queryByRole('button', { name: /处理$/ })).toBeNull()
  })
})
