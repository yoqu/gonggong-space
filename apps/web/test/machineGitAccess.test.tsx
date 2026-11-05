import type {
  DiagCheck,
  GitAccessTest,
  GitAccessView,
  MachineDto,
  ProviderStoreView,
  ToolsStateDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { MachinePage } from '../src/features/machines/MachinePage'
import { realtime } from '../src/lib/realtime'
import { Toaster } from '../src/ui'
import { mockApi } from './mockApi'

const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto

const server: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'gg-server-1',
  os: 'linux',
  arch: 'x86_64',
  online: true,
  agents: [],
  daemonVersion: '0.9.0',
  features: ['tools', 'providers', 'machineAdmin', 'gitAccess', 'diag'],
  lastSeenAt: null,
  hostname: 'gg-server-1',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const EMPTY: GitAccessView = { sshKeys: [], tokens: [], helper: null, knownHosts: [] }
const KEY = {
  path: '/home/gg/.ssh/id_ed25519.pub',
  type: 'ssh-ed25519',
  fingerprint: 'SHA256:abc',
  publicKey: 'ssh-ed25519 AAAA gonggong@gg-server-1',
  comment: 'gonggong@gg-server-1',
}
const TOOLS: ToolsStateDto = { tools: [], settings: { mirror: { kind: 'npmmirror' } } }
const VIEW: ProviderStoreView = {
  machine: {},
  official: {},
  bots: {},
  providers: [],
  agentSettings: {},
  cli: {},
  sessions: [],
}

beforeEach(() => {
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ machines: [server] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const open = (machine: MachineDto = server, url = '/?tab=git') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MachinePage machine={machine} bots={[]} />
      <Toaster />
    </MemoryRouter>,
  )

describe('Git 访问', () => {
  it('tests the repo a paused bot came from at once and points an https failure at the tokens', async () => {
    const repo = 'https://git.corp/pay/pay.git'
    const denied: GitAccessTest = {
      url: repo,
      ok: false,
      reason: 'denied',
      detail: 'Authentication failed',
      hostKey: null,
    }
    const calls = mockApi({
      'GET /machines/m1/git-access': EMPTY,
      'POST /machines/m1/git-access/test': denied,
    })
    open(server, `/?tab=git&repo=${encodeURIComponent(repo)}`)
    expect(await screen.findByText('在下方为 git.corp 添加 HTTPS 令牌后再测试')).toBeTruthy()
    expect(calls.find((c) => c.path.endsWith('/test'))?.body).toEqual({ url: repo })
    expect((screen.getByRole('textbox', { name: '主机' }) as HTMLInputElement).value).toBe('git.corp')
  })

  it('saves a token, then lists it masked and deletes it', async () => {
    const saved: GitAccessView = {
      ...EMPTY,
      tokens: [{ host: 'git.corp', username: 'wanglei', masked: 'glpa…' }],
    }
    const calls = mockApi({
      'GET /machines/m1/git-access': EMPTY,
      'PUT /machines/m1/git-access/tokens': saved,
      'DELETE /machines/m1/git-access/tokens/git.corp': EMPTY,
    })
    open()
    const section = await screen.findByRole('region', { name: 'HTTPS 令牌' })
    const save = within(section).getByRole('button', { name: '保存令牌' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(within(section).getByRole('textbox', { name: '主机' }), {
      target: { value: 'git.corp' },
    })
    fireEvent.change(within(section).getByRole('textbox', { name: '用户名' }), {
      target: { value: 'wanglei' },
    })
    fireEvent.change(within(section).getByLabelText('令牌'), { target: { value: 'glpat-secret' } })
    fireEvent.click(save)
    expect(await within(section).findByText('wanglei · glpa…')).toBeTruthy()
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      host: 'git.corp',
      username: 'wanglei',
      secret: 'glpat-secret',
    })
    expect((within(section).getByLabelText('令牌') as HTMLInputElement).value).toBe('')
    fireEvent.click(within(section).getByRole('button', { name: '删除 git.corp 的令牌' }))
    await waitFor(() => expect(within(section).queryByText('wanglei · glpa…')).toBeNull())
  })

  it('generates an ssh key when there is none and copies its public key', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    mockApi({
      'GET /machines/m1/git-access': EMPTY,
      'POST /machines/m1/git-access/ssh-key': { ...EMPTY, sshKeys: [KEY] },
    })
    open()
    const section = await screen.findByRole('region', { name: 'SSH 密钥' })
    expect(within(section).getByText('这台机器还没有 SSH 密钥')).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: '生成密钥' }))
    fireEvent.click(await within(section).findByRole('button', { name: '复制公钥' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY.publicKey))
    expect(within(section).queryByRole('button', { name: '生成密钥' })).toBeNull()
  })

  it('shows an unknown host key with its fingerprints, trusts it and tests again', async () => {
    const url = 'git@git.corp:pay/pay.git'
    const unknown: GitAccessTest = {
      url,
      ok: false,
      reason: 'denied',
      detail: 'Host key verification failed',
      hostKey: { host: 'git.corp', fingerprints: ['ED25519 SHA256:xyz'] },
    }
    let tests = 0
    const calls = mockApi({
      'GET /machines/m1/git-access': EMPTY,
      'POST /machines/m1/git-access/test': () => (tests++ ? { ...unknown, ok: true, reason: null } : unknown),
      'POST /machines/m1/git-access/known-hosts': { ...EMPTY, knownHosts: ['git.corp'] },
    })
    open()
    const section = await screen.findByRole('region', { name: '测试连接' })
    fireEvent.change(within(section).getByRole('textbox', { name: '仓库地址' }), { target: { value: url } })
    fireEvent.click(within(section).getByRole('button', { name: '测试' }))
    expect(await within(section).findByText('ED25519 SHA256:xyz')).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: '信任 git.corp' }))
    expect(await within(section).findByText(`可以访问 ${url}`)).toBeTruthy()
    expect(calls.find((c) => c.path.endsWith('/known-hosts'))?.body).toEqual({ host: 'git.corp' })
  })

  it('asks for a daemon upgrade on a machine without it', () => {
    open({ ...server, features: ['tools', 'providers', 'machineAdmin'] }, '/')
    expect((screen.getByRole('tab', { name: 'Git 访问' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('诊断 self-checks', () => {
  it("lists the machine's checks and leads a git problem to Git 访问", async () => {
    const checks: DiagCheck[] = [
      { kind: 'server', status: 'ok', detail: 'HTTPS 正常' },
      { kind: 'git', status: 'error', detail: 'SSH · Permission denied (publickey).' },
      { kind: 'screen_recording', status: 'skipped', detail: '' },
    ]
    mockApi({
      'GET /machines/m1/diag': checks,
      'GET /machines/m1/tools': TOOLS,
      'GET /machines/m1/git-access': EMPTY,
    })
    open(server, '/?tab=diagnostics')
    const section = await screen.findByRole('region', { name: '自检' })
    expect(await within(section).findByText('SSH · Permission denied (publickey).')).toBeTruthy()
    expect(within(section).queryByText('屏幕录制')).toBeNull()
    fireEvent.click(within(section).getByRole('button', { name: '去配置' }))
    expect(screen.getByRole('tab', { name: 'Git 访问' }).getAttribute('aria-selected')).toBe('true')
  })

  it('tells a container machine to rebuild its image to upgrade', async () => {
    mockApi({
      'GET /machines/m1/diag': [],
      'GET /machines/m1/tools': TOOLS,
      'GET /client-downloads': { version: '1.0.0', builds: [], desktop: [] },
    })
    open({ ...server, features: [...server.features, 'container', 'noAutoUpgrade'] }, '/?tab=diagnostics')
    const guide = await screen.findByRole('region', { name: '如何升级' })
    expect(guide.textContent).toContain('GG_VERSION 改为 1.0.0')
    expect(within(guide).getByText('docker compose build && docker compose up -d')).toBeTruthy()
    expect(guide.textContent).not.toContain('gg run')
  })

  it('upgrades a Linux daemon from the web and waits for it to be idle', async () => {
    const calls = mockApi({
      'GET /machines/m1/diag': [],
      'GET /machines/m1/tools': TOOLS,
      'GET /client-downloads': { version: '1.0.0', builds: [], desktop: [] },
      'POST /machines/m1/upgrade': { state: 'downloading', version: '1.0.0' },
    })
    open({ ...server, features: [...server.features, 'upgrade'] }, '/?tab=diagnostics')
    const guide = await screen.findByRole('region', { name: '如何升级' })
    fireEvent.click(within(guide).getByRole('button', { name: '立即升级' }))
    expect(await within(guide).findByText('正在下载 1.0.0，没有任务运行时自动重启完成升级')).toBeTruthy()
    expect(within(guide).queryByRole('button', { name: '立即升级' })).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/upgrade'))).toBe(true)
  })

  it('keeps the manual guide for a daemon that cannot upgrade from the web', async () => {
    mockApi({
      'GET /machines/m1/diag': [],
      'GET /machines/m1/tools': TOOLS,
      'GET /client-downloads': { version: '1.0.0', builds: [], desktop: [] },
    })
    open(server, '/?tab=diagnostics')
    const guide = await screen.findByRole('region', { name: '如何升级' })
    expect(within(guide).queryByRole('button', { name: '立即升级' })).toBeNull()
    expect(within(guide).getByText('gg run')).toBeTruthy()
  })
})

describe('official login', () => {
  it("explains logging in from the agent's CLI on the machine", async () => {
    mockApi({ 'GET /machines/m1/tools': TOOLS, 'GET /machines/m1/providers': VIEW })
    open(server, '/?tab=agents')
    const codex = await screen.findByRole('region', { name: 'Codex 供应商' })
    fireEvent.click(within(codex).getByRole('button', { name: '登录…' }))
    const dialog = await screen.findByRole('dialog', { name: '登录 Codex 官方账号' })
    expect(within(dialog).getByText('codex login --device-auth')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '改用 API Key 供应商' }))
    expect(await screen.findByRole('dialog', { name: /新增/ })).toBeTruthy()
  })
})
