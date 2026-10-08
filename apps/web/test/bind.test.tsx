import type { MachineDto } from '@gonggong/protocol'
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
  features: [],
  lastSeenAt: null,
  hostname: 'old-box',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
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

const linkOf = (code: string) => `gonggong://bind?server=${encodeURIComponent(location.origin)}&code=${code}`

const api = (ttlMs = 10 * 60_000) =>
  mockApi({
    'POST /bind-codes': () => {
      const code = codes.shift() as string
      return {
        code,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        link: linkOf(code),
      }
    },
    'GET /machines': [old],
  })

const openLink = () => screen.findByRole('link', { name: '在客户端中打开' })

describe('bind machine dialog', () => {
  it('opens the 接入链接 in the desktop app and copies it', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    api()
    render(<BindMachineDialog open onClose={() => {}} />)
    expect((await openLink()).getAttribute('href')).toBe(linkOf('K7QM-4X2P'))
    expect(await screen.findByText(/^一次性接入链接 · (10:00|09:5\d) 后失效$/)).toBeTruthy()
    expect(screen.getByText('没有自动打开？复制接入链接，粘贴到客户端。')).toBeTruthy()
    for (const step of ['生成接入链接', '客户端绑定', '上报机器与 agent'])
      expect(screen.getByText(step)).toBeTruthy()
    expect(screen.queryByText('确认 Bot')).toBeNull()
    expect(screen.getByText('等待客户端确认绑定…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制接入链接' }))
    expect(writeText).toHaveBeenCalledWith(linkOf('K7QM-4X2P'))
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  })

  it('links the installers published on this server, or GitHub before any is published', async () => {
    const sha256 = 'a'.repeat(64)
    mockApi({
      'POST /bind-codes': {
        code: 'K7QM-4X2P',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        link: '',
      },
      'GET /machines': [],
      'GET /client-downloads': {
        version: '0.3.0',
        builds: { 'linux-x86_64': { url: '/downloads/gonggong-0.3.0-linux-x86_64', sha256 } },
        desktop: {
          'macos-aarch64': { url: '/downloads/Gonggong_0.3.0_aarch64.dmg', sha256 },
          'windows-x86_64': { url: '/downloads/Gonggong_0.3.0_x64-setup.exe', sha256 },
        },
      },
    })
    const { unmount } = render(<BindMachineDialog open onClose={() => {}} />)
    expect((await screen.findByRole('link', { name: 'macOS（Apple 芯片）' })).getAttribute('href')).toBe(
      '/downloads/Gonggong_0.3.0_aarch64.dmg',
    )
    expect(screen.getByRole('link', { name: 'Windows' }).getAttribute('href')).toBe(
      '/downloads/Gonggong_0.3.0_x64-setup.exe',
    )
    expect(screen.getByRole('link', { name: 'Linux x86_64（命令行）' }).getAttribute('href')).toBe(
      '/downloads/gonggong-0.3.0-linux-x86_64',
    )
    unmount()

    api()
    render(<BindMachineDialog open onClose={() => {}} />)
    expect((await screen.findByRole('link', { name: '前往 GitHub 下载' })).getAttribute('href')).toBe(
      'https://github.com/yoqu/gonggong-space/releases/latest',
    )
  })

  it('keeps the gg login command under 使用命令行', async () => {
    api()
    render(<BindMachineDialog open onClose={() => {}} />)
    await openLink()
    const command = `gg login --server ${location.origin} --code K7QM-4X2P`
    expect(screen.queryByText(command)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '使用命令行' }))
    expect(screen.getByText(command)).toBeTruthy()
  })

  it('shows success with the machine and its agents once a new machine appears', async () => {
    api()
    render(<BindMachineDialog open onClose={() => {}} />)
    await openLink()
    emit(old)
    expect(screen.queryByText('绑定成功')).toBeNull()
    emit(fresh)
    expect(screen.getByText('绑定成功')).toBeTruthy()
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy()
    expect(screen.getByText(/wanglei-mbp/)).toBeTruthy()
    expect(screen.getByText(/等待上报 agent/)).toBeTruthy()
    emit({
      ...fresh,
      online: true,
      agents: [
        {
          kind: 'claude',
          available: true,
          version: '2.1.4',
          path: '/bin/claude',
          minVersion: '2.0.0',
          catalog: null,
        },
        { kind: 'codex', available: false, version: null, path: null, minVersion: '0.40.0', catalog: null },
      ],
    })
    expect(screen.getByText('Claude Code 2.1.4')).toBeTruthy()
    expect(screen.getByText('Codex 未安装')).toBeTruthy()
  })

  it('recognizes a known host logging in again as a restored machine', async () => {
    api()
    render(<BindMachineDialog open onClose={() => {}} />)
    await openLink()
    await act(async () => {})
    emit({ ...old, online: false })
    expect(screen.queryByText('绑定成功')).toBeNull()
    emit({ ...old, boundAt: '2026-09-24T08:00:00Z' })
    expect(screen.getByText('已恢复原有机器')).toBeTruthy()
    expect(screen.getByText(/old-box/)).toBeTruthy()
  })

  it('offers a new code once the current one expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = api(2_000)
    render(<BindMachineDialog open onClose={() => {}} />)
    await openLink()
    await act(async () => vi.advanceTimersByTime(3_000))
    expect(screen.getByText('接入链接已失效')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '在客户端中打开' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect((await openLink()).getAttribute('href')).toBe(linkOf('ABCD-EFGH'))
    expect(calls.filter((c) => c.path === '/bind-codes')).toHaveLength(2)
  })
})
