import type { BotDto, ConnectorDto, GroupDto, PluginManifest, TeamDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useConnectorStore } from '../src/features/connectors/store'
import { usePluginStore } from '../src/features/plugins/store'

// Shared by the connector suites: a chat in group g1 with one bot, and the group's connectors from `routes`.
// Importing it registers the suite's beforeEach / afterEach.
export const now = new Date().toISOString()

export const me = {
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

export const manifest = (o: Partial<PluginManifest>): PluginManifest => ({
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

export const connector = (o: Partial<ConnectorDto> = {}): ConnectorDto => ({
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
  on: true,
  status: 'unconnected',
  account: null,
  checkedAt: null,
  cli: null,
  ...o,
})
export const group: GroupDto = {
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
export const bot: BotDto = {
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

export const team: TeamDto = {
  id: 't1',
  name: '设计组',
  avatar: null,
  role: 'member',
  archivedAt: null,
  createdAt: now,
  unread: 0,
}

export class NoopSocket {
  close() {}
}

export const routes = (connectors: ConnectorDto[]) => ({
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

export function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

export const renderChat = () =>
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <App />
      <Where />
    </MemoryRouter>,
  )

export const box = () =>
  screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement

export async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: '外部连接' }))
  return screen.findByRole('dialog', { name: '外部连接' })
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
