import type { BotDto, MachineDto, ProviderStoreView, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { NewBotDialog } from '../src/features/bots/NewBotDialog'
import { MachinesOverview } from '../src/features/machines/MachinesOverview'
import { mockApi } from './mockApi'

const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const machine = (o: Partial<MachineDto>): MachineDto => ({
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [],
  daemonVersion: '0.9.0',
  features: ['providers'],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  ...o,
})
const claude = {
  kind: 'claude',
  available: true,
  version: '2.1.4',
  path: '/c',
  minVersion: null,
  catalog: null,
} as const
const mbp = machine({ agents: [claude] })
const box = machine({ id: 'm2', name: 'old-box', os: 'linux', online: false })
const bot = (id: string, presence: BotDto['presence']) =>
  ({ id, name: id, machineId: 'm1', presence }) as BotDto

beforeEach(() => {
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ machines: [], bots: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const VIEW = {
  machine: { claude: 'p1' },
  providers: [{ id: 'p1', agent: 'claude', name: 'Kimi' }],
} as unknown as ProviderStoreView

describe('machines overview', () => {
  it('shows a card per machine: state, system, agents with their provider, and its bots', async () => {
    const calls = mockApi({ 'GET /machines/m1/providers': VIEW })
    render(
      <MemoryRouter>
        <MachinesOverview
          machines={[mbp, box]}
          bots={[bot('b1', 'running'), bot('b2', 'online')]}
          onBindMachine={() => {}}
        />
      </MemoryRouter>,
    )
    const overview = screen.getByRole('region', { name: '机器总览' })
    // Headed like 市场 and 作品, with the machine count; the sidebar already says 机器与 Bot.
    expect(within(overview).getByRole('heading', { level: 1, name: '我的机器' })).toBeTruthy()
    expect(within(overview).getByText('2')).toBeTruthy()
    const card = within(overview).getByRole('link', { name: /wanglei-mbp/ })
    expect(card.getAttribute('href')).toBe('/machine/m1')
    for (const text of ['在线', 'macOS', 'Claude Code 2.1.4', 'Codex 未安装', '2 个 Bot · 1 个运行中'])
      expect(card.textContent).toContain(text)
    await waitFor(() => expect(card.textContent).toContain('供应商：Kimi'))
    const old = within(overview).getByRole('link', { name: /old-box/ })
    expect(old.textContent).toContain('离线')
    expect(old.textContent).toContain('没有 Bot')
    // An offline machine keeps its configuration to itself.
    expect(calls.map((c) => c.path)).toEqual(['/machines/m1/providers'])
  })

  it('guides a member without machines to bind one', () => {
    const onBindMachine = vi.fn()
    render(
      <MemoryRouter>
        <MachinesOverview machines={[]} bots={[]} onBindMachine={onBindMachine} />
      </MemoryRouter>,
    )
    const overview = screen.getByRole('region', { name: '机器总览' })
    expect(overview.textContent).toContain('还没有绑定机器')
    fireEvent.click(within(overview).getByRole('button', { name: '绑定新机器' }))
    expect(onBindMachine).toHaveBeenCalled()
  })
})

describe('新建 Bot after binding', () => {
  it('picks the machine just bound', async () => {
    mockApi({ 'GET /bots/owners': [{ id: 'u1', name: '王磊', machines: [box, mbp] }] })
    render(
      <MemoryRouter>
        <NewBotDialog me={me} machineId="m1" onClose={() => {}} />
      </MemoryRouter>,
    )
    const machines = await screen.findByRole('radiogroup', { name: '执行机器' })
    expect((within(machines).getByRole('radio', { name: /wanglei-mbp/ }) as HTMLInputElement).checked).toBe(
      true,
    )
  })
})
