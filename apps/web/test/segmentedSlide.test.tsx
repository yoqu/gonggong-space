import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SegmentedControl, Tabs } from '../src/ui'

// jsdom has no layout: give each segment a 60px slot and a width that grows with its label.
const proto = HTMLElement.prototype
const saved = {
  left: Object.getOwnPropertyDescriptor(proto, 'offsetLeft'),
  width: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
}
const slot = (el: HTMLElement) => [...(el.parentElement?.children ?? [])].indexOf(el)
beforeAll(() => {
  Object.defineProperty(proto, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('ui-seg__item') ? 2 + slot(this) * 60 : 0
    },
  })
  Object.defineProperty(proto, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('ui-seg__item') ? 40 + (this.textContent?.length ?? 0) * 8 : 0
    },
  })
})
afterAll(() => {
  if (saved.left) Object.defineProperty(proto, 'offsetLeft', saved.left)
  if (saved.width) Object.defineProperty(proto, 'offsetWidth', saved.width)
})

const items = [
  { value: 'd', label: '日' },
  { value: 'w', label: '一周' },
  { value: 'm', label: '月' },
]
const bar = () => document.querySelector<HTMLElement>('.ui-seg')!
const thumb = () => document.querySelector<HTMLElement>('.ui-seg__thumb')

describe('segmented selection slides', () => {
  it('draws one thumb under the selected segment, placed by its offset and width', () => {
    render(<SegmentedControl aria-label="范围" items={items} defaultValue="w" />)
    expect(thumb()).toBeTruthy()
    // The thumb is the first child: segments are 1-based in the slot math below.
    expect(bar().style.getPropertyValue('--seg-x')).toBe(`${2 + 2 * 60}px`)
    expect(bar().style.getPropertyValue('--seg-w')).toBe(`${40 + 2 * 8}px`)
  })

  it('moves the thumb to the new segment on change', () => {
    render(<SegmentedControl aria-label="范围" items={items} defaultValue="d" />)
    expect(bar().style.getPropertyValue('--seg-x')).toBe('62px')
    fireEvent.click(screen.getByRole('radio', { name: '月' }))
    expect(bar().style.getPropertyValue('--seg-x')).toBe(`${2 + 3 * 60}px`)
    expect(bar().style.getPropertyValue('--seg-w')).toBe('48px')
  })

  it('switches transitions on once the first placement is in, and keeps them across re-renders', () => {
    const { rerender } = render(<SegmentedControl aria-label="范围" items={items} value="m" />)
    expect(bar().style.getPropertyValue('--seg-x')).toBe('182px')
    expect(bar().hasAttribute('data-ready')).toBe(true)
    rerender(<SegmentedControl aria-label="范围" items={items} value="d" />)
    expect(bar().hasAttribute('data-ready')).toBe(true)
  })

  it('hides the thumb when nothing is selected, and slides for Tabs too', () => {
    const { unmount } = render(
      <Tabs aria-label="视图" items={items} value={'x' as 'd'} onChange={() => {}} />,
    )
    expect(bar().hasAttribute('data-empty')).toBe(true)
    unmount()
    render(<Tabs aria-label="视图" items={items} value="w" onChange={() => {}} />)
    expect(bar().hasAttribute('data-empty')).toBe(false)
    expect(thumb()).toBeTruthy()
  })
})
