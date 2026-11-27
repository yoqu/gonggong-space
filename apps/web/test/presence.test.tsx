import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog, Presence } from '../src/ui/overlay'
import { useLeaving, usePresence } from '../src/ui/presence'

function Box({ open }: { open: boolean }) {
  const p = usePresence(open, { timeout: 500 })
  return p.mounted ? <div data-testid="box" data-state={p.state} onAnimationEnd={p.onAnimationEnd} /> : null
}

const box = () => screen.queryByTestId('box')

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('usePresence', () => {
  it('mounts open and stays mounted as closed until the exit animation ends', () => {
    const { rerender } = render(<Box open={false} />)
    expect(box()).toBeNull()
    rerender(<Box open />)
    expect(box()?.dataset.state).toBe('open')
    rerender(<Box open={false} />)
    expect(box()?.dataset.state).toBe('closed')
    fireEvent.animationEnd(box()!)
    expect(box()).toBeNull()
  })

  it('ignores animationend bubbling from children', () => {
    function Parent({ open }: { open: boolean }) {
      const p = usePresence(open)
      return p.mounted ? (
        <div data-testid="box" onAnimationEnd={p.onAnimationEnd}>
          <span data-testid="child" />
        </div>
      ) : null
    }
    const { rerender } = render(<Parent open />)
    rerender(<Parent open={false} />)
    fireEvent.animationEnd(screen.getByTestId('child'))
    expect(box()).not.toBeNull()
  })

  it('unmounts after the timeout when no animation runs', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Box open />)
    rerender(<Box open={false} />)
    act(() => vi.advanceTimersByTime(499))
    expect(box()).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(box()).toBeNull()
  })

  it('restores open when reopened while closing', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Box open />)
    rerender(<Box open={false} />)
    rerender(<Box open />)
    expect(box()?.dataset.state).toBe('open')
    act(() => vi.advanceTimersByTime(1000))
    fireEvent.animationEnd(box()!)
    expect(box()?.dataset.state).toBe('open')
  })

  it('keeps the fade-out exit under reduced motion and unmounts on animationend or short timeout', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    const { rerender } = render(<Box open />)
    rerender(<Box open={false} />)
    expect(box()?.dataset.state).toBe('closed')
    act(() => vi.advanceTimersByTime(129))
    expect(box()).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(box()).toBeNull()
  })
})

describe('useLeaving', () => {
  it('keeps fade-out leaving state under reduced motion instead of dropping synchronously', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    const gone = vi.fn()
    function Rows() {
      const { leaving, leave } = useLeaving(220)
      return (
        <button type="button" data-leaving={leaving.has('a') || undefined} onClick={() => leave('a', gone)}>
          删
        </button>
      )
    }
    render(<Rows />)
    const btn = screen.getByRole('button', { name: '删' })
    fireEvent.click(btn)
    expect(btn.hasAttribute('data-leaving')).toBe(true)
    expect(gone).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(130))
    expect(gone).toHaveBeenCalledOnce()
    expect(btn.hasAttribute('data-leaving')).toBe(false)
  })

  it('drops the row as .ui-leaving (--fade-out) ends by default, leaving no blank gap', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const gone = vi.fn()
    function Rows() {
      const { leave } = useLeaving()
      return (
        <button type="button" onClick={() => leave('a', gone)}>
          删
        </button>
      )
    }
    render(<Rows />)
    fireEvent.click(screen.getByRole('button', { name: '删' }))
    act(() => vi.advanceTimersByTime(110))
    expect(gone).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(20))
    expect(gone).toHaveBeenCalledOnce()
  })

  it('drops pending exits on unmount instead of updating a gone tree', () => {
    vi.useFakeTimers()
    const gone = vi.fn()
    function Rows() {
      const { leave } = useLeaving(220)
      return (
        <button type="button" onClick={() => leave('a', gone)}>
          删
        </button>
      )
    }
    const { unmount } = render(<Rows />)
    fireEvent.click(screen.getByRole('button', { name: '删' }))
    unmount()
    act(() => vi.advanceTimersByTime(500))
    expect(gone).not.toHaveBeenCalled()
  })
})

describe('Presence', () => {
  it('treats multiple false conditional children as closed and animates the last open child out', () => {
    vi.useFakeTimers()
    function Host({ a, b }: { a: boolean; b: boolean }) {
      return (
        <Presence>
          {a && <Dialog open title="弹窗甲" onClose={() => {}} />}
          {b && <Dialog open title="弹窗乙" onClose={() => {}} />}
        </Presence>
      )
    }
    const { rerender } = render(<Host a={false} b={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<Host a b={false} />)
    const dlg = screen.getByRole('dialog', { name: '弹窗甲' })
    expect(dlg.parentElement?.dataset.state).toBe('open')

    rerender(<Host a={false} b={false} />)
    expect(dlg.parentElement?.dataset.state).toBe('closed')
    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
