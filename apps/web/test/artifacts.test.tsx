import type { ArtifactCard, ArtifactDto, ArtifactVersionDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { ArtifactCardView } from '../src/features/artifacts/ArtifactCard'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const at = '2026-10-29T10:00:00Z'
const version = (n: number, o: Partial<ArtifactVersionDto> = {}): ArtifactVersionDto => ({
  id: `v${n}`,
  artifactId: 'a1',
  n,
  parentVersionId: n > 1 ? `v${n - 1}` : null,
  source: 'run',
  runId: 'r1',
  userId: null,
  files: [],
  digest: 'a'.repeat(64),
  thumbnailUrl: null,
  stale: false,
  issues: [],
  createdAt: at,
  authorName: '设计助手',
  ...o,
})
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
  favorites: [],
  undoVersionId: 'v1',
  redoVersionId: null,
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
const ORIGIN = 'https://a1.preview.test'
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
    render(<ArtifactCardView card={card()} />)
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
    render(<ArtifactCardView card={card({ status: 'generating', versionN: null })} />)
    expect(screen.getByText('生成中')).toBeTruthy()
    expect(screen.queryByText(/^v\d/)).toBeNull()
  })

  it('flags a candidate version and design issues', () => {
    render(
      <ArtifactCardView card={card({ status: 'stale-candidate', issueCount: 2, thumbnailUrl: '/t.png' })} />,
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
      routes({ 'GET /artifacts/a1': artifact({ headVersionId: null, head: null, running: true }) }),
    )
    renderTab()
    expect(await screen.findByText('正在生成，第一版完成后显示在这里')).toBeTruthy()
    expect(calls.some((c) => c.path === '/artifacts/a1/preview')).toBe(false)
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

  it('selects screens: click, shift-click, ⌘A and Esc', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    expect(screen.queryByRole('toolbar', { name: '所选屏幕' })).toBeNull()
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.getByTestId('art-select-home').textContent).toContain('390 x 844')
    expect(screen.queryByTestId('art-select-detail')).toBeNull()
    const bar = screen.getByRole('toolbar', { name: '所选屏幕' })
    for (const name of ['生成', '修改', '预览', '更多'])
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

  it('lists planned tools disabled, as coming soon', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByTestId('art-node-home'))
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(screen.getByRole('menuitem', { name: /显示二维码/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '上传到画布' }).hasAttribute('disabled')).toBe(true)
  })

  it('switches tools with V and H; the hand does not select', async () => {
    mockApi(routes())
    renderTab()
    await screen.findByTitle('首页')
    const hand = screen.getByRole('button', { name: '抓手' })
    fireEvent.keyDown(canvas(), { key: 'h' })
    expect(hand.getAttribute('aria-pressed')).toBe('true')
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
})
