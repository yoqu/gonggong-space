import type { TerminalDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/features/terminal/TerminalView'

const mocks = vi.hoisted(() => {
  const events: Array<{ type: string; target: unknown }> = []
  class Terminal {
    static instances: Terminal[] = []
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    data: ((value: string) => void) | undefined
    resizeHandler: ((value: { cols: number; rows: number }) => void) | undefined
    writes: Uint8Array[] = []
    opened = false
    focused = 0
    disposed = 0
    textarea = document.createElement('textarea')
    constructor() {
      Terminal.instances.push(this)
    }
    loadAddon() {}
    open() {
      this.opened = true
    }
    focus() {
      this.focused++
    }
    dispose() {
      this.disposed++
    }
    write(value: Uint8Array, callback?: () => void) {
      this.writes.push(value)
      callback?.()
    }
    attachCustomKeyEventHandler() {}
    registerLinkProvider() { return { dispose: vi.fn() } }
    getSelection() { return '' }
    paste() {}
    blur() {}
    onData(fn: (value: string) => void) {
      this.data = fn
      return { dispose: vi.fn() }
    }
    onBinary() {
      return { dispose: vi.fn() }
    }
    onResize(fn: (value: { cols: number; rows: number }) => void) {
      this.resizeHandler = fn
      return { dispose: vi.fn() }
    }
    input(value: string) {
      this.data?.(value)
    }
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      this.resizeHandler?.({ cols, rows })
    }
  }
  class FitAddon {
    static instances: FitAddon[] = []
    calls: string[] = []
    order = 0
    term: Terminal | undefined
    constructor() {
      FitAddon.instances.push(this)
    }
    activate(term: Terminal) {
      this.term = term
    }
    fit() {
      this.calls.push('fit')
      events.push({ type: 'fit', target: this })
    }
  }
  const create = vi.fn(() => {
    events.push({ type: 'create', target: null })
  })
  return { Terminal, FitAddon, create, end: vi.fn(), events }
})

vi.mock('@xterm/xterm', () => ({ Terminal: mocks.Terminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: mocks.FitAddon }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class { findNext() {} clearDecorations() {} dispose() {} } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('../src/features/terminal/api', () => ({
  createTerminal: mocks.create,
  endTerminal: mocks.end,
  terminalSocketUrl: (id: string, after = 0) => `ws://terminals/${id}${after ? `?after=${after}` : ''}`,
  resolveTerminalLink: vi.fn(),
}))

const sessionId = '7ca45f50-93a2-4f7f-b0c1-ff1dd24ef731'
const dto: TerminalDto = {
  sessionId,
  groupId: 'g1',
  botId: 'b1',
  status: 'running',
  createdAt: '2026-10-27T08:00:00Z',
  lastActiveAt: '2026-10-27T08:00:00Z',
  exitCode: null,
  reason: null,
}

class Socket {
  static instances: Socket[] = []
  static OPEN = 1
  readyState = 0
  binaryType = ''
  sent: Array<string | Uint8Array> = []
  closed = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  constructor(readonly url: string) {
    Socket.instances.push(this)
  }
  send(value: string | Uint8Array) {
    this.sent.push(value)
  }
  close() {
    this.closed++
    this.readyState = 3
  }
  disconnect(code = 1013) {
    this.readyState = 3
    this.onclose?.({ code } as CloseEvent)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  json(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent)
  }
  data(seq: number, value: string) {
    const data = new TextEncoder().encode(value)
    const bytes = new Uint8Array(data.length + 4)
    new DataView(bytes.buffer).setUint32(0, seq)
    bytes.set(data, 4)
    this.onmessage?.({ data: bytes.buffer } as MessageEvent)
  }
}

const lastTerm = () => mocks.Terminal.instances.at(-1)!
const lastFit = () => mocks.FitAddon.instances.at(-1)!
const lastSocket = () => Socket.instances.at(-1)!

beforeEach(() => {
  vi.stubGlobal('WebSocket', Socket)
  mocks.Terminal.instances.length = 0
  mocks.FitAddon.instances.length = 0
  Socket.instances.length = 0
  mocks.events.length = 0
  mocks.create.mockReset().mockImplementation(() => {
    mocks.events.push({ type: 'create', target: null })
    return Promise.resolve(dto)
  })
  mocks.end.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('terminal view', () => {
  it('fits before creating once in StrictMode, then attaches and forwards binary input and resize', async () => {
    const onSession = vi.fn()
    render(
      <StrictMode>
        <TerminalView groupId="g1" botId="b1" active onSession={onSession} />
      </StrictMode>,
    )
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(lastFit().calls[0]).toBe('fit')
    const createAt = mocks.events.findIndex((e) => e.type === 'create')
    expect(mocks.events.some((e, index) => e.type === 'fit' && index < createAt)).toBe(true)
    expect(mocks.create).toHaveBeenCalledWith('g1', 'b1', { cols: 80, rows: 24 })
    await waitFor(() => expect(Socket.instances).toHaveLength(1))
    expect(lastSocket().url).toBe(`ws://terminals/${sessionId}`)
    expect(onSession).toHaveBeenCalledWith(sessionId)
    act(() => {
      lastSocket().open()
      lastSocket().json({ sessionId, status: 'running', cols: 80, rows: 24, next: 1 })
    })
    expect(screen.getByText('终端运行中')).toBeTruthy()
    act(() => lastTerm().input('echo hi\r'))
    expect(new TextDecoder().decode(lastSocket().sent[0] as Uint8Array)).toBe('echo hi\r')
    act(() => lastTerm().resize(120, 32))
    expect(JSON.parse(lastSocket().sent[1] as string)).toEqual({
      op: 'resize',
      sessionId,
      cols: 120,
      rows: 32,
    })
  })

  it('attaches an existing session, writes binary output without its sequence, and detaches without ending', async () => {
    const view = render(<TerminalView sessionId={sessionId} active />)
    const socket = lastSocket()
    act(() => {
      socket.open()
      socket.data(8, 'hello\r\n')
    })
    await waitFor(() => expect(lastTerm().writes).toHaveLength(1))
    expect(new TextDecoder().decode(lastTerm().writes[0])).toBe('hello\r\n')
    view.rerender(<TerminalView sessionId={sessionId} active={false} />)
    expect(mocks.end).not.toHaveBeenCalled()
    view.unmount()
    expect(socket.closed).toBe(1)
    expect(mocks.end).not.toHaveBeenCalled()
  })

  it('only ends a terminal after explicit confirmation', async () => {
    render(<TerminalView sessionId={sessionId} active />)
    act(() => lastSocket().json({ status: 'running' }))
    fireEvent.click(screen.getByRole('button', { name: '结束终端…' }))
    const dialog = within(screen.getByRole('alertdialog', { name: '结束终端？' }))
    expect(mocks.end).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: '结束终端' }))
    await waitFor(() => expect(mocks.end).toHaveBeenCalledWith(sessionId))
    expect(screen.getAllByText('终端已结束').length).toBeGreaterThan(0)
  })

  it('shows forbidden and exited states without sending more input', async () => {
    const onExit = vi.fn()
    render(<TerminalView sessionId={sessionId} active onExit={onExit} />)
    act(() => lastSocket().json({ op: 'reset', code: 'forbidden' }))
    expect(screen.getByText('没有权限使用此终端，仅机器主人可访问')).toBeTruthy()
    act(() => lastSocket().json({ op: 'exit', state: 'exited', exitCode: 7, reason: 'exited' }))
    expect(onExit).toHaveBeenCalledWith(7, 'exited')
    expect(screen.getByText('Shell 已退出，退出码 7')).toBeTruthy()
  })

  it('shows an API creation error and does not open a socket', async () => {
    mocks.create.mockRejectedValue(new Error('denied'))
    render(<TerminalView groupId="g1" botId="b1" active />)
    expect(await screen.findByText('denied')).toBeTruthy()
    expect(Socket.instances).toHaveLength(0)
  })

  it('waits for activation before fitting and creating a hidden tab', async () => {
    const view = render(<TerminalView groupId="g1" botId="b1" active={false} />)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(Socket.instances).toHaveLength(0)
    view.rerender(<TerminalView groupId="g1" botId="b1" active />)
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    const createAt = mocks.events.findIndex((e) => e.type === 'create')
    expect(mocks.events.findIndex((e) => e.type === 'fit' && e.target === lastFit())).toBeLessThan(createAt)
  })

  it('reopens the persisted session instead of creating another PTY', () => {
    render(<TerminalView sessionId={sessionId} groupId="g1" botId="b1" active />)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(lastSocket().url).toBe(`ws://terminals/${sessionId}`)
  })

  it('reconnects the same session from its last output sequence without creating another PTY', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<TerminalView sessionId={sessionId} active />)
    const first = lastSocket()
    act(() => {
      first.open()
      first.json({ sessionId, status: 'running', next: 9 })
      first.data(8, 'hello\r\n')
      first.disconnect()
    })
    expect(screen.getByText('正在连接终端…')).toBeTruthy()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(Socket.instances).toHaveLength(2)
    expect(lastSocket().url).toBe(`ws://terminals/${sessionId}?after=8`)
    expect(mocks.create).not.toHaveBeenCalled()
    act(() => {
      lastSocket().open()
      lastSocket().json({ sessionId, status: 'running', next: 9 })
    })
    expect(screen.getByText('终端运行中')).toBeTruthy()
    vi.useRealTimers()
  })
})
