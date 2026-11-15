import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Brand, Logo } from '../src/ui/brand'

describe('Logo（对眼 gg）', () => {
  it('draws two g marks with pupils from 32px up', () => {
    const { container } = render(<Logo size={40} />)
    expect(container.querySelectorAll('.ui-logo__g')).toHaveLength(2)
    expect(container.querySelectorAll('.ui-logo__pupil')).toHaveLength(2)
  })

  it('uses the small version without pupils below 32px', () => {
    const { container } = render(<Logo size={20} />)
    expect(container.querySelectorAll('.ui-logo__g')).toHaveLength(2)
    expect(container.querySelector('.ui-logo__pupil')).toBeNull()
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('20')
  })

  it('keeps the motion modifiers and drops the old mark', () => {
    const { container } = render(<Logo size={48} motion="idle" />)
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('ui-logo--idle')).toBe(true)
    expect(
      container.querySelector('linearGradient, .ui-logo__hand, .ui-logo__jade, .ui-logo__water'),
    ).toBeNull()
  })

  it('Brand pairs the mark with the product name', () => {
    const { container, getByText } = render(<Brand size={28} motion="enter" />)
    expect(container.querySelector('.ui-logo--enter')).not.toBeNull()
    expect(getByText('共工空间')).toBeTruthy()
  })
})
