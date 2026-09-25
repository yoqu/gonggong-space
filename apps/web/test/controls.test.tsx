import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CloseButton, Icon, IconButton, Tabs } from '../src/ui'

describe('Tabs', () => {
  it('keeps tab semantics and moves with arrow keys', () => {
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
    expect(screen.getByRole('tablist')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: '过程' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '改动' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('IconButton', () => {
  it('is a circular Pane button named by its title', () => {
    render(
      <>
        <IconButton title="plain">
          <Icon name="search" />
        </IconButton>
        <IconButton title="toolbar" variant="glass">
          <Icon name="bell" />
        </IconButton>
      </>,
    )
    expect(screen.getByRole('button', { name: 'plain' }).className).toBe(
      'ui-btn ui-btn--plain ui-btn--large ui-btn--icon ui-icon-btn',
    )
    expect(screen.getByRole('button', { name: 'toolbar' }).className).toContain('ui-btn--glass')
  })

  it('CloseButton defaults to 关闭', () => {
    render(<CloseButton />)
    expect(screen.getByRole('button', { name: '关闭' }).className).toContain('ui-close')
  })
})
