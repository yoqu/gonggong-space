import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge, RollingNumber } from '../src/ui'

const cells = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.ui-roll__face > span')]
const digit = (el: HTMLElement) => el.style.getPropertyValue('--d')

describe('RollingNumber', () => {
  it('keeps the exact text for queries and screen readers; the drawn face is hidden', () => {
    const { container } = render(<RollingNumber value="待我处理 12" />)
    const roll = container.querySelector<HTMLElement>('.ui-roll')!
    expect(roll.textContent).toBe('待我处理 12')
    expect(screen.getByText('待我处理 12')).toBeTruthy()
    expect(roll.querySelector('.ui-roll__face')!.getAttribute('aria-hidden')).toBe('true')
    // Digits become rolling strips, the rest are drawn as they are.
    expect(cells(roll).map((c) => c.className)).toEqual([
      ...Array(5).fill('ui-roll__char'),
      'ui-roll__digit',
      'ui-roll__digit',
    ])
    expect(cells(roll).slice(-2).map(digit)).toEqual(['1', '2'])
  })

  it('keeps each place (counted from the right) on the same element, so a change rolls instead of remounting', () => {
    const { container, rerender } = render(<RollingNumber value={9} />)
    const units = cells(container)[0]!
    rerender(<RollingNumber value={10} />)
    const [tens, units2] = cells(container)
    expect(units2).toBe(units)
    expect(digit(units2!)).toBe('0')
    expect(digit(tens!)).toBe('1')
  })

  it('rolls the unread badge instead of popping it again on every new count', () => {
    const { container, rerender } = render(<Badge count={3} />)
    const badge = container.querySelector('.ui-badge')!
    expect(badge.getAttribute('aria-label')).toBe('3 条未读')
    rerender(<Badge count={4} />)
    expect(container.querySelector('.ui-badge')).toBe(badge)
    expect(badge.textContent).toBe('4')
  })
})
