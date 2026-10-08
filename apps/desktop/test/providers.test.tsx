import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Providers } from '../src/ipc'
import { AgentsPage } from '../src/pages/Agents'
import { useDaemon } from '../src/store'
import { CLAUDE, CODEX, INFO, provider } from './ipc-mock'

const m = vi.mocked(ipc)

const DATA: Providers = {
  machine: {},
  bots: {},
  providers: [
    provider({ id: 'kimi-1', name: 'Kimi' }),
    provider({ id: 'ds-1', agent: 'codex', name: 'DeepSeek' }),
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ info: INFO })
  m.agents.mockResolvedValue([CLAUDE, CODEX])
  m.bots.mockResolvedValue([])
  m.providers.mockResolvedValue(DATA)
  m.chooseProvider.mockResolvedValue()
  m.openProvidersInWeb.mockResolvedValue()
})

/** The 本机供应商 box right after an agent's card. */
const box = async (agent: 'Claude Code' | 'Codex') => {
  const title = await screen.findByText(agent)
  const card = title.closest('.dk-agent') as HTMLElement
  const head = await within(card).findByText('本机供应商')
  return within(head.closest('.ui-group') as HTMLElement)
}

it('lists this agent’s providers with masked keys and switches the default after confirming', async () => {
  render(<AgentsPage go={() => {}} />)
  const claude = await box('Claude Code')
  expect((claude.getByRole('radio', { name: /官方登录/ }) as HTMLInputElement).checked).toBe(true)
  expect(claude.getByText('https://api.kimi.com/coding/ · kimi-for-coding · Key ****abcd')).toBeTruthy()
  expect(claude.queryByText('DeepSeek')).toBeNull()
  expect((await box('Codex')).getByText('DeepSeek')).toBeTruthy()

  m.providerImpact.mockResolvedValue([
    { group: '支付服务重构', bot: '小王的 Claude', from: '官方登录', to: 'Kimi' },
    { group: '官网改版', bot: '小王的 Claude', from: '官方登录', to: 'Kimi' },
  ])
  fireEvent.click(claude.getByRole('radio', { name: /Kimi/ }))
  await waitFor(() => expect(m.providerImpact).toHaveBeenCalledWith('claude', 'kimi-1', undefined))
  const alert = within(await screen.findByRole('alertdialog'))
  expect(alert.getByText('2 个群的会话仍在使用 官方登录，开启新会话后才会切换到 Kimi：')).toBeTruthy()
  fireEvent.click(alert.getByRole('button', { name: '取消' }))
  expect(m.chooseProvider).not.toHaveBeenCalled()

  m.providerImpact.mockResolvedValue([])
  fireEvent.click(claude.getByRole('radio', { name: /Kimi/ }))
  await waitFor(() => expect(m.chooseProvider).toHaveBeenCalledWith('claude', 'kimi-1', undefined))
  expect(m.providers).toHaveBeenCalledTimes(2)
})

it('leaves adding, editing and importing to the Web', async () => {
  render(<AgentsPage go={() => {}} />)
  const claude = await box('Claude Code')
  for (const name of ['新增…', '编辑…', '删除', '粘贴链接导入…', '从 CC Switch 导入…'])
    expect(claude.queryByRole('button', { name })).toBeNull()
  fireEvent.click(claude.getByRole('button', { name: '在 Web 中管理' }))
  await waitFor(() => expect(m.openProvidersInWeb).toHaveBeenCalled())
})
