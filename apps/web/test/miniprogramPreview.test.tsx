import type { GroupPreviewsDto, PreviewDto } from '@gonggong/protocol'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { PreviewCard } from '../src/features/previews/PreviewCard'
import { PreviewTags } from '../src/features/previews/PreviewTags'
import { resetPreviews } from '../src/features/previews/store'
import { MiniprogramTab, useMiniprogramTabMeta } from '../src/features/workbench/tabs/MiniprogramTab'
import { mockApi } from './mockApi'

const preview = (o: Partial<PreviewDto> = {}): PreviewDto => ({
  id: 'p2',
  groupId: 'g1',
  groupName: '支付重构',
  botId: 'b1',
  botName: '小王的 Claude',
  kind: 'miniprogram',
  title: '商城',
  path: '/pages/goods/detail?id=42',
  serviceId: null,
  serviceName: null,
  port: null,
  snapshotAt: '2026-09-28T10:00:00Z',
  status: 'online',
  awaiting: null,
  snapshotError: null,
  canManage: false,
  createdAt: '2026-09-27T10:00:00Z',
  ...o,
})
const list = (previews: PreviewDto[]): GroupPreviewsDto => ({ previews, services: [], manageableBotIds: [] })
const tab: Extract<WorkbenchTab, { kind: 'miniprogram' }> = { kind: 'miniprogram', previewId: 'p2' }

class NoopSocket {
  close() {}
}

beforeEach(() => {
  resetPreviews()
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  vi.stubGlobal('WebSocket', NoopSocket)
})
afterEach(() => vi.unstubAllGlobals())

describe('小程序预览卡片', () => {
  it('shows the simulator and its page, opens in the workbench, never as a web page or public link', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview({ canManage: true })]) })
    render(<PreviewCard previewId="p2" groupId="g1" botId="b1" fallback="预览：商城" />)
    const shot = await screen.findByRole('img', { name: '商城 模拟器' })
    expect(shot.getAttribute('src')).toContain('/api/previews/p2/snapshot')
    expect(screen.getByText('小程序 · /pages/goods/detail?id=42')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '打开' })).toBeNull()
    expect(screen.queryByRole('button', { name: '公开链接' })).toBeNull()
    expect(screen.getByRole('button', { name: '关闭预览' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '在工作台打开' }))
    expect(useWorkbench.getState().benches.g1?.tabs).toEqual([tab])
  })

  it('is pinned above the composer without a port', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    render(<PreviewTags groupId="g1" />)
    const tag = await screen.findByRole('button', { name: /商城/ })
    expect(tag.textContent).not.toContain(':')
  })
})

describe('小程序 · 开发者工具未登录', () => {
  const login = (canManage: boolean) => preview({ awaiting: 'login', canManage })

  it('shows the login code to managers on the card and in the workbench', async () => {
    mockApi({ 'GET /groups/g1/previews': list([login(true)]) })
    render(<PreviewCard previewId="p2" groupId="g1" botId="b1" fallback="预览：商城" />)
    const code = await screen.findByRole('img', { name: '微信开发者工具登录二维码' })
    expect(code.getAttribute('src')).toContain('/api/previews/p2/snapshot')
    expect(screen.getByText('微信开发者工具未登录，请用微信扫码登录')).toBeTruthy()
  })

  it('members only learn that the bot owner has to log in', async () => {
    mockApi({ 'GET /groups/g1/previews': list([login(false)]) })
    render(<MiniprogramTab tab={tab} tabKey="mp:p2" active />)
    await screen.findByText('等待 Bot 主人登录微信开发者工具')
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('小程序 · 截图失败', () => {
  const failed = preview({ snapshotAt: null, snapshotError: '本机的微信开发者工具未运行' })

  it('says why on the card and in the workbench', async () => {
    mockApi({ 'GET /groups/g1/previews': list([failed]) })
    render(
      <>
        <PreviewCard previewId="p2" groupId="g1" botId="b1" fallback="预览：商城" />
        <MiniprogramTab tab={tab} tabKey="mp:p2" active />
      </>,
    )
    expect(await screen.findAllByText('本机的微信开发者工具未运行')).toHaveLength(2)
    expect(screen.queryByText('正在截取模拟器画面…')).toBeNull()
  })
})

describe('工作台 · 小程序', () => {
  it('shows the latest screenshot; managers refresh it or switch the page', async () => {
    const calls = mockApi({
      'GET /groups/g1/previews': list([preview({ canManage: true })]),
      'POST /previews/p2/snapshot': undefined,
    })
    render(<MiniprogramTab tab={tab} tabKey="mp:p2" active />)
    expect((await screen.findByRole('img', { name: '商城 模拟器' })).getAttribute('src')).toContain('v=2026')
    const page = screen.getByRole('textbox', { name: '页面' }) as HTMLInputElement
    expect(page.value).toBe('pages/goods/detail?id=42')

    fireEvent.click(screen.getByRole('button', { name: '刷新截图' }))
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/previews/p2/snapshot' }))
    expect(calls.at(-1)?.body).toBeUndefined()

    fireEvent.change(page, { target: { value: 'pages/me/me' } })
    fireEvent.keyDown(page, { key: 'Enter' })
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ path: '/pages/me/me' }))
  })

  it('members only look', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    render(<MiniprogramTab tab={tab} tabKey="mp:p2" active />)
    await screen.findByRole('img', { name: '商城 模拟器' })
    expect(screen.queryByRole('button', { name: '刷新截图' })).toBeNull()
    expect((screen.getByRole('textbox', { name: '页面' }) as HTMLInputElement).readOnly).toBe(true)
  })

  it('labels the tab with the preview and its state', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview({ status: 'offline' })]) })
    const { result } = renderHook(() => useMiniprogramTabMeta(tab))
    await waitFor(() =>
      expect(result.current).toEqual({ icon: 'smartphone', title: '商城', status: 'offline' }),
    )
  })
})
