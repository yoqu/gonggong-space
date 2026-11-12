import type { MessageDto } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { UserMessage } from '../src/features/chat/TimelineItems'
import { Linkified, splitUrls } from '../src/lib/links'

describe('splitUrls', () => {
  it('finds http(s) links and stops before CJK text or trailing punctuation', () => {
    expect(splitUrls('看这里https://ex.com/a?b=1中文，还有 http://x.io/p. 结束')).toEqual([
      { text: '看这里' },
      { text: 'https://ex.com/a?b=1', url: true },
      { text: '中文，还有 ' },
      { text: 'http://x.io/p', url: true },
      { text: '. 结束' },
    ])
    expect(splitUrls('没有链接 www.example.com')).toEqual([{ text: '没有链接 www.example.com' }])
    expect(splitUrls('(see https://ex.com/x)')).toEqual([
      { text: '(see ' },
      { text: 'https://ex.com/x', url: true },
      { text: ')' },
    ])
  })
})

describe('Linkified', () => {
  it('opens links in a new tab without bubbling the click', () => {
    const outer = vi.fn()
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test harness
      // biome-ignore lint/a11y/noStaticElementInteractions: test harness
      <div onClick={outer}>
        <Linkified text="文档 https://ex.com/doc 看看" />
      </div>,
    )
    const a = screen.getByRole('link', { name: 'https://ex.com/doc' })
    expect(a.getAttribute('href')).toBe('https://ex.com/doc')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(a)
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('member messages', () => {
  it('make links clickable next to Chinese text and @ mentions, leaving the rest plain', () => {
    const m = {
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'user',
      authorId: 'u2',
      authorName: '李建国',
      body: '@小王的 Claude 看下https://ex.com/pr/12这个 **PR**',
      mentions: ['b1'],
      runId: null,
      createdAt: '2026-09-24T08:00:00Z',
      attachments: [],
      quote: null,
      reactions: [],
    } as MessageDto
    render(
      <MemoryRouter>
        <UserMessage m={m} targets={[{ id: 'b1', name: '小王的 Claude' }]} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'https://ex.com/pr/12' }).getAttribute('href')).toBe(
      'https://ex.com/pr/12',
    )
    expect(screen.getByText('@小王的 Claude')).toBeTruthy()
    expect(document.body.textContent).toContain('这个 **PR**')
  })
})
