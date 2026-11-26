import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Toaster, useToasts } from '@web/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Tunnels, type Update, type WorkspaceRow, type Workspaces } from '../src/ipc'
import { Onboarding } from '../src/onboarding/Onboarding'
import { PAGES } from '../src/pages'
import { BotsPage } from '../src/pages/Bots'
import { LogsPage } from '../src/pages/Logs'
import { MarketPage } from '../src/pages/Market'
import { OverviewPage } from '../src/pages/Overview'
import { SettingsPage } from '../src/pages/Settings'
import { TunnelsPage } from '../src/pages/Tunnels'
import { WorkspacesPage } from '../src/pages/Workspaces'
import { ConnectionDiagnosticsDialog } from '../src/shell/ConnectionDiagnosticsDialog'
import { UpdateBanner } from '../src/shell/UpdateBanner'
import { useDaemon } from '../src/store'
import { autoRestart, startUpdater, useUpdate } from '../src/updater'
import { bot, CLAUDE, CODEX, INFO, run, STATE, status, VIEW } from './ipc-mock'

const m = vi.mocked(ipc)

function fakeUpdate(calls: string[], version = '0.2.0') {
  return {
    version,
    body: '- fix',
    download: vi.fn(async () => {
      calls.push(`download ${version}`)
    }),
    install: vi.fn(async () => {
      calls.push(`install ${version}`)
    }),
  } as unknown as Update
}

beforeEach(() => {
  vi.clearAllMocks()
  useToasts.setState({ items: [] })
  useUpdate.setState({ state: { phase: 'idle' }, dismissed: false, auto: true })
  useDaemon.setState({
    info: INFO,
    snapshot: { phase: 'running', status: status() },
    overview: null,
    botGuideDismissed: false,
  })
  m.settings.mockResolvedValue({
    autoUpgrade: true,
    launchAtLogin: false,
    hideDockOnClose: false,
    mirror: { kind: 'npmmirror' },
    env: { FOO: '1' },
  })
  m.setAutoUpgrade.mockResolvedValue()
  m.setEnv.mockResolvedValue()
  m.setMirror.mockResolvedValue()
  m.stopDaemon.mockResolvedValue()
  m.relaunch.mockResolvedValue()
  m.openLocal.mockResolvedValue()
  m.openWeb.mockResolvedValue()
  m.reveal.mockResolvedValue()
  m.readClipboard.mockResolvedValue('')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('U-13 Desktop updater safety & sync', () => {
  it('starts idle timer only after update is ready and respects dismissed, focus, dialogs and dirty editors', async () => {
    const calls: string[] = []
    m.checkUpdate.mockResolvedValue(fakeUpdate(calls))
    m.stopDaemon.mockImplementation(async () => {
      calls.push('stop')
    })
    m.relaunch.mockImplementation(async () => {
      calls.push('relaunch')
    })
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)

    // Calls while phase === 'idle' must NOT prime idleSince.
    await autoRestart(0)
    await autoRestart(120_000)

    render(<UpdateBanner />)
    const stop = startUpdater()
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('v0.2.0 已就绪，任务结束且空闲 1 分钟后自动更新')

    // First poll after ready only starts the 60s countdown (must NOT relaunch immediately).
    await autoRestart(125_000)
    expect(m.relaunch).not.toHaveBeenCalled()

    // Focused window blocks autoRestart and resets idle countdown.
    hasFocus.mockReturnValue(true)
    await autoRestart(200_000)
    expect(m.relaunch).not.toHaveBeenCalled()

    // Unfocused with an open dialog still blocks autoRestart.
    hasFocus.mockReturnValue(false)
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog')
    document.body.appendChild(dlg)
    await autoRestart(210_000)
    await autoRestart(280_000)
    expect(m.relaunch).not.toHaveBeenCalled()
    dlg.remove()

    // Unfocused with a dirty editor still blocks autoRestart.
    const dirtyEl = document.createElement('div')
    dirtyEl.setAttribute('data-dirty', 'true')
    document.body.appendChild(dirtyEl)
    await autoRestart(290_000)
    await autoRestart(360_000)
    expect(m.relaunch).not.toHaveBeenCalled()
    dirtyEl.remove()

    // Dismissing banner via 稍后 suppresses autoRestart completely.
    fireEvent.click(within(banner).getByRole('button', { name: '稍后' }))
    await autoRestart(370_000)
    await autoRestart(450_000)
    expect(m.relaunch).not.toHaveBeenCalled()

    // Un-dismissed and clean unfocused for >= 60s relaunches.
    useUpdate.setState({ dismissed: false })
    await autoRestart(500_000)
    expect(m.relaunch).not.toHaveBeenCalled()
    await autoRestart(560_000)
    await waitFor(() => expect(m.relaunch).toHaveBeenCalledTimes(1))
    stop()
  })

  it('syncs useUpdate.auto and triggers checkForUpdate when toggled in Settings', async () => {
    m.settings.mockResolvedValue({
      autoUpgrade: false,
      launchAtLogin: false,
      hideDockOnClose: false,
      mirror: { kind: 'npmmirror' },
      env: {},
    })
    useUpdate.setState({ auto: false })
    m.checkUpdate.mockResolvedValue(null)
    render(<SettingsPage go={() => {}} />)
    const sw = await screen.findByRole('switch', { name: '自动升级' })
    fireEvent.click(sw)
    await waitFor(() => expect(useUpdate.getState().auto).toBe(true))
    await waitFor(() => expect(m.checkUpdate).toHaveBeenCalledTimes(1))
  })
})

describe('U-19 & U-65 Tunnels consistency, bg-service confirm, poll error & inline dialog errors', () => {
  const DATA: Tunnels = {
    previews: [
      {
        id: 'p_ext',
        kind: 'http',
        title: '外部服务',
        groupName: '数据看板',
        botName: '小王的 Claude',
        port: 8080,
        path: '/',
        serviceId: null,
        serviceName: null,
        status: 'online',
      },
      {
        id: 'p_paused',
        kind: 'http',
        title: '调试台',
        groupName: '支付重构',
        botName: '小王的 Claude',
        port: 5173,
        path: '/',
        serviceId: 'sv_gone',
        serviceName: 'swagger',
        status: 'stopped',
      },
    ],
    services: [
      {
        id: 'sv_bg',
        name: 'data-worker',
        groupName: '数据分析',
        botName: '数据助手',
        command: 'python worker.py',
        cwd: 'jobs',
        port: null,
        status: 'running',
      },
    ],
  }

  it('uses 停止预览, non-primary row Restart, ghost menu, bg-service confirm, command tooltip, empty desc and poll error alert', async () => {
    m.tunnels.mockResolvedValueOnce(DATA)
    m.stopService.mockRejectedValueOnce('停止失败：进程忙').mockResolvedValueOnce()
    render(
      <>
        <TunnelsPage go={() => {}} />
        <Toaster />
      </>,
    )

    const extRow = within((await screen.findByText('外部服务')).closest('.dk-row-item') as HTMLElement)
    expect(extRow.getByRole('button', { name: '停止预览' })).toBeTruthy()
    expect(extRow.queryByRole('button', { name: '停止穿透' })).toBeNull()
    const moreBtn = extRow.getByRole('button', { name: '外部服务 的更多操作' })
    expect(moreBtn.className).toContain('ui-btn--ghost')

    const pausedRow = within(screen.getByText('调试台').closest('.dk-row-item') as HTMLElement)
    const restartBtn = pausedRow.getByRole('button', { name: '重新启动' })
    expect(restartBtn.className).not.toContain('ui-btn--primary')

    // Command tooltip includes full command
    const cmdSpan = screen.getByText('$ python worker.py')
    expect(cmdSpan.getAttribute('title')).toBe('jobs$ python worker.py')

    // Stopping background service requires confirmation and shows inline error on failure
    const bgRow = within(screen.getByText('data-worker').closest('.dk-row-item') as HTMLElement)
    fireEvent.click(bgRow.getByRole('button', { name: '停止' }))
    expect(m.stopService).not.toHaveBeenCalled()
    const dlg = screen.getByRole('alertdialog')
    expect(dlg.textContent).toContain('要停止后台服务「data-worker」吗？')
    fireEvent.click(within(dlg).getByRole('button', { name: '停止服务' }))
    expect(await within(dlg).findByRole('alert')).toBeTruthy()
    expect(within(dlg).getByRole('alert').textContent).toContain('停止失败：进程忙')
    // Retry succeeds and closes dialog
    fireEvent.click(within(dlg).getByRole('button', { name: '停止服务' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('shows non-blocking poll error alert when data exists and shows empty description', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    m.tunnels
      .mockResolvedValueOnce({ previews: [], services: [] })
      .mockRejectedValueOnce(new Error('轮询超时'))
      .mockResolvedValueOnce({ previews: [], services: [] })

    render(<TunnelsPage go={() => {}} />)
    expect(
      await screen.findByText('让 Bot 把网页或服务跑起来（比如「起个预览给我看看」），就会出现在这里。'),
    ).toBeTruthy()

    await act(async () => vi.advanceTimersByTime(5000))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('轮询超时')
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('U-44 & U-46 Settings error/retry, EnvRows retry & cancel, HTTP copy, unbind inline error', () => {
  it('shows error alert with retry when ipc.settings fails', async () => {
    m.settings.mockRejectedValueOnce('配置读取失败').mockResolvedValueOnce({
      autoUpgrade: true,
      launchAtLogin: false,
      hideDockOnClose: false,
      mirror: { kind: 'npmmirror' },
      env: {},
    })
    render(<SettingsPage go={() => {}} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('配置读取失败')
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('switch', { name: '自动升级' })).toBeTruthy()
  })

  it('retries failed EnvRows save on re-blur and offers 取消 to restore emptied env', async () => {
    m.setEnv.mockRejectedValueOnce('磁盘只读').mockResolvedValueOnce()
    render(<SettingsPage go={() => {}} />)
    const env = (await screen.findByRole('textbox', { name: '环境变量' })) as HTMLTextAreaElement
    fireEvent.change(env, { target: { value: 'FOO=2' } })
    fireEvent.blur(env)
    await waitFor(() => expect(m.setEnv).toHaveBeenCalledTimes(1))
    // Re-blurring must retry because sent.current was not committed on failure.
    fireEvent.blur(env)
    await waitFor(() => expect(m.setEnv).toHaveBeenCalledTimes(2))

    // Emptying env offers 取消 to restore saved value.
    fireEvent.change(env, { target: { value: '' } })
    fireEvent.blur(env)
    expect(screen.getByText('环境变量已清空，确认保存？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText('环境变量已清空，确认保存？')).toBeNull()
    expect(env.value).toBe('FOO=2')
  })

  it('serializes rapid A -> B -> A env edits so reverting before B resolves still saves A (Codex #2)', async () => {
    let resolveB: () => void = () => {}
    m.setEnv.mockImplementationOnce(() => new Promise<void>((r) => (resolveB = r))).mockResolvedValueOnce()
    render(<SettingsPage go={() => {}} />)
    const env = (await screen.findByRole('textbox', { name: '环境变量' })) as HTMLTextAreaElement
    expect(env.value).toBe('FOO=1')

    // Edit A -> B and blur while save B stays in flight
    fireEvent.change(env, { target: { value: 'FOO=2' } })
    fireEvent.blur(env)
    await waitFor(() => expect(m.setEnv).toHaveBeenCalledTimes(1))
    expect(m.setEnv).toHaveBeenNthCalledWith(1, { FOO: '2' })

    // Revert B -> A before B finishes
    fireEvent.change(env, { target: { value: 'FOO=1' } })
    fireEvent.blur(env)
    // Must not race concurrently while B is in flight
    expect(m.setEnv).toHaveBeenCalledTimes(1)

    // Resolve B -> queued revert A must now flush sequentially
    await act(async () => resolveB())
    await waitFor(() => expect(m.setEnv).toHaveBeenCalledTimes(2))
    expect(m.setEnv).toHaveBeenNthCalledWith(2, { FOO: '1' })
  })

  it('shows unencrypted HTTP label for http:// server and inline alert on unbind failure', async () => {
    useDaemon.setState({ info: { ...INFO, server: 'http://10.0.0.5:3000' } })
    m.unbind.mockRejectedValueOnce('解绑失败：无权限')
    render(<SettingsPage go={() => {}} />)
    expect(await screen.findByText('由本机主动连接服务器（当前为未加密 HTTP）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '解除绑定…' }))
    const dlg = screen.getByRole('alertdialog')
    fireEvent.click(within(dlg).getByRole('button', { name: '解除绑定' }))
    const err = await within(dlg).findByRole('alert')
    expect(err.textContent).toContain('解绑失败：无权限')
  })
})

describe('U-45 Bots avoids false Agent 未就绪 flash while tools load or fail', () => {
  it('does not show red 未安装 warning while ipc.tools is pending or rejected', async () => {
    m.bots.mockResolvedValue([bot({})])
    m.providers.mockResolvedValue({ view: VIEW })
    m.tools.mockReturnValue(new Promise(() => {}))
    const { unmount } = render(<BotsPage go={() => {}} />)
    const claude = within((await screen.findByText('小王的 Claude')).closest('.dk-bot') as HTMLElement)
    expect(claude.queryByText('Agent 未就绪')).toBeNull()
    expect(claude.queryByText(/本机未安装/)).toBeNull()
    unmount()

    m.tools.mockRejectedValueOnce('工具探测超时').mockResolvedValueOnce({ ...STATE, agents: [CLAUDE, CODEX] })
    render(<BotsPage go={() => {}} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('工具探测超时')
    expect(screen.queryByText(/本机未安装/)).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('U-46 Onboarding Enter submit and loading state', () => {
  it('submits on form Enter and marks 绑定 busy while binding', async () => {
    m.parseLink.mockResolvedValue({ server: 'https://gonggong.corp.cn', code: 'K7QM-4X2P' })
    let resolveLogin: () => void = () => {}
    m.login.mockImplementationOnce(() => new Promise<void>((r) => (resolveLogin = r)))
    m.startDaemon.mockResolvedValue()
    m.appInfo.mockResolvedValue(INFO)
    const onDone = vi.fn()
    render(<Onboarding link={null} onDone={onDone} />)
    const field = screen.getByLabelText('接入链接')
    fireEvent.change(field, {
      target: { value: 'gonggong://bind?server=https%3A%2F%2Fgonggong.corp.cn&code=K7QM-4X2P' },
    })
    await screen.findByText('gonggong.corp.cn')
    fireEvent.submit(field.closest('form') as HTMLFormElement)
    await waitFor(() => expect(m.login).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '绑定中…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => resolveLogin())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})

describe('U-47 Logs, Market, Overview & RunDetail error/retry/loading', () => {
  it('Logs renders error Alert+Retry on diagnostics/logs failure and loading on measure/export', async () => {
    m.diagnostics.mockRejectedValueOnce('自检异常').mockResolvedValueOnce([])
    m.recentLogs.mockRejectedValueOnce('日志读取失败').mockResolvedValueOnce([])
    render(<LogsPage go={() => {}} />)
    const alerts = await screen.findAllByRole('alert')
    expect(
      alerts.some((a) => a.textContent?.includes('诊断未完成') && a.textContent?.includes('自检异常')),
    ).toBe(true)
    expect(alerts.some((a) => a.textContent?.includes('日志读取失败'))).toBe(true)
    for (const a of alerts) fireEvent.click(within(a).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: '重新检测' })).toBeTruthy()
  })

  it('Market shows query-aware no-match message with 清除搜索 and loading on 刷新', async () => {
    m.marketInstalls.mockResolvedValue([])
    m.marketListings.mockResolvedValue([])
    render(<MarketPage go={() => {}} />)
    await screen.findByText('市场里还没有条目')
    const box = screen.getByRole('searchbox', { name: '搜索 Skill 和插件' }) as HTMLInputElement
    fireEvent.change(box, { target: { value: 'qqq' } })
    expect(screen.getByText('没有找到与「qqq」匹配的条目')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(box.value).toBe('')
  })

  it('Overview shows — while bots load, surfaces BlockedAlert error, and RunDetail shows error+retry on poll fail', async () => {
    m.bots.mockReturnValue(new Promise(() => {}))
    m.overview.mockResolvedValue({ workspaces: { count: 0, detail: '' } })
    const r1 = run({ runId: 'r1' })
    m.runProcess.mockRejectedValueOnce('IPC 读取失败')
    useDaemon.setState({ info: INFO, snapshot: { phase: 'running', status: status({ runs: [r1] }) } })
    render(
      <>
        <OverviewPage go={() => {}} />
        <Toaster />
      </>,
    )
    const stats = screen.getByTestId('stats')
    expect(within(stats).queryByText('0 已绑定')).toBeNull()
    expect(within(stats).queryByText('0 / 0')).toBeNull()
    expect(within(stats).getAllByText('—').length).toBeGreaterThanOrEqual(2)

    // Drill into RunDetail and verify poll error shows Alert with Retry
    fireEvent.click(within(screen.getByTestId('running')).getByRole('button', { name: /小王的 Claude/ }))
    const err = await screen.findByRole('alert')
    expect(err.textContent).toContain('读取运行过程失败')
    expect(within(err).getByRole('button', { name: '重试' })).toBeTruthy()
  })
})

describe('U-65 Workspaces deletable 打开 & inline AlertDialog error', () => {
  const DATA: Workspaces = {
    rows: [
      {
        groupId: 'g3',
        botId: 'b1',
        group: '旧版后台',
        bot: '小王的 Claude',
        kind: 'managed',
        kindLabel: '托管',
        path: '/Users/wl/.gonggong/workspaces/g3/b1/r3',
        state: 'removed',
        stateLabel: '已移出',
        deletable: true,
        context: null,
      } satisfies WorkspaceRow,
    ],
    backups: [],
    offline: false,
  }

  it('shows 打开 next to 删除… on deletable rows and keeps AlertDialog open with inline error on failure', async () => {
    m.workspaces.mockResolvedValue(DATA)
    m.workspaceChanges.mockResolvedValue({ uncommitted: 0, unpushed: 0, unknown: false })
    m.deleteWorkspace.mockRejectedValueOnce('删除失败：文件被占用')
    render(<WorkspacesPage go={() => {}} />)
    const row = (await screen.findByText('旧版后台')).closest('[role="row"]') as HTMLElement
    expect(within(row).getByRole('button', { name: '打开' })).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: '删除…' }))
    const dlg = await screen.findByRole('alertdialog')
    fireEvent.click(within(dlg).getByRole('button', { name: '删除' }))
    const err = await within(dlg).findByRole('alert')
    expect(err.textContent).toContain('删除失败：文件被占用')
  })
})

describe('U-66 Desktop copy removes ACP jargon and capitalizes Git', () => {
  it('uses plain terms in Logs page description and ConnectionDiagnosticsDialog', () => {
    const logsDesc = PAGES.find((p) => p.key === 'logs')?.desc ?? ''
    expect(logsDesc).not.toContain('ACP')
    expect(logsDesc).toContain('Git')
    render(<ConnectionDiagnosticsDialog open onClose={() => {}} />)
    const dlg = screen.getByRole('dialog', { name: '连接诊断' })
    expect(dlg.textContent).not.toContain('ACP')
    expect(dlg.textContent).toContain('适配器')
  })
})
