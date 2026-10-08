import type { AgentCatalog, BotDto, MachineDto, ProviderStoreView, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { BotDetail } from '../src/features/bots/BotsAdminPage'
import { mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const mbp: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [],
  daemonVersion: '0.9.0',
  features: ['tools', 'providers'],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const OFFICIAL: AgentCatalog = {
  current: 'sonnet',
  efforts: [],
  effort: null,
  models: [{ value: 'sonnet', name: 'Sonnet', efforts: [], effort: null }],
}
const KIMI: AgentCatalog = {
  current: 'kimi-for-coding',
  efforts: [],
  effort: null,
  models: [
    { value: 'kimi-for-coding', name: 'kimi-for-coding', efforts: [], effort: null },
    { value: 'kimi-k2', name: 'kimi-k2', efforts: [], effort: null },
  ],
}

const bot = (o: Partial<BotDto> = {}): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  machineId: 'm1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: '2.1.4',
  agentMinVersion: '2.0.0',
  groupCount: 1,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  approval: 'ask',
  allowlist: [],
  model: null,
  effort: null,
  catalog: OFFICIAL,
  ...o,
})

const provider = (id: string, name: string, agent: 'claude' | 'codex' = 'claude') => ({
  id,
  agent,
  name,
  presetId: null,
  revision: 1,
  baseUrl: 'https://x.example.com',
  apiKey: '****abcd',
  apiKeyField: null,
  model: null,
  models: null,
  env: {},
  proxy: null,
  wireApi: null,
  effort: null,
  source: null,
})

const VIEW: ProviderStoreView = {
  machine: { claude: 'p1' },
  bots: {},
  providers: [provider('p1', 'Kimi'), provider('p2', 'GLM'), provider('p3', 'Codex 中转', 'codex')],
  sessions: [],
}

beforeEach(() => {
  useWorkspace.setState({ machines: [mbp], groups: [], bots: [] })
})
afterEach(() => vi.unstubAllGlobals())

const renderDetail = (b: BotDto = bot(), user: UserDto = me) =>
  render(
    <MemoryRouter>
      <BotDetail bot={b} me={user} users={[]} />
    </MemoryRouter>,
  )

describe('bot provider', () => {
  it('offers inherit (naming the machine default), official and the same-agent providers', async () => {
    mockApi({
      'GET /machines/m1/providers': VIEW,
      'GET /bots/b1/catalog': { catalog: KIMI },
    })
    renderDetail()
    const select = await screen.findByRole('button', { name: '供应商' })
    await waitFor(() => expect(select.textContent).toContain('继承机器（当前：Kimi）'))
    fireEvent.click(select)
    const names = screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent)
    expect(names).toEqual(['继承机器（当前：Kimi）', '官方登录', 'Kimi', 'GLM'])
  })

  it('sets the provider and takes model options from its catalog', async () => {
    let switched = false
    const calls = mockApi({
      'GET /machines/m1/providers': { ...VIEW, machine: {} },
      'PUT /bots/b1/provider': () => {
        switched = true
        return { ...VIEW, machine: {}, bots: { b1: 'p2' } }
      },
      'GET /bots/b1/catalog': () => ({ catalog: switched ? KIMI : OFFICIAL }),
    })
    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: '供应商' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'GLM' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/bots/b1/provider',
        body: { choice: 'p2' },
      }),
    )
    await waitFor(() => expect(calls.filter((c) => c.path === '/bots/b1/catalog').length).toBeGreaterThan(1))
    fireEvent.click(await screen.findByRole('button', { name: '模型' }))
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: 'kimi-k2' })).toBeTruthy())
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Sonnet' })).toBeNull()
  })

  it('confirms when sessions of the bot keep the old provider', async () => {
    const view = {
      ...VIEW,
      sessions: [{ groupId: 'g1', botId: 'b1', agent: 'claude' as const, provider: 'p1' }],
    }
    useWorkspace.setState({ groups: [{ id: 'g1', name: '前端组' } as never], bots: [bot()] })
    const calls = mockApi({
      'GET /machines/m1/providers': view,
      'GET /bots/b1/catalog': { catalog: KIMI },
      'PUT /bots/b1/provider': { ...view, bots: { b1: 'official' } },
    })
    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: '供应商' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '官方登录' }))
    const alert = await screen.findByRole('alertdialog')
    expect(alert.textContent).toContain('1 个群的会话仍在使用 Kimi，开启新会话后才会切换到 官方登录')
    expect(within(alert).getByText('前端组（小王的 Claude）')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: '切换' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ choice: 'official' }))
  })

  it('is disabled with the reason when the machine is offline', async () => {
    const calls = mockApi({})
    useWorkspace.setState({ machines: [{ ...mbp, online: false }] })
    renderDetail()
    const select = screen.getByRole('button', { name: '供应商' }) as HTMLButtonElement
    expect(select.disabled).toBe(true)
    expect(screen.getByText(/机器离线/)).toBeTruthy()
    expect(calls.some((c) => c.path.includes('/providers'))).toBe(false)
  })

  it('is disabled for someone who does not own the bot', () => {
    mockApi({})
    renderDetail(bot(), { ...me, id: 'u9', role: 'sysadmin' })
    expect((screen.getByRole('button', { name: '供应商' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('只有 Bot 主人可以设置其供应商')).toBeTruthy()
  })

  it("offers a sysadmin the models of the bot's provider though they cannot set it", async () => {
    mockApi({ 'GET /bots/b1/catalog': { catalog: KIMI } })
    renderDetail(bot(), { ...me, id: 'u9', role: 'sysadmin' })
    fireEvent.click(await screen.findByRole('button', { name: '模型' }))
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: 'kimi-k2' })).toBeTruthy())
  })
})
