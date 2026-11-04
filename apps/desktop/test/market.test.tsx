import type { InstallDto, ListingSummary, MarketListingDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { MarketPage } from '../src/pages/Market'

const m = vi.mocked(ipc)

const summary = (over: Partial<ListingSummary>): ListingSummary => ({
  id: 'l1',
  type: 'skill',
  name: 'wiki',
  title: 'wiki',
  description: '查团队知识库',
  layer: 'team',
  status: 'listed',
  versionId: 'v3',
  revision: 3,
  ...over,
})

const install = (over: Partial<InstallDto> & { listing: ListingSummary }): InstallDto => ({
  scope: 'user',
  enabled: true,
  pinVersionId: null,
  resolvedVersionId: 'v3',
  resolvedRevision: 3,
  updatedBy: '王磊',
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
})

const listing = (over: Partial<MarketListingDto>): MarketListingDto => ({
  ...summary({}),
  source: 'team',
  visibility: 'team',
  teamId: 't1',
  teamName: '默认团队',
  author: '安',
  agents: [],
  listedVersionId: 'v3',
  listedRevision: 3,
  installs: 12,
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
})

beforeEach(() => vi.clearAllMocks())

const go = () => {}

it('lists personal skills with version, switch state and listing status, and the market read-only', async () => {
  m.marketInstalls.mockResolvedValue([
    install({ listing: summary({ id: 'l1', title: 'wiki' }) }),
    install({
      listing: summary({ id: 'l2', title: 'lint', status: 'unlisted' }),
      pinVersionId: 'v1',
      resolvedRevision: 1,
      enabled: false,
    }),
    install({ listing: summary({ id: 'l3', title: 'deploy', status: 'banned' }) }),
  ])
  m.marketListings.mockResolvedValue([
    listing({
      id: 'l1',
      title: 'wiki',
      description: '查团队知识库',
      author: '安',
      teamName: '默认团队',
      installs: 12,
    }),
  ])
  render(<MarketPage go={go} />)

  const wiki = (await screen.findByText('wiki', { selector: '.dk-mine .dk-strong' })).closest(
    '.dk-row',
  ) as HTMLElement
  expect(within(wiki).getByText('跟随最新')).toBeTruthy()
  expect(within(wiki).getByText('已启用')).toBeTruthy()
  expect(within(wiki).getByText('Skill')).toBeTruthy()
  const lint = screen.getByText('lint').closest('.dk-row') as HTMLElement
  expect(within(lint).getByText('锁定 r1')).toBeTruthy()
  expect(within(lint).getByText('已停用')).toBeTruthy()
  expect(within(lint).getByText('已下架')).toBeTruthy()
  expect(
    within(screen.getByText('deploy').closest('.dk-row') as HTMLElement).getByText('已封禁'),
  ).toBeTruthy()

  const card = screen
    .getByText('wiki', { selector: '.dk-market .dk-strong' })
    .closest('.dk-row') as HTMLElement
  expect(within(card).getByText('查团队知识库')).toBeTruthy()
  expect(within(card).getByText('安 · 默认团队 · 12 次安装')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('button', { name: /引入|发布|审核/ })).toBeNull()

  fireEvent.click(screen.getAllByRole('button', { name: '在网页中打开' })[0] as HTMLElement)
  expect(m.openMarketInWeb).toHaveBeenCalledOnce()
})

it('shows empty states that open the web market', async () => {
  m.marketInstalls.mockResolvedValue([])
  m.marketListings.mockResolvedValue([])
  render(<MarketPage go={go} />)

  expect(await screen.findByText('还没有个人 Skill')).toBeTruthy()
  expect(screen.getByText('市场里还没有条目')).toBeTruthy()
  const buttons = screen.getAllByRole('button', { name: '在网页中打开' })
  expect(buttons.length).toBe(3)
  fireEvent.click(buttons[1] as HTMLElement)
  expect(m.openMarketInWeb).toHaveBeenCalledOnce()
})

it('shows the error when the server cannot be reached', async () => {
  m.marketInstalls.mockRejectedValue('尚未绑定')
  m.marketListings.mockRejectedValue('尚未绑定')
  render(<MarketPage go={go} />)

  expect((await screen.findAllByText('尚未绑定')).length).toBeGreaterThan(0)
})
