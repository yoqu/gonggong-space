import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IconButton, Tabs } from '../src/ui'

// jsdom has no layout: give each tab a position derived from its index.
const tabIndex = (el: HTMLElement) => [...(el.parentElement?.children ?? [])].indexOf(el)
const saved = {
  left: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft'),
  width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
}
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return 2 + tabIndex(this) * 50
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return 40 + tabIndex(this) * 10
    },
  })
})
afterAll(() => {
  if (saved.left) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', saved.left)
  if (saved.width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.width)
})

describe('Tabs indicator', () => {
  it('moves the sliding indicator to the selected tab', () => {
    function Harness() {
      const [v, setV] = useState<'a' | 'b'>('a')
      return (
        <Tabs
          value={v}
          onChange={setV}
          items={[
            { value: 'a', label: '过程' },
            { value: 'b', label: '改动' },
          ]}
        />
      )
    }
    render(<Harness />)
    const list = screen.getByRole('tablist')
    expect(list.style.getPropertyValue('--indicator-x')).toBe('2px')
    expect(list.style.getPropertyValue('--indicator-w')).toBe('40px')
    fireEvent.click(screen.getByRole('tab', { name: '改动' }))
    expect(list.style.getPropertyValue('--indicator-x')).toBe('52px')
    expect(list.style.getPropertyValue('--indicator-w')).toBe('50px')
  })

  it('hides the indicator when nothing is selected', () => {
    render(<Tabs value={'x' as 'a'} onChange={() => {}} items={[{ value: 'a', label: '过程' }]} />)
    expect(screen.getByRole('tablist').style.getPropertyValue('--indicator-w')).toBe('0px')
  })
})

describe('IconButton', () => {
  it('adds the glass toolbar class for variant="glass"', () => {
    render(
      <>
        <IconButton title="plain">+</IconButton>
        <IconButton title="toolbar" variant="glass">
          +
        </IconButton>
      </>,
    )
    expect(screen.getByRole('button', { name: 'plain' }).className).toBe('ui-icon-btn')
    expect(screen.getByRole('button', { name: 'toolbar' }).className).toBe('ui-icon-btn ui-icon-btn--glass')
  })
})
