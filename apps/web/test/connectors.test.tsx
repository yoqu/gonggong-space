import type { BotDto, ConnectorDto, GroupDto, PluginManifest, TeamDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useConnectorStore } from '../src/features/connectors/store'
import { usePluginStore } from '../src/features/plugins/store'
import { mockApi } from './mockApi'

const now = new Date().toISOString()

const me = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
} as UserDto

const manifest = (o: Partial<PluginManifest>): PluginManifest => ({
  name: 'dw',
  version: '1.0.0',
  title: '数仓',
  description: '查询线上数据，按你的 Key 控制可见的库表',
  category: 'connector',
  agents: ['claude'],
  minDaemon: '0.4.0',
  entry: null,
  permissions: ['network'],
  contributes: {
    mcp: [{ transport: 'http', name: 'query', url: 'https://dw.example.com/mcp', headers: {} }],
    commands: [],
    providers: [],
    agents: [],
  },
  templates: [],
  designSystems: [],
  inputs: [],
  secrets: ['DW_MANAGER_API_KEY'],
  secretSpecs: [
    {
      name: 'DW_MANAGER_API_KEY',
      title: '数仓 Key',
      description: '在数仓个人中心生成',
      mode: 'personal',
      required: true,
    },
  ],
  connector: { examples: ['查一下昨天的订单量', '近 7 天新增用户趋势'], docs: 'https://dw.example.com/keys' },
  composer: null,
  source: null,
  ...o,
})

const connector = (o: Partial<ConnectorDto> = {}): ConnectorDto => ({
  id: 'c1',
  layer: 'team',
  manifest: manifest({}),
  versionId: 'v1',
  revision: 1,
  size: 1024,
  updatedBy: null,
  updatedAt: now,
  builtin: false,
  enabledInGroup: true,
  bots: [],
  personal: true,
  connected: false,
  missing: ['DW_MANAGER_API_KEY'],
  sharedWith: [],
  ...o,
})
const dw = connector()
const modao = connector({
  id: 'c2',
  manifest: manifest({
    name: 'modao',
    title: '墨刀',
    description: '读取墨刀原型',
    secrets: ['MODAO_TOKEN'],
    secretSpecs: [{ name: 'MODAO_TOKEN', description: '', mode: 'shared', required: true }],
    connector: { examples: ['看看这个原型'] },
  }),
  personal: false,
  missing: [],
})
const meegle = connector({
  id: 'c3',
  manifest: manifest({
    name: 'meegle',
    title: '飞书项目',
    description: '查需求、缺陷和排期',
    connector: { examples: ['我这周有哪些待办', '列出本迭代的缺陷'] },
  }),
  connected: true,
  missing: [],
  sharedWith: ['dw-query'],
})
const off = connector({
  id: 'c4',
  manifest: manifest({ name: 'jenkins', title: '研发流水线' }),
  enabledInGroup: false,
})

const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '产品设计组',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: false }],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}
const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '设计助手',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 0,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  aiReview: false,
  model: null,
  effort: null,
  catalog: null,
}

const team: TeamDto = {
  id: 't1',
  name: '设计组',
  avatar: null,
  role: 'member',
  archivedAt: null,
  createdAt: now,
  unread: 0,
}

class NoopSocket {
  close() {}
}

const routes = (connectors: ConnectorDto[]) => ({
  'GET /groups': [group],
  'GET /users': [],
  'GET /bots': [bot],
  'GET /machines': [],
  'GET /notifications/unread': { n: 0 },
  'GET /groups/g1/timeline': { messages: [], runs: [] },
  'POST /groups/g1/read': group,
  'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
  'GET /groups/g1/plugins': [],
  'GET /groups/g1/connectors': { connectors },
})

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

const renderChat = () =>
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <App />
      <Where />
    </MemoryRouter>,
  )

const box = () =>
  screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: '连接器' }))
  return screen.findByRole('dialog', { name: '连接器' })
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({
    user: me,
    status: 'ready',
    tenancy: {
      teams: [team],
      singleTeamMode: true,
      canCreateTeam: false,
      demoMode: false,
      pluginsEnabled: true,
    },
  })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  usePluginStore.setState({ lists: {} })
  useConnectorStore.setState({ lists: {}, errors: {} })
  sessionStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('输入框 · 连接器菜单', () => {
  it("lists the group's enabled connectors with their status, searches and links to the market", async () => {
    mockApi(routes([dw, modao, meegle, off]))
    renderChat()
    const menu = await openMenu()
    const rows = await within(menu).findAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['数仓连接', '墨刀待管理员配置', '飞书项目已连接'])
    expect(within(rows[0]!).getByRole('button', { name: '连接' })).toBeTruthy()

    fireEvent.change(within(menu).getByRole('searchbox', { name: '搜索连接器' }), { target: { value: '墨' } })
    expect(
      within(menu)
        .getAllByRole('listitem')
        .map((r) => r.textContent),
    ).toEqual(['墨刀待管理员配置'])
    fireEvent.change(within(menu).getByRole('searchbox', { name: '搜索连接器' }), {
      target: { value: 'xyz' },
    })
    expect(within(menu).getByText('没有匹配的连接器')).toBeTruthy()

    fireEvent.click(within(menu).getByRole('button', { name: '管理连接器' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/market?shelf=connector'))
  })

  it('shows an empty state that leads to the market when the group has none', async () => {
    mockApi(routes([off]))
    renderChat()
    const menu = await openMenu()
    expect(await within(menu).findByText('本群还没有开启连接器')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: '去市场看看' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/market?shelf=connector'))
  })
})

describe('连接器详情弹窗', () => {
  it('connects with my own key, usable on others’ machines', async () => {
    const calls = mockApi({
      ...routes([dw, modao]),
      'POST /groups/g1/connectors/c1/connect': connector({ connected: true, missing: [] }),
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '连接' }))
    const dialog = await screen.findByRole('dialog', { name: '数仓' })
    expect(within(dialog).getByText('查询线上数据，按你的 Key 控制可见的库表')).toBeTruthy()
    expect(within(dialog).getByText(/将允许群内 Bot 在他人机器上使用/)).toBeTruthy()
    expect(within(dialog).getByText(/Bot 的回复群内可见/)).toBeTruthy()
    expect(within(dialog).getByText('数仓 Key')).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('link', { name: /^如何获取/ })
        .getAttribute('href'),
    ).toBe('https://dw.example.com/keys')
    const connect = within(dialog).getByRole('button', { name: '连接' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('DW_MANAGER_API_KEY'), {
      target: { value: 'sk-12345678' },
    })
    expect(connect.disabled).toBe(false)
    fireEvent.click(connect)
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/groups/g1/connectors/c1/connect')?.body,
      ).toEqual({
        values: { DW_MANAGER_API_KEY: 'sk-12345678' },
      }),
    )
    expect(await within(dialog).findByRole('button', { name: '去试试' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '解绑' })).toBeTruthy()
  })

  it('a shared connector not connected yet waits for an admin', async () => {
    mockApi(routes([modao]))
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '墨刀' }))
    const dialog = await screen.findByRole('dialog', { name: '墨刀' })
    expect(within(dialog).getByText(/待管理员配置/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '连接' })).toBeNull()
    expect(within(dialog).queryByText(/Bot 的回复群内可见/)).toBeNull()
  })

  it('去试试 and the example cards fill the composer @-ing the bot, without sending', async () => {
    const calls = mockApi(routes([meegle]))
    renderChat()
    let menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书项目' }))
    let dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    fireEvent.click(within(dialog).getByRole('button', { name: '去试试' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '飞书项目' })).toBeNull())
    expect(box().value).toBe('@设计助手 我这周有哪些待办')

    fireEvent.change(box(), { target: { value: '' } })
    menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书项目' }))
    dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    const tries = within(dialog).getByRole('region', { name: '试试这样用' })
    fireEvent.click(within(tries).getByRole('button', { name: '列出本迭代的缺陷' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '飞书项目' })).toBeNull())
    expect(box().value).toBe('@设计助手 列出本迭代的缺陷')
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/messages'))).toBe(false)
  })

  it('解绑 confirms, naming what else gets cut off', async () => {
    const calls = mockApi({
      ...routes([meegle]),
      'DELETE /groups/g1/connectors/c3/connection': undefined,
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书项目' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    fireEvent.click(within(dialog).getByRole('button', { name: '解绑' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('这些也会一起断开：dw-query')).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: '解绑' }))
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.path === '/groups/g1/connectors/c3/connection'),
      ).toBe(true),
    )
  })
})
