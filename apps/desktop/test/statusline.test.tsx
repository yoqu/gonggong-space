import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Toaster, useToasts } from '@web/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { StatusLine } from '../src/shell/StatusLine'
import { useDaemon } from '../src/store'
import { INFO, run, status } from './ipc-mock'

beforeEach(() => {
  vi.clearAllMocks()
  useToasts.setState({ items: [] })
  useDaemon.setState({
    info: INFO,
    snapshot: { phase: 'running', status: status() },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StatusLine & connection diagnostics', () => {
  it('shows only connection status, task count and version without technical clutter', () => {
    render(<StatusLine />)
    const footer = screen.getByTestId('status-line')
    expect(within(footer).getByRole('button', { name: '已连接' })).toBeTruthy()
    expect(within(footer).getByRole('button', { name: '空闲' })).toBeTruthy()
    expect(within(footer).getByText('v0.1.0')).toBeTruthy()
    expect(footer.textContent).not.toContain('心跳')
    expect(footer.textContent).not.toContain('延迟')
    expect(footer.textContent).not.toContain('ACP')
    expect(footer.textContent).not.toContain('协议')
  })

  it('reflects reconnecting and disconnected states and task counts accurately', () => {
    const onOpenOverview = vi.fn()
    const { rerender } = render(<StatusLine onOpenOverview={onOpenOverview} />)

    useDaemon.setState({
      snapshot: {
        phase: 'running',
        status: status({
          conn: { state: 'offline', retryAtMs: Date.now() + 5000, error: 'refused' },
          runs: [run({ runId: 'r1' }), run({ runId: 'r2' })],
        }),
      },
    })
    rerender(<StatusLine onOpenOverview={onOpenOverview} />)
    expect(screen.getByRole('button', { name: '重连中…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '运行中 2' }))
    expect(onOpenOverview).toHaveBeenCalledTimes(1)

    useDaemon.setState({
      snapshot: {
        phase: 'running',
        status: status({
          conn: { state: 'rejected', reason: 'revoked', message: 'revoked', wiped: [] },
          runs: [
            run({ runId: 'r1' }),
            run({ runId: 'r2', queued: true }),
            run({ runId: 'r3', queued: true }),
          ],
        }),
      },
    })
    rerender(<StatusLine onOpenOverview={onOpenOverview} />)
    expect(screen.getByRole('button', { name: '未连接' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '运行中 1 · 排队 2' })).toBeTruthy()

    useDaemon.setState({ snapshot: { phase: 'unbound' } })
    rerender(<StatusLine onOpenOverview={onOpenOverview} />)
    expect(screen.getByRole('button', { name: '未连接' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '空闲' })).toBeTruthy()
  })

  it('opens the 连接诊断 dialog with technical info and copies diagnostics with a toast', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(
      <>
        <StatusLine />
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: '已连接' }))
    const dialog = screen.getByRole('dialog', { name: '连接诊断' })
    expect(dialog.textContent).toContain('gonggong.corp.cn')
    expect(dialog.textContent).toContain('15 秒')
    expect(dialog.textContent).toContain('38 ms')
    expect(dialog.textContent).toContain('v1')
    expect(dialog.textContent).toContain('claude-agent-acp 0.81.0')
    expect(dialog.textContent).not.toContain('codex-acp')

    fireEvent.click(within(dialog).getByRole('button', { name: '复制诊断信息' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0]?.[0] ?? ''
    expect(copied).toContain('gonggong.corp.cn')
    expect(copied).toContain('38 ms')
    expect(copied).toContain('v1')
    expect(copied).toContain('claude-agent-acp 0.81.0')
    expect(await screen.findByText('已复制诊断信息')).toBeTruthy()
  })
})
