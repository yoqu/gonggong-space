import type {
  GroupDto,
  MarketInstalledDto,
  MarketListingDetailDto,
  MarketReadinessDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { type InstallableListingInput, InstallTargetDialog } from '../src/features/market/InstallTargetDialog'
import { MarketPage } from '../src/features/market/MarketPage'
import type { MarketListingView } from '../src/features/market/meta'
import { mockApi } from './mockApi'

const me = { id: 'u1', name: '姜维川', role: 'member' } as UserDto
const group = {
  id: 'g1',
  teamId: 't1',
  name: '支付核心群',
  kind: 'group',
  members: [{ userId: 'u1', name: '姜维川', avatar: null, isAdmin: true }],
} as unknown as GroupDto

const listing: InstallableListingInput = {
  id: 'l1',
  type: 'plugin',
  name: 'review-pr',
  title: '代码评审助手',
  listedVersionId: 'pv3',
  listedRevision: 3,
}

const view = (o: Partial<MarketListingView> = {}): MarketListingView => ({
  id: 'l1',
  type: 'skill',
  name: 'review-pr',
  title: '代码评审助手',
  description: '按团队规范审查 diff',
  layer: 'team',
  status: 'listed',
  versionId: 'pv3',
  revision: 3,
  source: 'team',
  visibility: 'team',
  teamId: 't1',
  teamName: '支付组',
  author: '陈晨',
  agents: ['claude'],
  listedVersionId: 'pv3',
  listedRevision: 3,
  installs: 12,
  scene: 'dev',
  capabilities: ['do'],
  readiness: 'ready',
  teamGroupsCount: 4,
  updatedAt: '2026-11-01T00:00:00Z',
  ...o,
})

const ready = (o: Partial<MarketReadinessDto> = {}): MarketReadinessDto => ({
  listingId: 'l1',
  title: '代码评审助手',
  versionId: 'pv3',
  scope: 'group',
  scopeId: 'g1',
  targetLabel: '支付核心群',
  ready: true,
  pendingSteps: 0,
  secrets: [],
  reusedSecrets: [],
  connector: null,
  trusts: null,
  tryPrompts: ['帮我审查一下最近的提交'],
  ...o,
})

const pendingTrust = ready({
  ready: false,
  pendingSteps: 1,
  trusts: {
    codeEnabled: true,
    ready: false,
    machines: [
      {
        machineId: 'm1',
        machineName: '我的 MacBook',
        ownerId: 'u1',
        ownerName: '姜维川',
        own: true,
        online: true,
        trustId: null,
        status: 'unrequested',
        botIds: ['b1'],
        botNames: ['研效 Bot'],
      },
    ],
  },
})

const emptyInstalled: MarketInstalledDto = { todoCount: 0, pendingUpdates: 0, mine: [], groups: [], team: [] }

const renderDialog = (initialReadyTarget?: { scope: 'group'; scopeId: string; label: string }) =>
  render(
    <MemoryRouter>
      <InstallTargetDialog
        listing={listing}
        sourceGroupId="g1"
        initialReadyTarget={initialReadyTarget}
        onClose={() => {}}
      />
    </MemoryRouter>,
  )

const pane = (dialog: HTMLElement) => dialog.querySelector('.mkt-step-pane') as HTMLElement
const stepCheck = (dialog: HTMLElement) => dialog.querySelector('.mkt-steps__num .mkt-steps__check')
const heroCheck = (dialog: HTMLElement) => dialog.querySelector('.mkt-done-hero__icon > span')

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
  useSession.setState({
    user: me,
    status: 'ready',
    tenancy: { teams: [], singleTeamMode: false, canCreateTeam: true, demoMode: false, pluginsEnabled: true },
  })
  useWorkspace.setState({ notifCount: 0, groups: [group] })
})
afterEach(() => vi.unstubAllGlobals())

describe('添加弹窗动效', () => {
  it('slides step 2 in from the right and pops the step-1 check after adding', async () => {
    mockApi({
      'PUT /groups/g1/installs/l1': {},
      'GET /market/l1/readiness?scope=group&scopeId=g1': ready(),
    })
    renderDialog()
    const dialog = await screen.findByRole('dialog')
    expect(pane(dialog).className).toBe('mkt-step-pane')

    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(await within(dialog).findByText('已就绪，可以用了')).toBeTruthy()
    expect(pane(dialog).classList.contains('mkt-step-pane--fwd')).toBe(true)
    expect(stepCheck(dialog)?.classList.contains('ui-check-pop')).toBe(true)
    expect(dialog.querySelector('.mkt-steps__line--done')).toBeTruthy()
    // Already ready the moment step 2 loaded: nothing was just finished, so the big check stays still.
    expect(heroCheck(dialog)?.classList.contains('ui-check-pop')).toBe(false)
  })

  it('opening straight into step 2 neither slides nor pops', async () => {
    mockApi({ 'GET /market/l1/readiness?scope=group&scopeId=g1': ready() })
    renderDialog({ scope: 'group', scopeId: 'g1', label: '支付核心群' })
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('已就绪，可以用了')).toBeTruthy()
    expect(pane(dialog).className).toBe('mkt-step-pane')
    expect(stepCheck(dialog)?.classList.contains('ui-check-pop')).toBe(false)
    expect(heroCheck(dialog)?.classList.contains('ui-check-pop')).toBe(false)
  })

  it('pops the ready check only when the user just finished the last pending step', async () => {
    let allowed = false
    mockApi({
      'GET /market/l1/readiness?scope=group&scopeId=g1': () => (allowed ? ready() : pendingTrust),
      'POST /market/l1/readiness/action': () => {
        allowed = true
        return { ok: true, notified: true }
      },
    })
    renderDialog({ scope: 'group', scopeId: 'g1', label: '支付核心群' })
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: '立即允许' }))
    expect(await within(dialog).findByText('已就绪，可以用了')).toBeTruthy()
    expect(heroCheck(dialog)?.classList.contains('ui-check-pop')).toBe(true)
  })
})

describe('市场列表动效', () => {
  it('staggers cards only on first arrival; back from a detail the list just fades in', async () => {
    mockApi({
      'GET /market': [view(), view({ id: 'l2', title: '幻灯片', scene: 'create' })],
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/l1': {
        ...view(),
        readme: '',
        permissions: [],
        mcp: [],
        secretSpecs: [],
        files: [],
        versions: [],
        ghSource: null,
        canEdit: false,
      } as unknown as MarketListingDetailDto,
    })
    const { container } = render(
      <MemoryRouter initialEntries={['/market?tab=catalog&scene=all']}>
        <MarketPage />
      </MemoryRouter>,
    )
    const list = await screen.findByRole('list', { name: '插件列表' })
    expect(list.classList.contains('mkt-cards--intro')).toBe(true)
    expect(container.querySelector('.mkt-view')?.className).toBe('mkt-view')
    await waitFor(
      () =>
        expect(screen.getByRole('list', { name: '插件列表' }).classList.contains('mkt-cards--intro')).toBe(
          false,
        ),
      { timeout: 2000 },
    )

    fireEvent.click(screen.getByRole('button', { name: '查看 代码评审助手' }))
    await screen.findByRole('tab', { name: '概览' })
    expect(container.querySelector('.mkt-view')?.classList.contains('mkt-view--detail')).toBe(true)
    expect(container.querySelector('.mkt-detail-cols')?.classList.contains('ui-panel-swap')).toBe(false)

    fireEvent.click(screen.getByRole('tab', { name: '开发者信息' }))
    expect(screen.getByRole('region', { name: '开发者信息' }).classList.contains('ui-panel-swap')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '插件市场' }))
    const back = await screen.findByRole('list', { name: '插件列表' })
    expect(back.classList.contains('mkt-cards--intro')).toBe(false)
    expect(container.querySelector('.mkt-view')?.classList.contains('mkt-view--fade')).toBe(true)
  })
})
