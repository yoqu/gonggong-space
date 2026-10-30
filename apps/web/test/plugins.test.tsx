import { readFileSync } from 'node:fs'
import type {
  BotDto,
  CreationCard,
  CreationDraftCard,
  GroupDto,
  GroupPluginDto,
  MessageDto,
  PluginDto,
  PluginManifest,
  SystemParams,
  TeamDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { strToU8, zipSync } from 'fflate'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { usePluginStore } from '../src/features/plugins/store'
import type { Call } from './mockApi'

/** Like ./mockApi, but routes ignore the query string. */
function mockApi(routes: Record<string, unknown>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const path = input.replace(/^\/api/, '')
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      const key = `${method} ${path.split('?')[0]}`
      if (!(key in routes))
        return new Response(JSON.stringify({ error: 'not_found', message: key }), { status: 404 })
      const route = routes[key]
      const out = typeof route === 'function' ? route(body) : route
      return out === undefined ? new Response(null, { status: 204 }) : new Response(JSON.stringify(out))
    }),
  )
  return calls
}

const now = new Date().toISOString()

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const manifest = (o: Partial<PluginManifest> = {}): PluginManifest => ({
  name: 'web-prototype',
  version: '1.2.0',
  title: '网页原型',
  description: '落地页、官网、活动页',
  category: 'web',
  agents: ['claude'],
  minDaemon: '0.4.0',
  entry: 'web-prototype',
  templates: [
    {
      id: 'saas',
      title: 'SaaS 产品落地页',
      description: '首屏 · 功能 · 价格 · CTA',
      group: null,
      preview: 'previews/saas.png',
      inputs: null,
      designSystem: true,
    },
    {
      id: 'event',
      title: '活动报名页',
      description: '倒计时 · 议程 · 报名表',
      group: null,
      preview: null,
      inputs: null,
      designSystem: true,
    },
  ],
  designSystems: [
    {
      id: 'neutral-modern',
      title: '中性现代',
      description: '黑白灰 + 一种强调色',
      category: null,
      swatches: ['#1d1d1f', '#6e6e73', '#0088ff'],
      dir: 'design-systems/neutral-modern',
    },
    {
      id: 'warm-editorial',
      title: '温暖编辑',
      description: '杂志感 · 米色衬线',
      category: null,
      swatches: ['#3d2b1f', '#c8a27a'],
      dir: 'design-systems/warm-editorial',
    },
  ],
  inputs: [
    {
      id: 'title',
      label: '主标题',
      type: 'string',
      required: true,
      options: [],
      default: null,
      placeholder: null,
      designSource: false,
    },
    {
      id: 'points',
      label: '核心卖点',
      type: 'text',
      required: false,
      options: [],
      default: null,
      placeholder: null,
      designSource: false,
    },
    {
      id: 'tone',
      label: '语气',
      type: 'select',
      required: false,
      options: ['专业', '亲切', '活泼'],
      default: '专业',
      placeholder: null,
      designSource: false,
    },
  ],
  secrets: [],
  license: 'Apache-2.0',
  source: { name: 'open-design', url: 'https://github.com/nexu-io/open-design', revision: '4f69a42' },
  ...o,
})

const layerPlugin = (o: Partial<PluginDto> = {}): PluginDto => ({
  id: 'p1',
  layer: 'platform',
  manifest: manifest(),
  versionId: 'v1',
  revision: 1,
  size: 20480,
  updatedBy: '陈晨',
  updatedAt: now,
  builtin: false,
  ...o,
})

const plugin = (o: Partial<GroupPluginDto> = {}): GroupPluginDto => ({
  ...layerPlugin(),
  enabledInGroup: true,
  bots: [
    { botId: 'b1', blocker: null },
    { botId: 'b2', blocker: 'daemon' },
  ],
  ...o,
})

const poster = plugin({
  id: 'p2',
  layer: 'team',
  manifest: manifest({
    name: 'poster-kit',
    title: '海报与社媒图',
    category: 'poster',
    secrets: ['OPENAI_API_KEY'],
    templates: [],
    designSystems: [],
    inputs: [],
    source: null,
  }),
  enabledInGroup: false,
  bots: [
    { botId: 'b1', blocker: 'secret' },
    { botId: 'b2', blocker: 'agent' },
  ],
})

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
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
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '设计助手',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
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
  model: null,
  effort: null,
  catalog: null,
  ...o,
})
const bots = [
  bot({}),
  bot({ id: 'b2', name: '温涛的 Codex', ownerId: 'u2', ownerName: '温涛', agentKind: 'codex' }),
]

const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '',
  mentions: [],
  runId: null,
  createdAt: now,
  attachments: [],
  quote: null,
  ...o,
})

const card: CreationCard = {
  type: 'creation',
  pluginId: 'p1',
  pluginTitle: '网页原型',
  category: 'web',
  pluginVersion: '1.2.0',
  template: { id: 'event', title: '活动报名页' },
  designSystem: { id: 'warm-editorial', title: '温暖编辑', swatches: ['#3d2b1f', '#c8a27a'] },
  inputs: [
    { label: '主标题', value: '共工' },
    { label: '语气', value: '亲切' },
  ],
  directions: true,
  botId: 'b1',
  botName: '设计助手',
}

class NoopSocket {
  close() {}
}

const chatRoutes = (plugins: GroupPluginDto[] | null, messages: MessageDto[] = []) => ({
  'GET /groups': [group()],
  'GET /users': [],
  'GET /bots': bots,
  'GET /machines': [],
  'GET /notifications/unread': { n: 0 },
  'GET /groups/g1/timeline': { messages, runs: [] },
  'POST /groups/g1/read': group(),
  'GET /groups/g1/candidates/commands': {
    system: [{ name: 'stop', hint: '停止运行' }],
    skill: [],
    agent: [],
  },
  'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
  ...(plugins ? { 'GET /groups/g1/plugins': plugins } : {}),
})

const team: TeamDto = {
  id: 't1',
  name: '设计组',
  avatar: null,
  role: 'owner',
  archivedAt: null,
  createdAt: now,
  unread: 0,
}
const tenancy = { teams: [team], singleTeamMode: true, canCreateTeam: false, demoMode: false }
const setPluginsOn = (pluginsEnabled: boolean) =>
  useSession.setState({ tenancy: { ...tenancy, pluginsEnabled } })

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

const box = () =>
  screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: me, status: 'ready' })
  setPluginsOn(true)
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  usePluginStore.setState({ lists: {} })
  sessionStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('插件 · 没有启用时界面不变', () => {
  for (const [name, list] of [
    ['总开关关闭（空列表）', []],
    ['群里一个都没启用', [plugin({ enabledInGroup: false })]],
    ['旧服务端没有这个接口', null],
  ] as const) {
    it(name, async () => {
      mockApi(chatRoutes(list as GroupPluginDto[] | null))
      renderAt('/g/g1')
      await screen.findByText('还没有消息')
      await waitFor(() => expect(usePluginStore.getState().lists.g1).toBeDefined())
      expect(screen.queryByRole('button', { name: '创作' })).toBeNull()
      expect(screen.queryByText(/插件 · /)).toBeNull()
      fireEvent.change(box(), { target: { value: '/', selectionStart: 1 } })
      const pop = await screen.findByRole('listbox', { name: '/ 命令' })
      await within(pop).findByText('/stop')
      expect(within(pop).queryByRole('group', { name: '插件' })).toBeNull()
    })
  }
})

describe('插件 · 创作入口', () => {
  it('shows 创作 in the composer, 插件 · N in the header and a 插件 group among / candidates', async () => {
    mockApi(chatRoutes([plugin(), poster]))
    renderAt('/g/g1')
    expect(await screen.findByRole('button', { name: '创作' })).toBeTruthy()
    expect(screen.getByText('插件 · 1')).toBeTruthy()

    fireEvent.change(box(), { target: { value: '/网页', selectionStart: 3 } })
    const pop = await screen.findByRole('listbox', { name: '/ 命令' })
    const group = await within(pop).findByRole('group', { name: '插件' })
    // Only plugins enabled in the group.
    expect(
      within(group)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['网页原型打开创作面板'])
    fireEvent.keyDown(box(), { key: 'Enter' })
    const dialog = await screen.findByRole('dialog', { name: '创作' })
    expect(within(dialog).getByRole('button', { name: /网页原型/, pressed: true })).toBeTruthy()
    expect(box().value).toBe('')
  })

  it('walks the steps and hands the request to the only bot that can take it', async () => {
    const calls = mockApi({
      ...chatRoutes([plugin()]),
      'POST /groups/g1/creations': msg({
        seq: 2,
        id: 'm2',
        body: '@设计助手 请用插件',
        mentions: ['b1'],
        card,
      }),
    })
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '创作' }))
    const dialog = await screen.findByRole('dialog', { name: '创作' })
    const d = within(dialog)

    // 1 类型与模板: the first template is picked; previews come from the plugin's files.
    expect(d.getByRole('button', { name: /SaaS 产品落地页/, pressed: true })).toBeTruthy()
    expect((d.getByAltText('SaaS 产品落地页') as HTMLImageElement).getAttribute('src')).toBe(
      '/api/plugins/p1/files/previews/saas.png',
    )
    fireEvent.click(d.getByRole('button', { name: /活动报名页/ }))
    // Only 设计助手 can use it: 交给谁 folds into the last step.
    expect(d.getByText('1 / 3')).toBeTruthy()
    expect(d.queryByRole('button', { name: /交给谁/ })).toBeNull()
    fireEvent.click(d.getByRole('button', { name: '下一步' }))

    // 2 设计系统
    fireEvent.click(d.getByRole('button', { name: /温暖编辑/ }))
    fireEvent.click(d.getByRole('button', { name: '下一步' }))

    // 3 内容与参数: the form follows the manifest's inputs; required fields block the hand-off.
    expect(d.getByText('请填写主标题')).toBeTruthy()
    fireEvent.change(d.getByLabelText('主标题'), { target: { value: '共工' } })
    fireEvent.click(d.getByRole('radio', { name: '亲切' }))
    fireEvent.click(d.getByRole('switch', { name: '视觉方向' }))
    expect(d.getByText('3 / 3')).toBeTruthy()

    // The summary on the right follows every step.
    const summary = d.getByLabelText('将交给 AI 的内容')
    expect(summary.textContent).toContain('模板：活动报名页')
    expect(summary.textContent).toContain('设计系统：温暖编辑')
    expect(summary.textContent).toContain('主标题：共工')
    expect(summary.textContent).toContain('语气：亲切')
    expect(summary.textContent).toContain('先出视觉方向：是')
    expect(summary.textContent).toContain('交给：设计助手')
    expect(d.getByText('可以开始：Bot 在线，插件可用，密钥齐全')).toBeTruthy()

    fireEvent.click(d.getByRole('button', { name: '交给 设计助手' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g1/creations',
        body: {
          pluginId: 'p1',
          templateId: 'event',
          designSystemId: 'warm-editorial',
          inputs: { title: '共工', tone: '亲切' },
          directions: true,
          botId: 'b1',
          attachmentIds: [],
        },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '创作' })).toBeNull())
    expect(await screen.findByText('创作请求 · 网页原型')).toBeTruthy()
  })
})

describe('插件 · 步骤随插件和模板变化', () => {
  /** A wireframe asking only for 主标题 with its own look; both bots can take it. */
  const wired = plugin({
    manifest: manifest({
      templates: [
        ...manifest().templates,
        {
          id: 'wire',
          title: '线框图',
          description: '',
          group: null,
          preview: null,
          inputs: ['title'],
          designSystem: false,
        },
      ],
    }),
    bots: [
      { botId: 'b1', blocker: null },
      { botId: 'b2', blocker: null },
    ],
  })

  it('drops the design step and the other inputs for a template with its own look; asks 交给谁 among several bots', async () => {
    const calls = mockApi({
      ...chatRoutes([wired]),
      'POST /groups/g1/creations': msg({ seq: 2, id: 'm2', mentions: ['b2'], card }),
    })
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '创作' }))
    const d = within(await screen.findByRole('dialog', { name: '创作' }))
    const steps = () =>
      within(d.getByRole('navigation', { name: '步骤' }))
        .getAllByRole('button')
        .map((b) => b.querySelector('.plg-step__text > :first-child')?.textContent)
    expect(steps()).toEqual(['类型与模板', '设计系统', '内容与参数', '交给谁'])
    fireEvent.click(d.getByRole('button', { name: /线框图/ }))
    expect(steps()).toEqual(['类型与模板', '内容与参数', '交给谁'])
    fireEvent.click(d.getByRole('button', { name: '下一步' }))
    expect(d.getByLabelText('主标题')).toBeTruthy()
    expect(d.queryByLabelText('核心卖点')).toBeNull()
    expect(d.queryByRole('radio', { name: '亲切' })).toBeNull()
    fireEvent.change(d.getByLabelText('主标题'), { target: { value: '后台' } })
    fireEvent.click(d.getByRole('button', { name: '下一步' }))
    fireEvent.click(d.getByRole('radio', { name: /温涛的 Codex/ }))
    expect(d.getByLabelText('将交给 AI 的内容').textContent).not.toContain('设计系统')
    fireEvent.click(d.getByRole('button', { name: '交给 AI' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g1/creations',
        body: {
          pluginId: 'p1',
          templateId: 'wire',
          designSystemId: null,
          inputs: { title: '后台' },
          directions: false,
          botId: 'b2',
          attachmentIds: [],
        },
      }),
    )
  })
})

describe('插件 · 创作确认卡', () => {
  const draft = (o: Partial<CreationDraftCard> = {}): MessageDto =>
    msg({
      seq: 2,
      id: 'd1',
      kind: 'event',
      authorId: null,
      authorName: '',
      body: '设计助手 提议用「网页原型」创作，等群成员确认',
      card: {
        ...card,
        type: 'creation-draft',
        inputs: [{ label: '语气', value: '亲切' }],
        directions: false,
        missing: [],
        note: '活动页用报名模板',
        status: 'pending',
        by: null,
        creationId: null,
        ...o,
      },
    })

  it('starts as the member with the bot it names, marking the card', async () => {
    const calls = mockApi({
      ...chatRoutes([plugin()], [draft({ inputs: [{ label: '主标题', value: '共工' }] })]),
      'POST /groups/g1/creations': msg({ seq: 3, id: 'm3', mentions: ['b1'], card }),
    })
    renderAt('/g/g1')
    const c = within(await screen.findByTestId('creation-draft'))
    expect(c.getByText('创作确认 · 网页原型')).toBeTruthy()
    expect(c.getByText('活动页用报名模板')).toBeTruthy()
    fireEvent.click(c.getByRole('button', { name: '开始' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g1/creations',
        body: {
          pluginId: 'p1',
          templateId: 'event',
          designSystemId: 'warm-editorial',
          inputs: { title: '共工' },
          directions: false,
          botId: 'b1',
          fromDraft: 'd1',
          attachmentIds: [],
        },
      }),
    )
  })

  it('asks for missing inputs in the prefilled panel, and drops the card on 不用了', async () => {
    const calls = mockApi({
      ...chatRoutes([plugin()], [draft({ missing: ['主标题'] })]),
      'POST /groups/g1/creations': msg({ seq: 3, id: 'm3', mentions: ['b1'], card }),
      'POST /groups/g1/creation-drafts/d1/dismiss': undefined,
    })
    renderAt('/g/g1')
    const c = within(await screen.findByTestId('creation-draft'))
    expect(c.getByText('待补充：主标题')).toBeTruthy()
    expect((c.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(c.getByRole('button', { name: '改参数…' }))
    const d = within(await screen.findByRole('dialog', { name: '创作' }))
    expect((d.getByRole('radio', { name: '亲切' }) as HTMLInputElement).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.change(d.getByLabelText('主标题'), { target: { value: '共工' } })
    fireEvent.click(d.getByRole('button', { name: '交给 设计助手' }))
    await waitFor(() =>
      expect(calls.find((x) => x.path === '/groups/g1/creations')?.body).toMatchObject({
        templateId: 'event',
        inputs: { title: '共工', tone: '亲切' },
        fromDraft: 'd1',
      }),
    )
    fireEvent.click(c.getByRole('button', { name: '不用了' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g1/creation-drafts/d1/dismiss',
        body: {},
      }),
    )
  })

  it('says who settled it', async () => {
    mockApi(chatRoutes([plugin()], [draft({ status: 'dismissed', by: '李建国' })]))
    renderAt('/g/g1')
    const c = within(await screen.findByTestId('creation-draft'))
    expect(c.getByText('李建国 选了不用')).toBeTruthy()
    expect(c.queryByRole('button', { name: '开始' })).toBeNull()
  })
})

const tpl = (id: string, title: string, group: string | null) =>
  ({
    id,
    title,
    description: '',
    group,
    preview: null,
    inputs: null,
    designSystem: true,
  }) as PluginManifest['templates'][number]
const dsys = (id: string, title: string, category: string | null, description = '') =>
  ({
    id,
    title,
    description,
    category,
    swatches: ['#111111', '#ffffff'],
    dir: `design-systems/${id}`,
  }) as PluginManifest['designSystems'][number]
/** 3 grouped templates and 10 categorised design systems. */
const catalogue = plugin({
  manifest: manifest({
    templates: [
      tpl('saas', 'SaaS 落地页', '营销网页'),
      tpl('dash', '数据看板', '产品界面'),
      tpl('event', '活动报名页', '营销网页'),
    ],
    designSystems: [
      dsys('neutral', '中性现代', '入门', '黑白灰'),
      dsys('warm', '温暖编辑', '入门', '杂志感 · 米色衬线'),
      ...Array.from({ length: 7 }, (_, i) => dsys(`min${i}`, `极简 ${i}`, '现代极简')),
      dsys('loud', '霓虹', '大胆张扬', '高饱和撞色'),
    ],
  }),
})
const cardNames = (el: HTMLElement) =>
  within(el)
    .getAllByRole('button')
    .filter((b) => b.classList.contains('plg-card'))
    .map((b) => b.querySelector('b')?.textContent)

describe('插件 · 大目录', () => {
  it('filters templates by group chips and keeps the pick while switching', async () => {
    mockApi(chatRoutes([catalogue]))
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '创作' }))
    const d = within(await screen.findByRole('dialog', { name: '创作' }))
    const chips = d.getByRole('group', { name: '模板分组' })
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['全部3', '营销网页2', '产品界面1'])
    // Opens on the group of the picked template (the first one).
    expect(within(chips).getByRole('button', { name: /营销网页/, pressed: true })).toBeTruthy()
    const pane = d.getByText('选一个模板').closest('section') as HTMLElement
    expect(cardNames(pane)).toEqual(['SaaS 落地页', '活动报名页'])
    fireEvent.click(within(chips).getByRole('button', { name: /产品界面/ }))
    expect(cardNames(pane)).toEqual(['数据看板'])
    fireEvent.click(d.getByRole('button', { name: /数据看板/ }))
    fireEvent.click(within(chips).getByRole('button', { name: /全部/ }))
    expect(cardNames(pane)).toEqual(['SaaS 落地页', '数据看板', '活动报名页'])
    expect(d.getByRole('button', { name: /数据看板/, pressed: true })).toBeTruthy()
    fireEvent.click(within(chips).getByRole('button', { name: /营销网页/ }))
    expect(d.getByLabelText('将交给 AI 的内容').textContent).toContain('模板：数据看板')
  })

  it('filters design systems by category chips and a search', async () => {
    mockApi(chatRoutes([catalogue]))
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '创作' }))
    const d = within(await screen.findByRole('dialog', { name: '创作' }))
    fireEvent.click(d.getByRole('button', { name: /设计系统/ }))
    const pane = d.getByRole('heading', { name: '设计系统' }).closest('section') as HTMLElement
    const chips = d.getByRole('group', { name: '设计系统分类' })
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['全部10', '入门2', '现代极简7', '大胆张扬1'])
    expect(within(chips).getByRole('button', { name: /入门/, pressed: true })).toBeTruthy()
    expect(cardNames(pane)).toEqual(['中性现代', '温暖编辑'])
    fireEvent.click(within(chips).getByRole('button', { name: /大胆张扬/ }))
    expect(cardNames(pane)).toEqual(['霓虹'])
    fireEvent.click(within(chips).getByRole('button', { name: /全部/ }))
    expect(cardNames(pane)).toHaveLength(10)
    // The search matches titles and descriptions within the chosen category.
    fireEvent.change(d.getByRole('searchbox', { name: '搜索设计系统' }), { target: { value: '米色' } })
    expect(cardNames(pane)).toEqual(['温暖编辑'])
    fireEvent.click(within(chips).getByRole('button', { name: /现代极简/ }))
    expect(d.getByText('没有匹配的设计系统')).toBeTruthy()
  })

  it('shows no chips or search for a small ungrouped catalogue', async () => {
    mockApi(chatRoutes([plugin()]))
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '创作' }))
    const d = within(await screen.findByRole('dialog', { name: '创作' }))
    expect(d.queryByRole('group', { name: '模板分组' })).toBeNull()
    fireEvent.click(d.getByRole('button', { name: /设计系统/ }))
    expect(d.queryByRole('group', { name: '设计系统分类' })).toBeNull()
    expect(d.queryByRole('searchbox')).toBeNull()
  })
})

describe('插件 · 创作请求卡片', () => {
  it('shows a summary with 查看全部, 再来一版 and 改参数重做…', async () => {
    const calls = mockApi({
      ...chatRoutes(
        [plugin()],
        [msg({ seq: 1, body: '@设计助手 请用插件「网页原型」创作。', mentions: ['b1'], card })],
      ),
      'POST /groups/g1/creations': msg({ seq: 2, id: 'm2', body: 'again', card }),
    })
    renderAt('/g/g1')
    const c = await screen.findByTestId('creation-card')
    expect(c.textContent).toContain('创作请求 · 网页原型')
    expect(c.textContent).toContain('已交给 @设计助手')
    // A narrow chat column cuts the title short on one line instead of breaking it (P2-20).
    const title = c.querySelector('.plg-req__title') as HTMLElement
    expect(title.title).toBe('创作请求 · 网页原型')
    expect(readFileSync(`${process.cwd()}/src/features/plugins/plugins.css`, 'utf8')).toMatch(
      /\.plg-req__title \{[^}]*white-space: nowrap;[^}]*\}/,
    )
    expect(c.textContent).toContain('活动报名页 · 温暖编辑 ·「共工」')
    // The agent-facing instructions are not shown.
    expect(c.textContent).not.toContain('请用插件')
    expect(c.textContent).not.toContain('语气：亲切')
    fireEvent.click(within(c).getByRole('button', { name: '查看全部' }))
    expect(c.textContent).toContain('语气：亲切')
    expect(c.textContent).toContain('先出视觉方向：是')
    expect(c.textContent).toContain('web-prototype 1.2.0')

    fireEvent.click(within(c).getByRole('button', { name: '再来一版' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g1/creations',
        body: {
          pluginId: 'p1',
          templateId: 'event',
          designSystemId: 'warm-editorial',
          inputs: { title: '共工', tone: '亲切' },
          directions: true,
          botId: 'b1',
          attachmentIds: [],
        },
      }),
    )

    fireEvent.click(within(c).getByRole('button', { name: '改参数重做…' }))
    const dialog = await screen.findByRole('dialog', { name: '创作' })
    expect((within(dialog).getByLabelText('主标题') as HTMLInputElement).value).toBe('共工')
    expect(within(dialog).getByRole('radio', { name: '亲切' }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getByLabelText('将交给 AI 的内容').textContent).toContain('模板：活动报名页')
  })

  it('folds a long parameter such as a pasted DESIGN.md to its first lines until expanded', async () => {
    const md = ['---', 'name: 阅境', '---', '# 阅境', '正文用宋体', '留白克制'].join('\n')
    const long = { ...card, inputs: [{ label: '粘贴 DESIGN.md', value: md }, ...card.inputs] }
    mockApi(chatRoutes([plugin()], [msg({ seq: 1, body: 'x', card: long })]))
    renderAt('/g/g1')
    const c = await screen.findByTestId('creation-card')
    // The summary quotes only its first line.
    expect(c.textContent).toContain('「---…」')
    fireEvent.click(within(c).getByRole('button', { name: '查看全部' }))
    const folded = within(c).getByTestId('creation-input-long')
    expect(folded.textContent).not.toContain('留白克制')
    fireEvent.click(within(folded).getByRole('button', { name: '展开（共 6 行）' }))
    expect(folded.textContent).toContain('留白克制')
    fireEvent.click(within(folded).getByRole('button', { name: '收起' }))
    expect(folded.textContent).not.toContain('留白克制')
  })

  it("改参数重做… opens on the group of the card's template", async () => {
    mockApi(chatRoutes([catalogue], [msg({ seq: 1, body: 'x', card: { ...card, designSystem: null } })]))
    renderAt('/g/g1')
    const c = await screen.findByTestId('creation-card')
    fireEvent.click(within(c).getByRole('button', { name: '改参数重做…' }))
    const d = within(await screen.findByRole('dialog', { name: '创作' }))
    fireEvent.click(d.getByRole('button', { name: /类型与模板/ }))
    const chips = d.getByRole('group', { name: '模板分组' })
    expect(within(chips).getByRole('button', { name: /营销网页/, pressed: true })).toBeTruthy()
    expect(d.getByRole('button', { name: /活动报名页/, pressed: true })).toBeTruthy()
  })

  it('shows the body of a card kind it does not know, and keeps 再来一版 off once the plugin is off', async () => {
    mockApi(
      chatRoutes(
        [plugin({ enabledInGroup: false })],
        [
          msg({ seq: 1, body: '产物 v2 已生成', card: { type: 'future-card' } as unknown as CreationCard }),
          msg({ seq: 2, id: 'm2', body: 'x', card }),
        ],
      ),
    )
    renderAt('/g/g1')
    expect(await screen.findByText('产物 v2 已生成')).toBeTruthy()
    const c = await screen.findByTestId('creation-card')
    expect((within(c).getByRole('button', { name: '再来一版' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(c).getByRole('button', { name: '改参数重做…' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('插件 · 管理', () => {
  it('群设置 · 插件: switches per group and shows per-bot availability', async () => {
    const calls = mockApi({
      ...chatRoutes([plugin(), poster]),
      'PUT /groups/g1/plugins/p2': { ...poster, enabledInGroup: true },
    })
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '打开群设置' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: '插件' }))
    const row = (await within(dialog).findByText('海报与社媒图')).closest('.cfg__item') as HTMLElement
    expect(row.textContent).toContain('poster-kit 1.2.0')
    expect(row.textContent).toContain('团队层')
    expect(row.textContent).toContain('支持：Claude Code')
    expect(row.textContent).toContain('需要密钥：OPENAI_API_KEY')
    expect(row.textContent).toContain('温涛的 Codex 不支持（仅 Claude Code）')
    fireEvent.click(within(row).getByRole('switch', { name: '在本群启用 海报与社媒图' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PUT', path: '/groups/g1/plugins/p2', body: { enabled: true } }),
    )
    const avail = within(dialog).getByRole('group', { name: 'Bot 可用性' })
    expect(avail.textContent).toContain('设计助手')
    expect(avail.textContent).toContain('可使用 1 个插件')
    expect(avail.textContent).toContain('机器版本过低，需升级到 0.4.0 才能使用插件')
    // Once enabled, the composer offers 创作 for it too.
    await waitFor(() => expect(screen.getByText('插件 · 2')).toBeTruthy())
  })

  it('群设置 has no 插件 tab while the master switch is off', async () => {
    setPluginsOn(false)
    mockApi(chatRoutes([]))
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '打开群设置' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('button', { name: 'Skill' })
    expect(within(dialog).queryByRole('button', { name: '插件' })).toBeNull()
  })

  it('群设置 shows the 插件 tab with its upload while the switch is on and no plugin exists yet', async () => {
    mockApi(chatRoutes([]))
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '打开群设置' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: '插件' }))
    expect(await within(dialog).findByText('本群插件')).toBeTruthy()
  })

  it('配置中心 · 插件: a built-in plugin is tagged and cannot be deleted', async () => {
    mockApi({
      'GET /admin/mcp': [],
      'GET /bots': [],
      'GET /machines': [],
      'GET /groups': [],
      'GET /notifications/unread': { n: 0 },
      'GET /admin/plugins': [layerPlugin({ builtin: true, updatedBy: null })],
    })
    renderAt('/admin/config')
    fireEvent.click(await screen.findByRole('tab', { name: '插件' }))
    const row = (await screen.findByText('网页原型')).closest('.cfg__item') as HTMLElement
    expect(row.textContent).toContain('内置')
    expect(within(row).queryByRole('button', { name: '删除 网页原型' })).toBeNull()
  })

  it('配置中心 · 插件: lists the layer with its manifest, uploads a zip as a new version and deletes', async () => {
    const calls = mockApi({
      'GET /admin/mcp': [],
      'GET /bots': [],
      'GET /machines': [],
      'GET /groups': [],
      'GET /notifications/unread': { n: 0 },
      'GET /admin/plugins': [layerPlugin()],
      'POST /admin/plugins': layerPlugin({ revision: 2 }),
      'DELETE /admin/plugins/p1': undefined,
    })
    renderAt('/admin/config')
    fireEvent.click(await screen.findByRole('tab', { name: '插件' }))
    const row = (await screen.findByText('网页原型')).closest('.cfg__item') as HTMLElement
    expect(row.textContent).toContain('web-prototype 1.2.0')
    expect(row.textContent).toContain('平台层')
    expect(row.textContent).toContain('支持：Claude Code')
    expect(row.textContent).toContain('需要密钥：—')
    expect(row.textContent).toContain('最低机器版本 0.4.0')
    expect(row.textContent).toContain('Apache-2.0 · open-design@4f69a42')
    expect(row.textContent).toContain('陈晨 · 刚刚 · 20 KB')

    const zip = zipSync({
      'web-prototype/gonggong-plugin.json': strToU8('{}'),
      'web-prototype/skills/web-prototype/SKILL.md': strToU8('---\nname: web-prototype\n---\n'),
    })
    fireEvent.change(screen.getByLabelText('上传 zip'), {
      target: { files: [new File([zip], 'p.zip', { type: 'application/zip' })] },
    })
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/admin/plugins',
        body: {
          files: [
            { path: 'gonggong-plugin.json', content: '{}', encoding: 'utf8' },
            {
              path: 'skills/web-prototype/SKILL.md',
              content: '---\nname: web-prototype\n---\n',
              encoding: 'utf8',
            },
          ],
        },
      }),
    )

    fireEvent.click(within(row).getByRole('button', { name: '删除 网页原型' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/admin/plugins/p1', body: undefined }),
    )
  })

  it('系统参数 has the plugin master switch, applied to group settings without a reload', async () => {
    setPluginsOn(false)
    usePluginStore.setState({ lists: { g1: [] } })
    const params = { pluginsEnabled: false, demoMode: false } as SystemParams
    const calls = mockApi({
      'GET /me': { ...me, ...tenancy, pluginsEnabled: true },
      'GET /bots': [],
      'GET /machines': [],
      'GET /groups': [],
      'GET /notifications/unread': { n: 0 },
      'GET /admin/params': params,
      'PUT /admin/params': (body: unknown) => ({ ...params, ...(body as object) }),
    })
    renderAt('/admin/params')
    fireEvent.click(await screen.findByRole('switch', { name: '插件' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PUT', path: '/admin/params', body: { pluginsEnabled: true } }),
    )
    await waitFor(() => expect(useSession.getState().tenancy?.pluginsEnabled).toBe(true))
    expect(usePluginStore.getState().lists).toEqual({})
  })

  it('系统参数 links 管理插件 to the 插件 tab of 配置中心, built-ins included', async () => {
    mockApi({
      'GET /bots': [],
      'GET /machines': [],
      'GET /groups': [],
      'GET /notifications/unread': { n: 0 },
      'GET /admin/params': { pluginsEnabled: true, demoMode: false } as SystemParams,
      'GET /admin/mcp': [],
      'GET /admin/plugins': [layerPlugin({ builtin: true, updatedBy: null })],
    })
    renderAt('/admin/params')
    fireEvent.click(await screen.findByRole('button', { name: '管理插件' }))
    expect(await screen.findByText('网页原型')).toBeTruthy()
    expect(screen.getByRole('tab', { name: '插件' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('插件 · 产物卡片', () => {
  it('shows the artifact card in the timeline; 打开 opens its canvas tab', async () => {
    mockApi({
      ...chatRoutes(
        [plugin()],
        [
          msg({
            seq: 2,
            id: 'a1m',
            kind: 'event',
            authorId: null,
            authorName: '',
            body: '产物 读书会小程序',
            card: {
              type: 'artifact',
              artifactId: 'a1',
              title: '读书会小程序',
              versionN: 2,
              status: 'ready',
              thumbnailUrl: null,
              issueCount: 1,
            },
          }),
        ],
      ),
    })
    renderAt('/g/g1')
    const c = within(await screen.findByTestId('artifact-card'))
    expect(c.getByText('1 项规范问题')).toBeTruthy()
    fireEvent.click(c.getByRole('button', { name: '打开' }))
    await waitFor(() =>
      expect(useWorkbench.getState().benches.g1?.tabs).toContainEqual({
        kind: 'artifact',
        artifactId: 'a1',
        title: '读书会小程序',
      }),
    )
  })
})
