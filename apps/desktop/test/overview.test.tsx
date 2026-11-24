import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { type DaemonStatus, ipc } from '../src/ipc'
import { OverviewPage } from '../src/pages/Overview'
import { mergeProcess } from '../src/pages/RunDetail'
import { useDaemon } from '../src/store'
import { useUpdate } from '../src/updater'
import { bot, INFO, run, status } from './ipc-mock'

const m = vi.mocked(ipc)

function show(s: DaemonStatus) {
  useDaemon.setState({ info: INFO, snapshot: { phase: 'running', status: s } })
  return render(<OverviewPage go={() => {}} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ overview: null, botGuideDismissed: false })
  useUpdate.setState({ state: { phase: 'idle' }, dismissed: false })
  m.unbind.mockResolvedValue()
  m.tunnels.mockResolvedValue({ previews: [], services: [] })
  m.openWeb.mockResolvedValue()
  m.overview.mockResolvedValue({ workspaces: { count: 5, detail: '托管 4 · 本机目录 1 · 1.8 GB' } })
  m.bots.mockResolvedValue([
    bot({ presence: 'running' }),
    bot({
      id: 'b2',
      name: '小王的 Codex',
      agentKind: 'codex',
      binding: 'pending_confirm',
      presence: 'pending_confirm',
      concurrency: 1,
    }),
  ])
})

describe('overview', () => {
  it('points to 实时画面 when a live preview fails to publish', async () => {
    const go = vi.fn()
    m.tunnels.mockResolvedValue({
      services: [],
      previews: [
        {
          id: 'p1',
          kind: 'gui',
          title: '桌面客户端',
          groupName: '支付重构',
          botName: '小王的 Claude',
          port: null,
          path: '/',
          serviceId: null,
          serviceName: null,
          status: 'online',
          live: { state: 'failed', error: '找不到服务的窗口', missing: [] },
          control: null,
        },
      ],
    })
    useDaemon.setState({ info: INFO, snapshot: { phase: 'running', status: status() } })
    render(<OverviewPage go={go} />)
    const alert = (await screen.findByText('实时画面推流失败：桌面客户端')).closest(
      '[role="alert"]',
    ) as HTMLElement
    expect(within(alert).getByText('找不到服务的窗口')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: '查看' }))
    expect(go).toHaveBeenCalledWith('live')
  })

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
    expect(within(stats).getByText('加密连接')).toBeTruthy()
    expect(await within(stats).findByText('1 已绑定')).toBeTruthy()
    expect(within(stats).getByText('Agent 可用 1 / 2')).toBeTruthy()
    expect(within(stats).getByText('2 / 2')).toBeTruthy()
    expect(within(stats).getByText('本机队列 1')).toBeTruthy()
    expect(await within(stats).findByText('5 个')).toBeTruthy()
    expect(within(stats).getByText('托管 4 · 本机目录 1 · 1.8 GB')).toBeTruthy()

    const running = screen.getByTestId('running')
    expect(within(running).getByText('等待审批')).toBeTruthy()
    expect(within(running).getByText('等待审批：go build ./...')).toBeTruthy()
    expect(within(running).getByText('准备中')).toBeTruthy()
    expect(within(running).getByText('官网改版 · 王磊 触发')).toBeTruthy()
    expect(screen.getByText('小王的 Claude · 支付服务重构 · 陈晨 触发 · 排第 1')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("shows the running bot's context occupancy on its row", async () => {
    show(
      status({
        runs: [
          run({ runId: 'r1', context: { used: 180_000, size: 200_000, blockAt: 187_000 } }),
          run({ runId: 'r2', groupId: 'g2', groupName: '官网改版' }),
        ],
      }),
    )
    const running = screen.getByTestId('running')
    const ring = within(running).getByLabelText('小王的 Claude 上下文 180k / 200k')
    expect(ring.dataset.level).toBe('critical')
    expect(ring.textContent).toBe('90%')
    expect(within(running).getAllByLabelText(/上下文/)).toHaveLength(1)
  })

  it('keeps the last workspace count while it is counted again', async () => {
    m.overview.mockReturnValue(new Promise(() => {}))
    const first = show(status())
    expect(within(screen.getByTestId('stats')).getByText('统计中…')).toBeTruthy()
    first.unmount()
    useDaemon.setState({ overview: { workspaces: { count: 6, detail: '托管 2 · 本机目录 4 · 1.5 GB' } } })
    show(status())
    expect(within(screen.getByTestId('stats')).getByText('6 个')).toBeTruthy()
    expect(within(screen.getByTestId('stats')).getByText('托管 2 · 本机目录 4 · 1.5 GB')).toBeTruthy()
  })

  it('drills into a running run and shows its process, subagents included', async () => {
    const r1 = run({ runId: 'r1', status: 'running', step: 'Read' })
    m.runProcess.mockResolvedValueOnce({
      run: r1,
      endedMs: null,
      outcome: null,
      error: null,
      rev: 5,
      firstId: 1,
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
    m.runProcess.mockResolvedValue({
      run: r1,
      endedMs: null,
      outcome: null,
      error: null,
      rev: 7,
      firstId: 1,
      events: [
        { id: 3, atMs: 3000, event: { kind: 'text', delta: '主进度，继续' } },
        { id: 4, atMs: 4000, event: { kind: 'text', delta: '子报告二', agentId: 'a1' } },
      ],
    })
    show(status({ runs: [r1] }))
    fireEvent.click(within(screen.getByTestId('running')).getByRole('button', { name: /小王的 Claude/ }))
    // The lane and its chip in the dock.
    expect(await screen.findAllByText('Explore')).toHaveLength(2)
    expect(m.runProcess).toHaveBeenCalledWith('r1', null, null)
    expect(within(screen.getByTestId('activity-dock')).getByText('子 agent 1 个运行中')).toBeTruthy()
    expect(screen.getByText('找调用方')).toBeTruthy()
    expect(screen.getByText('子报告')).toBeTruthy()
    expect(screen.getByText('主进度')).toBeTruthy()

    expect(await screen.findByText('主进度，继续')).toBeTruthy()
    expect(m.runProcess).toHaveBeenNthCalledWith(2, 'r1', 3, 5)
    expect(screen.queryByText('主进度')).toBeNull()
    expect(screen.getByText('子报告')).toBeTruthy()
    expect(screen.getByText('子报告二')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByTestId('stats')).toBeTruthy()
  })

  it("shows why a run failed above its process, the agent's error in full", async () => {
    const r1 = run({ runId: 'r1', status: 'running', step: 'Read' })
    m.runProcess.mockResolvedValue({
      run: r1,
      endedMs: 9000,
      outcome: 'failed',
      error: '401 Unauthorized\nplease run /login',
      rev: 3,
      firstId: 1,
      events: [{ id: 1, atMs: 1000, event: { kind: 'text', delta: '主进度' } }],
    })
    show(status({ runs: [r1] }))
    fireEvent.click(within(screen.getByTestId('running')).getByRole('button', { name: /小王的 Claude/ }))
    const alert = (await screen.findByText('运行失败：Agent 异常')).closest('[role="alert"]') as HTMLElement
    expect(alert.querySelector('pre')?.textContent).toBe('401 Unauthorized\nplease run /login')
    expect(within(alert).getByText(/检查 Bot 所在电脑上 Agent 的登录/)).toBeTruthy()
    expect(within(alert).getByRole('button', { name: '复制错误信息' })).toBeTruthy()
    expect(
      alert.compareDocumentPosition(screen.getByText('主进度')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it.each([
    ['failed without an error', 'failed', null, '运行失败：Agent 异常', '未知错误'],
    ['interrupted with a reason', 'interrupted', 'agent 进程退出', '运行已中断', 'agent 进程退出'],
  ] as const)('explains a run %s', async (_, outcome, error, title, detail) => {
    const r1 = run({ runId: 'r1' })
    m.runProcess.mockResolvedValue({
      run: r1,
      endedMs: 9000,
      outcome,
      error,
      rev: 1,
      firstId: null,
      events: [],
    })
    show(status({ runs: [r1] }))
    fireEvent.click(within(screen.getByTestId('running')).getByRole('button', { name: /小王的 Claude/ }))
    const alert = (await screen.findByText(title)).closest('[role="alert"]') as HTMLElement
    expect(alert.querySelector('.run-issue__detail')?.textContent).toBe(detail)
  })

  it('shows no banner for a completed run or one interrupted without a reason', async () => {
    const r1 = run({ runId: 'r1' })
    m.runProcess.mockResolvedValue({
      run: r1,
      endedMs: 9000,
      outcome: 'interrupted',
      error: null,
      rev: 1,
      firstId: null,
      events: [],
    })
    show(status({ runs: [r1] }))
    fireEvent.click(within(screen.getByTestId('running')).getByRole('button', { name: /小王的 Claude/ }))
    expect(await screen.findByText('已中断')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('merges each poll into the process shown so far', () => {
    const ev = (id: number, delta: string) => ({
      id,
      atMs: id * 1000,
      event: { kind: 'text' as const, delta },
    })
    const base = { run: run({ runId: 'r1' }), endedMs: null, outcome: null, error: null }
    const shown = { ...base, rev: 2, events: [ev(1, 'a'), ev(2, 'b'), ev(3, 'c')] }
    expect(mergeProcess(shown, { ...base, rev: 2, firstId: 1, events: [] })).toBe(shown)
    expect(
      mergeProcess(shown, { ...base, rev: 3, firstId: 2, events: [ev(3, 'cd'), ev(4, 'e')] })?.events,
    ).toEqual([ev(2, 'b'), ev(3, 'cd'), ev(4, 'e')])
    const ended = mergeProcess(shown, {
      ...base,
      endedMs: 9000,
      outcome: 'completed',
      rev: 4,
      firstId: 1,
      events: [],
    })
    expect(ended).toMatchObject({ endedMs: 9000, outcome: 'completed', rev: 4, events: shown.events })
    expect(mergeProcess(undefined, { ...base, rev: 1, firstId: 5, events: [ev(5, 'x')] })?.events).toEqual([
      ev(5, 'x'),
    ])
    expect(mergeProcess(shown, null)).toBeNull()
  })

  it('warns while offline with the next retry', () => {
    show(status({ conn: { state: 'offline', retryAtMs: Date.now() + 16_000, error: 'refused' } }))
    expect(screen.getByRole('alert').textContent).toMatch(/连不上服务器 · 1[56] 秒后自动重连/)
    expect(screen.getByText('当前没有运行中的轮次')).toBeTruthy()
    expect(screen.getByText('本机队列为空')).toBeTruthy()
  })

  it('explains a protocol rejection', () => {
    show(status({ conn: { state: 'rejected', reason: 'protocol', message: '需要协议 v2', wiped: [] } }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('协议版本不兼容 · 服务器拒绝连接')
    expect(alert.textContent).toContain('这台电脑的共工客户端（v0.1.0）版本太旧')
    expect(alert.textContent).toContain('需要协议 v2')
  })

  it('offers to check for an update on a protocol rejection, and to restart once it is downloaded', async () => {
    const first = show(
      status({ conn: { state: 'rejected', reason: 'protocol', message: '需要协议 v2', wiped: [] } }),
    )
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '检查更新' }))
    await waitFor(() => expect(m.checkUpdate).toHaveBeenCalledTimes(1))
    first.unmount()
    useUpdate.setState({ state: { phase: 'ready', version: '0.5.0' } })
    show(status({ conn: { state: 'rejected', reason: 'protocol', message: '需要协议 v2', wiped: [] } }))
    const alert = screen.getByRole('alert')
    expect(within(alert).queryByRole('button', { name: '检查更新' })).toBeNull()
    expect(within(alert).getByRole('button', { name: '立即重启' })).toBeTruthy()
  })

  it('asks before rebinding after an invalid binding, which clears the team key and workspaces', async () => {
    show(status({ conn: { state: 'rejected', reason: 'unauthorized', message: '密钥无效', wiped: [] } }))
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '重新绑定' }))
    expect(m.unbind).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('要清除本机数据并重新绑定吗？')
    expect(dialog.textContent).not.toContain('解除')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(m.unbind).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '重新绑定' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '清除并重新绑定' }))
    await waitFor(() => expect(m.unbind).toHaveBeenCalledTimes(1))
  })

  it('rebinds right away once the machine was already revoked', async () => {
    show(status({ conn: { state: 'rejected', reason: 'revoked', message: 'revoked', wiped: [] } }))
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '重新绑定' }))
    expect(m.unbind).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
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
    expect(alert.textContent).toContain('电脑已解绑 · 账号已停用')
    expect(alert.textContent).toContain('已清理这台电脑上的团队密钥和 2 个托管工作区')
    expect(alert.textContent).toContain('你手动选择的本机目录和本地备份保持不变')
    expect(alert.textContent).not.toContain('/cd')
    expect(within(alert).getByRole('button', { name: '重新绑定' })).toBeTruthy()
  })

  it('shows a dismissible create-Bot guide when connected with 0 Bots and opens Web on click', async () => {
    m.bots.mockResolvedValue([])
    show(status())
    const guide = await screen.findByTestId('create-bot-guide')
    expect(guide.textContent).toContain('电脑已接入，接下来创建你的第一个 Bot')
    expect(guide.textContent).toContain('在网页端为这台电脑创建 Bot 后，就能在群里 @ 它开始干活。')

    fireEvent.click(within(guide).getByRole('button', { name: '去网页端创建 Bot' }))
    expect(m.openWeb).toHaveBeenCalledTimes(1)

    fireEvent.click(within(guide).getByRole('button', { name: '稍后再说' }))
    expect(screen.queryByTestId('create-bot-guide')).toBeNull()
  })

  it('hides the create-Bot guide when the machine already has Bots or is not connected', async () => {
    show(status())
    await within(screen.getByTestId('stats')).findByText('1 已绑定')
    expect(screen.queryByTestId('create-bot-guide')).toBeNull()

    m.bots.mockResolvedValue([])
    show(status({ conn: { state: 'offline', retryAtMs: Date.now() + 10_000, error: 'down' } }))
    expect(screen.queryByTestId('create-bot-guide')).toBeNull()
  })
})
