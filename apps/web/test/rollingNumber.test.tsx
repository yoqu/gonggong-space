import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Badge, RollingNumber } from '../src/ui'

const cells = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.ui-roll__face > span')]
const digit = (el: HTMLElement) => el.style.getPropertyValue('--d')

afterEach(() => vi.unstubAllGlobals())

describe('RollingNumber', () => {
  it('keeps the exact text for queries and screen readers; the drawn face is hidden', () => {
    const { container } = render(<RollingNumber value="待我处理 12" />)
    const roll = container.querySelector<HTMLElement>('.ui-roll')!
    expect(roll.textContent).toBe('待我处理 12')
    expect(screen.getByText('待我处理 12')).toBeTruthy()
    expect(roll.querySelector('.ui-roll__face')!.getAttribute('aria-hidden')).toBe('true')
    // Initial mount skips rolling.
    expect(roll.hasAttribute('data-static')).toBe(true)
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
    const roll = container.querySelector<HTMLElement>('.ui-roll')!
    expect(roll.hasAttribute('data-static')).toBe(true)
    const units = cells(container)[0]!
    rerender(<RollingNumber value={10} />)
    expect(roll.hasAttribute('data-static')).toBe(false)
    const [tens, units2] = cells(container)
    expect(units2).toBe(units)
    expect(digit(units2!)).toBe('0')
    expect(digit(tens!)).toBe('1')
  })

  it('splits trailing units and skips rolling on unit/magnitude change (980 -> 1.0k), then rolls within the same unit', () => {
    const { container, rerender } = render(<RollingNumber value="980" />)
    const roll = container.querySelector<HTMLElement>('.ui-roll')!
    rerender(<RollingNumber value="990" />)
    expect(roll.hasAttribute('data-static')).toBe(false)

    // Unit changed "" -> "k": skip rolling so keys/width do not scramble.
    rerender(<RollingNumber value="1.0k" />)
    expect(roll.hasAttribute('data-static')).toBe(true)
    expect(cells(roll).map((c) => c.className)).toEqual([
      'ui-roll__digit',
      'ui-roll__char',
      'ui-roll__digit',
      'ui-roll__char',
    ])
    const tenth = cells(roll)[2]!

    // Same unit "k": rolls smoothly and preserves the digit element.
    rerender(<RollingNumber value="1.1k" />)
    expect(roll.hasAttribute('data-static')).toBe(false)
    expect(cells(roll)[2]).toBe(tenth)
    expect(digit(tenth)).toBe('1')
  })

  it('skips rolling under prefers-reduced-motion: reduce', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    const { container, rerender } = render(<RollingNumber value={5} />)
    rerender(<RollingNumber value={6} />)
    expect(container.querySelector('.ui-roll')?.hasAttribute('data-static')).toBe(true)
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
