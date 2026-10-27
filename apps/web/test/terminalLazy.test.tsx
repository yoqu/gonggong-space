import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { lazyTerminalUI } from '../src/features/terminal/lazy'

describe('terminal UI lazy loading', () => {
  it('does not load an unused terminal and reuses a preload when rendered', async () => {
    const View = ({ label }: { label: string }) => <div>{label}</div>
    const load = vi.fn(async () => ({ default: View }))
    const terminal = lazyTerminalUI<{ label: string }>(load)

    expect(load).not.toHaveBeenCalled()
    const first = terminal.preload()
    const second = terminal.preload()
    expect(first).toBe(second)
    await act(() => first)
    expect(load).toHaveBeenCalledTimes(1)

    render(
      <Suspense fallback={<div>loading</div>}>
        <terminal.Component label="ready" />
      </Suspense>,
    )
    expect(await screen.findByText('ready')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('starts loading on first render instead of module evaluation', async () => {
    const View = () => <div>terminal ready</div>
    const load = vi.fn(async () => ({ default: View }))
    const terminal = lazyTerminalUI(load)
    render(
      <Suspense fallback={<div>loading</div>}>
        <terminal.Component />
      </Suspense>,
    )

    expect(screen.getByText('loading')).toBeTruthy()
    expect(await screen.findByText('terminal ready')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
