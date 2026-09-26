import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { AgentsPage } from '../src/pages/Agents'
import { useDaemon } from '../src/store'
import { bot, CLAUDE, CODEX, INFO } from './ipc-mock'

const m = vi.mocked(ipc)
const writeText = vi.fn(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText } })
  useDaemon.setState({ info: INFO })
  m.agents.mockResolvedValue([CLAUDE, CODEX])
  m.bots.mockResolvedValue([bot({}), bot({ id: 'b2', name: '小王的 Codex', agentKind: 'codex' })])
  m.pickAgentPath.mockResolvedValue(true)
  m.resetAgentPath.mockResolvedValue()
  m.reveal.mockResolvedValue()
})

const card = async (name: string) => (await screen.findByText(name)).closest('.dk-agent') as HTMLElement

it('shows an installed agent with the models its adapter offers', async () => {
  render(<AgentsPage go={() => {}} />)
  const claude = within(await card('Claude Code'))
  expect(claude.getByText('已安装 2.1.4')).toBeTruthy()
  const path = claude.getByRole('navigation', { name: '/opt/homebrew/bin/claude' })
  fireEvent.click(within(path).getByRole('button', { name: 'homebrew' }))
  expect(m.reveal).toHaveBeenCalledWith('/opt/homebrew')
  expect(claude.getByText('2.1.4 · 满足 ≥ 2.0.0')).toBeTruthy()
  expect(claude.getByText('已登录 · Claude Max')).toBeTruthy()
  expect(claude.getByText('0.81.0 · 随 daemon')).toBeTruthy()
  expect(await claude.findByText('被 小王的 Claude 使用')).toBeTruthy()

  expect(claude.getByText('Sonnet 5、Haiku 4.5')).toBeTruthy()
  expect(claude.getByText('模型与推理强度在 Web 端为 Bot 设置')).toBeTruthy()

  fireEvent.click(claude.getByRole('button', { name: '更换路径…' }))
  await waitFor(() => expect(m.pickAgentPath).toHaveBeenCalledWith('claude'))
  expect(m.agents).toHaveBeenCalledTimes(2)
})

it('helps install a missing agent', async () => {
  render(<AgentsPage go={() => {}} />)
  const codex = within(await card('Codex'))
  expect(codex.getByText('未安装')).toBeTruthy()
  expect(codex.getByText(/本机未检测到 Codex/).textContent).toContain('小王的 Codex 依赖它')
  expect(codex.getByText('npm install -g @openai/codex')).toBeTruthy()
  fireEvent.click(codex.getByRole('button', { name: '复制' }))
  expect(writeText).toHaveBeenCalledWith('npm install -g @openai/codex')
  expect(await codex.findByRole('button', { name: '已复制' })).toBeTruthy()

  m.agents.mockResolvedValue([CLAUDE, { ...CODEX, available: true, version: '0.48.0', path: '/x/codex' }])
  fireEvent.click(codex.getByRole('button', { name: '已安装，重新检测' }))
  expect(await screen.findByText('已安装 0.48.0')).toBeTruthy()

  m.agents.mockResolvedValue([CLAUDE, CODEX])
  fireEvent.click(screen.getAllByRole('button', { name: '重新检测' })[1] as HTMLElement)
  const again = within(await card('Codex'))
  fireEvent.click(await again.findByRole('button', { name: '手动指定路径…' }))
  await waitFor(() => expect(m.pickAgentPath).toHaveBeenCalledWith('codex'))
})

it('shows models as pending until probed, and restores detection for a custom path', async () => {
  m.agents.mockResolvedValue([
    { ...CLAUDE, catalog: null, customPath: true, path: '/opt/claude' },
    { ...CODEX, available: true, version: '0.48.0', path: '/x/codex' },
  ])
  render(<AgentsPage go={() => {}} />)
  const claude = within(await card('Claude Code'))
  expect(claude.getByText('检测中…')).toBeTruthy()
  fireEvent.click(claude.getByRole('button', { name: '恢复自动检测' }))
  await waitFor(() => expect(m.resetAgentPath).toHaveBeenCalledWith('claude'))
  const codex = within(await card('Codex'))
  expect(codex.getByText('被 小王的 Codex 使用')).toBeTruthy()
})
