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
  banReason: null,
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

it('lists my skills with version status, ban reasons and listing status, and the market read-only', async () => {
  m.marketInstalls.mockResolvedValue([
    install({ listing: summary({ id: 'l1', title: 'wiki' }) }),
    install({
      listing: summary({ id: 'l2', title: 'lint', status: 'unlisted' }),
      pinVersionId: 'v1',
      resolvedRevision: 1,
      enabled: false,
    }),
    install({ listing: summary({ id: 'l3', title: 'deploy', status: 'banned' }), banReason: '含恶意脚本' }),
    install({
      listing: summary({ id: 'l4', title: 'fmt', revision: 5 }),
      pinVersionId: 'v2',
      resolvedRevision: 2,
    }),
  ])
  m.marketListings.mockResolvedValue([
    listing({
      id: 'l1',
      title: 'wiki',
      description: '查团队知识库',
      author: '安',
      teamName: '默认团队',
      installs: 12,
      installedIn: [{ scope: 'user', scopeId: 'u1', label: '' }],
    }),
    listing({ id: 'l9', title: 'review', description: '审查 diff', installedIn: [] }),
  ])
  render(<MarketPage go={go} />)

  expect(await screen.findByRole('heading', { name: '我的 Skill' })).toBeTruthy()
  const wiki = (await screen.findByText('wiki', { selector: '.dk-mine .dk-strong' })).closest(
    '.dk-row',
  ) as HTMLElement
  expect(within(wiki).getByText('跟随最新 · r3')).toBeTruthy()
  expect(within(wiki).getByText('已启用')).toBeTruthy()
  expect(within(wiki).getByText('Skill')).toBeTruthy()
  const lint = screen.getByText('lint').closest('.dk-row') as HTMLElement
  expect(within(lint).getByText('锁定 r1')).toBeTruthy()
  expect(within(lint).getByText('已停用')).toBeTruthy()
  expect(within(lint).getByText('已下架')).toBeTruthy()
  expect(within(lint).getByText('已下架：继续使用 r1，不会再有新版本')).toBeTruthy()
  const deploy = screen.getByText('deploy').closest('.dk-row') as HTMLElement
  expect(within(deploy).getByText('已封禁')).toBeTruthy()
  expect(within(deploy).getByText('封禁原因：含恶意脚本。下一轮起停止加载，建议移除')).toBeTruthy()
  expect(
    within(screen.getByText('fmt').closest('.dk-row') as HTMLElement).getByText('有新版本 r5'),
  ).toBeTruthy()

  const card = screen
    .getByText('wiki', { selector: '.dk-market .dk-strong' })
    .closest('.dk-row') as HTMLElement
  expect(within(card).getByText('查团队知识库')).toBeTruthy()
  expect(within(card).getByText('安 · 默认团队 · 12 次引入')).toBeTruthy()
  expect(within(card).getByText('已引入')).toBeTruthy()
  expect(
    within(screen.getByText('review').closest('.dk-row') as HTMLElement).queryByText('已引入'),
  ).toBeNull()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('button', { name: /引入到|发布|审核/ })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '在网页中打开' }))
  expect(m.openMarketInWeb).toHaveBeenCalledWith()
})

it('filters both lists by the search text', async () => {
  m.marketInstalls.mockResolvedValue([install({ listing: summary({ id: 'l1', title: 'wiki' }) })])
  m.marketListings.mockResolvedValue([
    listing({ id: 'l1', title: 'wiki' }),
    listing({ id: 'l9', title: 'review', description: '审查 diff' }),
  ])
  render(<MarketPage go={go} />)
  await screen.findByText('review')

  fireEvent.change(screen.getByRole('searchbox', { name: '搜索 Skill 和插件' }), {
    target: { value: 'DIFF' },
  })
  expect(screen.getByText('review')).toBeTruthy()
  expect(screen.queryByText('wiki')).toBeNull()
  expect(screen.getByText('「我的 Skill」里没有匹配的条目')).toBeTruthy()

  fireEvent.change(screen.getByRole('searchbox', { name: '搜索 Skill 和插件' }), { target: { value: 'zzz' } })
  expect(screen.getByText('没有匹配的条目')).toBeTruthy()
})

it('opens a read-only detail of a listing that links to it on the web', async () => {
  m.marketInstalls.mockResolvedValue([
    install({ listing: summary({ id: 'l3', title: 'deploy', status: 'banned' }), banReason: '含恶意脚本' }),
  ])
  m.marketListings.mockResolvedValue([
    listing({
      id: 'l1',
      title: 'wiki',
      description: '查团队知识库',
      agents: ['claude', 'codex'],
      installedIn: [
        { scope: 'user', scopeId: 'u1', label: '' },
        { scope: 'group', scopeId: 'g1', label: '支付核心群' },
      ],
    }),
  ])
  render(<MarketPage go={go} />)

  fireEvent.click(await screen.findByRole('button', { name: /^wiki/ }))
  const drawer = await screen.findByRole('dialog', { name: 'wiki' })
  expect(within(drawer).getByText('查团队知识库')).toBeTruthy()
  expect(within(drawer).getByText('r3')).toBeTruthy()
  expect(within(drawer).getByText('我的 Skill、支付核心群')).toBeTruthy()
  expect(within(drawer).getByText('claude、codex')).toBeTruthy()
  fireEvent.click(within(drawer).getByRole('button', { name: '在网页中查看详情' }))
  expect(m.openMarketInWeb).toHaveBeenCalledWith('l1')

  fireEvent.click(screen.getByRole('button', { name: /^deploy/ }))
  const banned = await screen.findByRole('dialog', { name: 'deploy' })
  expect(within(banned).getByText('封禁原因：含恶意脚本。下一轮起停止加载，建议移除')).toBeTruthy()
  fireEvent.click(within(banned).getByRole('button', { name: '在网页中查看详情' }))
  expect(m.openMarketInWeb).toHaveBeenLastCalledWith('l3')
})

it('shows empty states that open the web market', async () => {
  m.marketInstalls.mockResolvedValue([])
  m.marketListings.mockResolvedValue([])
  render(<MarketPage go={go} />)

  expect(await screen.findByText('「我的 Skill」里还没有条目')).toBeTruthy()
  expect(screen.getByText('市场里还没有条目')).toBeTruthy()
  const buttons = screen.getAllByRole('button', { name: '在网页中打开' })
  expect(buttons.length).toBe(3)
  fireEvent.click(buttons[1] as HTMLElement)
  expect(m.openMarketInWeb).toHaveBeenCalledOnce()
})

it('explains an unreachable server and reloads on 刷新', async () => {
  m.marketInstalls.mockRejectedValue(
    'error sending request for url (https://gg.example.com/api/daemon/me/installs)',
  )
  m.marketListings.mockRejectedValue('尚未绑定')
  render(<MarketPage go={go} />)

  expect(await screen.findByText('连不上服务器，请检查网络后刷新')).toBeTruthy()
  expect(screen.getByText('尚未绑定')).toBeTruthy()

  m.marketInstalls.mockResolvedValue([install({ listing: summary({ id: 'l1', title: 'wiki' }) })])
  m.marketListings.mockResolvedValue([])
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  expect(await screen.findByText('wiki')).toBeTruthy()
  expect(m.marketInstalls).toHaveBeenCalledTimes(2)
  expect(m.marketListings).toHaveBeenCalledTimes(2)
})
