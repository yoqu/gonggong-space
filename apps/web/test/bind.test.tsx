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

const promptOf = (code: string) =>
  `帮我接入共工空间：读取 ${location.origin}/api/install.md 并按步骤执行，接入码 ${code}。`

const api = (ttlMs = 30 * 60_000) =>
  mockApi({
    'POST /bind-codes': () => {
      const code = codes.shift() as string
      return {
        code,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        link: linkOf(code),
        agentPrompt: promptOf(code),
      }
    },
    'GET /machines': [old],
  })

const request = {
  id: 'r1',
  machine: { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' },
  agent: 'claude',
  ip: '203.0.113.7',
  userCode: 'X7QM',
  status: 'pending',
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
}

/** 其他方式: the desktop app, the gg login command and Docker. */
const others = () => fireEvent.click(screen.getByRole('button', { name: '其他方式' }))
const openLink = async () => {
  await screen.findByRole('button', { name: '复制' })
  if (!screen.queryByRole('link', { name: '在客户端中打开' })) others()
  return screen.findByRole('link', { name: '在客户端中打开' })
}

const show = (props: { onClose?: () => void; onNewBot?: (machineId: string) => void } = {}) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={<BindMachineDialog open onClose={props.onClose ?? (() => {})} onNewBot={props.onNewBot} />}
        />
        <Route path="/machine/:id" element={<p>machine page</p>} />
        <Route path="/g/:id" element={<p>dm page</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('bind machine dialog', () => {
  it('leads with a sentence for the local agent, copied in one click, the other ways folded away', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    api()
    show()
    const card = await screen.findByRole('region', { name: '发给你的 Agent' })
    expect(within(card).getByText(promptOf('K7QM-4X2P'))).toBeTruthy()
    // A silent loop above the sentence shows what happens after pasting it.
    const demo = within(card).getByLabelText('一句话接入演示') as HTMLVideoElement
    expect(demo.loop).toBe(true)
    // No countdown: an expired code still binds, through a confirmation here.
    expect(within(card).getByText('接入码过期也能接入，届时在这里点一下允许')).toBeTruthy()
    expect(card.textContent).not.toMatch(/后失效/)
    // One line of explanation (the dialog message); what the client reports is folded away.
    const dialog = screen.getByRole('dialog', { name: '绑定新机器' })
    expect(dialog.textContent).toContain('它会自己安装 gg、绑定这台机器并建好 Bot')
    expect(card.textContent).not.toContain('支持 macOS 和 Linux')
    expect(screen.queryByText(/客户端会上报机器名/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '了解上报内容' }))
    expect(screen.getByText(/客户端会上报机器名/)).toBeTruthy()
    expect(screen.getByText('等待接入…Agent 会自己下载安装，通常 1–3 分钟')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '在客户端中打开' })).toBeNull()
    expect(screen.queryByText(/Windows 上请展开/)).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith(promptOf('K7QM-4X2P'))
    expect(await within(card).findByRole('button', { name: '已复制' })).toBeTruthy()
    others()
    expect(screen.getByRole('link', { name: '在客户端中打开' })).toBeTruthy()
  })

  it('opens the DM once the agent has bound the machine and made the bot', async () => {
    api()
    const onClose = vi.fn()
    show({ onClose, onNewBot: () => {} })
    await screen.findByRole('button', { name: '复制' })
    const step = (name: string) =>
      screen.getByText(name, { selector: '.ui-step__label' }).closest('li')?.getAttribute('data-status')
    expect(step('复制给 Agent')).toBe('active')
    expect(step('机器接入')).toBe('pending')
    emit(fresh)
    expect(step('复制给 Agent')).toBe('completed')
    expect(step('机器接入')).toBe('completed')
    expect(step('Bot 就绪')).toBe('active')
    act(() =>
      FakeSocket.last.onmessage?.({
        data: JSON.stringify({ t: 'machine.onboarded', machineId: 'm1', botId: 'b1', groupId: 'g1' }),
      }),
    )
    expect(await screen.findByText('dm page')).toBeTruthy()
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the 接入链接 in the desktop app and copies it', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    api()
    show()
    expect((await openLink()).getAttribute('href')).toBe(linkOf('K7QM-4X2P'))
    expect(screen.getByText('没有自动打开？复制接入链接，粘贴到客户端。')).toBeTruthy()
    // Three steps, the client download first.
    const sections = ['安装客户端', '打开接入链接', '等待接入'].map((name) =>
      screen.getByRole('region', { name }),
    )
    for (let i = 1; i < sections.length; i++)
      expect(
        sections[i - 1]!.compareDocumentPosition(sections[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    expect(sections[0]!.textContent).toContain('已经装好客户端可以跳过这一步')
    expect(within(sections[1]!).getByRole('link', { name: '在客户端中打开' })).toBeTruthy()
    expect(screen.queryByText('还没安装客户端？')).toBeNull()
    expect(within(sections[2]!).getByText('等待接入…Agent 会自己下载安装，通常 1–3 分钟')).toBeTruthy()
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
        agentPrompt: promptOf('K7QM-4X2P'),
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
    await screen.findByRole('button', { name: '复制' })
    others()
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
    await screen.findByRole('button', { name: '复制' })
    others()
    expect(await screen.findByRole('link', { name: '下载 macOS（Intel）' })).toBeTruthy()
    unmount()
    // Windows has no install.sh: the other ways open at once, with a word on why.
    browser(WIN)
    withDownloads(published)
    show()
    expect(await screen.findByText('Windows 上请展开「其他方式」，用桌面客户端绑定。')).toBeTruthy()
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

  it('ticks ① once 我已安装 is pressed', async () => {
    api()
    show()
    await openLink()
    const install = screen.getByRole('region', { name: '安装客户端' })
    fireEvent.click(within(install).getByRole('button', { name: '我已安装' }))
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
    // 共字君 celebrates instead of a plain notice.
    const done = within(screen.getByRole('region', { name: '已接入的机器' })).getByRole('img', {
      name: '共字君',
    })
    expect(done.getAttribute('data-action')).toBe('done')
    // One way forward: 新建 Bot leads, 稍后 steps back; 查看机器 and 完成 are gone.
    expect(screen.getByRole('button', { name: '新建 Bot' }).className).toContain('ui-btn--primary')
    expect(screen.getByRole('button', { name: '稍后' }).className).not.toContain('ui-btn--primary')
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull()
    expect(screen.getByText(/wanglei-mbp/)).toBeTruthy()
    // Bound through the desktop app: its agents come once the client runs.
    expect(screen.getByText(/等待上报 agent…在机器上打开共工空间客户端/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: '等待机器上线' })).toBeNull()
    expect(screen.getByRole('region', { name: '已接入的机器' })).toBeTruthy()
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

  it('waits for the machine to come online, not for a client, when the agent bound it', async () => {
    api()
    show({ onNewBot: () => {} })
    await screen.findByRole('button', { name: '复制' })
    emit(fresh)
    expect(screen.getByText('等待机器上线…')).toBeTruthy()
    expect(screen.queryByText(/打开共工空间客户端/)).toBeNull()
  })

  it('leaves with 稍后 and offers no 查看机器 once online', async () => {
    api()
    const onClose = vi.fn()
    show({ onClose, onNewBot: () => {} })
    await openLink()
    emit({ ...fresh, online: true })
    expect(screen.getByRole('region', { name: '已接入的机器' }).textContent).toContain('机器已上线')
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

  it('swaps in a new code silently once the current one expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = api(2_000)
    show()
    await openLink()
    await act(async () => vi.advanceTimersByTime(3_000))
    expect((await openLink()).getAttribute('href')).toBe(linkOf('ABCD-EFGH'))
    const card = screen.getByRole('region', { name: '发给你的 Agent' })
    expect(within(card).getByText(promptOf('ABCD-EFGH'))).toBeTruthy()
    expect(screen.queryByText(/已失效/)).toBeNull()
    expect(calls.filter((c) => c.path === '/bind-codes')).toHaveLength(2)
  })

  it('keeps a validity note for Docker, which only binds with the code', async () => {
    api()
    show()
    await openLink()
    fireEvent.click(screen.getByRole('button', { name: '在 Docker 中运行' }))
    expect(screen.getByText(/接入码 30 分钟内有效，过期请重新生成/)).toBeTruthy()
  })

  it('asks right here when a machine whose code expired requests to be bound', async () => {
    const calls = mockApi({
      'POST /bind-codes': {
        code: 'K7QM-4X2P',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        link: linkOf('K7QM-4X2P'),
        agentPrompt: promptOf('K7QM-4X2P'),
      },
      'GET /machines': [old],
      'POST /link-requests/r1/approve': { ...request, status: 'approved' },
    })
    show()
    const card = await screen.findByRole('region', { name: '发给你的 Agent' })
    expect(screen.queryByRole('region', { name: '机器接入申请' })).toBeNull()
    act(() => FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: 'machine.linkRequested', request }) }))
    const ask = within(card).getByRole('region', { name: '机器接入申请' })
    expect(ask.textContent).toContain('wanglei-mbp')
    expect(within(ask).getByText('X7QM')).toBeTruthy()
    fireEvent.click(within(ask).getByRole('button', { name: '允许接入' }))
    expect(await within(ask).findByText('已允许接入')).toBeTruthy()
    expect(calls.some((c) => c.path === '/link-requests/r1/approve')).toBe(true)
    emit(fresh)
    expect(screen.getByText('绑定成功')).toBeTruthy()
  })
})
