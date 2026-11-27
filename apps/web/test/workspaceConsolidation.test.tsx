import type {
  BotDto,
  ConnectorDto,
  GroupDto,
  GroupPluginDto,
  InstallDto,
  MachineDto,
  PluginTrustDto,
  SecretDto,
  TeamDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { BotPage } from '../src/features/bots/BotPage'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { ConnectorMenu } from '../src/features/connectors/ConnectorMenu'
import { useConnectorStore } from '../src/features/connectors/store'
import { GroupSettingsDialog } from '../src/features/groups/GroupSettingsDialog'
import { MachinePage } from '../src/features/machines/MachinePage'
import { usePluginStore } from '../src/features/plugins/store'
import { TeamSettingsDialog } from '../src/features/teams/TeamSettingsDialog'
import { realtime } from '../src/lib/realtime'
import { Toaster } from '../src/ui'
import { mockApi } from './mockApi'

const now = '2026-11-27T08:00:00Z'

const adminUser: UserDto = {
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

const memberUser: UserDto = { ...adminUser, id: 'u2', account: 'zhaomin', name: '赵敏' }

const team: TeamDto = {
  id: 't1',
  name: '支付研发组',
  avatar: null,
  role: 'admin',
  archivedAt: null,
  createdAt: now,
  unread: 0,
}

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '支付服务重构',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '赵敏', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const bot = (o: Partial<BotDto> = {}): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '研发助手',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'm1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: '2.1.4',
  agentMinVersion: '2.0.0',
  groupCount: 2,
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
  ...o,
})

const machine = (o: Partial<MachineDto> = {}): MachineDto => ({
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [],
  daemonVersion: '0.9.0',
  features: ['tools', 'providers', 'protocolProviders', 'agentSettings'],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: now,
  createdAt: now,
  ...o,
})

const connectorPlugin: GroupPluginDto = {
  id: 'p-feishu',
  layer: 'team',
  manifest: {
    name: 'feishu',
    version: '1.0.0',
    title: '飞书',
    description: '读写飞书文档、日程与群消息',
    category: 'connector',
    agents: ['claude'],
    minDaemon: '0.4.0',
    entry: null,
    permissions: ['network'],
    contributes: { mcp: [], commands: [], providers: [], agents: [] },
    templates: [],
    designSystems: [],
    inputs: [],
    secrets: ['FEISHU_TOKEN'],
    secretSpecs: [
      { name: 'FEISHU_TOKEN', title: '飞书令牌', description: '', mode: 'personal', required: true },
    ],
    connector: { examples: ['查今天日程'] },
    composer: null,
    source: null,
  },
  versionId: 'v1',
  revision: 1,
  size: 1024,
  updatedBy: null,
  updatedAt: now,
  builtin: false,
  enabledInGroup: true,
  bots: [],
}

const creationPlugin: GroupPluginDto = {
  ...connectorPlugin,
  id: 'p-slides',
  layer: 'group',
  manifest: {
    ...connectorPlugin.manifest,
    name: 'slides',
    title: 'PPT 演示文稿',
    description: '按大纲生成可编辑幻灯片',
    category: 'deck',
    secrets: [],
    secretSpecs: [],
    connector: undefined,
  },
}

const connectorItem = (o: Partial<ConnectorDto> = {}): ConnectorDto => ({
  ...connectorPlugin,
  personal: true,
  connected: false,
  missing: ['FEISHU_TOKEN'],
  sharedWith: [],
  on: true,
  status: 'unconnected',
  account: null,
  checkedAt: null,
  cli: null,
  ...o,
})

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

beforeEach(() => {
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useSession.setState({
    user: adminUser,
    status: 'ready',
    tenancy: {
      teams: [team],
      singleTeamMode: true,
      canCreateTeam: false,
      demoMode: false,
      pluginsEnabled: true,
    },
  })
  useWorkspace.setState({ groups: [group()], bots: [bot()], machines: [machine()], activeGroupId: 'g1' })
  usePluginStore.setState({ lists: {} })
  useConnectorStore.setState({ lists: {}, errors: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Workspace Concept Consolidation · Group & Team Settings', () => {
  it('consolidates Group Settings into 插件与能力 + 凭据与授权 with collapsed developer config', async () => {
    const g = group()
    const secret: SecretDto = {
      id: 's1',
      scope: 'group',
      teamId: 't1',
      groupId: 'g1',
      name: 'CUSTOM_RAW_KEY',
      description: '内部密钥',
      mode: 'shared',
      botIds: null,
      enabled: true,
      expiresAt: null,
      value: { last4: '9988', updatedBy: '王磊', updatedAt: now },
      personalFilled: [],
      updatedAt: now,
    }
    mockApi({
      'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
      'GET /groups/g1/plugins': [connectorPlugin, creationPlugin],
      'GET /groups/g1/connectors': { connectors: [connectorItem()] },
      'GET /groups/g1/secret-needs': [
        {
          skill: 'feishu',
          skillVersionId: 'sv1',
          personalSkill: false,
          spec: {
            name: 'FEISHU_TOKEN',
            title: '飞书令牌',
            description: '',
            mode: 'personal',
            required: true,
          },
          status: 'unfilled',
          def: { id: 's2', scope: 'group', mode: 'personal', description: '', hasValue: false },
          target: null,
          mine: null,
          action: 'fill_personal',
        },
      ],
      'GET /groups/g1/installs': [] as InstallDto[],
      'GET /groups/g1/inherited-skills': [],
      'GET /groups/g1/mcp': [
        {
          id: 'm1',
          enabled: true,
          config: { transport: 'http', name: 'custom-mcp', url: 'https://x.test', headers: {} },
          updatedAt: now,
        },
      ],
      'GET /groups/g1/inherited-mcp': [],
      'GET /groups/g1/skills': [],
      'GET /groups/g1/secrets': [secret],
      'GET /me/secrets': [],
    })

    const onClose = vi.fn()
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <GroupSettingsDialog group={g} tab="plugins" onClose={onClose} />
        <Where />
      </MemoryRouter>,
    )

    const dlg = screen.getByRole('dialog', { name: '插件与能力 · 支付服务重构' })
    // Separate MCP / Skill / 密钥 tabs are gone; unified 插件与能力 & 凭据与授权 remain.
    expect(within(dlg).queryByRole('button', { name: 'MCP' })).toBeNull()
    expect(within(dlg).queryByRole('button', { name: 'Skill' })).toBeNull()
    expect(within(dlg).queryByRole('button', { name: '密钥' })).toBeNull()
    expect(within(dlg).getByRole('button', { name: '插件与能力' })).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: '凭据与授权' })).toBeTruthy()

    // Grouped plain-language sections render with status tags and summary.
    expect(await within(dlg).findByRole('region', { name: '连接外部系统' })).toBeTruthy()
    expect(within(dlg).getByRole('region', { name: '专业创作与专项能力' })).toBeTruthy()
    expect(within(dlg).getByText('本群已启用 2 个插件 · 1 个待配置')).toBeTruthy()

    // Developer advanced section is collapsed by default; raw MCP server is hidden until expanded.
    expect(within(dlg).queryByText('custom-mcp')).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: /开发者高级配置（自定义 MCP 服务与本地上传）/ }))
    expect(await within(dlg).findByText('custom-mcp')).toBeTruthy()

    // Switch to 凭据与授权: plugin credentials shown up front, raw env vars collapsed by default.
    fireEvent.click(within(dlg).getByRole('button', { name: '凭据与授权' }))
    expect(await within(dlg).findByText('本群插件用到的凭据与账号')).toBeTruthy()
    expect(within(dlg).queryByText('CUSTOM_RAW_KEY')).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: /高级：底层环境变量明细/ }))
    expect(await within(dlg).findByText('CUSTOM_RAW_KEY')).toBeTruthy()

    // 从市场添加 navigates with fromGroup context.
    fireEvent.click(within(dlg).getByRole('button', { name: '插件与能力' }))
    fireEvent.click(await within(dlg).findByRole('button', { name: '从市场添加' }))
    expect(screen.getByTestId('where').textContent).toBe('/market?fromGroup=g1')
  })

  it('shows read-only guidance and 去市场申请 for regular group members', async () => {
    useSession.setState({ user: memberUser })
    mockApi({
      'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
      'GET /groups/g1/plugins': [creationPlugin],
      'GET /groups/g1/connectors': { connectors: [] },
      'GET /groups/g1/secret-needs': [],
      'GET /groups/g1/installs': [],
      'GET /groups/g1/inherited-skills': [],
    })
    render(
      <MemoryRouter>
        <GroupSettingsDialog group={group()} tab="plugins" onClose={() => {}} />
      </MemoryRouter>,
    )
    const dlg = screen.getByRole('dialog', { name: '插件与能力 · 支付服务重构' })
    expect(
      await within(dlg).findByText(
        '你是普通成员：可以查看本群插件和填写自己的个人凭据；启用或移除插件可去市场提交申请。',
      ),
    ).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: '去市场申请' })).toBeTruthy()
    expect(within(dlg).queryByRole('switch')).toBeNull()
  })

  it('shows 去连接 for CLI connectors and surfaces banned & secret-needed states on market skill installs', async () => {
    const cliConn = connectorItem({
      id: 'p-feishu',
      connected: false,
      missing: [],
      status: 'unchecked',
      cli: {
        state: 'needs_login',
        target: 'm1',
        readyBotIds: [],
        machines: [
          {
            machineId: 'm1',
            machineName: 'wanglei-mbp',
            own: true,
            profile: 'default',
            state: 'needs_login',
            account: null,
            verified: null,
            botIds: ['b1'],
          },
        ],
      },
    })
    const makeInstall = (
      id: string,
      name: string,
      title: string,
      status: 'listed' | 'banned',
    ): InstallDto => ({
      scope: 'group',
      enabled: true,
      pinVersionId: null,
      resolvedVersionId: `v-${id}`,
      resolvedRevision: 1,
      banReason: status === 'banned' ? '已下架' : null,
      updatedBy: null,
      updatedAt: now,
      listing: {
        id,
        type: 'skill',
        name,
        title,
        description: `${title}说明`,
        layer: 'team',
        status,
        versionId: `v-${id}`,
        revision: 1,
      },
    })
    mockApi({
      'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
      'GET /groups/g1/plugins': [connectorPlugin],
      'GET /groups/g1/connectors': { connectors: [cliConn] },
      'GET /groups/g1/installs': [
        makeInstall('l-sec', 'jira-helper', 'Jira 助手', 'listed'),
        makeInstall('l-ban', 'bad-skill', '已下架技能', 'banned'),
      ],
      'GET /groups/g1/secret-needs': [
        {
          skill: 'jira-helper',
          skillVersionId: 'v-l-sec',
          personalSkill: false,
          spec: { name: 'JIRA_KEY', title: 'Jira Key', description: '', mode: 'personal', required: true },
          status: 'unfilled',
          def: { id: 's9', scope: 'group', mode: 'personal', description: '', hasValue: false },
          target: null,
          mine: null,
          action: 'fill_personal',
        },
      ],
      'GET /groups/g1/inherited-skills': [],
    })

    render(
      <MemoryRouter>
        <GroupSettingsDialog group={group()} tab="plugins" onClose={() => {}} />
      </MemoryRouter>,
    )

    const dlg = screen.getByRole('dialog', { name: '插件与能力 · 支付服务重构' })
    // 1 CLI connector + 1 secret-needed skill (banned skill excluded from enabled count) = 2 enabled, 2 pending.
    expect(await within(dlg).findByText('本群已启用 2 个插件 · 2 个待配置')).toBeTruthy()
    const connSection = within(dlg).getByRole('region', { name: '连接外部系统' })
    expect(within(connSection).getByRole('button', { name: '去连接' })).toBeTruthy()
    expect(within(connSection).queryByRole('button', { name: '去填写' })).toBeNull()

    const capSection = within(dlg).getByRole('region', { name: '专业创作与专项能力' })
    const jiraRow = within(capSection).getByText('Jira 助手').closest('.cfg__item') as HTMLElement
    expect(within(jiraRow).getByText('待填凭据')).toBeTruthy()
    expect(within(jiraRow).getByRole('button', { name: '去填写' })).toBeTruthy()
    const bannedRow = within(capSection).getByText('已下架技能').closest('.cfg__item') as HTMLElement
    expect(within(bannedRow).getByText('已封禁')).toBeTruthy()
    expect(within(bannedRow).queryByText('已就绪')).toBeNull()

    fireEvent.click(within(jiraRow).getByRole('button', { name: '去填写' }))
    expect(await screen.findByRole('dialog', { name: '配置密钥' })).toBeTruthy()
  })

  it('consolidates TeamSettingsDialog into 插件与能力 + 凭据与授权 with collapsed developer config', async () => {
    mockApi({
      'GET /teams/t1/members': [],
      'GET /teams/t1/installs': [],
      'GET /teams/t1/mcp': [
        {
          id: 'tm1',
          enabled: true,
          config: { transport: 'http', name: 'team-mcp', url: 'https://t.test', headers: {} },
          updatedAt: now,
        },
      ],
      'GET /teams/t1/skills': [],
      'GET /teams/t1/plugins': [],
    })
    render(
      <MemoryRouter>
        <TeamSettingsDialog team={team} onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'MCP' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skill' })).toBeNull()
    expect(screen.getByRole('button', { name: '凭据与授权' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '插件与能力' }))
    expect(screen.queryByText('team-mcp')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /开发者高级配置（自定义 MCP 服务与本地上传）/ }))
    expect(await screen.findByText('team-mcp')).toBeTruthy()
  })
})

describe('Workspace Concept Consolidation · Chat / Menu & External Connector Popover', () => {
  it('groups / candidates into 创作与插件, 快捷指令, and 系统命令 without Skill/ACP jargon', async () => {
    mockApi({
      'GET /groups/g1/plugins': [creationPlugin],
      'GET /groups/g1/connectors': { connectors: [] },
      'GET /groups/g1/candidates/commands': {
        system: [{ name: 'new', hint: '开新会话' }],
        plugin: [{ name: 'standup', hint: '生成站会小结', plugin: '团队工具' }],
        skill: [
          { name: 'gonggong-team:notes', hint: '整理我的笔记', personal: true },
          { name: 'gonggong-team:review-pr', hint: '按规范审查改动' },
        ],
        agent: [
          { name: 'compact', hint: '压缩上下文', botId: 'b1', botName: '研发助手' },
          { name: '$lint', hint: '运行代码检查', botId: 'b1', botName: '研发助手' },
        ],
      },
    })
    render(
      <MemoryRouter>
        <MessageComposer group={group()} onSent={() => {}} />
      </MemoryRouter>,
    )
    const box = screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令')
    fireEvent.change(box, { target: { value: '/', selectionStart: 1 } })
    const list = await screen.findByRole('listbox', { name: '/ 命令' })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('group')
          .map((g) => g.getAttribute('aria-label')),
      ).toEqual(['创作与插件', '快捷指令', '系统命令']),
    )
    expect(list.textContent).not.toContain('我的 Skill')
    expect(list.textContent).not.toContain('团队 Skill')
    expect(list.textContent).not.toContain('AGENT 命令')
    expect(list.textContent).not.toContain('ACP 上报')
    expect(list.textContent).not.toContain('配置中心')
  })

  it('renders traffic-light statuses and links to /market?scene=connect&fromGroup=g1', async () => {
    const okConn = connectorItem({ id: 'c-ok', connected: true, missing: [], status: 'ok', account: '王磊' })
    const warnConn = connectorItem({
      id: 'c-warn',
      manifest: { ...connectorPlugin.manifest, name: 'dw', title: '数仓' },
      connected: false,
      missing: ['DW_KEY'],
      status: 'unconnected',
    })
    const badConn = connectorItem({
      id: 'c-bad',
      manifest: { ...connectorPlugin.manifest, name: 'jira', title: 'Jira' },
      connected: true,
      missing: [],
      status: 'expired',
    })
    mockApi({ 'GET /groups/g1/connectors': { connectors: [okConn, warnConn, badConn] } })

    const onClose = vi.fn()
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <ConnectorMenu groupId="g1" onPick={() => {}} onClose={onClose} />
        <Where />
      </MemoryRouter>,
    )
    const menu = screen.getByRole('dialog', { name: '外部连接' })
    expect(within(menu).getByText('本群外部连接插件')).toBeTruthy()
    await within(menu).findByText('已连接 · 王磊')
    expect(menu.querySelector('.cn-status--ok')).toBeTruthy()
    expect(menu.querySelector('.cn-status--warn')).toBeTruthy()
    expect(menu.querySelector('.cn-status--bad')).toBeTruthy()

    fireEvent.click(within(menu).getByRole('button', { name: '添加更多外部连接插件' }))
    expect(screen.getByTestId('where').textContent).toBe('/market?scene=connect&fromGroup=g1')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Workspace Concept Consolidation · Bot Details 已装配能力', () => {
  it('toggles group vs all-groups scope, lists ready & unavailable plugins, and executes actions', async () => {
    const calls = mockApi({
      'GET /users': [{ id: 'u1', name: '王磊', account: 'wanglei' }],
      'GET /bots/b1/activity': [],
      'GET /bots/b1/feishu': { app: null },
      'GET /usage?by=user&days=7&botId=b1': [],
      'GET /usage?by=group&days=7&botId=b1': [],
      'GET /usage/daily?days=7&botId=b1': [],
      'GET /bots/b1/capabilities?groupId=g1': {
        botId: 'b1',
        groupId: 'g1',
        groups: [
          { id: 'g1', name: '支付服务重构' },
          { id: 'g2', name: '设计评审群' },
        ],
        pluginsEnabled: true,
        ready: [
          {
            pluginId: 'p-feishu',
            name: 'feishu',
            title: '飞书',
            description: '读写飞书文档与日程',
            type: 'plugin',
            icon: 'assets/feishu.svg',
            versionId: 'v1',
            scene: 'connect',
            capabilities: ['connect'],
            source: 'team',
            sourceLabel: '团队插件 · 你的账号',
            statusLabel: '已就绪',
            createsArtifacts: false,
            chatCommand: null,
            groups: [{ id: 'g1', name: '支付服务重构' }],
            groupId: 'g1',
            blocker: null,
            reasonLabel: null,
            reason: null,
            action: 'none',
            missingSecrets: [],
            ownMachine: false,
            machineId: 'm1',
            machineName: 'wanglei-mbp',
            machineOwnerName: '王磊',
            minDaemon: null,
            daemonVersion: '0.9.0',
          },
        ],
        unavailable: [
          {
            pluginId: 'p-dw',
            name: 'dw',
            title: '数仓查询',
            description: '查询业务库表',
            type: 'plugin',
            icon: null,
            versionId: 'v2',
            scene: 'connect',
            capabilities: ['connect'],
            source: 'group',
            sourceLabel: '本群插件',
            statusLabel: '待填写凭据',
            createsArtifacts: false,
            chatCommand: null,
            groups: [{ id: 'g1', name: '支付服务重构' }],
            groupId: 'g1',
            blocker: 'missing_secret',
            reasonLabel: '缺凭据',
            reason: '还缺少你的数仓 Key，填写后即可调用',
            action: 'fill-secret',
            missingSecrets: ['DW_KEY'],
            ownMachine: false,
            machineId: 'm1',
            machineName: 'wanglei-mbp',
            machineOwnerName: '王磊',
            minDaemon: null,
            daemonVersion: '0.9.0',
          },
          {
            pluginId: 'p-exec',
            name: 'tracker',
            title: '缺陷跟踪',
            description: '拉取研发缺陷单',
            type: 'plugin',
            icon: null,
            versionId: 'v3',
            scene: 'dev',
            capabilities: ['do'],
            source: 'team',
            sourceLabel: '团队插件',
            statusLabel: '待授权',
            createsArtifacts: false,
            chatCommand: null,
            groups: [{ id: 'g1', name: '支付服务重构' }],
            groupId: 'g1',
            blocker: 'untrusted',
            reasonLabel: '待电脑授权',
            reason: '需要电脑主人王磊允许该插件在 wanglei-mbp 运行',
            action: 'trust-machine',
            missingSecrets: [],
            ownMachine: false,
            machineId: 'm1',
            machineName: 'wanglei-mbp',
            machineOwnerName: '王磊',
            minDaemon: null,
            daemonVersion: '0.9.0',
          },
        ],
      },
      'GET /bots/b1/capabilities': {
        botId: 'b1',
        groupId: null,
        groups: [
          { id: 'g1', name: '支付服务重构' },
          { id: 'g2', name: '设计评审群' },
        ],
        pluginsEnabled: true,
        ready: [],
        unavailable: [],
      },
      'POST /market/p-exec/readiness/action': { ok: true, notified: true },
    })

    // Non-owner, non-shared member still sees 已装配能力 and relative icons resolve via previewUrl!
    render(
      <MemoryRouter initialEntries={['/bot/b1?groupId=g1']}>
        <BotPage bot={bot()} me={memberUser} onSettings={() => {}} />
        <Toaster />
        <Where />
      </MemoryRouter>,
    )

    const panel = await screen.findByRole('region', { name: '已装配能力' })
    expect(await within(panel).findByText('已就绪 · 现在就能用（1）')).toBeTruthy()
    expect(within(panel).getByText('待处理 / 暂不可用（2）')).toBeTruthy()
    expect(within(panel).getByText('飞书')).toBeTruthy()
    expect(panel.querySelector('img.bot-cap__img')?.getAttribute('src')).toBe(
      '/api/plugins/p-feishu/files/assets/feishu.svg',
    )
    expect(within(panel).getByText('还缺少你的数仓 Key，填写后即可调用')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: '去填写' })).toBeTruthy()

    // Non-owner clicking 提醒电脑主人 invokes readiness/action.
    fireEvent.click(within(panel).getByRole('button', { name: '提醒电脑主人' }))
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/market/p-exec/readiness/action')?.body,
      ).toMatchObject({
        action: 'notify_trust',
        machineId: 'm1',
      }),
    )

    // Switch scope to 全部所在群（2）.
    fireEvent.click(within(panel).getByRole('radio', { name: '全部所在群（2）' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/bots/b1/capabilities')).toBe(true))
  })

  it('respects ownMachine=false even when me.id === bot.ownerId', async () => {
    mockApi({
      'GET /users': [{ id: 'u1', name: '王磊', account: 'wanglei' }],
      'GET /bots/b1/activity': [],
      'GET /bots/b1/feishu': { app: null },
      'GET /usage?by=user&days=7&botId=b1': [],
      'GET /usage?by=group&days=7&botId=b1': [],
      'GET /usage/daily?days=7&botId=b1': [],
      'GET /bots/b1/capabilities': {
        botId: 'b1',
        groupId: null,
        groups: [{ id: 'g1', name: '支付服务重构' }],
        pluginsEnabled: true,
        ready: [],
        unavailable: [
          {
            pluginId: 'p-exec',
            name: 'tracker',
            title: '缺陷跟踪',
            description: '拉取研发缺陷单',
            type: 'plugin',
            icon: null,
            versionId: 'v3',
            scene: 'dev',
            capabilities: ['do'],
            source: 'team',
            sourceLabel: '团队插件',
            statusLabel: '',
            createsArtifacts: false,
            chatCommand: null,
            groups: [{ id: 'g1', name: '支付服务重构' }],
            groupId: 'g1',
            blocker: 'trust',
            reasonLabel: '待电脑授权',
            reason: '需要电脑主人允许运行',
            action: 'trust-machine',
            missingSecrets: [],
            ownMachine: false,
            machineId: 'm-other',
            machineName: 'other-mbp',
            machineOwnerName: '陈晨',
            minDaemon: null,
            daemonVersion: '0.9.0',
          },
        ],
      },
    })
    render(
      <MemoryRouter initialEntries={['/bot/b1']}>
        <BotPage bot={bot({ ownerId: adminUser.id })} me={adminUser} onSettings={() => {}} />
      </MemoryRouter>,
    )
    const panel = await screen.findByRole('region', { name: '已装配能力' })
    expect(await within(panel).findByRole('button', { name: '提醒电脑主人' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: '去授权' })).toBeNull()
  })
})

describe('Workspace Concept Consolidation · Machine Settings Framing', () => {
  it('shows relocation guidance banner on Agent 与供应商 and opens 插件运行授权 from ?tab=trusts', async () => {
    const pendingTrust: PluginTrustDto = {
      id: 'pt1',
      machineId: 'm1',
      pluginId: 'p1',
      pluginName: 'tracker',
      pluginTitle: '缺陷跟踪',
      version: '1.0.0',
      versionId: 'pv1',
      permissions: ['exec'],
      mcp: [{ transport: 'stdio', name: 'issues', command: ['node', 'server.mjs'], env: {} }],
      status: 'pending',
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
    }
    mockApi({
      'GET /machines/m1/providers': {
        official: {},
        machine: {},
        bots: {},
        providers: [],
        sessions: [],
        cli: {},
        agentSettings: {},
      },
      'GET /machines/m1/tools': { node: null, agents: [], mirror: 'npmmirror', nodeMirror: null },
      'GET /machines/m1/plugin-trusts': [pendingTrust],
    })

    render(
      <MemoryRouter initialEntries={['/machine/m1?tab=agents']}>
        <MachinePage machine={machine()} bots={[]} />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/官方模型供应商预设由平台自动同步，无需从市场安装/)).toBeTruthy()
    // A one-off relocation notice is no use on every visit to the Agent tab.
    expect(screen.queryByText(/不再混在插件市场中/)).toBeNull()
    expect(screen.queryByRole('link', { name: '前往插件市场' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '插件运行授权' }))
    const trusts = await screen.findByRole('region', { name: '插件运行授权' })
    expect(await within(trusts).findByText('待授权 1')).toBeTruthy()
    expect(within(trusts).getByText('缺陷跟踪 1.0.0')).toBeTruthy()
  })
})
