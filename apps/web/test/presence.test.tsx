import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePresence } from '../src/ui/presence'

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

  it('unmounts immediately under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    const { rerender } = render(<Box open />)
    rerender(<Box open={false} />)
    expect(box()).toBeNull()
  })
})
