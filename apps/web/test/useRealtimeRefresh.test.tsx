import type { WebEvent } from '@gonggong/protocol'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRealtimeRefresh } from '../src/lib/useRealtimeRefresh'

const rt = vi.hoisted(() => ({
  handlers: new Set<(e: { t: string }) => void>(),
  reconnects: new Set<() => void>(),
}))
vi.mock('../src/lib/realtime', () => ({
  realtime: {
    subscribe: (h: (e: { t: string }) => void) => {
      rt.handlers.add(h)
      return () => rt.handlers.delete(h)
    },
    onReconnect: (cb: () => void) => {
      rt.reconnects.add(cb)
      return () => rt.reconnects.delete(cb)
    },
  },
}))

const emit = (t: string) => {
  for (const h of rt.handlers) h({ t })
}
const isHit = (e: WebEvent) => e.t === 'saved.changed'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  rt.handlers.clear()
  rt.reconnects.clear()
})

describe('useRealtimeRefresh', () => {
  it('loads at once, coalesces a burst of matching events and ignores others', () => {
    const load = vi.fn()
    renderHook(() => useRealtimeRefresh(load, isHit))
    expect(load).toHaveBeenCalledTimes(1)
    emit('saved.changed')
    vi.advanceTimersByTime(200)
    emit('saved.changed')
    emit('message.new')
    vi.advanceTimersByTime(299)
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(load).toHaveBeenCalledTimes(2)
    emit('message.new')
    vi.advanceTimersByTime(1000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reloads on reconnect', () => {
    const load = vi.fn()
    renderHook(() => useRealtimeRefresh(load, isHit))
    for (const cb of rt.reconnects) cb()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps one subscription across renders with an inline matcher', () => {
    const load = vi.fn()
    const { rerender } = renderHook(() => useRealtimeRefresh(load, (e) => e.t === 'saved.changed'))
    rerender()
    expect(load).toHaveBeenCalledTimes(1)
    expect(rt.handlers.size).toBe(1)
  })

  it('unsubscribes and drops a pending refresh on unmount', () => {
    const load = vi.fn()
    const { unmount } = renderHook(() => useRealtimeRefresh(load, isHit))
    emit('saved.changed')
    unmount()
    vi.advanceTimersByTime(1000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(rt.handlers.size).toBe(0)
    expect(rt.reconnects.size).toBe(0)
  })
})
