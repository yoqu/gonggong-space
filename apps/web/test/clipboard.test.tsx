import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyWithToast } from '../src/lib/clipboard'
import { useToasts } from '../src/ui'

afterEach(() => {
  useToasts.setState({ items: [] })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const shown = () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
}

describe('copyWithToast', () => {
  Object.assign(navigator, { clipboard: { writeText: () => Promise.resolve() } })

  it('marks the pressed button with a ✓ instead of a toast, then restores it', async () => {
    vi.useFakeTimers()
    shown()
    render(
      <button type="button" onClick={() => void copyWithToast('x', '链接已复制')}>
        复制
      </button>,
    )
    const button = screen.getByRole('button', { name: '复制' })
    fireEvent.click(button)
    await act(async () => {})
    expect(button.hasAttribute('data-copied')).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('链接已复制')
    expect(useToasts.getState().items).toEqual([])
    act(() => vi.advanceTimersByTime(1500))
    expect(button.hasAttribute('data-copied')).toBe(false)
  })

  it('falls back to a toast from a menu item or a keyboard shortcut', async () => {
    shown()
    render(
      <div role="menu">
        <button type="button" role="menuitem" onClick={() => void copyWithToast('x', '已复制')}>
          复制
        </button>
      </div>,
    )
    fireEvent.click(screen.getByRole('menuitem'))
    await act(async () => {})
    expect(useToasts.getState().items.map((x) => x.message)).toEqual(['已复制'])
    useToasts.setState({ items: [] })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000)
    await act(() => copyWithToast('x', '已复制路径'))
    expect(useToasts.getState().items.map((x) => x.message)).toEqual(['已复制路径'])
  })

  it('extends the ✓ flash when clicked again before the first timer fires', async () => {
    vi.useFakeTimers()
    shown()
    render(
      <button type="button" onClick={() => void copyWithToast('x', '链接已复制')}>
        复制
      </button>,
    )
    const button = screen.getByRole('button', { name: '复制' })
    fireEvent.click(button)
    await act(async () => {})
    expect(button.hasAttribute('data-copied')).toBe(true)
    act(() => vi.advanceTimersByTime(1000))
    fireEvent.click(button)
    await act(async () => {})
    act(() => vi.advanceTimersByTime(600))
    expect(button.hasAttribute('data-copied')).toBe(true)
    act(() => vi.advanceTimersByTime(900))
    expect(button.hasAttribute('data-copied')).toBe(false)
  })
})
