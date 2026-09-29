import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { type Check, ipc, type LogLine } from '../src/ipc'
import { LogsPage } from '../src/pages/Logs'
import { usePermissions } from '../src/permissions'

const m = vi.mocked(ipc)

const CHECKS: Check[] = [
  { kind: 'server', label: '服务器连接', status: 'ok', detail: 'WSS 正常 · 证书固定通过' },
  { kind: 'agent', label: 'Agent', status: 'warn', detail: 'Codex 未安装' },
  { kind: 'git', label: 'git 凭据', status: 'error', detail: 'SSH · Permission denied' },
  { kind: 'disk', label: '磁盘', status: 'ok', detail: '工作区 1.8 GB · 剩余 212 GB' },
  { kind: 'eol', label: '换行符', status: 'skipped', detail: '本机暂无托管仓库' },
]

const LINES: LogLine[] = [
  { level: 'info', text: '10:21:12 INFO  router  msg m_8812' },
  { level: 'warn', text: '10:05:02 WARN  sync    local edit without lock' },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.diagnostics.mockResolvedValue(CHECKS)
  m.recentLogs.mockResolvedValue(LINES)
  m.measureNet.mockResolvedValue({ latencyMs: 23.4, bandwidthMbps: 87.5 })
  m.exportDiagnostics.mockResolvedValue('/Users/wl/Desktop/gonggong-diag.zip')
})
afterEach(() => vi.useRealTimers())

describe('日志与诊断', () => {
  it('shows the five checks with their status', async () => {
    render(<LogsPage go={() => {}} />)
    const git = (await screen.findByText('git 凭据')).closest('[data-testid="check"]') as HTMLElement
    expect(git.dataset.status).toBe('error')
    expect(git.textContent).toContain('SSH · Permission denied')
    expect(screen.getAllByTestId('check').map((c) => c.dataset.status)).toEqual([
      'ok',
      'warn',
      'error',
      'ok',
      'skipped',
    ])
  })

  it('opens the permissions guide from a missing permission', async () => {
    m.diagnostics.mockResolvedValue([
      ...CHECKS,
      { kind: 'screen_recording', label: '屏幕录制', status: 'warn', detail: '未授权' },
      { kind: 'accessibility', label: '辅助功能', status: 'ok', detail: '已授权' },
    ])
    usePermissions.setState({ guide: false })
    render(<LogsPage go={() => {}} />)
    await screen.findByText('屏幕录制')
    const buttons = screen.getAllByRole('button', { name: '去授权' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0] as HTMLElement)
    expect(usePermissions.getState().guide).toBe(true)
  })

  it('measures the network and exports a bundle', async () => {
    render(<LogsPage go={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '测量延迟与带宽' }))
    expect(await screen.findByText('延迟 23.4 ms · 带宽 87.5 Mbps · 已上报服务器')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导出诊断包…' }))
    await waitFor(() => expect(m.exportDiagnostics).toHaveBeenCalled())
  })

  it('shows recent lines for the chosen level and refreshes them', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    render(<LogsPage go={() => {}} />)
    await waitFor(() =>
      expect(screen.getByTestId('log-pane').textContent).toContain('WARN  sync    local edit'),
    )
    expect(m.recentLogs).toHaveBeenLastCalledWith('info', expect.any(Number))
    fireEvent.click(screen.getByRole('radio', { name: 'warn' }))
    await waitFor(() => expect(m.recentLogs).toHaveBeenLastCalledWith('warn', expect.any(Number)))
    const calls = m.recentLogs.mock.calls.length
    await act(async () => vi.advanceTimersByTime(2000))
    expect(m.recentLogs.mock.calls.length).toBeGreaterThan(calls)
    fireEvent.click(screen.getByRole('radio', { name: 'debug' }))
    await waitFor(() => expect(m.recentLogs).toHaveBeenLastCalledWith('debug', expect.any(Number)))
  })
})

describe('诊断 while it runs', () => {
  it('says what it is checking instead of an empty box, and keeps a failure visible', async () => {
    let fail = (_: unknown) => {}
    m.diagnostics.mockReturnValue(new Promise((_, reject) => (fail = reject)))
    render(<LogsPage go={() => {}} />)
    expect(screen.getByText(/正在检测服务器连接、Agent、git 凭据、磁盘与换行符/)).toBeTruthy()
    await act(async () => fail('boom'))
    expect(await screen.findByText('诊断未完成')).toBeTruthy()
  })
})
