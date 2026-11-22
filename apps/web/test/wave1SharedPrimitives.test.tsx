import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGroupStore } from '../src/lib/groupStore'
import { parseHttpUrl } from '../src/lib/links'
import { realtime } from '../src/lib/realtime'
import { browserTimeZone } from '../src/lib/time'
import { useUnsavedWarn } from '../src/lib/unsaved'
import { Alert, GroupRow } from '../src/ui'

function UnsavedProbe({ dirty }: { dirty: boolean }) {
  useUnsavedWarn(dirty)
  return <div>{dirty ? 'dirty' : 'clean'}</div>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shared UI & lib primitives', () => {
  it('Alert renders a built-in retry button when onRetry is provided', () => {
    const onRetry = vi.fn()
    render(<Alert variant="error" description="加载失败" onRetry={onRetry} />)
    const btn = screen.getByRole('button', { name: '重试' })
    expect(btn.closest('.ui-alert__retry')).toBeTruthy()
    // Description-only alert with onRetry should use the leading icon, not the inline desc icon.
    expect(document.querySelector('.ui-alert__icon')).toBeTruthy()
    expect(document.querySelector('.ui-alert__desc-icon')).toBeNull()
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('GroupRow emits ui-group__row--stacked when stacked is true', () => {
    const { container } = render(
      <GroupRow label="凭证" stacked>
        <span>内容</span>
      </GroupRow>,
    )
    expect(container.querySelector('.ui-group__row--stacked')).toBeTruthy()
  })

  it('createGroupStore supports reconnect="reload" and nullable groupId', async () => {
    const reconnect: { cb?: () => void } = {}
    const unsubEvent = vi.fn()
    const unsubReconnect = vi.fn()
    vi.spyOn(realtime, 'subscribe').mockReturnValue(unsubEvent)
    vi.spyOn(realtime, 'onReconnect').mockImplementation((cb) => {
      reconnect.cb = cb
      return unsubReconnect
    })

    let seq = 0
    const store = createGroupStore<number>({
      load: async () => ++seq,
      onEvent: () => null,
      reconnect: 'reload',
    })

    function View({ id }: { id: string | null }) {
      const val = store.use(id)
      return <div data-testid="val">{val ?? 'none'}</div>
    }

    const { rerender } = render(<View id={null} />)
    expect(screen.getByTestId('val').textContent).toBe('none')
    expect(seq).toBe(0)

    rerender(<View id="g1" />)
    expect(await screen.findByText('1')).toBeTruthy()

    // Reconnect reloads in place without flashing undefined.
    reconnect.cb?.()
    expect(screen.getByTestId('val').textContent).toBe('1')
    expect(await screen.findByText('2')).toBeTruthy()

    store.reset()
    expect(unsubEvent).toHaveBeenCalledTimes(1)
    expect(unsubReconnect).toHaveBeenCalledTimes(1)
  })

  it('useUnsavedWarn registers and cleans up beforeunload only when dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { rerender, unmount } = render(<UnsavedProbe dirty={false} />)
    expect(addSpy.mock.calls.some(([ev]) => ev === 'beforeunload')).toBe(false)

    rerender(<UnsavedProbe dirty />)
    expect(addSpy.mock.calls.some(([ev]) => ev === 'beforeunload')).toBe(true)

    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)

    unmount()
    expect(removeSpy.mock.calls.some(([ev]) => ev === 'beforeunload')).toBe(true)
  })

  it('parseHttpUrl validates real URLs and rejects malformed strings that match loose regexes', () => {
    expect(parseHttpUrl('https://example.com/a')?.url).toBe('https://example.com/a')
    expect(parseHttpUrl('example.com/a', true)?.url).toBe('https://example.com/a')
    expect(parseHttpUrl('example.com/a', false)).toBeNull()
    expect(parseHttpUrl('http://:80', true)).toBeNull()
    expect(parseHttpUrl('https://[bad', true)).toBeNull()
    expect(parseHttpUrl('javascript:alert(1)', true)).toBeNull()
    expect(typeof browserTimeZone).toBe('string')
  })
})
