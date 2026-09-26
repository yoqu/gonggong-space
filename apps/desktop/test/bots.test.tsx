import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { BotsPage } from '../src/pages/Bots'
import { bot, CLAUDE, CODEX } from './ipc-mock'

const m = vi.mocked(ipc)

beforeEach(() => {
  vi.clearAllMocks()
  m.agents.mockResolvedValue([CLAUDE, CODEX])
  m.openBotInWeb.mockResolvedValue()
  m.bots.mockResolvedValue([
    bot({}),
    bot({
      id: 'b2',
      name: '小王的 Codex',
      agentKind: 'codex',
      binding: 'pending_confirm',
      presence: 'pending_confirm',
      concurrency: 1,
      approval: 'allowlist',
      allowlist: ['go build', 'npm test'],
    }),
  ])
})

const card = async (name: string) => within((await screen.findByText(name)).closest('.dk-bot') as HTMLElement)

it('shows the server settings of each bot read-only', async () => {
  const go = vi.fn()
  render(<BotsPage go={go} />)
  const claude = await card('小王的 Claude')
  expect(claude.getByText('在线')).toBeTruthy()
  expect(claude.getByText('Claude Code 2.1.4')).toBeTruthy()
  expect(claude.getByText('每次询问')).toBeTruthy()
  expect(claude.queryByText('命令白名单')).toBeNull()

  const codex = await card('小王的 Codex')
  expect(codex.getByText('待确认')).toBeTruthy()
  expect(codex.getByText('他人为你创建，请在 Web 中确认')).toBeTruthy()
  expect(codex.getByText('Codex · 未安装')).toBeTruthy()
  expect(codex.getByText('白名单自动')).toBeTruthy()
  expect(codex.getByText('go build、npm test')).toBeTruthy()
  expect(codex.getByText('本机未安装 Codex，该 Bot 暂不能执行')).toBeTruthy()
  fireEvent.click(codex.getByRole('button', { name: '前往 Agent' }))
  expect(go).toHaveBeenCalledWith('agents')

  expect(screen.queryByRole('button', { name: '设置…' })).toBeNull()
  expect(screen.queryByRole('button', { name: '确认' })).toBeNull()
  expect(screen.getByText(/Bot 的全部设置都在 Web 端管理/)).toBeTruthy()
})

it('opens each bot on the Web to manage or confirm it', async () => {
  render(<BotsPage go={() => {}} />)
  fireEvent.click((await card('小王的 Claude')).getByRole('button', { name: '在 Web 中管理' }))
  await waitFor(() => expect(m.openBotInWeb).toHaveBeenCalledWith('b1'))
  const codex = await card('小王的 Codex')
  expect(codex.queryByRole('button', { name: '在 Web 中管理' })).toBeNull()
  fireEvent.click(codex.getByRole('button', { name: '在 Web 中确认' }))
  await waitFor(() => expect(m.openBotInWeb).toHaveBeenCalledWith('b2'))
})
