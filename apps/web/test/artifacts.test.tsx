import type { ArtifactCard, ArtifactDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { ArtifactCardView } from '../src/features/artifacts/ArtifactCard'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { ORIGIN, versionAt } from './artifactFixtures'
import { mockApi } from './mockApi'

const at = '2026-10-29T10:00:00Z'
const version = versionAt(at)
const { files: _, ...head } = version(2)
const artifact = (o: Partial<ArtifactDto> = {}): ArtifactDto => ({
  id: 'a1',
  groupId: 'g1',
  title: '读书会小程序',
  dir: 'design/app-screens-ab12',
  pluginId: 'p1',
  pluginVersionId: 'pv1',
  designSystemId: null,
  headVersionId: 'v2',
  head,
  manifest: {
    title: '读书会小程序',
    device: 'mobile',
    entry: 'home',
    screens: [
      { id: 'home', title: '首页', file: 'screens/home.html' },
      { id: 'detail', title: '书籍详情', file: 'screens/detail.html' },
    ],
  },
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  running: false,
  queued: false,
  queuedRunCount: 0,
  favorites: [],
  botId: null,
  undoVersionId: 'v1',
  redoVersionId: null,
  visibility: 'group',
  createdBy: null,
  kind: 'prototype',
  ...o,
})
const card = (o: Partial<ArtifactCard> = {}): ArtifactCard => ({
  type: 'artifact',
  artifactId: 'a1',
  title: '读书会小程序',
  versionN: 3,
  status: 'ready',
  thumbnailUrl: null,
  issueCount: 0,
  ...o,
})

const routes = (o: Record<string, unknown> = {}) => ({
  'GET /artifacts/a1': artifact(),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
  ...o,
})
const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }
const renderTab = () => render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
const canvas = () => screen.getByRole('application', { name: '画布' })
const zoomLabel = () => screen.getByRole('button', { name: '缩放' }).textContent

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  resetArtifacts()
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('artifact card', () => {
  it('shows a ready version and opens the canvas tab in focus mode', () => {
    render(<ArtifactCardView card={card()} groupId="g1" />)
    const c = within(screen.getByTestId('artifact-card'))
    expect(c.getByText('读书会小程序')).toBeTruthy()
    expect(c.getByText('v3')).toBeTruthy()
    expect(c.getByText('就绪')).toBeTruthy()
    fireEvent.click(c.getByRole('button', { name: '打开' }))
    const s = useWorkbench.getState()
    expect(s.benches.g1?.tabs).toEqual([tab])
    expect(s.benches.g1?.active).toBe('artifact:a1')
    expect(s.open).toBe(true)
    expect(s.mode).toBe('focus')
  })

  it('says it is generating before the first version', () => {
    render(<ArtifactCardView card={card({ status: 'generating', versionN: null })} groupId="g1" />)
    expect(screen.getByText('生成中')).toBeTruthy()
    expect(screen.queryByText(/^v\d/)).toBeNull()
  })

  it('flags a candidate version and design issues', () => {
    render(
      <ArtifactCardView
        card={card({ status: 'stale-candidate', issueCount: 2, thumbnailUrl: '/t.png' })}
        groupId="g1"
      />,
    )
    expect(screen.getByText('有候选版本')).toBeTruthy()
    expect(screen.getByText('2 项规范问题')).toBeTruthy()
    expect(screen.getByRole('img', { name: '读书会小程序 缩略图' }).getAttribute('src')).toBe('/t.png')
  })
})

describe('artifact tab', () => {
  it('lays the head version’s screens out through the preview', async () => {
    const calls = mockApi(routes())
    renderTab()
    const home = (await screen.findByTitle('首页')) as HTMLIFrameElement
    expect(home.getAttribute('src')).toBe('/api/previews/pw1/open?path=%2Fscreens%2Fhome.html')
    expect(screen.getByTitle('书籍详情')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '读书会小程序' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '版本' }).textContent).toContain('v2')
    expect(calls).toContainEqual({ method: 'POST', path: '/artifacts/a1/preview', body: {} })
    // Mobile screens are 390 wide, laid side by side.
    expect(screen.getByTestId('art-node-detail').style.left).toBe('510px')
  })

  it('shows placeholders until the first version arrives', async () => {
    const calls = mockApi(
      routes({
        'GET /artifacts/a1': artifact({ headVersionId: null, head: null, running: true }),
        'POST /artifacts/a1/chat': {
          rootId: 'chat-root',
          group: { id: 'g1', kind: 'works', name: '作品空间', members: [], botIds: [] },
        },
      }),
    )
    renderTab()
    expect(await screen.findByText('正在生成，第一版完成后显示在这里')).toBeTruthy()
    expect(await screen.findByTestId('art-composer')).toBeTruthy()
    expect(calls.some((c) => c.path === '/artifacts/a1/preview')).toBe(false)
  })

  it('an empty work keeps its canvas, tools and AI chat: editing waits for the first version', async () => {
    const calls = mockApi(
      routes({
        'GET /artifacts/a1': artifact({ headVersionId: null, head: null, manifest: null, running: false }),
        'GET /artifacts/a1/versions': [],
        'POST /artifacts/a1/chat': {
          rootId: 'chat-root',
          group: { id: 'g1', kind: 'works', name: '作品空间', members: [], botIds: [] },
        },
      }),
    )
    renderTab()
    expect(await screen.findByRole('application', { name: '画布' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '上传到画布' })).toHaveProperty('disabled', true)
    expect(screen.getByText('在下方对话框里说要做什么，AI 会做出第一版')).toBeTruthy()
    expect(screen.queryByText('正在生成，第一版完成后显示在这里')).toBeNull()
    await waitFor(() =>
      expect(document.querySelector('.composer textarea, .composer [contenteditable]')).toBeTruthy(),
    )
    expect(calls.some((c) => c.path === '/artifacts/a1/preview')).toBe(false)
  })

  it('an empty work can reopen a collapsed page rail', async () => {
    localStorage.setItem('gg.art.rail', '0')
    mockApi(
      routes({
        'GET /artifacts/a1': artifact({ headVersionId: null, head: null, manifest: null, running: false }),
        'GET /artifacts/a1/versions': [],
      }),
    )
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '展开侧栏' }))
    expect(localStorage.getItem('gg.art.rail')).toBe('1')
    localStorage.removeItem('gg.art.rail')
  })

  it('zooms from the menu and the keyboard', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    expect(zoomLabel()).toBe('100%')
    fireEvent.click(screen.getByRole('button', { name: '缩放' }))
    const menu = screen.getByRole('menu')
    expect(
      within(menu)
        .getByRole('menuitem', { name: /适应选中/ })
        .hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /放大/ }))
    expect(zoomLabel()).toBe('125%')
    fireEvent.keyDown(canvas(), { key: '-', metaKey: true })
    expect(zoomLabel()).toBe('100%')
    fireEvent.keyDown(canvas(), { key: '=', ctrlKey: true })
    fireEvent.keyDown(canvas(), { key: '=', ctrlKey: true })
    expect(zoomLabel()).toBe('156%')
    fireEvent.keyDown(canvas(), { key: ')', code: 'Digit0', shiftKey: true })
    expect(zoomLabel()).toBe('100%')
  })

  it('pinches with two fingers on a touch screen', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    const plane = screen.getByTestId('art-plane')
    const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', id: number, x: number) =>
      fireEvent[type](plane, { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: 100 })
    touch('pointerDown', 1, 90)
    touch('pointerDown', 2, 110)
    touch('pointerMove', 2, 130)
    expect(zoomLabel()).toBe('200%')
    touch('pointerUp', 1, 90)
    touch('pointerUp', 2, 130)
    expect(zoomLabel()).toBe('200%')
  })

  it('selects screens: click, shift-click, ⌘A and Esc', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    expect(screen.queryByTestId('art-selection-actions')).toBeNull()
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.getByTestId('art-select-home').textContent).toContain('390 x 844')
    expect(screen.queryByTestId('art-select-detail')).toBeNull()
    const bar = screen.getByTestId('art-selection-actions')
    for (const name of ['生成', '显示二维码', '下载'])
      expect(within(bar).getByRole('button', { name })).toBeTruthy()
    fireEvent.click(screen.getByTestId('art-node-detail'), { shiftKey: true })
    expect(screen.getByTestId('art-select-home')).toBeTruthy()
    expect(screen.getByTestId('art-select-detail')).toBeTruthy()
    fireEvent.click(screen.getByTestId('art-node-detail'))
    expect(screen.queryByTestId('art-select-home')).toBeNull()
    fireEvent.keyDown(canvas(), { key: 'Escape' })
    expect(screen.queryByTestId('art-select-detail')).toBeNull()
    fireEvent.keyDown(canvas(), { key: 'a', metaKey: true })
    expect(screen.getByTestId('art-select-home')).toBeTruthy()
    expect(screen.getByTestId('art-select-detail')).toBeTruthy()
    fireEvent.click(screen.getByTestId('art-plane'))
    expect(screen.queryByTestId('art-select-home')).toBeNull()
  })

  it('offers the QR code of a selected page, and upload to canvas on an editable version', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.getByRole('button', { name: '显示二维码' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '上传到画布' }).hasAttribute('disabled')).toBe(false)
  })

  it('switches tools with V and H (no hand button: space pans); the hand does not select', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    expect(screen.queryByRole('button', { name: '抓手' })).toBeNull()
    fireEvent.keyDown(canvas(), { key: 'h' })
    expect(screen.getByRole('button', { name: '选择' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.queryByTestId('art-select-home')).toBeNull()
    fireEvent.keyDown(canvas(), { key: 'v' })
    expect(screen.getByRole('button', { name: '选择' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.getByTestId('art-select-home')).toBeTruthy()
  })

  it('shows a past version read-only from the version menu', async () => {
    const calls = mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    const items = screen.getAllByRole('menuitemcheckbox')
    expect(items.map((i) => i.querySelector('.ui-menu__label')?.textContent)).toEqual(['v2（当前）', 'v1'])
    expect(items[1]?.textContent).toContain('AI 生成 · 设计助手')
    fireEvent.click(items[1] as HTMLElement)
    expect(await screen.findByText('正在查看 v1（只读）')).toBeTruthy()
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/artifacts/a1/preview',
        body: { versionId: 'v1' },
      }),
    )
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '回到当前版本' }))
    expect(screen.queryByText('正在查看 v1（只读）')).toBeNull()
  })

  it('undoes and redoes to the server’s targets', async () => {
    const calls = mockApi(
      routes({
        'GET /artifacts/a1': artifact({ undoVersionId: 'v1', redoVersionId: null }),
        'POST /artifacts/a1/versions/v1/restore': artifact({ headVersionId: 'v1' }),
      }),
    )
    renderTab()
    await screen.findByTitle('首页')
    expect(screen.getByRole('button', { name: '重做' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/artifacts/a1/versions/v1/restore',
        body: undefined,
      }),
    )
    // Reloaded after the restore.
    await waitFor(() => expect(calls.filter((c) => c.path === '/artifacts/a1').length).toBe(2))
  })

  it('opens the shortcut sheet with ?', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    act(() => {
      fireEvent.keyDown(canvas(), { key: '?' })
    })
    const dialog = await screen.findByRole('dialog', { name: '快捷键' })
    expect(within(dialog).getByText('适应画布')).toBeTruthy()
    expect(within(dialog).getByText('平移（按住）')).toBeTruthy()
  })

  it('renders a hosted site as a full-bleed iframe without canvas controls or AI composer', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    mockApi(
      routes({
        'GET /artifacts/a1': artifact({
          title: '活动官网',
          manifest: null,
          site: true,
        }),
      }),
    )
    const { container } = renderTab()
    const frame = await waitFor(() => {
      const el = container.querySelector('iframe.art-site__frame') as HTMLIFrameElement | null
      expect(el).toBeTruthy()
      return el!
    })
    expect(frame.getAttribute('title')).toBe('活动官网')
    expect(frame.getAttribute('src')).toBe('/api/previews/pw1/open')
    expect(screen.queryByRole('application', { name: '画布' })).toBeNull()
    expect(screen.queryByRole('button', { name: '预览原型' })).toBeNull()
    expect(screen.queryByRole('button', { name: '展开侧栏' })).toBeNull()
    expect(screen.getByRole('button', { name: '版本' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '分享' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全屏' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新窗口打开' }))
    expect(openSpy).toHaveBeenCalledWith('/api/previews/pw1/open', '_blank', 'noopener')
  })
})
