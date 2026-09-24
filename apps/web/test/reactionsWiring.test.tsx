import type { MessageDto } from '@aiws/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageActions } from '../src/features/chat/MessageActions'

const msg = {
  id: 'm1',
  groupId: 'g1',
  reactions: [
    {
      emoji: '👍',
      count: 2,
      mine: true,
      users: [
        { id: 'u1', name: '甲' },
        { id: 'u2', name: '乙' },
      ],
    },
  ],
} as unknown as MessageDto

describe('reactions in the hover bar', () => {
  it('offers the picker first for a message', () => {
    render(<MessageActions message={msg} link="" onQuote={() => {}} />)
    const buttons = screen.getByRole('toolbar', { name: '消息操作' }).querySelectorAll('button')
    expect(buttons[0]?.title).toBe('添加表情回应')
  })

  it('has no picker for a run card without its reply', () => {
    render(<MessageActions message={null} link="" onQuote={() => {}} />)
    expect(screen.queryByTitle('添加表情回应')).toBeNull()
  })
})
