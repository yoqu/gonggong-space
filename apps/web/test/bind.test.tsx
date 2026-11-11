import type { MachineDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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

const show = (props: { onClose?: () => void; onNewBot?: (machineId: string) => void } = {}) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={<BindMachineDialog open onClose={props.onClose ?? (() => {})} onNewBot={props.onNewBot} />}
        />
        <Route path="/machine/:id" element={<p>machine page</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('bind machine dialog', () => {
  it('opens the 接入链接 in the desktop app and copies it', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    api()
    show()
    expect((await openLink()).getAttribute('href')).toBe(linkOf('K7QM-4X2P'))
    expect(await screen.findByText(/^一次性接入链接 · (10:00|09:5\d) 后失效$/)).toBeTruthy()
    expect(screen.getByText('没有自动打开？复制接入链接，粘贴到客户端。')).toBeTruthy()
    // Three steps, the client download first.
    const sections = ['安装客户端', '打开接入链接', '等待机器上线'].map((name) =>
      screen.getByRole('region', { name }),
    )
    for (let i = 1; i < sections.length; i++)
      expect(
        sections[i - 1]!.compareDocumentPosition(sections[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    expect(sections[0]!.textContent).toContain('已经装好客户端可以跳过这一步')
    expect(within(sections[1]!).getByRole('link', { name: '在客户端中打开' })).toBeTruthy()
    expect(screen.queryByText('还没安装客户端？')).toBeNull()
    expect(within(sections[2]!).getByText('等待机器上线…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制接入链接' }))
    expect(writeText).toHaveBeenCalledWith(linkOf('K7QM-4X2P'))
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  })

  const sha256 = 'a'.repeat(64)
  const published = {
    version: '0.3.2',
    builds: { 'linux-x86_64': { url: '/downloads/gonggong-0.3.2-linux-x86_64', sha256 } },
    desktop: {
      'macos-aarch64': { url: '/downloads/Gonggong_0.3.2_aarch64.dmg', sha256 },
      'macos-x86_64': { url: '/downloads/Gonggong_0.3.2_x86_64.dmg', sha256 },
      'windows-x86_64': { url: '/downloads/Gonggong_0.3.2_x64-setup.exe', sha256 },
    },
  }
  const withDownloads = (downloads: unknown) =>
    mockApi({
      'POST /bind-codes': {
        code: 'K7QM-4X2P',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        link: '',
      },
      'GET /machines': [],
      'GET /client-downloads': downloads,
    })
  const browser = (userAgent: string, architecture?: string) =>
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent,
      userAgentData: architecture ? { getHighEntropyValues: async () => ({ architecture }) } : undefined,
    })
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'
  const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'

  it('recommends the installer for the browser system and lets the user pick another one', async () => {
    browser(MAC, 'arm')
    withDownloads(published)
    show()
    const download = await screen.findByRole('link', { name: '下载 macOS（Apple 芯片）' })
    expect(download.getAttribute('href')).toBe('/downloads/Gonggong_0.3.2_aarch64.dmg')
    expect(screen.getByText('桌面客户端 · v0.3.2')).toBeTruthy()
    const options = screen.getByRole('group', { name: '选择系统' })
    const recommended = within(options).getByRole('radio', { name: /macOS（Apple 芯片）/ })
    expect((recommended as HTMLInputElement).checked).toBe(true)
    expect(within(recommended.closest('label') as HTMLElement).getByText('推荐')).toBeTruthy()

    fireEvent.click(within(options).getByRole('radio', { name: /Linux x86_64（命令行）/ }))
    expect(screen.getByRole('link', { name: '下载 Linux x86_64（命令行）' }).getAttribute('href')).toBe(
      '/downloads/gonggong-0.3.2-linux-x86_64',
    )
    expect(screen.getByText('命令行客户端 · v0.3.2')).toBeTruthy()
  })

  it('tells Intel Macs and Windows apart', async () => {
    browser(MAC, 'x86')
    withDownloads(published)
    const { unmount } = show()
    expect(await screen.findByRole('link', { name: '下载 macOS（Intel）' })).toBeTruthy()
    unmount()
    browser(WIN)
    withDownloads(published)
    show()
    expect((await screen.findByRole('link', { name: '下载 Windows' })).getAttribute('href')).toBe(
      '/downloads/Gonggong_0.3.2_x64-setup.exe',
    )
  })

  it('points to GitHub before any client is published', async () => {
    browser(WIN)
    withDownloads(null)
    show()
    expect((await screen.findByRole('link', { name: '前往 GitHub 下载' })).getAttribute('href')).toBe(
      'https://github.com/yoqu/gonggong-space/releases/latest',
    )
  })

  it('ticks ① once 我已安装 is pressed and moves on to ②', async () => {
    api()
    show()
    await openLink()
    const step = (name: string) =>
      screen.getByText(name, { selector: '.ui-step__label' }).closest('li')?.getAttribute('data-status')
    expect(step('安装客户端')).toBe('active')
    expect(step('打开接入链接')).toBe('pending')
    const install = screen.getByRole('region', { name: '安装客户端' })
    fireEvent.click(within(install).getByRole('button', { name: '我已安装' }))
    expect(step('安装客户端')).toBe('completed')
    expect(step('打开接入链接')).toBe('active')
    expect(within(install).queryByRole('button', { name: '我已安装' })).toBeNull()
    expect(install.textContent).toContain('已安装客户端')
  })

  it('keeps the gg login command under 使用命令行', async () => {
    api()
    show()
    await openLink()
    const command = `gg login --server ${location.origin} --code K7QM-4X2P`
    expect(screen.queryByText(command)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '使用命令行' }))
    expect(screen.getByText(command)).toBeTruthy()
  })

  it('shows success with the machine and its agents once a new machine appears', async () => {
    api()
    const onNewBot = vi.fn()
    show({ onNewBot })
    await openLink()
    emit(old)
    expect(screen.queryByText('绑定成功')).toBeNull()
    emit(fresh)
    expect(screen.getByText('绑定成功')).toBeTruthy()
    // One way forward: 新建 Bot leads, 稍后 steps back; 查看机器 and 完成 are gone.
    expect(screen.getByRole('button', { name: '新建 Bot' }).className).toContain('ui-btn--primary')
    expect(screen.getByRole('button', { name: '稍后' }).className).not.toContain('ui-btn--primary')
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull()
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
        { kind: 'codex', available: false, version: null, path: null, minVersion: '0.160.1', catalog: null },
      ],
    })
    expect(screen.getByText('Claude Code 2.1.4')).toBeTruthy()
    expect(screen.getByText('Codex 未安装')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建 Bot' }))
    expect(onNewBot).toHaveBeenCalledWith('m1')
  })

  it('leaves with 稍后 and offers no 查看机器 once online', async () => {
    api()
    const onClose = vi.fn()
    show({ onClose, onNewBot: () => {} })
    await openLink()
    emit({ ...fresh, online: true })
    expect(screen.getByRole('region', { name: '等待机器上线' }).textContent).toContain('机器已上线')
    expect(screen.queryByRole('button', { name: '查看机器' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '新建 Bot' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '稍后' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('recognizes a known host logging in again as a restored machine', async () => {
    api()
    show()
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
    show()
    await openLink()
    await act(async () => vi.advanceTimersByTime(3_000))
    expect(screen.getByText('接入链接已失效')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '在客户端中打开' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect((await openLink()).getAttribute('href')).toBe(linkOf('ABCD-EFGH'))
    expect(calls.filter((c) => c.path === '/bind-codes')).toHaveLength(2)
  })
})
