import type { MachineDto, PluginTrustDto, UserDto } from '@gonggong/protocol'
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

const machine: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: false,
  agents: [],
  daemonVersion: '0.9.0',
  features: [],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const trust = (o: Partial<PluginTrustDto>): PluginTrustDto => ({
  id: 'pt1',
  machineId: 'm1',
  pluginId: 'p1',
  pluginName: 'tracker',
  pluginTitle: '缺陷跟踪',
  version: '1.0.0',
  versionId: 'pv1',
  permissions: ['exec', 'network'],
  mcp: [
    { transport: 'stdio', name: 'issues', command: ['{node}', '{pkg}/contrib/mcp/server.mjs'], env: {} },
    { transport: 'http', name: 'search', url: 'https://tracker.example.com/mcp', headers: {} },
  ],
  status: 'pending',
  requestedAt: '2026-11-11T00:00:00Z',
  decidedBy: null,
  decidedAt: null,
  ...o,
})

beforeEach(() => {
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useSession.setState({ user: me, status: 'ready', tenancy: { pluginsEnabled: true } as never })
  useWorkspace.setState({ machines: [machine] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useSession.setState({ tenancy: undefined as never })
})

const open = () =>
  render(
    <MemoryRouter initialEntries={['/?tab=plugins']}>
      <MachinePage machine={machine} bots={[]} />
      <Toaster />
    </MemoryRouter>,
  )

describe('插件授权', () => {
  it('lists what a plugin runs, allows it even offline, then revokes it', async () => {
    let list = [trust({})]
    const calls = mockApi({
      'GET /machines/m1/plugin-trusts': () => list,
      'PUT /machines/m1/plugin-trusts/pt1': (body: unknown) => {
        list = [trust({ status: (body as { allow: boolean }).allow ? 'allowed' : 'denied' })]
        return list[0]
      },
      'DELETE /machines/m1/plugin-trusts/pt1': () => {
        list = []
      },
    })
    open()
    const section = await screen.findByRole('region', { name: '插件授权' })
    expect(await within(section).findByText('缺陷跟踪 1.0.0')).toBeTruthy()
    expect(within(section).getByText('待授权')).toBeTruthy()
    expect(within(section).getByText('权限：运行代码、访问网络')).toBeTruthy()
    expect(within(section).getByText('tracker-issues：{node} {pkg}/contrib/mcp/server.mjs')).toBeTruthy()
    expect(within(section).getByText('tracker-search：https://tracker.example.com/mcp')).toBeTruthy()

    fireEvent.click(within(section).getByRole('button', { name: '允许' }))
    expect(await within(section).findByText('已允许')).toBeTruthy()
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ allow: true })

    fireEvent.click(within(section).getByRole('button', { name: '撤销' }))
    expect(await within(section).findByText('还没有插件请求在这台机器上运行代码')).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  })

  it('has no tab while plugins are off', async () => {
    useSession.setState({ tenancy: { pluginsEnabled: false } as never })
    mockApi({})
    open()
    expect(screen.queryByRole('tab', { name: '插件授权' })).toBeNull()
  })
})
