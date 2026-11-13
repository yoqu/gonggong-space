import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, CloseButton, Icon, IconButton, Tabs, useFlash } from '../src/ui'

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

describe('Button busy and done', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('swaps the icon for a spinner while loading, then a check when done, keeping its label', () => {
    const { rerender } = render(<Button icon="arrow-down">拉取</Button>)
    const btn = screen.getByRole('button', { name: '拉取' })
    rerender(
      <Button icon="arrow-down" loading>
        拉取中…
      </Button>,
    )
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('progressbar', { name: '正在处理' })).toBeTruthy()
    rerender(
      <Button icon="arrow-down" done>
        已是最新
      </Button>,
    )
    expect(btn.getAttribute('aria-busy')).toBeNull()
    expect(btn.classList.contains('ui-btn--done')).toBe(true)
    expect(btn.querySelector('.ui-btn__check')).toBeTruthy()
    expect(btn.textContent).toBe('已是最新')
  })

  it('keeps a live icon that animates itself instead of the spinner', () => {
    render(
      <Button icon={<svg data-testid="glyph" />} liveIcon loading>
        提交中…
      </Button>,
    )
    expect(screen.getByTestId('glyph')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('glides between widths when it turns busy or done, not on other renders', () => {
    const widths = [80, 96]
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => widths[0] as number)
    const animate = vi.fn()
    HTMLElement.prototype.animate = animate
    const { rerender } = render(<Button>提交</Button>)
    rerender(<Button title="x">提交</Button>)
    expect(animate).not.toHaveBeenCalled()
    widths.shift()
    rerender(<Button loading>提交中…</Button>)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0]?.[0]).toEqual([{ width: '80px' }, { width: '96px' }])
  })

  it('useFlash turns on for a moment', () => {
    vi.useFakeTimers()
    let flash: () => void = () => {}
    function Harness() {
      const [on, trigger] = useFlash(1200)
      flash = trigger
      return <span>{on ? 'on' : 'off'}</span>
    }
    render(<Harness />)
    act(() => flash())
    expect(screen.getByText('on')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1200))
    expect(screen.getByText('off')).toBeTruthy()
  })
})
