import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BottomScrollPill, TopUnreadPill } from '../src/features/chat/ScrollPills'

describe('ScrollPills exit presence', () => {
  it('makes exiting top/bottom pills inert and retains the last positive count while fading out', () => {
    const { rerender, container } = render(
      <>
        <TopUnreadPill show count={5} onClick={() => {}} />
        <BottomScrollPill unseen={3} away onClick={() => {}} />
      </>,
    )
    const top = container.querySelector('.chat-scroll__pill--top') as HTMLElement
    const bottomCount = container.querySelector(
      '.chat-scroll__pill:not(.chat-scroll__pill--top)',
    ) as HTMLElement
    expect(top.textContent).toContain('5 条新消息')
    expect(bottomCount.textContent).toContain('3 条新消息')
    expect(top.hasAttribute('inert')).toBe(false)
    expect(bottomCount.hasAttribute('inert')).toBe(false)

    rerender(
      <>
        <TopUnreadPill show={false} count={0} onClick={() => {}} />
        <BottomScrollPill unseen={0} away onClick={() => {}} />
      </>,
    )
    expect(top.dataset.state).toBe('closed')
    expect(top.hasAttribute('inert')).toBe(true)
    expect(top.getAttribute('aria-hidden')).toBe('true')
    expect(top.textContent).toContain('5 条新消息')
    expect(top.textContent).not.toContain('0 条新消息')

    expect(bottomCount.dataset.state).toBe('closed')
    expect(bottomCount.hasAttribute('inert')).toBe(true)
    expect(bottomCount.getAttribute('aria-hidden')).toBe('true')
    expect(bottomCount.textContent).toContain('3 条新消息')
    expect(bottomCount.textContent).not.toContain('0 条新消息')

    // Jump-to-bottom button also becomes inert when hiding.
    const jump = screen.getByRole('button', { name: '回到底部' })
    rerender(
      <>
        <TopUnreadPill show={false} count={0} onClick={() => {}} />
        <BottomScrollPill unseen={0} away={false} onClick={() => {}} />
      </>,
    )
    expect(jump.dataset.state).toBe('closed')
    expect(jump.hasAttribute('inert')).toBe(true)
    expect(jump.getAttribute('aria-hidden')).toBe('true')
    fireEvent.animationEnd(jump)
    expect(container.querySelector('.chat-scroll__bottom')).toBeNull()
  })
})
