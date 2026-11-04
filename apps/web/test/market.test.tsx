import type { InstallableDto, InstallDto, ListingSummary, RepoDto, TeamDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { InstallList } from '../src/features/market/InstallList'
import { SettingsDialog } from '../src/features/settings/SettingsDialog'
import { TeamSettingsDialog } from '../src/features/teams/TeamSettingsDialog'
import { apiError, mockApi } from './mockApi'

const listing = (o: Partial<ListingSummary> = {}): ListingSummary => ({
  id: 'l1',
  type: 'skill',
  name: 'review-pr',
  title: 'review-pr',
  description: '按团队规范审查 diff',
  layer: 'team',
  status: 'listed',
  versionId: 'pv3',
  revision: 3,
  ...o,
})

const install = (o: Partial<InstallDto> = {}): InstallDto => ({
  listing: listing(),
  scope: 'group',
  enabled: true,
  pinVersionId: null,
  resolvedVersionId: 'pv3',
  resolvedRevision: 3,
  updatedBy: '陈晨',
  updatedAt: new Date().toISOString(),
  ...o,
})

const installs: InstallDto[] = [
  install(),
  install({
    listing: listing({
      id: 'l2',
      type: 'plugin',
      name: 'slides',
      title: '幻灯片',
      layer: 'platform',
      status: 'unlisted',
    }),
    pinVersionId: 'pv1',
    resolvedVersionId: 'pv1',
    resolvedRevision: 1,
    enabled: false,
  }),
  install({ listing: listing({ id: 'l3', name: 'old-skill', title: 'old-skill', status: 'banned' }) }),
]

const installable: InstallableDto[] = [
  listing({
    id: 'l4',
    name: 'lint-fix',
    title: 'lint-fix',
    layer: 'platform',
    versionId: 'pv9',
    revision: 2,
  }),
  listing({ id: 'l5', type: 'plugin', name: 'deck', title: '演示文稿', layer: 'group' }),
]

const row = (name: string) => screen.getByText(name).closest('.cfg__item') as HTMLElement

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
})
afterEach(() => vi.unstubAllGlobals())

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

describe('InstallList', () => {
  it('lists the scope installs: type, layer, version policy and status', async () => {
    mockApi({ 'GET /groups/g1/installs': installs })
    render(<InstallList base="/groups/g1" />)
    const review = await screen.findByText('review-pr')
    const r = review.closest('.cfg__item') as HTMLElement
    expect(within(r).getByText('Skill')).toBeTruthy()
    expect(within(r).getByText('团队层')).toBeTruthy()
    expect(within(r).getByText('跟随最新')).toBeTruthy()
    const slides = row('幻灯片')
    expect(within(slides).getByText('插件')).toBeTruthy()
    expect(within(slides).getByText('平台层')).toBeTruthy()
    expect(within(slides).getByText('锁定 r1')).toBeTruthy()
    expect(within(slides).getByText('已下架')).toBeTruthy()
    expect(within(row('old-skill')).getByText('已封禁')).toBeTruthy()
    expect(within(slides).getByRole('switch', { name: '启用 幻灯片' })).toHaveProperty('checked', false)
  })

  it('toggles an install, keeping its version policy', async () => {
    const calls = mockApi({
      'GET /teams/t1/installs': installs,
      'PUT /teams/t1/installs/l2': (body: unknown) => ({ ...installs[1], ...(body as object) }),
    })
    render(<InstallList base="/teams/t1" />)
    fireEvent.click(await screen.findByRole('switch', { name: '启用 幻灯片' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: true, pinVersionId: 'pv1' })
  })

  it('removes an install after confirmation', async () => {
    const calls = mockApi({ 'GET /groups/g1/installs': installs, 'DELETE /groups/g1/installs/l1': undefined })
    render(<InstallList base="/groups/g1" />)
    fireEvent.click(await screen.findByRole('button', { name: '移除 review-pr' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '移除' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/groups/g1/installs/l1')).toBe(true),
    )
  })

  it('imports a listing following the latest version by default, or pinned to the current one', async () => {
    const calls = mockApi({
      'GET /teams/t1/repos/r1/installs': [],
      'GET /teams/t1/repos/r1/installable': installable,
      'PUT /teams/t1/repos/r1/installs/l4': install({ listing: installable[0] }),
      'PUT /teams/t1/repos/r1/installs/l5': install({ listing: installable[1] }),
    })
    render(<InstallList base="/teams/t1/repos/r1" />)
    fireEvent.click(await screen.findByRole('button', { name: '从已有条目引入…' }))
    let dialog = await screen.findByRole('dialog', { name: '从已有条目引入' })
    fireEvent.click(await within(dialog).findByRole('radio', { name: /lint-fix/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.path === '/teams/t1/repos/r1/installs/l4')?.body).toEqual({
      enabled: true,
      pinVersionId: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '从已有条目引入' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '从已有条目引入…' }))
    dialog = await screen.findByRole('dialog', { name: '从已有条目引入' })
    fireEvent.click(await within(dialog).findByRole('radio', { name: /演示文稿/ }))
    fireEvent.click(within(dialog).getByRole('radio', { name: /锁定当前版本/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/teams/t1/repos/r1/installs/l5')?.body).toEqual({
        enabled: true,
        pinVersionId: 'pv3',
      }),
    )
  })

  it('shows the server message on a 409 conflict', async () => {
    mockApi({
      'GET /groups/g1/installs': [],
      'GET /groups/g1/installable': installable,
      'PUT /groups/g1/installs/l4': apiError(409, 'conflict', '同名 Skill 已存在'),
    })
    render(<InstallList base="/groups/g1" />)
    fireEvent.click(await screen.findByRole('button', { name: '从已有条目引入…' }))
    const dialog = await screen.findByRole('dialog', { name: '从已有条目引入' })
    fireEvent.click(await within(dialog).findByRole('radio', { name: /lint-fix/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    expect(await within(dialog).findByText('同名 Skill 已存在')).toBeTruthy()
  })

  it('is read-only: no switch, remove or import', async () => {
    mockApi({ 'GET /groups/g1/installs': installs })
    render(<InstallList base="/groups/g1" readOnly />)
    await screen.findByText('review-pr')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /移除/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '从已有条目引入…' })).toBeNull()
    expect(within(row('幻灯片')).getByText('已停用')).toBeTruthy()
  })
})

describe('team settings · repos', () => {
  const team: TeamDto = {
    id: 't1',
    name: '支付组',
    avatar: null,
    role: 'admin',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    unread: 0,
  }
  const repo: RepoDto = {
    id: 'r1',
    key: 'git.example.com/pay/core',
    url: 'https://git.example.com/pay/core.git',
    name: 'core',
    lastBranch: 'main',
    lastUsedAt: '2026-01-01T00:00:00Z',
    groups: 2,
    mine: true,
    localPaths: [],
  }

  it('lists the team repos and opens one repo installs', async () => {
    mockApi({ 'GET /teams/t1/repos': [repo], 'GET /teams/t1/repos/r1/installs': installs })
    useSession.setState({ status: 'ready' })
    render(<TeamSettingsDialog team={team} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '仓库' }))
    fireEvent.click(await screen.findByRole('button', { name: '展开 core' }))
    expect(await screen.findByText('review-pr')).toBeTruthy()
  })

  it('lists the team pending reviews under 待审核', async () => {
    const calls = mockApi({ 'GET /market/reviews?teamId=t1': [] })
    render(<TeamSettingsDialog team={team} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '待审核' }))
    expect(await screen.findByText('没有待审核的版本')).toBeTruthy()
    expect(calls.some((c) => c.path === '/market/reviews?teamId=t1')).toBe(true)
  })

  it('shows the team installs under the Skill tab, with a way to the market', async () => {
    mockApi({ 'GET /teams/t1/skills': [], 'GET /teams/t1/installs': installs })
    const onClose = vi.fn()
    render(
      <MemoryRouter initialEntries={['/']}>
        <TeamSettingsDialog team={team} onClose={onClose} />
        <Where />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skill' }))
    expect(await screen.findByText('已引入')).toBeTruthy()
    expect(await screen.findByText('review-pr')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开市场' }))
    expect(screen.getByTestId('where').textContent).toBe('/market')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('settings · 我的 Skill', () => {
  it('lists my personal installs, imports from /me/installable and opens the market', async () => {
    const calls = mockApi({
      'GET /me/installs': [install({ scope: 'user' })],
      'GET /me/installable': [installable[0]],
      'PUT /me/installs/l4': install({ scope: 'user', listing: installable[0] }),
    })
    const onClose = vi.fn()
    render(
      <MemoryRouter initialEntries={['/']}>
        <SettingsDialog page="appearance" onClose={onClose} />
        <Where />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '我的 Skill' }))
    expect(
      screen.getByText('只在你发起的运行里生效，跟着你进入所有群；优先级高于群、仓库、团队的同名 Skill。'),
    ).toBeTruthy()
    expect(await screen.findByText('review-pr')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '从已有条目引入…' }))
    const dialog = await screen.findByRole('dialog', { name: '从已有条目引入' })
    fireEvent.click(await within(dialog).findByRole('radio', { name: /lint-fix/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/me/installs/l4')?.body).toEqual({
        enabled: true,
        pinVersionId: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '从已有条目引入' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '打开市场' }))
    expect(screen.getByTestId('where').textContent).toBe('/market')
    expect(onClose).toHaveBeenCalled()
  })
})
