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
