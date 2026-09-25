import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { BotsPage } from '../src/pages/Bots'
import { bot, CLAUDE, CODEX } from './ipc-mock'

const m = vi.mocked(ipc)

beforeEach(() => {
  vi.clearAllMocks()
  m.agents.mockResolvedValue([{ ...CLAUDE, defaultModel: 'sonnet' }, CODEX])
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
      allowlist: ['go build'],
    }),
  ])
  m.confirmBots.mockResolvedValue()
  m.saveBot.mockResolvedValue()
})

const card = async (name: string) => within((await screen.findByText(name)).closest('.dk-bot') as HTMLElement)

it('lists the bots with their local settings and warnings', async () => {
  const go = vi.fn()
  render(<BotsPage go={go} />)
  const claude = await card('小王的 Claude')
  expect(claude.getByText('在线')).toBeTruthy()
  expect(claude.getByText('Claude Code 2.1.4')).toBeTruthy()
  expect(claude.getByText('Sonnet 5 · 跟随默认')).toBeTruthy()
  expect(claude.getByText('每次询问')).toBeTruthy()

  const codex = await card('小王的 Codex')
  expect(codex.getByText('待确认')).toBeTruthy()
  expect(codex.getByText('Codex · 未安装')).toBeTruthy()
  expect(codex.getByText('白名单自动')).toBeTruthy()
  expect(codex.getByText('本机未安装 Codex，该 Bot 暂不能执行')).toBeTruthy()
  fireEvent.click(codex.getByRole('button', { name: '前往 Agent' }))
  expect(go).toHaveBeenCalledWith('agents')

  fireEvent.click(codex.getByRole('button', { name: '确认' }))
  await waitFor(() => expect(m.confirmBots).toHaveBeenCalledWith(['b2']))
  expect(m.bots).toHaveBeenCalledTimes(2)
})

it('edits the model, concurrency and command approval of a bot', async () => {
  render(<BotsPage go={() => {}} />)
  fireEvent.click((await card('小王的 Claude')).getByRole('button', { name: '设置' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText('小王的 Claude · 本机设置')).toBeTruthy()
  expect(dialog.getByRole('radio', { name: /Claude Code/ }).getAttribute('aria-checked')).toBe('true')
  expect(dialog.getByRole('radio', { name: /Codex/ })).toHaveProperty('disabled', true)
  expect(dialog.getByText(/切换 agent 会结束该 Bot 在各群的会话上下文/)).toBeTruthy()
  expect(dialog.getByRole('radio', { name: /跟随 agent 默认 · Sonnet 5/ }).getAttribute('aria-checked')).toBe(
    'true',
  )

  fireEvent.click(dialog.getByRole('radio', { name: /Haiku 4.5/ }))
  fireEvent.click(dialog.getByRole('tab', { name: '3' }))
  fireEvent.click(dialog.getByRole('tab', { name: '白名单自动' }))
  const input = dialog.getByPlaceholderText('命令前缀，如 go build')
  fireEvent.change(input, { target: { value: 'npm test' } })
  fireEvent.click(dialog.getByRole('button', { name: '添加' }))
  fireEvent.change(input, { target: { value: 'node -e' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.click(dialog.getByRole('button', { name: '移除 npm test' }))
  fireEvent.click(dialog.getByRole('button', { name: '保存' }))

  await waitFor(() =>
    expect(m.saveBot).toHaveBeenCalledWith('b1', {
      model: 'haiku',
      approval: 'allowlist',
      allowlist: ['node -e'],
      concurrency: 3,
    }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('saves only local settings when the concurrency is unchanged, and back to following the default', async () => {
  m.bots.mockResolvedValue([bot({ model: 'haiku', approval: 'all' })])
  render(<BotsPage go={() => {}} />)
  fireEvent.click((await card('小王的 Claude')).getByRole('button', { name: '设置' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.click(dialog.getByRole('radio', { name: /跟随 agent 默认/ }))
  fireEvent.click(dialog.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(m.saveBot).toHaveBeenCalledWith('b1', {
      model: null,
      approval: 'all',
      allowlist: [],
      concurrency: null,
    }),
  )
})
