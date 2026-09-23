import type { MachineDto } from '@aiws/protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BindMachineDialog } from '../src/features/machines/BindMachineDialog'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

class FakeSocket {
  static last: FakeSocket
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {}
}

const old: MachineDto = {
  id: 'm0',
  ownerId: 'u1',
  name: 'old-box',
  os: 'linux',
  arch: 'x86_64',
  online: true,
  agents: [],
  daemonVersion: '0.1.0',
  lastSeenAt: null,
}
const fresh: MachineDto = {
  ...old,
  id: 'm1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: false,
}
const emit = (machine: MachineDto) =>
  act(() => FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: 'machine.updated', machine }) }))

let codes: string[]
beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  realtime.start()
  codes = ['K7QM-4X2P', 'ABCD-EFGH']
})
afterEach(() => {
  realtime.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const api = (ttlMs = 10 * 60_000) =>
  mockApi({
    'POST /bind-codes': () => ({
      code: codes.shift(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    }),
    'GET /machines': [old],
  })

describe('bind machine dialog', () => {
  it('shows a one-time code, its countdown and the login command', async () => {
    api()
    render(<BindMachineDialog open onClose={() => {}} />)
    expect((await screen.findByTestId('bind-code')).textContent).toBe('K7QM-4X2P')
    expect(screen.getByText(/^一次性绑定码 · (10:00|09:5\d) 后失效$/)).toBeTruthy()
    expect(screen.getByText(`aiws login --server ${location.origin} --code K7QM-4X2P`)).toBeTruthy()
    for (const step of ['生成绑定码', 'daemon 登录', '上报机器与 agent', '确认 bot'])
      expect(screen.getByText(step)).toBeTruthy()
    expect(screen.getByText('等待 daemon 使用绑定码登录…')).toBeTruthy()
  })

  it('shows success with the machine and its agents once a new machine appears', async () => {
    api()
    render(<BindMachineDialog open onClose={() => {}} />)
    await screen.findByTestId('bind-code')
    emit(old)
    expect(screen.queryByText('绑定成功')).toBeNull()
    emit(fresh)
    expect(screen.getByText('绑定成功')).toBeTruthy()
    expect(screen.getByText(/wanglei-mbp/)).toBeTruthy()
    expect(screen.getByText(/等待 daemon 上报/)).toBeTruthy()
    emit({
      ...fresh,
      online: true,
      agents: [
        { kind: 'claude', available: true, version: '2.1.4', path: '/bin/claude' },
        { kind: 'codex', available: false, version: null, path: null },
      ],
    })
    expect(screen.getByText('Claude Code 2.1.4')).toBeTruthy()
    expect(screen.getByText('Codex 未安装')).toBeTruthy()
  })

  it('offers a new code once the current one expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = api(2_000)
    render(<BindMachineDialog open onClose={() => {}} />)
    await screen.findByTestId('bind-code')
    await act(async () => vi.advanceTimersByTime(3_000))
    expect(screen.getByText('绑定码已失效')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect((await screen.findByTestId('bind-code')).textContent).toBe('ABCD-EFGH')
    expect(calls.filter((c) => c.path === '/bind-codes')).toHaveLength(2)
  })
})
