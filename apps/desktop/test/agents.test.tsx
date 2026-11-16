import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { desktopSource } from '../src/agentsSource'
import { ipc, onToolProgress } from '../src/ipc'
import { AgentsPage } from '../src/pages/Agents'
import { agent, bot, CLAUDE, CODEX, provider, STATE, VIEW } from './ipc-mock'

const m = vi.mocked(ipc)

beforeEach(() => {
  vi.clearAllMocks()
  m.agentFeatures.mockResolvedValue(['tools', 'providers', 'protocolProviders'])
  m.tools.mockResolvedValue({ ...STATE, agents: [CLAUDE, CODEX] })
  m.providers.mockResolvedValue({ view: VIEW })
  m.bots.mockResolvedValue([bot({}), bot({ id: 'b2', name: '小王的 Codex', agentKind: 'codex' })])
})

const row = (name: string) =>
  within(screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('.ag-agent') as HTMLElement)

describe('Agent page', () => {
  it('shows the shared Agent page on this machine’s detection and providers', async () => {
    m.providers.mockResolvedValue({ view: { ...VIEW, providers: [provider({ name: 'Kimi' })] } })
    render(<AgentsPage go={() => {}} />)
    const agents = await screen.findByRole('region', { name: 'Agent' })
    expect(within(agents).getByText('Claude Code')).toBeTruthy()
    const installable = screen.getByRole('region', { name: '可安装' })
    expect(within(installable).getByText('Codex')).toBeTruthy()
    const providers = await screen.findByRole('region', { name: '供应商' })
    expect(within(providers).getByText('Kimi')).toBeTruthy()
    expect(m.providers).toHaveBeenCalledWith({ action: 'list' })
  })

  it('opens Claude Code when the daemon leaves out empty agentSettings and cli', async () => {
    m.agentFeatures.mockResolvedValue(['tools', 'providers', 'protocolProviders', 'agentSettings'])
    const { agentSettings: _, cli: __, ...bare } = VIEW
    m.providers.mockResolvedValue({ view: bare as typeof VIEW })
    render(<AgentsPage go={() => {}} />)
    await screen.findByRole('region', { name: '供应商' })
    fireEvent.click(screen.getByRole('button', { name: /^Claude Code/ }))
    expect(await screen.findByRole('region', { name: 'Claude Code Agent 设置' })).toBeTruthy()
  })

  it('installs an agent with a live log, then shows the new state', async () => {
    let emit: (line: string) => void = () => {}
    vi.mocked(onToolProgress).mockImplementation(async (_id, cb) => {
      emit = cb
      return () => {}
    })
    let finish: (s: typeof STATE) => void = () => {}
    m.runTool.mockImplementation(() => new Promise((r) => (finish = r)))
    render(<AgentsPage go={() => {}} />)
    await screen.findByRole('region', { name: '可安装' })
    fireEvent.click(row('Codex').getByRole('button', { name: '安装' }))
    await waitFor(() =>
      expect(m.runTool).toHaveBeenCalledWith('install', 'codex', expect.stringMatching(/^codex-/)),
    )
    expect(vi.mocked(onToolProgress).mock.calls[0]?.[0]).toBe(m.runTool.mock.calls[0]?.[2])
    act(() => emit('安装 @openai/codex@latest'))
    expect(await screen.findByText('安装 @openai/codex@latest')).toBeTruthy()

    const codex = agent('codex', { version: '0.161.0', managed: true })
    await act(async () => finish({ ...STATE, agents: [CLAUDE, codex] }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '可安装' })).toBeNull())
  })

  it('shows the login and adapter, and picks or resets the path on this machine', async () => {
    m.agentLocal.mockResolvedValue({
      customPath: true,
      login: '已登录 · Claude Max',
      adapterVersion: '0.81.0',
    })
    m.pickAgentPath.mockResolvedValue(true)
    render(<AgentsPage go={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Claude Code/ }))
    expect(await row('Claude Code').findByText('已登录 · Claude Max')).toBeTruthy()
    expect(m.agentLocal).toHaveBeenCalledWith('claude')
    expect(row('Claude Code').getByText('共工内置适配器 0.81.0')).toBeTruthy()
    fireEvent.click(row('Claude Code').getByRole('button', { name: '更换路径…' }))
    await waitFor(() => expect(m.pickAgentPath).toHaveBeenCalledWith('claude'))
    await waitFor(() => expect(m.tools).toHaveBeenCalledTimes(2))
    fireEvent.click(row('Claude Code').getByRole('button', { name: '恢复自动检测' }))
    await waitFor(() => expect(m.resetAgentPath).toHaveBeenCalledWith('claude'))
    await waitFor(() => expect(m.tools).toHaveBeenCalledTimes(3))
  })

  it('tells how to log in to the official account in this machine’s terminal', async () => {
    m.agentLocal.mockResolvedValue({ customPath: false, login: null, adapterVersion: null })
    render(<AgentsPage go={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Claude Code/ }))
    fireEvent.click(await row('Claude Code').findByRole('button', { name: '登录…' }))
    const dialog = await screen.findByRole('dialog', { name: '登录 Claude Code 官方账号' })
    expect(within(dialog).getByText('在本机打开终端')).toBeTruthy()
    expect(within(dialog).getByText('进入后输入 /login，按提示在浏览器里完成登录')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '打开终端' })).toBeNull()
  })

  it('asks before switching a default that sessions still use, naming their groups and bots', async () => {
    m.providers.mockResolvedValue({
      view: {
        ...VIEW,
        providers: [provider({ id: 'k1', name: 'Kimi' })],
        sessions: [{ groupId: 'g1', botId: 'b1', agent: 'claude', provider: 'official' }],
      },
    })
    m.groupNames.mockResolvedValue({ g1: '支付服务重构' })
    render(<AgentsPage go={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Claude Code/ }))
    fireEvent.click(await screen.findByRole('button', { name: '供应商/模型' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Kimi/ }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('支付服务重构（小王的 Claude）')).toBeTruthy()
    expect(m.providers).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'use' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '切换' }))
    await waitFor(() =>
      expect(m.providers).toHaveBeenCalledWith({ action: 'use', agent: 'claude', choice: 'k1', model: null }),
    )
  })

  it('shows a failed install’s message in its log', async () => {
    m.runTool.mockRejectedValue('本机已有工具安装或升级在进行中，请稍后再试')
    render(<AgentsPage go={() => {}} />)
    await screen.findByRole('region', { name: '可安装' })
    fireEvent.click(row('Codex').getByRole('button', { name: '安装' }))
    expect(await screen.findByText('本机已有工具安装或升级在进行中，请稍后再试')).toBeTruthy()
  })
})

describe('desktop source', () => {
  const source = (features = ['tools', 'providers', 'protocolProviders']) => desktopSource(features)

  it('saves a vendor, then makes it the default of each agent asked', async () => {
    const saved = { ...VIEW, providers: [provider({ id: 'k1' })] }
    const used = { ...VIEW, machine: { codex: { provider: 'k1', model: null } } }
    m.providers.mockImplementation(async (cmd) =>
      cmd.action === 'save' ? { id: 'k1', view: saved } : { view: used },
    )
    const res = await source().saveProvider(null, {
      name: 'Kimi',
      apiKey: 'sk-1',
      endpoints: [{ protocol: 'openai', baseUrl: 'https://k.test/v1' }],
      setDefault: ['claude', 'codex'],
      agent: 'codex',
    })
    expect(m.providers.mock.calls.map((c) => c[0])).toEqual([
      {
        action: 'save',
        provider: {
          name: 'Kimi',
          apiKey: 'sk-1',
          endpoints: [{ protocol: 'openai', baseUrl: 'https://k.test/v1' }],
        },
      },
      { action: 'use', agent: 'claude', choice: 'k1' },
      { action: 'use', agent: 'codex', choice: 'k1' },
    ])
    expect(res).toEqual({ id: 'k1', view: used })

    await source().saveProvider('k1', { removeProtocols: ['openai'] })
    expect(m.providers).toHaveBeenLastCalledWith({
      action: 'save',
      provider: { removeProtocols: ['openai'], id: 'k1' },
    })
  })

  it('passes defaults with their model, official logins and agent settings as the daemon takes them', async () => {
    const s = source()
    await s.setDefault('claude', 'k1', 'kimi-k2')
    expect(m.providers).toHaveBeenLastCalledWith({
      action: 'use',
      agent: 'claude',
      choice: 'k1',
      model: 'kimi-k2',
    })
    await s.saveOfficial({ agent: 'claude', proxy: '' })
    expect(m.providers).toHaveBeenLastCalledWith({
      action: 'official',
      agent: 'claude',
      official: { proxy: '' },
    })
    await s.saveAgentSettings({ agent: 'claude', values: {}, inheritCli: false })
    expect(m.providers).toHaveBeenLastCalledWith({
      action: 'agentSettings',
      agent: 'claude',
      agentSettings: { values: {}, inheritCli: false },
    })
    await s.removeProvider('k1')
    expect(m.providers).toHaveBeenLastCalledWith({ action: 'remove', id: 'k1' })
    await s.importLink('ccswitch://v1/import?x')
    expect(m.providers).toHaveBeenLastCalledWith({
      action: 'importLink',
      link: 'ccswitch://v1/import?x',
      setDefault: false,
    })
  })

  it('rejects with an Error carrying the command’s message', async () => {
    m.providers.mockRejectedValue('供应商 k1 不存在')
    await expect(source().removeProvider('k1')).rejects.toThrow(new Error('供应商 k1 不存在'))
  })

  it('offers CC Switch only when the machine has it', async () => {
    expect(source().ccSwitch).toBeUndefined()
    const s = source(['providers', 'ccSwitch'])
    m.ccSwitchApply.mockResolvedValue({ imported: ['k1'], view: VIEW })
    expect(await s.ccSwitch?.apply(['claude:1'])).toEqual({ imported: ['k1'], view: VIEW })
    expect(m.ccSwitchApply).toHaveBeenCalledWith(['claude:1'])
  })
})
