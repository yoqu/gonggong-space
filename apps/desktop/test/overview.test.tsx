import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { type DaemonStatus, ipc } from '../src/ipc'
import { OverviewPage } from '../src/pages/Overview'
import { useDaemon } from '../src/store'
import { INFO, run, status } from './ipc-mock'

const m = vi.mocked(ipc)

function show(s: DaemonStatus) {
  useDaemon.setState({ info: INFO, snapshot: { phase: 'running', status: s } })
  return render(<OverviewPage go={() => {}} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.overview.mockResolvedValue({ workspaces: { count: 5, detail: '托管 4 · /cd 1 · 1.8 GB' } })
  m.machineBots.mockResolvedValue([
    {
      id: 'b1',
      name: '小王的 Claude',
      agentKind: 'claude',
      binding: 'bound',
      presence: 'running',
      systemPrompt: '',
      concurrency: 2,
    },
    {
      id: 'b2',
      name: '小王的 Codex',
      agentKind: 'codex',
      binding: 'pending_confirm',
      presence: 'pending_confirm',
      systemPrompt: '',
      concurrency: 1,
    },
  ])
})

describe('overview', () => {
  it('shows stats, running runs with their state and step, and the local queue', async () => {
    show(
      status({
        runs: [
          run({ runId: 'r1', status: 'awaiting_approval', step: '等待审批：go build ./...' }),
          run({
            runId: 'r2',
            groupName: '官网改版',
            status: null,
            step: '准备工作区',
            botId: 'b1',
            groupId: 'g2',
          }),
          run({ runId: 'r3', groupName: '支付服务重构', triggeredBy: '陈晨', queued: true }),
        ],
      }),
    )
    const stats = screen.getByTestId('stats')
    expect(within(stats).getByText('在线')).toBeTruthy()
    expect(within(stats).getByText('WSS · 证书固定')).toBeTruthy()
    expect(await within(stats).findByText('1 已绑定')).toBeTruthy()
    expect(within(stats).getByText('agent 可用 1 / 2')).toBeTruthy()
    expect(within(stats).getByText('2 / 2')).toBeTruthy()
    expect(within(stats).getByText('本机队列 1')).toBeTruthy()
    expect(await within(stats).findByText('5 个')).toBeTruthy()
    expect(within(stats).getByText('托管 4 · /cd 1 · 1.8 GB')).toBeTruthy()

    const running = screen.getByTestId('running')
    expect(within(running).getByText('等待审批')).toBeTruthy()
    expect(within(running).getByText('等待审批：go build ./...')).toBeTruthy()
    expect(within(running).getByText('准备中')).toBeTruthy()
    expect(within(running).getByText('官网改版 · 王磊 触发')).toBeTruthy()
    expect(screen.getByText('小王的 Claude · 支付服务重构 · 陈晨 触发 · 排第 1')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drills into a running run and shows its process, subagents included', async () => {
    m.runProcess.mockResolvedValue({
      run: run({ runId: 'r1', status: 'running', step: 'Read' }),
      endedMs: null,
      outcome: null,
      events: [
        {
          id: 1,
          atMs: 1000,
          event: { kind: 'subagent', agentId: 'a1', name: 'Explore', task: '找调用方', state: 'running' },
        },
        { id: 2, atMs: 2000, event: { kind: 'text', delta: '子报告', agentId: 'a1' } },
        { id: 3, atMs: 3000, event: { kind: 'text', delta: '主进度' } },
      ],
    })
    show(status({ runs: [run({ runId: 'r1', status: 'running', step: 'Read' })] }))
    fireEvent.click(within(screen.getByTestId('running')).getByRole('button', { name: /小王的 Claude/ }))
    expect(await screen.findByText('Explore')).toBeTruthy()
    expect(m.runProcess).toHaveBeenCalledWith('r1')
    expect(screen.getByText('找调用方')).toBeTruthy()
    expect(screen.getByText('子报告')).toBeTruthy()
    expect(screen.getByText('主进度')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByTestId('stats')).toBeTruthy()
  })

  it('warns while offline with the next retry', () => {
    show(status({ conn: { state: 'offline', retryAtMs: Date.now() + 16_000, error: 'refused' } }))
    expect(screen.getByRole('alert').textContent).toMatch(/服务器不可用 · 指数退避重连中（下次 1[56] 秒后）/)
    expect(screen.getByText('当前没有运行中的轮次')).toBeTruthy()
    expect(screen.getByText('本机队列为空')).toBeTruthy()
  })

  it('explains a protocol rejection', () => {
    show(status({ conn: { state: 'rejected', reason: 'protocol', message: '需要协议 v2', wiped: [] } }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('协议版本不兼容 · 服务器拒绝连接')
    expect(alert.textContent).toContain('本机 daemon v0.1.0 使用协议 v1')
    expect(alert.textContent).toContain('需要协议 v2')
  })

  it('reports what a revocation wiped and offers to bind again', () => {
    show(
      status({
        conn: {
          state: 'rejected',
          reason: 'revoked',
          message: 'machine token revoked',
          wiped: [
            '/Users/wl/.gonggong/workspaces/g1',
            '/Users/wl/.gonggong/workspaces/g2',
            '/Users/wl/.gonggong/config.json',
          ],
        },
      }),
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('token 已被吊销 · 账号已停用')
    expect(alert.textContent).toContain('已清除本机团队密钥与 2 个托管工作区')
    expect(within(alert).getByRole('button', { name: '重新绑定' })).toBeTruthy()
  })
})
