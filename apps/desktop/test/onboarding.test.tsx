import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { Onboarding } from '../src/onboarding/Onboarding'
import { INFO } from './ipc-mock'

const m = vi.mocked(ipc)

const CLAUDE = {
  kind: 'claude',
  available: true,
  version: '2.1.4',
  path: '/opt/homebrew/bin/claude',
  minVersion: '2.0.0',
} as const
const CODEX_MISSING = {
  kind: 'codex',
  available: false,
  version: null,
  path: null,
  minVersion: '0.40.0',
} as const

beforeEach(() => {
  vi.clearAllMocks()
  m.appInfo.mockResolvedValue(INFO)
  m.login.mockResolvedValue()
  m.startDaemon.mockResolvedValue()
  m.confirmBots.mockResolvedValue()
})

async function bind() {
  fireEvent.change(screen.getByLabelText('服务器'), { target: { value: 'https://gonggong.corp.cn' } })
  fireEvent.change(screen.getByLabelText('绑定码'), { target: { value: 'k7qm-4x2p' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
}

describe('onboarding', () => {
  it('binds with the code and shows the equivalent CLI command', async () => {
    m.detectAgents.mockResolvedValue([CLAUDE])
    render(<Onboarding onDone={() => {}} />)
    expect(screen.getByText('绑定到团队服务器')).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录' })).toHaveProperty('disabled', true)
    await bind()
    expect(
      screen.getByText('等价命令：gg login --server https://gonggong.corp.cn --code K7QM-4X2P'),
    ).toBeTruthy()
    await screen.findByText('检测本机 agent')
    expect(m.login).toHaveBeenCalledWith('https://gonggong.corp.cn', 'K7QM-4X2P')
  })

  it('shows why binding failed and stays on the first step', async () => {
    m.login.mockRejectedValue('绑定失败：绑定码已失效（已过期或已被使用），请在 Web 端重新生成')
    render(<Onboarding onDone={() => {}} />)
    await bind()
    await screen.findByText('绑定失败：绑定码已失效（已过期或已被使用），请在 Web 端重新生成')
    expect(screen.getByText('绑定到团队服务器')).toBeTruthy()
  })

  it('lists agents with install hints, rechecks and needs one available agent', async () => {
    m.detectAgents.mockResolvedValueOnce([
      { ...CLAUDE, available: false, version: null, path: null },
      CODEX_MISSING,
    ])
    render(<Onboarding onDone={() => {}} />)
    await bind()
    await screen.findByText('检测本机 agent')
    expect(screen.getAllByText('未安装')).toHaveLength(2)
    expect(screen.getByText('npm install -g @openai/codex')).toBeTruthy()
    expect(screen.getByRole('button', { name: '上报并继续' })).toHaveProperty('disabled', true)

    m.detectAgents.mockResolvedValueOnce([CLAUDE, CODEX_MISSING])
    fireEvent.click(screen.getAllByRole('button', { name: '重新检测' })[0] as HTMLElement)
    await screen.findByText('Claude Code 2.1.4')
    expect(screen.getByText('可用')).toBeTruthy()
    expect(screen.getByText('/opt/homebrew/bin/claude')).toBeTruthy()
    expect(screen.getByRole('button', { name: '上报并继续' })).toHaveProperty('disabled', false)
  })

  it('reports agents, then confirms the checked bots and finishes', async () => {
    m.detectAgents.mockResolvedValue([CLAUDE])
    m.machineBots.mockResolvedValue([
      {
        id: 'b0',
        name: '我的 Claude',
        agentKind: 'claude',
        binding: 'bound',
        presence: 'online',
        systemPrompt: '',
        concurrency: 1,
      },
      {
        id: 'b1',
        name: '小王的 Claude',
        agentKind: 'claude',
        binding: 'pending_confirm',
        presence: 'pending_confirm',
        systemPrompt: '后端接口开发',
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
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)
    await bind()
    fireEvent.click(await screen.findByRole('button', { name: '上报并继续' }))
    await screen.findByText('确认 Bot')
    expect(m.startDaemon).toHaveBeenCalled()
    expect(screen.queryByText('我的 Claude')).toBeNull()
    expect(screen.getByText('Claude Code · 后端接口开发')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('小王的 Codex'))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(m.confirmBots).toHaveBeenCalledWith(['b1'])
  })
})
