import type {
  BotDto,
  CcSwitchCandidate,
  MachineDto,
  ProviderPreset,
  ProviderStoreView,
  ProviderView,
  ToolsStateDto,
  UserDto,
  WebEvent,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { MachineDialog } from '../src/features/machines/MachineDialog'
import { realtime } from '../src/lib/realtime'
import { type Call, mockApi } from './mockApi'

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
  features: ['tools', 'providers', 'ccSwitch'],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const TOOLS: ToolsStateDto = {
  tools: [
    { kind: 'node', installed: true, version: '22.1.0', latest: '22.9.0', managed: true, path: '/n' },
    { kind: 'claude', installed: true, version: '2.1.0', latest: '2.1.285', managed: false, path: '/c' },
    { kind: 'codex', installed: false, version: null, latest: '0.159.2', managed: false, path: null },
  ],
  settings: { mirror: { kind: 'npmmirror' } },
}

const kimiPreset: ProviderPreset = {
  id: 'kimi-coding',
  agent: 'claude',
  name: 'Kimi For Coding',
  group: 'cn',
  websiteUrl: 'https://www.kimi.com/code/',
  apiKeyUrl: 'https://platform.kimi.com/keys',
  baseUrl: 'https://api.kimi.com/coding/',
  apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
  model: 'kimi-for-coding',
  models: null,
  modelOptions: ['kimi-for-coding', 'kimi-k2'],
  env: {},
  wireApi: null,
  effort: null,
}
const PRESETS: ProviderPreset[] = [
  kimiPreset,
  {
    ...kimiPreset,
    id: 'openrouter',
    name: 'OpenRouter',
    group: 'aggregator',
    baseUrl: 'https://openrouter.ai/api',
  },
]

const kimi: ProviderView = {
  id: 'p1',
  agent: 'claude',
  name: 'Kimi',
  presetId: 'kimi-coding',
  revision: 1,
  baseUrl: 'https://api.kimi.com/coding/',
  apiKey: '****abcd',
  apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
  model: 'kimi-for-coding',
  models: null,
  env: {},
  proxy: 'http://bob:****@10.0.0.2:3128',
  wireApi: null,
  effort: null,
  source: null,
}
const VIEW: ProviderStoreView = {
  machine: {},
  bots: {},
  providers: [kimi],
  sessions: [
    { groupId: 'g1', botId: 'b1', agent: 'claude', provider: 'official' },
    { groupId: 'g2', botId: 'b1', agent: 'claude', provider: 'official' },
    { groupId: 'g3', botId: 'b2', agent: 'claude', provider: 'official' },
  ],
}

const group = (id: string, name: string) => ({ id, name }) as never
const bot = (id: string, name: string) => ({ id, name }) as BotDto

let handlers: Set<(e: WebEvent) => void>
const emit = (e: WebEvent) =>
  act(() => {
    for (const h of handlers) h(e)
  })

beforeEach(() => {
  handlers = new Set()
  vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
    handlers.add(h)
    return () => handlers.delete(h)
  })
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({
    groups: [group('g1', '前端组'), group('g2', '后端组'), group('g3', '测试组')],
    bots: [bot('b1', '小王的 Claude'), bot('b2', '审查员')],
    machines: [mbp],
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const open = (machine: MachineDto = mbp, url = '/') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MachineDialog machine={machine} onClose={() => {}} />
    </MemoryRouter>,
  )

const tab = (name: string) => screen.getByRole('tab', { name }) as HTMLButtonElement

describe('machine dialog tabs', () => {
  it('gives the owner Agent 工具 and 供应商 tabs next to 概览', () => {
    open()
    expect(tab('概览').getAttribute('aria-selected')).toBe('true')
    expect(tab('Agent 工具').disabled).toBe(false)
    expect(tab('供应商').disabled).toBe(false)
  })

  it('has no tabs for someone else (a sysadmin looking at a member machine)', () => {
    open({ ...mbp, ownerId: 'u2' })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByText('wanglei-mbp', { selector: '.machine__host' })).toBeTruthy()
  })

  it('disables both tabs with 机器离线 while the machine is offline', () => {
    open({ ...mbp, online: false, features: [] })
    expect(tab('Agent 工具').disabled).toBe(true)
    expect(tab('供应商').disabled).toBe(true)
    expect(screen.getByText(/机器离线/)).toBeTruthy()
  })

  it('asks for a daemon upgrade when the daemon predates the features', () => {
    open({ ...mbp, features: [] })
    expect(tab('Agent 工具').disabled).toBe(true)
    expect(screen.getByText(/请先升级该机器的 daemon/)).toBeTruthy()
  })
})

describe('Agent 工具', () => {
  const openTools = async (routes: Record<string, unknown> = {}) => {
    const calls = mockApi({ 'GET /machines/m1/tools': TOOLS, ...routes })
    open()
    fireEvent.click(tab('Agent 工具'))
    await screen.findByRole('region', { name: 'Codex' })
    return calls
  }

  it('shows versions, where they come from and the fitting action', async () => {
    await openTools()
    const node = screen.getByRole('region', { name: 'Node.js' })
    expect(node.textContent).toContain('22.1.0')
    expect(node.textContent).toContain('共工空间托管')
    expect(within(node).getByRole('button', { name: '升级到 22.9.0' })).toBeTruthy()
    const claude = screen.getByRole('region', { name: 'Claude Code' })
    expect(claude.textContent).toContain('自行安装')
    expect(claude.textContent).toContain('有更新')
    expect(claude.textContent).toContain('claude update')
    expect(within(claude).queryByRole('button', { name: '安装共工空间托管版' })).toBeNull()
    const codex = screen.getByRole('region', { name: 'Codex' })
    expect(codex.textContent).toContain('未安装')
    expect(within(codex).getByRole('button', { name: '安装' })).toBeTruthy()
  })

  it('streams the install log from realtime and takes the new state from the result', async () => {
    const calls = await openTools({ 'POST /machines/m1/tools/codex/install': { opId: 'op1' } })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Codex' })).getByRole('button', { name: '安装' }),
    )
    await waitFor(() => expect(calls.some((c) => c.path === '/machines/m1/tools/codex/install')).toBe(true))
    emit({ t: 'machine.tools.progress', machineId: 'm1', opId: 'op1', line: 'added 3 packages' })
    emit({ t: 'machine.tools.progress', machineId: 'other', opId: 'op9', line: 'not mine' })
    const log = screen.getByRole('log', { name: '安装日志' })
    expect(log.textContent).toContain('added 3 packages')
    expect(log.textContent).not.toContain('not mine')
    expect(screen.getByText('正在安装…')).toBeTruthy()
    const done: ToolsStateDto = {
      ...TOOLS,
      tools: TOOLS.tools.map((t) =>
        t.kind === 'codex' ? { ...t, installed: true, version: '0.159.2', managed: true } : t,
      ),
    }
    emit({ t: 'machine.tools.result', machineId: 'm1', opId: 'op1', ok: true, error: null, state: done })
    expect(screen.getByText('安装完成')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Codex' }).textContent).toContain('0.159.2')
  })

  it('shows a failed install with its error', async () => {
    await openTools({ 'POST /machines/m1/tools/codex/install': { opId: 'op1' } })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Codex' })).getByRole('button', { name: '安装' }),
    )
    await screen.findByRole('log', { name: '安装日志' })
    await waitFor(() => expect(screen.getByText('正在安装…')).toBeTruthy())
    emit({
      t: 'machine.tools.result',
      machineId: 'm1',
      opId: 'op1',
      ok: false,
      error: '机器离线',
      state: null,
    })
    expect(screen.getByText('安装失败')).toBeTruthy()
    expect(screen.getByRole('log', { name: '安装日志' }).textContent).toContain('机器离线')
  })

  it('saves a custom mirror with both addresses', async () => {
    const calls = await openTools({ 'PUT /machines/m1/tools/settings': TOOLS })
    fireEvent.click(screen.getByRole('button', { name: '镜像源' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '自定义' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'npm registry' }), {
      target: { value: 'https://r.example.com' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Node.js 下载地址' }), {
      target: { value: 'https://n.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        mirror: { kind: 'custom', registry: 'https://r.example.com', node: 'https://n.example.com' },
      }),
    )
  })
})

describe('供应商', () => {
  const openProviders = async (routes: Record<string, unknown> = {}, view = VIEW) => {
    const calls = mockApi({
      'GET /machines/m1/providers': view,
      'GET /machines/m1/providers/presets?agent=claude': PRESETS,
      ...routes,
    })
    open()
    fireEvent.click(tab('供应商'))
    return { calls, claude: await screen.findByRole('region', { name: 'Claude Code 供应商' }) }
  }
  const keyIn = (calls: Call[]) => calls.filter((c) => JSON.stringify(c.body ?? {}).includes('sk-new'))

  it("opens on the 供应商 tab from ?tab=providers (the desktop app's 在 Web 中管理)", async () => {
    mockApi({
      'GET /machines/m1/providers': VIEW,
      'GET /machines/m1/providers/presets?agent=claude': PRESETS,
    })
    open(mbp, '/?tab=providers')
    expect(await screen.findByRole('region', { name: 'Claude Code 供应商' })).toBeTruthy()
  })

  it('lists official login and the providers with masked keys', async () => {
    const { claude } = await openProviders()
    expect((within(claude).getByRole('radio', { name: /官方登录/ }) as HTMLInputElement).checked).toBe(true)
    expect(within(claude).getByRole('radio', { name: /Kimi/ }).closest('label')?.textContent).toContain(
      'Key ****abcd',
    )
    expect(screen.getByRole('region', { name: 'Codex 供应商' })).toBeTruthy()
  })

  it('creates one from a preset and sends the key only when saving', async () => {
    const { calls, claude } = await openProviders({
      'POST /machines/m1/providers': { id: 'p2', view: VIEW },
    })
    fireEvent.click(within(claude).getByRole('button', { name: '新增…' }))
    const picker = await screen.findByRole('dialog', { name: '新增 Claude Code 供应商' })
    expect(within(picker).getByText('国内厂商')).toBeTruthy()
    expect(within(picker).getByText('聚合平台')).toBeTruthy()
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: 'open' } })
    expect(within(picker).queryByRole('button', { name: /Kimi For Coding/ })).toBeNull()
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: '' } })
    fireEvent.click(await within(picker).findByRole('button', { name: /Kimi For Coding/ }))

    const form = await screen.findByRole('form', { name: '新增 Claude Code 供应商' })
    expect((within(form).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
      'Kimi For Coding',
    )
    expect((within(form).getByRole('combobox', { name: '模型' }) as HTMLInputElement).value).toBe(
      'kimi-for-coding',
    )
    const link = within(form).getByRole('link', { name: /获取 Key/ })
    expect(link.getAttribute('href')).toBe('https://platform.kimi.com/keys')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')

    fireEvent.change(within(form).getByLabelText('API Key'), { target: { value: 'sk-new' } })
    expect(keyIn(calls)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(keyIn(calls)).toHaveLength(1))
    expect(keyIn(calls)[0]).toMatchObject({
      method: 'POST',
      path: '/machines/m1/providers',
      body: {
        agent: 'claude',
        presetId: 'kimi-coding',
        name: 'Kimi For Coding',
        baseUrl: 'https://api.kimi.com/coding/',
        apiKey: 'sk-new',
        model: 'kimi-for-coding',
      },
    })
  })

  it('refuses to add one without an API key', async () => {
    const { calls, claude } = await openProviders()
    fireEvent.click(within(claude).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /Kimi For Coding/ }))
    await screen.findByRole('form', { name: '新增 Claude Code 供应商' })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请填写 API Key')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('edits without the key when it is left empty, and restores preset values', async () => {
    const { calls, claude } = await openProviders({
      'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW },
    })
    fireEvent.click(within(claude).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    const key = within(form).getByLabelText('API Key') as HTMLInputElement
    expect(key.value).toBe('')
    expect(key.placeholder).toBe('****abcd')
    fireEvent.change(within(form).getByRole('textbox', { name: '名称' }), { target: { value: 'Kimi 2' } })
    fireEvent.click(await screen.findByRole('button', { name: '恢复为预设值' }))
    expect((within(form).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
      'Kimi For Coding',
    )
    fireEvent.change(within(form).getByRole('textbox', { name: '名称' }), { target: { value: 'Kimi 2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const body = calls.find((c) => c.method === 'PUT')?.body as Record<string, unknown>
    expect(body).toMatchObject({ agent: 'claude', name: 'Kimi 2' })
    expect(body).not.toHaveProperty('apiKey')
  })

  it('edits the proxy and environment of either agent under 高级', async () => {
    const codex: ProviderView = {
      ...kimi,
      id: 'p2',
      agent: 'codex',
      name: 'GLM',
      presetId: null,
      proxy: null,
    }
    const { calls } = await openProviders(
      {
        'PUT /machines/m1/providers/p2': { id: 'p2', view: VIEW },
        'GET /machines/m1/providers/presets?agent=codex': [],
      },
      { ...VIEW, providers: [kimi, codex] },
    )
    const region = screen.getByRole('region', { name: 'Codex 供应商' })
    fireEvent.click(within(region).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    fireEvent.change(within(form).getByRole('textbox', { name: '代理地址' }), {
      target: { value: ' http://127.0.0.1:7890 ' },
    })
    fireEvent.change(within(form).getByRole('textbox', { name: '环境变量' }), {
      target: { value: 'NODE_OPTIONS=--max-old-space-size=4096' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      agent: 'codex',
      proxy: 'http://127.0.0.1:7890',
      env: { NODE_OPTIONS: '--max-old-space-size=4096' },
    })
  })

  it('shows the stored proxy masked and sends it back untouched', async () => {
    const { calls, claude } = await openProviders({
      'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW },
    })
    fireEvent.click(within(claude).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    expect((within(form).getByRole('textbox', { name: '代理地址' }) as HTMLInputElement).value).toBe(
      'http://bob:****@10.0.0.2:3128',
    )
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      proxy: 'http://bob:****@10.0.0.2:3128',
    })
  })

  it('opens a fresh editor each time', async () => {
    const { claude } = await openProviders()
    fireEvent.click(within(claude).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /Kimi For Coding/ }))
    await screen.findByRole('form', { name: '新增 Claude Code 供应商' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(within(claude).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    expect((within(form).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('Kimi')
  })

  it('confirms a machine default switch that leaves sessions on the old provider', async () => {
    const { calls, claude } = await openProviders({
      'PUT /machines/m1/providers/default': { ...VIEW, machine: { claude: 'p1' } },
    })
    fireEvent.click(within(claude).getByRole('radio', { name: /Kimi/ }))
    const alert = await screen.findByRole('alertdialog')
    expect(alert.textContent).toContain('3 个群的会话仍在使用 官方登录，开启新会话后才会切换到 Kimi')
    for (const g of ['前端组（小王的 Claude）', '后端组（小王的 Claude）', '测试组（审查员）'])
      expect(within(alert).getByText(g)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    fireEvent.click(within(alert).getByRole('button', { name: '切换' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/machines/m1/providers/default',
        body: { agent: 'claude', choice: 'p1' },
      }),
    )
    await waitFor(() =>
      expect((within(claude).getByRole('radio', { name: /Kimi/ }) as HTMLInputElement).checked).toBe(true),
    )
  })

  it('switches at once when no session is affected (bots with their own provider)', async () => {
    const view = { ...VIEW, bots: { b1: 'official', b2: 'official' } }
    const { calls, claude } = await openProviders(
      { 'PUT /machines/m1/providers/default': { ...view, machine: { claude: 'p1' } } },
      view,
    )
    fireEvent.click(within(claude).getByRole('radio', { name: /Kimi/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('warns that sessions pinned to a deleted provider start over', async () => {
    const pinned = {
      ...VIEW,
      sessions: [{ groupId: 'g1', botId: 'b1', agent: 'claude' as const, provider: 'p1' }],
    }
    const { calls, claude } = await openProviders(
      { 'DELETE /machines/m1/providers/p1': { ...pinned, providers: [] } },
      pinned,
    )
    fireEvent.click(within(claude).getByRole('button', { name: '删除' }))
    const alert = await screen.findByRole('alertdialog')
    expect(alert.textContent).toContain('1 个群的会话正在使用 Kimi')
    expect(within(alert).getByText('前端组（小王的 Claude）')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(within(claude).queryByRole('radio', { name: /Kimi/ })).toBeNull())
  })

  it('previews CC Switch providers masked and imports the chosen ones', async () => {
    const cand = (o: Partial<CcSwitchCandidate>): CcSwitchCandidate => ({
      key: 'k1',
      agent: 'claude',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: '****wxyz',
      model: 'deepseek-chat',
      current: true,
      existing: null,
      ...o,
    })
    const { calls, claude } = await openProviders({
      'GET /machines/m1/ccswitch': {
        candidates: [
          cand({}),
          cand({ key: 'k2', name: 'GLM', current: false, existing: 'p9' }),
          cand({ key: 'k3', agent: 'codex', name: 'Codex 中转' }),
        ],
      },
      'POST /machines/m1/ccswitch/apply': { imported: ['p5'], view: VIEW },
    })
    fireEvent.click(within(claude).getByRole('button', { name: '从 CC Switch 导入…' }))
    const dialog = await screen.findByRole('dialog', { name: '从 CC Switch 导入 Claude Code 供应商' })
    await within(dialog).findByText('DeepSeek')
    expect(dialog.textContent).toContain('Key ****wxyz')
    expect(dialog.textContent).toContain('将更新已有项')
    expect(within(dialog).queryByText('Codex 中转')).toBeNull()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /GLM/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '导入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/machines/m1/ccswitch/apply')?.body).toEqual({
        keys: ['k1'],
        setDefault: false,
      }),
    )
  })

  it('has no CC Switch entry when the machine has none', async () => {
    mockApi({ 'GET /machines/m1/providers': VIEW })
    open({ ...mbp, features: ['tools', 'providers'] })
    fireEvent.click(tab('供应商'))
    const claude = await screen.findByRole('region', { name: 'Claude Code 供应商' })
    expect(within(claude).queryByRole('button', { name: '从 CC Switch 导入…' })).toBeNull()
    expect(within(claude).getByRole('button', { name: '粘贴链接导入…' })).toBeTruthy()
  })

  it('imports a pasted ccswitch:// link', async () => {
    const { calls, claude } = await openProviders({
      'POST /machines/m1/providers/import-link': { id: 'p1', view: VIEW },
    })
    fireEvent.click(within(claude).getByRole('button', { name: '粘贴链接导入…' }))
    const dialog = await screen.findByRole('dialog', { name: '粘贴链接导入' })
    const link = 'ccswitch://v1/import?resource=provider&app=claude&name=K'
    fireEvent.change(within(dialog).getByRole('textbox', { name: '导入链接' }), { target: { value: link } })
    fireEvent.click(within(dialog).getByRole('button', { name: '导入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/machines/m1/providers/import-link')?.body).toEqual({
        link,
        setDefault: false,
      }),
    )
  })

  it('shows 机器离线 when the machine goes away while the tab is open', async () => {
    mockApi({ 'GET /machines/m1/providers': VIEW })
    const view = open()
    fireEvent.click(tab('供应商'))
    await screen.findByRole('region', { name: 'Claude Code 供应商' })
    view.rerender(
      <MemoryRouter>
        <MachineDialog machine={{ ...mbp, online: false }} onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getAllByText(/机器离线/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: 'Claude Code 供应商' })).toBeNull()
  })
})
