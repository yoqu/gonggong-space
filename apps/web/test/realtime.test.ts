import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRealtime } from '../src/lib/realtime'

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  closed = false
  sent: unknown[] = []
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  open() {
    this.onopen?.()
  }
  drop() {
    this.onclose?.()
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
}

const last = () => FakeSocket.all.at(-1) as FakeSocket
const sentOf = (t: string) => (last().sent as { t: string }[]).filter((m) => m.t === t)
const focuses = () => sentOf('focus')
const visibility = () => sentOf('visible').map((m) => (m as unknown as { visible: boolean }).visible)

beforeEach(() => {
  FakeSocket.all = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('realtime client', () => {
  it('connects to /ws/web on the page origin', () => {
    const rt = createRealtime()
    rt.start()
    expect(last().url).toBe(`ws://${location.host}/ws/web`)
    rt.stop()
  })

  it('reports status and reconnects with exponential backoff capped at 10s', () => {
    const rt = createRealtime()
    const statuses: string[] = []
    rt.onStatus((s) => statuses.push(s))
    rt.start()
    expect(rt.getStatus()).toBe('connecting')

    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      const before = FakeSocket.all.length
      last().drop()
      let waited = 0
      while (FakeSocket.all.length === before) {
        vi.advanceTimersByTime(100)
        waited += 100
      }
      delays.push(waited)
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000])
    expect(statuses).toContain('closed')

    last().open()
    expect(rt.getStatus()).toBe('open')
    const before = FakeSocket.all.length
    last().drop()
    vi.advanceTimersByTime(500)
    expect(FakeSocket.all.length).toBe(before + 1)
    rt.stop()
  })

  it('delivers valid events and ignores invalid or unknown ones', () => {
    const rt = createRealtime()
    const got: unknown[] = []
    rt.subscribe((e) => got.push(e))
    rt.start()
    last().open()
    const ev = { t: 'run.delta', runId: 'r1', text: 'hi', lastActivityAt: new Date().toISOString() }
    last().emit('not json')
    last().emit({ t: 'unknown.kind' })
    last().emit({ t: 'run.delta', runId: 1 })
    last().emit(ev)
    expect(got).toEqual([ev])
    rt.stop()
  })

  it('reports reconnects only: not the first open after subscribing while connecting', () => {
    const rt = createRealtime()
    rt.start()
    const reconnect = vi.fn()
    const off = rt.onReconnect(reconnect)
    last().open()
    expect(reconnect).not.toHaveBeenCalled()

    last().drop()
    vi.advanceTimersByTime(500)
    last().open()
    expect(reconnect).toHaveBeenCalledTimes(1)

    off()
    last().drop()
    vi.advanceTimersByTime(1000)
    last().open()
    expect(reconnect).toHaveBeenCalledTimes(1)
    rt.stop()
  })

  it('counts an already open socket as connected, so its first drop and return is a reconnect', () => {
    const rt = createRealtime()
    rt.start()
    last().open()
    const reconnect = vi.fn()
    rt.onReconnect(reconnect)
    last().drop()
    vi.advanceTimersByTime(500)
    last().open()
    expect(reconnect).toHaveBeenCalledTimes(1)
    rt.stop()
  })

  it('tells the server which group is shown once open, and again after every reconnect', () => {
    const rt = createRealtime()
    rt.start()
    last().open()
    expect(focuses()).toEqual([])

    rt.focus('g1')
    rt.focus(null)
    expect(focuses()).toEqual([
      { t: 'focus', groupId: 'g1' },
      { t: 'focus', groupId: null },
    ])

    rt.focus('g2')
    last().drop()
    vi.advanceTimersByTime(500)
    expect(focuses()).toEqual([])
    last().open()
    expect(focuses()).toEqual([{ t: 'focus', groupId: 'g2' }])
    rt.stop()
  })

  it('sends a group focused before the socket opened when it opens', () => {
    const rt = createRealtime()
    rt.focus('g1')
    rt.start()
    expect(focuses()).toEqual([])
    last().open()
    expect(focuses()).toEqual([{ t: 'focus', groupId: 'g1' }])
    rt.stop()
  })

  it('tells the server whether the page is on screen and focused, on open and on every change', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const rt = createRealtime()
    rt.start()
    last().open()
    expect(visibility()).toEqual([true])
    hasFocus.mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))
    hasFocus.mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    expect(visibility()).toEqual([true, false, true])
    rt.stop()
    window.dispatchEvent(new Event('blur'))
    expect(visibility()).toEqual([true, false, true])
    hasFocus.mockRestore()
  })

  it('stops without reconnecting and unsubscribes', () => {
    const rt = createRealtime()
    const handler = vi.fn()
    const off = rt.subscribe(handler)
    rt.start()
    const sock = last()
    off()
    sock.open()
    sock.emit({ t: 'run.delta', runId: 'r1', text: 'x' })
    expect(handler).not.toHaveBeenCalled()
    rt.stop()
    expect(sock.closed).toBe(true)
    vi.advanceTimersByTime(20000)
    expect(FakeSocket.all.length).toBe(1)
    expect(rt.getStatus()).toBe('closed')
  })
})
