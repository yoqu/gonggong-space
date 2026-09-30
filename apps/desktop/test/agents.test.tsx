import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, onToolProgress } from '../src/ipc'
import { AgentsPage } from '../src/pages/Agents'
import { useDaemon } from '../src/store'
import { bot, CLAUDE, CODEX, INFO, tool } from './ipc-mock'

const m = vi.mocked(ipc)

beforeEach(() => {
  vi.clearAllMocks()
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

it('installs a missing agent with a live log, then detects it again', async () => {
  let emit: (line: string) => void = () => {}
  vi.mocked(onToolProgress).mockImplementation(async (_id, cb) => {
    emit = cb
    return () => {}
  })
  let finish: (s: ReturnType<typeof tool>) => void = () => {}
  m.runTool.mockImplementation(() => new Promise((r) => (finish = r)))
  m.tools.mockResolvedValue([
    tool({ kind: 'claude', version: '2.1.4' }),
    tool({ kind: 'codex', installed: false }),
  ])
  render(<AgentsPage go={() => {}} />)
  const codex = within(await card('Codex'))
  expect(codex.getByText('未安装')).toBeTruthy()
  expect(codex.getByText(/本机未检测到 Codex/).textContent).toContain('小王的 Codex 依赖它')
  expect(codex.queryByText(/npm install/)).toBeNull()

  fireEvent.click(await codex.findByRole('button', { name: '安装' }))
  await waitFor(() =>
    expect(m.runTool).toHaveBeenCalledWith('install', 'codex', expect.stringMatching(/^codex-/)),
  )
  expect(vi.mocked(onToolProgress).mock.calls[0]?.[0]).toBe(m.runTool.mock.calls[0]?.[2])
  act(() => emit('安装 @openai/codex@latest（https://registry.npmmirror.com）'))
  const log = within(await codex.findByRole('log', { name: '安装日志' }))
  expect(log.getByText('安装 @openai/codex@latest（https://registry.npmmirror.com）')).toBeTruthy()
  expect(codex.getByText('正在安装…')).toBeTruthy()
  expect(
    screen
      .getAllByRole('button', { name: '安装共工空间托管版' })
      .every((b) => (b as HTMLButtonElement).disabled),
  ).toBe(true)

  m.agents.mockResolvedValue([CLAUDE, { ...CODEX, available: true, version: '0.159.2', path: '/x/codex' }])
  m.tools.mockResolvedValue([tool({ kind: 'codex', version: '0.159.2', managed: true, latest: '0.159.2' })])
  await act(async () => finish(tool({ kind: 'codex', version: '0.159.2', managed: true })))
  expect(await screen.findByText('已安装 0.159.2')).toBeTruthy()
  expect(await screen.findByText('安装完成')).toBeTruthy()
  expect(screen.getByText('共工空间托管')).toBeTruthy()
})

it('upgrades a managed tool and offers the managed install next to the user’s own', async () => {
  m.tools.mockResolvedValue([
    tool({ kind: 'node', version: '20.1.0', path: '/usr/local/bin/node' }),
    tool({ kind: 'claude', version: '2.1.4', latest: '2.2.0', managed: true }),
    tool({ kind: 'codex', installed: false }),
  ])
  m.runTool.mockRejectedValue('本机已有工具安装或升级在进行中，请稍后再试')
  render(<AgentsPage go={() => {}} />)
  const node = within((await screen.findByText('Node.js')).closest('.ui-group') as HTMLElement)
  expect(await node.findByText('版本过低 20.1.0')).toBeTruthy()
  expect(node.getByText(/低于 22，ACP 适配器无法运行/)).toBeTruthy()
  expect(node.getByText('自行安装')).toBeTruthy()

  const claude = within(await card('Claude Code'))
  expect(await claude.findByText('有更新')).toBeTruthy()
  expect(claude.getByText('共工空间托管')).toBeTruthy()
  fireEvent.click(claude.getByRole('button', { name: '升级到 2.2.0' }))
  await waitFor(() => expect(m.runTool).toHaveBeenCalledWith('upgrade', 'claude', expect.any(String)))
  expect(await claude.findByText('安装失败')).toBeTruthy()
  expect(within(claude.getByRole('log')).getByText('本机已有工具安装或升级在进行中，请稍后再试')).toBeTruthy()

  fireEvent.click(node.getByRole('button', { name: '安装' }))
  await waitFor(() => expect(m.runTool).toHaveBeenCalledWith('install', 'node', expect.any(String)))
})

it('rechecks and picks a path for a missing agent', async () => {
  render(<AgentsPage go={() => {}} />)
  const codex = within(await card('Codex'))
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
