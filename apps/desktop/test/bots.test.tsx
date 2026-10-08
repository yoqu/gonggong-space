import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { avatarSrc } from '@web/features/bots/avatars'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { BotsPage } from '../src/pages/Bots'
import { bot, CLAUDE, CODEX, provider } from './ipc-mock'

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
      avatar: 'role-sentry',
      teamId: 't2',
      teamName: '支付组',
    }),
  ])
})

const card = async (name: string) => within((await screen.findByText(name)).closest('.dk-bot') as HTMLElement)

it('shows the server settings of each bot read-only', async () => {
  const go = vi.fn()
  render(<BotsPage go={go} />)
  const claude = await card('小王的 Claude')
  expect(claude.getByText('在线')).toBeTruthy()
  expect(claude.getByRole('img', { name: '小王的 Claude' }).querySelector('img')?.getAttribute('src')).toBe(
    avatarSrc('role-gong'),
  )
  expect(claude.getByText('Claude Code 2.1.4')).toBeTruthy()
  expect(claude.getByText('每次询问')).toBeTruthy()
  expect(claude.queryByText('命令白名单')).toBeNull()
  expect(claude.getByText('默认团队')).toBeTruthy()

  const codex = await card('小王的 Codex')
  expect(codex.getByText('待确认')).toBeTruthy()
  expect(codex.getByRole('img', { name: '小王的 Codex' }).querySelector('img')?.getAttribute('src')).toBe(
    avatarSrc('role-sentry'),
  )
  expect(codex.getByText('他人为你创建，请在 Web 中确认')).toBeTruthy()
  expect(codex.getByText('支付组')).toBeTruthy()
  expect(codex.getByText('Codex · 未安装')).toBeTruthy()
  expect(codex.getByText('白名单自动')).toBeTruthy()
  expect(codex.getByText('go build、npm test')).toBeTruthy()
  expect(codex.getByText('本机未安装 Codex，该 Bot 暂不能执行')).toBeTruthy()
  fireEvent.click(codex.getByRole('button', { name: '前往 Agent' }))
  expect(go).toHaveBeenCalledWith('agents')

  expect(screen.queryByRole('button', { name: '设置…' })).toBeNull()
  expect(screen.queryByRole('button', { name: '确认' })).toBeNull()
  expect(screen.getByText(/供应商只保存在本机，在这里设置；Bot 的其余设置都在 Web 端管理/)).toBeTruthy()
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

it('describes what the page manages', async () => {
  const { PAGES } = await import('../src/pages')
  expect(PAGES.find((p) => p.key === 'bots')?.desc).toBe('本机运行的 Bot 与其供应商，其余设置请在 Web 端修改')
})

it('sets a bot’s provider: inherit, official or one of its agent, confirming when sessions keep the old one', async () => {
  m.providers.mockResolvedValue({
    machine: { claude: 'kimi-1' },
    bots: { b2: 'official' },
    providers: [
      provider({ id: 'kimi-1', name: 'Kimi' }),
      provider({ id: 'glm-1', name: '智谱 GLM' }),
      provider({ id: 'ds-1', agent: 'codex', name: 'DeepSeek' }),
    ],
  })
  m.chooseProvider.mockResolvedValue()
  render(<BotsPage go={() => {}} />)
  const claude = await card('小王的 Claude')
  const select = await claude.findByRole('button', { name: '小王的 Claude 的供应商' })
  expect(select.textContent).toContain('继承机器（当前：Kimi）')
  fireEvent.click(select)
  const menu = within(claude.getByRole('menu', { name: '小王的 Claude 的供应商' }))
  expect(menu.getAllByRole('menuitemcheckbox').map((o) => o.textContent)).toEqual([
    '继承机器（当前：Kimi）',
    '官方登录',
    'Kimi',
    '智谱 GLM',
  ])

  m.providerImpact.mockResolvedValue([
    { group: '支付服务重构', bot: '小王的 Claude', from: 'Kimi', to: '智谱 GLM' },
  ])
  fireEvent.click(menu.getByRole('menuitemcheckbox', { name: '智谱 GLM' }))
  await waitFor(() => expect(m.providerImpact).toHaveBeenCalledWith('claude', 'glm-1', 'b1'))
  const alert = within(await screen.findByRole('alertdialog'))
  expect(alert.getByText('1 个群的会话仍在使用 Kimi，开启新会话后才会切换到 智谱 GLM：')).toBeTruthy()
  expect(alert.getByText('支付服务重构（小王的 Claude）')).toBeTruthy()
  expect(m.chooseProvider).not.toHaveBeenCalled()
  fireEvent.click(alert.getByRole('button', { name: '切换' }))
  await waitFor(() => expect(m.chooseProvider).toHaveBeenCalledWith('claude', 'glm-1', 'b1'))

  const codex = await card('小王的 Codex')
  expect(codex.getByRole('button', { name: '小王的 Codex 的供应商' }).textContent).toContain('官方登录')
  fireEvent.click(codex.getByRole('button', { name: '小王的 Codex 的供应商' }))
  m.providerImpact.mockResolvedValue([])
  fireEvent.click(within(codex.getByRole('menu')).getByRole('menuitemcheckbox', { name: /继承机器/ }))
  await waitFor(() => expect(m.chooseProvider).toHaveBeenCalledWith('codex', 'inherit', 'b2'))
})

it('leaves the team out for servers before teams', async () => {
  m.bots.mockResolvedValue([bot({ teamId: null, teamName: null })])
  render(<BotsPage go={() => {}} />)
  expect((await card('小王的 Claude')).queryByText('团队')).toBeNull()
})
