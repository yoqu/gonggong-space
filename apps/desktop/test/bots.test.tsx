import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { avatarSrc } from '@web/features/bots/avatars'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { BotsPage } from '../src/pages/Bots'
import { bot, CLAUDE, CODEX, provider, STATE, VIEW } from './ipc-mock'

const m = vi.mocked(ipc)

beforeEach(() => {
  vi.clearAllMocks()
  m.tools.mockResolvedValue({ ...STATE, agents: [CLAUDE, CODEX] })
  m.providers.mockResolvedValue({ view: VIEW })
  m.openBotInWeb.mockResolvedValue()
  m.bots.mockResolvedValue([
    bot({ followAgent: true }),
    bot({
      id: 'b2',
      name: '小王的 Codex',
      agentKind: 'codex',
      binding: 'pending_confirm',
      presence: 'pending_confirm',
      concurrency: 1,
      aiReview: true,
      alwaysAllow: ['go build', 'npm test'],
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
    avatarSrc('agent-claude'),
  )
  expect(claude.getByText('Claude Code 2.1.4')).toBeTruthy()
  expect(claude.getByText('每次问我')).toBeTruthy()
  expect(claude.getByText('默认团队')).toBeTruthy()

  const codex = await card('小王的 Codex')
  expect(codex.getByText('待确认')).toBeTruthy()
  expect(codex.getByRole('img', { name: '小王的 Codex' }).querySelector('img')?.getAttribute('src')).toBe(
    avatarSrc('role-sentry'),
  )
  expect(codex.getByText('他人为你创建，请在 Web 中确认')).toBeTruthy()
  expect(codex.getByText('支付组')).toBeTruthy()
  expect(codex.getByText('Codex · 未安装')).toBeTruthy()
  expect(codex.getByText('帮我审批 · 已允许 go build、npm test')).toBeTruthy()
  expect(codex.getByText('本机未安装 Codex，该 Bot 暂不能执行')).toBeTruthy()
  fireEvent.click(codex.getByRole('button', { name: '前往 Agent' }))
  expect(go).toHaveBeenCalledWith('agents')

  expect(screen.queryByRole('button', { name: '设置…' })).toBeNull()
  expect(screen.queryByRole('button', { name: '确认' })).toBeNull()
  expect(screen.getByText(/Bot 的设置都在 Web 端管理（名称、角色说明、供应商与模型/)).toBeTruthy()
})

it('opens each bot on the Web to manage or confirm it', async () => {
  render(<BotsPage go={() => {}} />)
  fireEvent.click(
    (await card('小王的 Claude')).getAllByRole('button', { name: '在 Web 中管理' })[0] as HTMLElement,
  )
  await waitFor(() => expect(m.openBotInWeb).toHaveBeenCalledWith('b1'))
  const codex = await card('小王的 Codex')
  expect(codex.getAllByRole('button', { name: '在 Web 中管理' })).toHaveLength(1)
  fireEvent.click(codex.getByRole('button', { name: '在 Web 中确认' }))
  await waitFor(() => expect(m.openBotInWeb).toHaveBeenCalledWith('b2'))
})

it('describes what the page manages', async () => {
  const { PAGES } = await import('../src/pages')
  expect(PAGES.find((p) => p.key === 'bots')?.desc).toBe(
    '本机运行的 Bot 与其供应商/模型，设置请在 Web 端修改',
  )
})

it('shows each bot’s provider and model read-only, managed on the Web', async () => {
  m.providers.mockResolvedValue({
    view: {
      ...VIEW,
      machine: { claude: { provider: 'kimi-1', model: 'kimi-k2' } },
      bots: { b2: 'official' },
      providers: [provider({ id: 'kimi-1', name: 'Kimi' })],
    },
  })
  m.bots.mockResolvedValue([
    bot({}),
    bot({ id: 'b2', name: '小王的 Codex', agentKind: 'codex', model: 'gpt-5' }),
    bot({ id: 'b3', name: '小王的 Gemini', agentKind: 'gemini' }),
  ])
  render(<BotsPage go={() => {}} />)
  const claude = await card('小王的 Claude')
  expect(await claude.findByText('继承机器默认（Kimi / kimi-k2）')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /的供应商$/ })).toBeNull()
  const codex = await card('小王的 Codex')
  expect(codex.getByText('官方登录 / gpt-5')).toBeTruthy()
  fireEvent.click(codex.getAllByRole('button', { name: '在 Web 中管理' })[0] as HTMLElement)
  await waitFor(() => expect(m.openBotInWeb).toHaveBeenCalledWith('b2'))
  expect((await card('小王的 Gemini')).getByText('继承机器默认（官方登录）')).toBeTruthy()
  expect(m.providers).toHaveBeenCalledWith({ action: 'list' })
})

it('leaves the team out for servers before teams', async () => {
  m.bots.mockResolvedValue([bot({ teamId: null, teamName: null })])
  render(<BotsPage go={() => {}} />)
  expect((await card('小王的 Claude')).queryByText('团队')).toBeNull()
})
