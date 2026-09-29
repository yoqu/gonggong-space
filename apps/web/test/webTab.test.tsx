import type { GroupPreviewsDto, PreviewDto } from '@gonggong/protocol'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { resetPreviews } from '../src/features/previews/store'
import { useWebTabMeta, WebTab } from '../src/features/workbench/tabs/WebTab'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const preview = (o: Partial<PreviewDto> = {}): PreviewDto => ({
  id: 'p1',
  groupId: 'g1',
  groupName: '支付重构',
  botId: 'b1',
  botName: '小王的 Claude',
  kind: 'http',
  title: '登录页',
  path: '/login',
  serviceId: 'sv1',
  serviceName: 'web',
  port: 5173,
  snapshotAt: null,
  status: 'online',
  awaiting: null,
  snapshotError: null,
  live: null,
  canManage: false,
  createdAt: '2026-09-27T10:00:00Z',
  ...o,
})
const list = (previews: PreviewDto[]): GroupPreviewsDto => ({ previews, services: [], manageableBotIds: [] })
const tab: Extract<WorkbenchTab, { kind: 'web' }> = { kind: 'web', previewId: 'p1', path: '/login' }
const current = () => {
  const s = useWorkbench.getState()
  return s.benches.g1?.tabs.find((t) => t.kind === 'web' && t.previewId === 'p1')
}
const frame = () => screen.getByTitle('登录页') as HTMLIFrameElement

let push: ((e: never) => void) | undefined
const emit = (previews: PreviewDto[]) =>
  act(() => push!({ t: 'group.previews', groupId: 'g1', previews, services: [] } as never))

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  resetPreviews()
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
    push = h as never
    return () => {}
  })
  useWorkbench.setState({ groupId: 'g1', open: true, mode: 'focus', previous: 'split', benches: {} })
  useWorkbench.getState().show(tab)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('web tab', () => {
  it('embeds the preview through the main site and keeps the frame while hidden', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    const { rerender } = render(<WebTab tab={tab} tabKey="web:p1" active />)
    const el = await screen.findByTitle('登录页')
    expect(el.getAttribute('src')).toBe('/api/previews/p1/open?path=%2Flogin')
    expect(screen.getByRole('link', { name: '新窗口打开' }).getAttribute('href')).toBe(
      '/api/previews/p1/open?path=%2Flogin',
    )
    expect(screen.getByText('在线')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '公开链接…' })).toBeNull()
    rerender(<WebTab tab={tab} tabKey="web:p1" active={false} />)
    rerender(<WebTab tab={tab} tabKey="web:p1" active />)
    expect(frame()).toBe(el)
  })

  it('刷新 remounts the frame', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    render(<WebTab tab={tab} tabKey="web:p1" active />)
    const el = await screen.findByTitle('登录页')
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(frame()).not.toBe(el)
    expect(frame().getAttribute('src')).toBe('/api/previews/p1/open?path=%2Flogin')
  })

  it('enters a new path: patches the tab and reloads the frame there', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    const { rerender } = render(<WebTab tab={tab} tabKey="web:p1" active />)
    await screen.findByTitle('登录页')
    const input = screen.getByRole('textbox', { name: '进入路径' })
    fireEvent.change(input, { target: { value: 'dashboard?x=1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(current()).toMatchObject({ path: '/dashboard?x=1' })
    rerender(<WebTab tab={current() as typeof tab} tabKey="web:p1" active />)
    expect(frame().getAttribute('src')).toBe('/api/previews/p1/open?path=%2Fdashboard%3Fx%3D1')
  })

  it('shows the offline state and reloads once the preview is back online', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview({ status: 'offline' })]) })
    render(<WebTab tab={tab} tabKey="web:p1" active />)
    await screen.findByText('服务已停止 · 等待 Bot 重新发布')
    expect(screen.queryByTitle('登录页')).toBeNull()
    emit([preview()])
    expect(frame().getAttribute('src')).toBe('/api/previews/p1/open?path=%2Flogin')
  })

  it('shows 预览已关闭 with a close-tab button once the preview is gone', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    render(<WebTab tab={tab} tabKey="web:p1" active />)
    await screen.findByTitle('登录页')
    emit([])
    expect(screen.getByText('预览已关闭')).toBeTruthy()
    expect(screen.queryByTitle('登录页')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭标签页' }))
    expect(current()).toBeUndefined()
  })

  it('offers 公开链接… to managers', async () => {
    mockApi({
      'GET /groups/g1/previews': list([preview({ canManage: true })]),
      'GET /previews/p1/shares': [],
    })
    render(<WebTab tab={tab} tabKey="web:p1" active />)
    fireEvent.click(await screen.findByRole('button', { name: '公开链接…' }))
    expect(screen.getByRole('dialog', { name: /公开链接 · 登录页/ })).toBeTruthy()
  })

  describe('viewport presets', () => {
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(720)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    })

    it('scales a fixed width down to fit and remembers the preset per preview', async () => {
      mockApi({ 'GET /groups/g1/previews': list([preview()]) })
      const { unmount } = render(<WebTab tab={tab} tabKey="web:p1" active />)
      await screen.findByTitle('登录页')
      expect(frame().style.transform).toBe('')
      fireEvent.click(screen.getByRole('radio', { name: '1440' }))
      expect(frame().style.width).toBe('1440px')
      expect(frame().style.height).toBe('1200px')
      expect(frame().style.transform).toBe('scale(0.5)')
      fireEvent.click(screen.getByRole('radio', { name: '390' }))
      expect(frame().style.width).toBe('390px')
      expect(frame().style.transform).toBe('scale(1)')
      unmount()
      render(<WebTab tab={tab} tabKey="web:p1" active />)
      await screen.findByTitle('登录页')
      expect(screen.getByRole('radio', { name: '390' }).getAttribute('aria-checked')).toBe('true')
    })
  })
})

describe('useWebTabMeta', () => {
  it('names the tab after the preview and shows its state', async () => {
    mockApi({ 'GET /groups/g1/previews': list([preview()]) })
    const { result } = renderHook(() => useWebTabMeta(tab))
    expect(result.current).toMatchObject({ icon: 'desktop', title: '预览' })
    await vi.waitFor(() =>
      expect(result.current).toEqual({ icon: 'desktop', title: '登录页', status: 'online' }),
    )
    emit([])
    expect(result.current).toEqual({ icon: 'desktop', title: '预览', status: 'offline' })
  })
})
