import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ICON_NAMES, Icon } from '../src/ui'
import { DRAWN_PATHS } from '../src/ui/icons/drawn'
import { PANE_PATHS } from '../src/ui/icons/pane'

describe('Icon', () => {
  it('renders an 18-grid svg at the requested size with Pane stroke defaults', () => {
    const { container } = render(<Icon name="folder" size={20} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('viewBox')).toBe('0 0 18 18')
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('1.4')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M2\.5 5\.2c/)
  })

  it('defaults to 16px and applies weight, color and className', () => {
    const { container } = render(<Icon name="check" weight={2} color="var(--system-orange)" className="x" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('stroke-width')).toBe('2')
    expect(svg.style.color).toBe('var(--system-orange)')
    expect(svg.getAttribute('class')).toBe('x')
  })

  it('is decorative without a label', () => {
    const { container } = render(<Icon name="gear" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('role')).toBeNull()
  })

  it('is an image with an accessible name when labelled', () => {
    const { getByRole } = render(<Icon name="pin" label="已置顶" />)
    const svg = getByRole('img', { name: '已置顶' })
    expect(svg.getAttribute('aria-hidden')).toBeNull()
  })

  it('ships all 73 Pane v2 icons and never shadows one with a drawn glyph', () => {
    expect(Object.keys(PANE_PATHS)).toHaveLength(73)
    for (const name of ['undo', 'external', 'copy', 'eye-slash', 'chevron-down', 'hard-drive', 'appearance'])
      expect(ICON_NAMES, name).toContain(name)
    expect(Object.keys(DRAWN_PATHS).filter((name) => name in PANE_PATHS)).toEqual([])
  })

  it('renders Pane originals for names Pane v2 added', () => {
    const { container } = render(<Icon name="copy" />)
    expect(container.querySelector('path')?.getAttribute('d')).toBe(PANE_PATHS.copy)
  })
})
