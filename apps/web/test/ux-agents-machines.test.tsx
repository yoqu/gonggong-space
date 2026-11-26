import {
  type AgentState,
  type GitAccessView,
  type MachineAgentsDto,
  type MachineDto,
  type PluginTrustDto,
  type ProviderEndpoint,
  type ProviderPreset,
  type ProviderSavedDto,
  type ProviderStoreView,
  type ProviderView,
  TERMINAL_DIR_FEATURE,
  type UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { AgentsPanel } from '../src/features/agents/AgentsPanel'
import type { AgentsSource } from '../src/features/agents/source'
import { DiagnosticsPanel, WorkspacesPanel } from '../src/features/machines/AdminPanels'
import { GitAccessPanel } from '../src/features/machines/GitAccessPanel'
import { AdminMachinePage, MachinePage } from '../src/features/machines/MachinePage'
import { MirrorRows } from '../src/features/machines/MirrorRows'
import { PluginTrustsPanel } from '../src/features/machines/PluginTrustsPanel'
import { OfficialEditor, ProviderEditor } from '../src/features/machines/ProviderEditor'
import { CcSwitchImport, LinkImport } from '../src/features/machines/ProviderImports'
import { ProvidersPanel } from '../src/features/machines/ProvidersPanel'
import { realtime } from '../src/lib/realtime'
import { Toaster, useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const machine: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [],
  daemonVersion: '0.9.0',
  features: [
    'tools',
    'providers',
    'protocolProviders',
    'claudeProfile',
    'claudeDefaultDir',
    'ccSwitch',
    'terminal',
    TERMINAL_DIR_FEATURE,
    'machineAdmin',
    'gitAccess',
    'diag',
  ],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const agent = (kind: AgentState['kind'], o: Partial<AgentState> = {}): AgentState => ({
  kind,
  available: true,
  version: '1.0.0',
  path: `/bin/${kind}`,
  minVersion: null,
  catalog: null,
  latest: '1.0.0',
  managed: true,
  upgradeCommand: null,
  installCommand: null,
  ...o,
})

const endpoint = (o: Partial<ProviderEndpoint> = {}): ProviderEndpoint => ({
  protocol: 'anthropic',
  baseUrl: 'https://x.example.com',
  apiKeyField: null,
  wireApi: null,
  model: null,
  models: null,
  effort: null,
  env: {},
  args: [],
  configDir: null,
  executablePath: null,
  modelOptions: [],
  ...o,
})

const kimi: ProviderView = {
  id: 'p1',
  name: 'Kimi',
  presetId: null,
  revision: 1,
  apiKey: '****abcd',
  proxy: null,
  source: null,
  endpoints: [endpoint()],
}

const VIEW: ProviderStoreView = {
  machine: {},
  official: {},
  bots: {},
  providers: [kimi],
  sessions: [],
  agentSettings: {},
  cli: {},
}

const STATE: MachineAgentsDto = {
  node: { installed: true, version: '22.3.0', latest: '22.3.0', managed: true, path: '/n' },
  agents: [
    agent('claude', { version: '1.0.0', latest: '1.1.0' }),
    agent('codex', { version: '1.0.0', latest: '1.2.0' }),
  ],
  settings: { mirror: { kind: 'npmmirror' } },
}

function fakeSource(o: Partial<AgentsSource> = {}): AgentsSource {
  return {
    key: 'local',
    features: ['tools', 'providers', 'protocolProviders', 'claudeProfile', 'claudeDefaultDir', 'ccSwitch'],
    loadAgents: vi.fn(async () => STATE),
    runTool: vi.fn(async () => null),
    loadProviders: vi.fn(async () => VIEW),
    presets: vi.fn(async () => [] as ProviderPreset[]),
    saveProvider: vi.fn(async () => ({ id: 'p1', view: VIEW })),
    removeProvider: vi.fn(async () => ({ ...VIEW, providers: [] })),
    setDefault: vi.fn(async () => VIEW),
    saveOfficial: vi.fn(async () => VIEW),
    saveAgentSettings: vi.fn(async () => VIEW),
    importLink: vi.fn(async () => ({ id: 'p2', view: VIEW })),
    ccSwitch: {
      preview: vi.fn(async () => []),
      apply: vi.fn(async () => ({ imported: ['p2'], view: VIEW })),
    },
    claudeDirs: vi.fn(async () => []),
    claudeDefaultDir: vi.fn(async () => ({ path: '/Users/test/.claude', exists: true })),
    ...o,
  }
}

beforeEach(() => {
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useToasts.setState({ items: [] })
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ machines: [machine], groups: [], bots: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('U-10 AgentsPanel retry, primary CTA budget & loading', () => {
  it('shows Alert with 重试 reloading both tools and providers when loading fails', async () => {
    const loadAgents = vi.fn().mockRejectedValueOnce(new Error('工具失败')).mockResolvedValue(STATE)
    const loadProviders = vi.fn().mockRejectedValueOnce(new Error('供应商失败')).mockResolvedValue(VIEW)
    render(
      <MemoryRouter>
        <AgentsPanel source={fakeSource({ loadAgents, loadProviders })} bots={[]} />
      </MemoryRouter>,
    )
    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(loadAgents).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(loadProviders).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('region', { name: '供应商' })).toBeTruthy()
  })

  it('keeps max 1 primary button when 全部升级 is shown and shows loading on active row upgrade', async () => {
    let finish = () => {}
    const runTool = vi.fn(() => new Promise<MachineAgentsDto | null>((r) => (finish = () => r(null))))
    render(
      <MemoryRouter>
        <AgentsPanel source={fakeSource({ runTool })} bots={[]} />
      </MemoryRouter>,
    )
    await screen.findByRole('region', { name: '供应商' })
    const allUpgrade = screen.getByRole('button', { name: '全部升级（2）' })
    expect(allUpgrade.className).toContain('ui-btn--primary')

    // Per-row 升级到 and ProvidersPanel 新增… must be demoted when 全部升级 is shown.
    const rowUpgrades = screen.getAllByRole('button', { name: /^升级到 / })
    for (const btn of rowUpgrades) expect(btn.className).not.toContain('ui-btn--primary')
    expect(screen.getByRole('button', { name: '新增…' }).className).not.toContain('ui-btn--primary')

    // Active row upgrade button shows aria-busy="true".
    fireEvent.click(rowUpgrades[0]!)
    await waitFor(() => expect(rowUpgrades[0]!.getAttribute('aria-busy')).toBe('true'))
    await act(async () => finish())
  })
})

describe('U-11 & A-6 ProviderEditor, OfficialEditor, ProvidersPanel & ProviderImports', () => {
  it('guards dirty edits on close, locks submit while saving, hoists only ArgsRow for default Claude dir, adds ⚠ on missing dir & updated VendorPicker copy', async () => {
    const onClose = vi.fn()
    let resolveSave: (v: { id: string; view: ProviderStoreView }) => void = () => {}
    const source = fakeSource({
      presets: vi.fn().mockRejectedValueOnce(new Error('预设加载失败')).mockResolvedValueOnce([]),
      claudeDefaultDir: vi.fn(async () => ({ path: '/Users/test/.claude', exists: false })),
      saveProvider: vi.fn(() => new Promise<ProviderSavedDto>((r) => (resolveSave = r))),
    })
    render(<ProviderEditor source={source} editing={null} onClose={onClose} onSaved={() => {}} />)

    // Preset error renders Alert with Retry and suppresses Skeleton.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('预设加载失败')
    expect(document.querySelector('.ui-skeleton')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    // VendorPicker copy mentions ~/.claude.
    expect(screen.getByText(/含默认 ~\/\.claude/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /这台电脑的 Claude 配置目录/ }))
    const form = await screen.findByRole('form', { name: '新增供应商' })

    // Selecting default dir hoists ONLY 命令行参数 outside collapsed 高级, keeping 代理地址 hidden; missing dir includes ⚠.
    fireEvent.click(await within(form).findByRole('button', { name: '使用默认目录' }))
    expect(within(form).getByText(/⚠/)).toBeTruthy()
    expect(within(form).getByRole('textbox', { name: '命令行参数' })).toBeTruthy()
    expect(within(form).queryByRole('textbox', { name: '代理地址' })).toBeNull()

    // Dirty close prompts DiscardChangesDialog.
    fireEvent.change(within(form).getByRole('textbox', { name: '名称' }), { target: { value: 'MyClaude' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))

    // Submitting locks 取消, Esc, and marks 保存 busy.
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('button', { name: '保存' }).getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => resolveSave({ id: 'p2', view: VIEW }))
  })

  it('guards dirty edits and locks submit in OfficialEditor', async () => {
    const onClose = vi.fn()
    let resolveSave: (v: ProviderStoreView) => void = () => {}
    const source = fakeSource({
      saveOfficial: vi.fn(() => new Promise<ProviderStoreView>((r) => (resolveSave = r))),
    })
    render(
      <OfficialEditor
        source={source}
        agent="claude"
        official={undefined}
        onClose={onClose}
        onSaved={() => {}}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: '代理地址' }), {
      target: { value: 'http://127.0.0.1:7890' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('button', { name: '保存' }).getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => resolveSave(VIEW))
  })

  it('keeps ProvidersPanel delete dialog open with loading & inline error and uses complete subtitle copy (A-6)', async () => {
    let rejectDelete: (e: Error) => void = () => {}
    const source = fakeSource({
      removeProvider: vi.fn(() => new Promise<ProviderStoreView>((_, r) => (rejectDelete = r))),
    })
    render(
      <MemoryRouter>
        <ProvidersPanel source={source} view={VIEW} onView={() => {}} editor={null} onEditor={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByText('一个供应商可提供多种协议，各 Agent 可在详情里选用匹配的供应商')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const dlg = await screen.findByRole('alertdialog')
    fireEvent.click(within(dlg).getByRole('button', { name: '删除' }))
    expect(within(dlg).getByRole('button', { name: '删除' }).getAttribute('aria-busy')).toBe('true')
    expect((within(dlg).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => rejectDelete(new Error('删除失败：被占用')))
    expect(within(dlg).getByRole('alert').textContent).toContain('删除失败：被占用')
  })

  it('supports retry in CcSwitchImport and locks submit in LinkImport', async () => {
    const preview = vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce([])
    const source = fakeSource({ ccSwitch: { preview, apply: vi.fn() } })
    const { unmount } = render(<CcSwitchImport source={source} onClose={() => {}} onImported={() => {}} />)
    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2))
    unmount()

    let resolveLink: (v: { id: string; view: ProviderStoreView }) => void = () => {}
    const linkSource = fakeSource({
      importLink: vi.fn(() => new Promise<ProviderSavedDto>((r) => (resolveLink = r))),
    })
    render(<LinkImport source={linkSource} onClose={() => {}} onImported={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: '导入链接' }), {
      target: { value: 'ccswitch://v1/import?x=1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(screen.getByRole('button', { name: '导入' }).getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => resolveLink({ id: 'p2', view: VIEW }))
  })
})

describe('U-34, U-62, U-64 AdminPanels retry, loading, delete locks & hide 删除所选', () => {
  it('shows retry alerts on SelfChecks, LogsPanel, MirrorPanel and hides 删除所选 when 0 deletable', async () => {
    mockApi({
      'GET /machines/m1/diag': () => apiError(500, 'err', '自检失败'),
      'GET /machines/m1/logs?level=info&limit=300': () => apiError(500, 'err', '日志失败'),
      'GET /machines/m1/tools': () => apiError(500, 'err', '镜像失败'),
      'GET /machines/m1/workspaces': {
        entries: [
          {
            groupId: 'g1',
            groupName: '群A',
            dm: false,
            botId: 'b1',
            botName: 'BotA',
            kind: 'managed',
            path: '/w/1',
            size: 100,
            state: 'running',
            changes: null,
            lastUsedAt: null,
          },
        ],
        disk: { free: 1000, total: 2000 },
      },
    })
    render(
      <MemoryRouter>
        <DiagnosticsPanel machine={machine} />
        <WorkspacesPanel machine={machine} />
      </MemoryRouter>,
    )
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBe(3)
    for (const a of alerts) expect(within(a).getByRole('button', { name: '重试' })).toBeTruthy()
    await screen.findByText('群A')
    expect(screen.queryByRole('button', { name: '删除所选' })).toBeNull()
  })
})

describe('U-35 PluginTrustsPanel busy op isolation, confirm revoke & retry', () => {
  const trust: PluginTrustDto = {
    id: 'pt1',
    machineId: 'm1',
    pluginId: 'p1',
    pluginName: 'tracker',
    pluginTitle: '缺陷跟踪',
    version: '1.0.0',
    versionId: 'pv1',
    permissions: ['exec'],
    mcp: [],
    status: 'pending',
    requestedAt: '2026-11-11T00:00:00Z',
    decidedBy: null,
    decidedAt: null,
  }

  it('spins only the clicked Deny button, confirms Revoke, and offers Retry on load error', async () => {
    let failLoad = true
    let resolveDeny: (v: PluginTrustDto) => void = () => {}
    const calls = mockApi({
      'GET /machines/m1/plugin-trusts': () => (failLoad ? apiError(500, 'err', '加载授权失败') : [trust]),
      'PUT /machines/m1/plugin-trusts/pt1': () => new Promise<PluginTrustDto>((r) => (resolveDeny = r)),
      'DELETE /machines/m1/plugin-trusts/pt1': () => ({}),
    })
    render(
      <>
        <PluginTrustsPanel machine={machine} />
        <Toaster />
      </>,
    )
    const alert = await screen.findByRole('alert')
    failLoad = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await screen.findByText('缺陷跟踪 1.0.0')

    const allowBtn = screen.getByRole('button', { name: '允许' })
    const denyBtn = screen.getByRole('button', { name: '拒绝' })
    fireEvent.click(denyBtn)
    expect(denyBtn.getAttribute('aria-busy')).toBe('true')
    expect(allowBtn.getAttribute('aria-busy')).not.toBe('true')
    await act(async () => resolveDeny({ ...trust, status: 'denied' }))
    await screen.findByText('已拒绝插件授权')

    // Now test Revoke confirmation on allowed trust.
    mockApi({
      'GET /machines/m1/plugin-trusts': () => [{ ...trust, status: 'allowed' }],
      'DELETE /machines/m1/plugin-trusts/pt1': () => ({}),
    })
    const { unmount } = render(
      <>
        <PluginTrustsPanel machine={machine} />
        <Toaster />
      </>,
    )
    const revokeBtns = await screen.findAllByRole('button', { name: '撤销' })
    fireEvent.click(revokeBtns[revokeBtns.length - 1]!)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const dlg = await screen.findByRole('alertdialog')
    expect(dlg.textContent).toContain('要撤销 缺陷跟踪 的授权吗？')
    fireEvent.click(within(dlg).getByRole('button', { name: '撤销' }))
    await screen.findByText('已撤销插件授权')
    unmount()
  })
})

describe('U-43 & U-61 GitAccessPanel retry, primary cap, loading & Enter submit', () => {
  it('shows Retry on error, max 1 primary button, and submits token on Enter', async () => {
    const empty: GitAccessView = { sshKeys: [], tokens: [], helper: null, knownHosts: [] }
    let fail = true
    const calls = mockApi({
      'GET /machines/m1/git-access': () => (fail ? apiError(500, 'err', '读取失败') : empty),
      'PUT /machines/m1/git-access/tokens': {
        ...empty,
        tokens: [{ host: 'git.corp', username: 'u', masked: 'a…' }],
      },
    })
    render(
      <>
        <GitAccessPanel machine={machine} />
        <Toaster />
      </>,
    )
    const alert = await screen.findByRole('alert')
    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await screen.findByRole('button', { name: '生成密钥' })
    expect(screen.getByRole('button', { name: '生成密钥' }).className).not.toContain('ui-btn--primary')
    expect(screen.getByRole('button', { name: '保存令牌' }).className).toContain('ui-btn--primary')

    fireEvent.change(screen.getByRole('textbox', { name: '主机' }), { target: { value: 'git.corp' } })
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: 'wanglei' } })
    const secret = screen.getByLabelText('令牌')
    fireEvent.change(secret, { target: { value: 'tok-123' } })
    fireEvent.keyDown(secret, { key: 'Enter' })
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
  })
})

describe('U-46 MirrorRows retries failed save on re-blur', () => {
  it('does not lock out retry when custom mirror save fails', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<MirrorRows mirror={{ kind: 'custom', registry: '', node: '' }} status={null} onSave={onSave} />)
    const reg = screen.getByRole('textbox', { name: 'npm registry' })
    const node = screen.getByRole('textbox', { name: 'Node.js 下载地址' })
    fireEvent.change(reg, { target: { value: 'https://r.test' } })
    fireEvent.change(node, { target: { value: 'https://n.test' } })
    fireEvent.blur(node)
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    fireEvent.blur(node)
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  })
})

describe('U-64 & U-66 AgentDetail path loading & no ACP jargon', () => {
  it('locks path buttons while picking and avoids ACP jargon', async () => {
    let resolvePick: (ok: boolean) => void = () => {}
    const pickPath = vi.fn(() => new Promise<boolean>((r) => (resolvePick = r)))
    const source = fakeSource({
      agentLocal: vi.fn(async () => ({ customPath: true, login: null, adapterVersion: null })),
      pickPath,
      resetPath: vi.fn(async () => {}),
    })
    render(
      <MemoryRouter>
        <AgentsPanel source={source} bots={[]} />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /^Claude Code/ }))
    expect(screen.queryByText('ACP 适配器')).toBeNull()
    expect(screen.getByText('适配器')).toBeTruthy()
    const changeBtn = await screen.findByRole('button', { name: '更换路径…' })
    const resetBtn = screen.getByRole('button', { name: '恢复自动检测' }) as HTMLButtonElement
    fireEvent.click(changeBtn)
    expect(changeBtn.getAttribute('aria-busy')).toBe('true')
    expect(resetBtn.disabled).toBe(true)
    await act(async () => resolvePick(false))
  })
})

describe('A-2 MachinePage overflow unbind & AdminMachinePage retry + spinner', () => {
  it('moves 解绑电脑… into overflow menu away from 终端', async () => {
    render(
      <MemoryRouter>
        <MachinePage machine={machine} bots={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: '新建终端' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '解绑电脑' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    const item = await screen.findByRole('menuitem', { name: '解绑电脑…' })
    fireEvent.click(item)
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('shows Spinner while loading AdminMachinePage and Retry button on error', async () => {
    let resolveReq: (v: unknown) => void = () => {}
    mockApi({ 'GET /admin/machines': () => new Promise((r) => (resolveReq = r)) })
    const { unmount } = render(
      <MemoryRouter>
        <AdminMachinePage id="m1" />
      </MemoryRouter>,
    )
    expect(document.querySelector('.ui-spinner')).toBeTruthy()
    resolveReq([])
    unmount()

    let fail = true
    mockApi({ 'GET /admin/machines': () => (fail ? apiError(500, 'err', '列表失败') : []) })
    render(
      <MemoryRouter>
        <AdminMachinePage id="m1" />
      </MemoryRouter>,
    )
    const retry = await screen.findByRole('button', { name: '重试' })
    fail = false
    fireEvent.click(retry)
    expect(await screen.findByText('电脑不存在或已解绑')).toBeTruthy()
  })
})
