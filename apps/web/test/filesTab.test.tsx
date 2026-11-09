import type { Attachment, BotDto, FileTreeEntry, GroupDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { TabContent, TabLabel } from '../src/features/workbench/TabContent'
import { copyText } from '../src/lib/clipboard'
import { useToasts } from '../src/ui'

const office = vi.hoisted(() => ({
  docx: vi.fn(async (_data: ArrayBuffer, body: HTMLElement) => {
    body.innerHTML = '<p>周报正文</p>'
  }),
  pptx: vi.fn(),
  sheets: vi.fn(async () => [
    {
      sheet: '销量',
      data: [
        ['城市', '数量', '日期', '达标'],
        ['上海', 0.1 + 0.2, new Date(Date.UTC(2026, 10, 2)), true],
      ],
    },
    { sheet: '备注', data: [['只看第一页']] },
    { sheet: '空表', data: [] },
  ]),
}))
vi.mock('docx-preview', () => ({ renderAsync: office.docx }))
vi.mock('pptx-preview', () => ({
  init: (dom: HTMLElement, options: unknown) => ({
    preview: async (data: ArrayBuffer) => {
      office.pptx(dom, options, data)
      dom.innerHTML = '<section>第一页幻灯片</section>'
    },
    destroy: () => {},
  }),
}))
vi.mock('read-excel-file/universal', () => ({ default: office.sheets }))

const entry = (name: string, o: Partial<FileTreeEntry> = {}): FileTreeEntry => ({
  name,
  dir: false,
  size: 10,
  mtime: 0,
  uncommitted: false,
  ignored: false,
  ...o,
})

const TREES: Record<string, { entries: FileTreeEntry[]; truncated: boolean }> = {
  '': {
    entries: [entry('README.md'), entry('src', { dir: true, uncommitted: true })],
    truncated: false,
  },
  src: {
    entries: [entry('main.ts', { uncommitted: true }), entry('assets', { dir: true })],
    truncated: true,
  },
  'src/assets': {
    entries: [entry('logo.png'), entry('demo.mp4'), entry('song.mp3'), entry('doc.pdf')],
    truncated: false,
  },
}
const IGNORED = entry('node_modules', { dir: true, ignored: true })

const TEXTS: Record<string, { text: string | null; binary: boolean; size: number; mime: string }> = {
  'README.md': { text: '# 标题\n\n正文', binary: false, size: 14, mime: 'text/markdown' },
  'src/main.ts': { text: 'const a = 1\nconsole.log(a)\n', binary: false, size: 27, mime: 'text/plain' },
  'big.log': { text: null, binary: false, size: 3 * 1024 * 1024, mime: 'text/plain' },
  'data.bin': { text: null, binary: true, size: 2048, mime: 'application/octet-stream' },
  'index.html': { text: '<h1>hi</h1>', binary: false, size: 11, mime: 'text/html' },
  'long.txt': { text: 'x\n'.repeat(5001), binary: false, size: 10002, mime: 'text/plain' },
  'docs/guide.md': {
    text: [
      '# 指南',
      '![标志](../src/assets/logo.png) ![外面](../../secret.png) ![远程](https://example.com/a.png)',
      '## 安装',
      '见 [主程序](../src/main.ts)、[资源目录](../src/assets/)、[越界](../../x.md)、[官网](https://example.com)、[跳到使用](#使用-说明)',
      '## 使用 说明',
      '正文',
    ].join('\n\n'),
    binary: false,
    size: 200,
    mime: 'text/markdown',
  },
}

let calls: string[]
let treeFails = 0
beforeEach(() => {
  calls = []
  treeFails = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const u = new URL(url, 'http://x')
      const path = u.searchParams.get('path') ?? ''
      const json = (v: unknown) => new Response(JSON.stringify(v))
      if (u.pathname === '/api/groups/g1/bots/b1/files/tree') {
        if (treeFails > 0) {
          treeFails--
          return new Response(
            JSON.stringify({ error: 'conflict', message: '小王的 Claude 离线，无法读取文件' }),
            {
              status: 409,
            },
          )
        }
        const t = TREES[path] ?? { entries: [], truncated: false }
        const ignored = u.searchParams.get('ignored') === '1' && path === ''
        return json({ path, ...t, entries: ignored ? [...t.entries, IGNORED] : t.entries })
      }
      if (u.pathname === '/api/groups/g1/bots/b1/files/text') return json({ path, ...TEXTS[path] })
      if (u.pathname === '/api/groups/g1/candidates/files')
        return json({
          source: 'workspace',
          label: '小王的 Claude 工作区',
          entries: [{ path: 'src/main.ts', dir: false, uncommitted: true, notInWorkspace: false }],
        })
      if (u.pathname === '/api/attachments/a1') return new Response('line one\nERROR boom\n')
      if (u.pathname === '/api/groups/g1/bots/b1/files/raw' && path.startsWith('gone.'))
        return new Response(
          JSON.stringify({ error: 'conflict', message: '小王的 Claude 离线，无法读取文件' }),
          { status: 409 },
        )
      if (u.pathname === '/api/attachments/a2' || u.pathname === '/api/groups/g1/bots/b1/files/raw') {
        const size = path === 'huge.docx' ? 99 * 1024 * 1024 : 3
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': String(size) } })
      }
      return new Response('{}', { status: 404 })
    }),
  )
  useWorkspace.setState({ bots: [{ id: 'b1', name: '小王的 Claude' } as BotDto], botStates: {} })
  useWorkbench.setState({ groupId: 'g1', open: true, benches: {} })
  useToasts.setState({ items: [] })
})
afterEach(() => {
  localStorage.removeItem('gg.fv.wrap')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const current = () => useWorkbench.getState().benches.g1?.tabs ?? []
const filesTab = () => current().find((t) => t.kind === 'files') as Extract<WorkbenchTab, { kind: 'files' }>

function Bench() {
  const tabs = useWorkbench((s) => s.benches.g1?.tabs ?? [])
  return (
    <>
      {tabs.map((t) => (
        <section key={tabKey(t)} data-testid={tabKey(t)}>
          <TabLabel tab={t}>{(m) => <h2 data-icon={m.icon}>{m.title}</h2>}</TabLabel>
          <TabContent tab={t} active />
        </section>
      ))}
    </>
  )
}

const open = (t: WorkbenchTab) => {
  act(() => {
    useWorkbench.getState().show(t)
  })
  return render(<Bench />)
}
const openFiles = (o: Partial<Extract<WorkbenchTab, { kind: 'files' }>> = {}) =>
  open({ kind: 'files', botId: 'b1', dir: '', selected: null, ...o })
const fileTab = (path: string): WorkbenchTab => ({ kind: 'file', source: { botId: 'b1', path } })
const openFile = (...paths: string[]) => {
  act(() => {
    for (const p of paths.slice(0, -1)) useWorkbench.getState().show(fileTab(p))
  })
  return open(fileTab(paths.at(-1) as string))
}
const files = () => within(screen.getByTestId('files:b1'))
const tree = () => within(screen.getByRole('tree', { name: '文件' }))
const row = (name: RegExp) => tree().getByRole('treeitem', { name })
const raw = (p: string) => `/api/groups/g1/bots/b1/files/raw?path=${encodeURIComponent(p)}`

describe('files tab', () => {
  it('is titled after the bot with a folder icon', () => {
    openFiles()
    expect(screen.getByRole('heading').textContent).toBe('文件 · 小王的 Claude')
    expect(screen.getByRole('heading').dataset.icon).toBe('folder')
  })

  it('lists the root lazily, dirs first, with uncommitted marks; the ignored toggle refetches', async () => {
    openFiles()
    await screen.findByRole('treeitem', { name: /src/ })
    expect(calls.filter((c) => c.includes('/files/'))[0]).toBe('/api/groups/g1/bots/b1/files/tree?path=')
    const names = tree()
      .getAllByRole('treeitem')
      .map((r) => r.dataset.name)
    expect(names).toEqual(['src', 'README.md'])
    expect(within(row(/^src/)).getByTitle('未提交').textContent).toBe('M')
    expect(within(row(/README/)).queryByTitle('未提交')).toBeNull()
    expect(row(/README/).querySelector('svg[data-type="md"]')).toBeTruthy()
    expect(row(/^src/).querySelector('svg[data-type]')).toBeNull()
    expect(tree().queryByRole('treeitem', { name: /node_modules/ })).toBeNull()

    fireEvent.click(files().getByRole('checkbox', { name: '显示忽略的' }))
    expect(await tree().findByRole('treeitem', { name: /node_modules/ })).toBeTruthy()
    expect(calls).toContain('/api/groups/g1/bots/b1/files/tree?path=&ignored=1')
    expect(row(/node_modules/).dataset.ignored).toBe('true')
  })

  it('expands and collapses folders, keeping dir in the tab and noting truncation', async () => {
    openFiles()
    fireEvent.click(await screen.findByRole('treeitem', { name: /^src/ }))
    expect(await tree().findByRole('treeitem', { name: /main\.ts/ })).toBeTruthy()
    expect(calls).toContain('/api/groups/g1/bots/b1/files/tree?path=src')
    expect(row(/^src/).getAttribute('aria-expanded')).toBe('true')
    expect(filesTab().dir).toBe('src')
    expect(files().getByText(/已截断/)).toBeTruthy()

    fireEvent.click(row(/^src/))
    expect(tree().queryByRole('treeitem', { name: /main\.ts/ })).toBeNull()
    expect(filesTab().dir).toBe('')
  })

  it('selects a file into the tab and shows it with line numbers', async () => {
    openFiles()
    fireEvent.click(await screen.findByRole('treeitem', { name: /^src/ }))
    fireEvent.click(await tree().findByRole('treeitem', { name: /main\.ts/ }))
    expect(filesTab()).toMatchObject({ dir: 'src', selected: 'src/main.ts' })
    expect(await files().findByText('console.log(a)')).toBeTruthy()
    expect(calls).toContain('/api/groups/g1/bots/b1/files/text?path=src%2Fmain.ts')
    const line = files().getByText('console.log(a)').closest('.pv-line') as HTMLElement
    expect(line.querySelector('.pv-line__n')?.textContent).toBe('2')
    await waitFor(() => expect(line.querySelector('.hl')).toBeTruthy())
    expect(line.querySelector('.pv-line__t')?.textContent).toBe('console.log(a)')
    expect(row(/main\.ts/).getAttribute('aria-selected')).toBe('true')
  })

  it('reveals the selected file when opened from elsewhere, with clickable breadcrumbs', async () => {
    openFiles({ dir: 'src/assets', selected: 'src/assets/logo.png' })
    const logo = await tree().findByRole('treeitem', { name: /logo\.png/ })
    expect(logo.getAttribute('aria-selected')).toBe('true')
    const img = files().getByRole('img', { name: 'logo.png' }) as HTMLImageElement
    expect(img.getAttribute('src')).toBe(raw('src/assets/logo.png'))

    const crumbs = within(files().getByRole('navigation', { name: '路径' }))
    expect(crumbs.getAllByRole('button').map((b) => b.textContent)).toEqual(['工作区', 'src', 'assets'])
    fireEvent.click(crumbs.getByRole('button', { name: 'src' }))
    expect(filesTab().dir).toBe('src')
  })

  it('shows the server message when the workspace cannot be read, and retries', async () => {
    treeFails = 1
    openFiles()
    expect(await files().findByText('小王的 Claude 离线，无法读取文件')).toBeTruthy()
    fireEvent.click(files().getByRole('button', { name: '重试' }))
    expect(await tree().findByRole('treeitem', { name: /README/ })).toBeTruthy()
  })

  it('searches the workspace with the @ candidates lookup and opens a hit', async () => {
    openFiles()
    await screen.findByRole('treeitem', { name: /README/ })
    fireEvent.change(files().getByRole('searchbox', { name: '搜索文件' }), { target: { value: 'main' } })
    const hit = await files().findByRole('button', { name: /src\/main\.ts/ })
    expect(calls).toContain('/api/groups/g1/candidates/files?q=main&botId=b1')
    expect(hit.querySelector('svg[data-type="code"]')).toBeTruthy()
    fireEvent.click(hit)
    expect(filesTab()).toMatchObject({ dir: 'src', selected: 'src/main.ts' })
    expect(await tree().findByRole('treeitem', { name: /main\.ts/ })).toBeTruthy()
  })

  it('opens the viewed file in its own tab', async () => {
    openFiles({ dir: 'src', selected: 'src/main.ts' })
    await files().findByText('console.log(a)')
    fireEvent.click(files().getByRole('button', { name: '在新标签页打开' }))
    expect(current().at(-1)).toEqual({ kind: 'file', source: { botId: 'b1', path: 'src/main.ts' } })
  })

  it('collapses and expands the tree when wide, keeping the file in view', async () => {
    openFiles({ dir: 'src', selected: 'src/main.ts' })
    await files().findByText('console.log(a)')
    const toggle = files().getByRole('button', { name: '目录' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.queryByRole('tree', { name: '文件' })).toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('.pv-lines')?.textContent).toContain('console.log(a)')
    fireEvent.click(toggle)
    expect(screen.getByRole('tree', { name: '文件' })).toBeTruthy()
  })

  it('folds the tree into a toggleable panel when narrow', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
    openFiles({ dir: 'src', selected: 'src/main.ts' })
    await files().findByText('console.log(a)')
    expect(screen.queryByRole('tree', { name: '文件' })).toBeNull()
    fireEvent.click(files().getByRole('button', { name: '目录' }))
    fireEvent.click(await tree().findByRole('treeitem', { name: /README/ }))
    expect(screen.queryByRole('tree', { name: '文件' })).toBeNull()
    expect(filesTab().selected).toBe('README.md')
  })
})

describe('file viewer', () => {
  it('renders markdown with a source toggle', async () => {
    openFile('README.md')
    expect(screen.getByRole('heading', { name: 'README.md' }).dataset.icon).toBe('doc-text')
    expect(await screen.findByRole('heading', { name: '标题' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '源码' }))
    expect(screen.getByText('# 标题')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '在新标签页打开' })).toBeNull()
  })

  it('streams media from the raw route', () => {
    openFile('src/assets/demo.mp4', 'src/assets/song.mp3', 'src/assets/doc.pdf')
    expect(document.querySelector('video')?.getAttribute('src')).toBe(raw('src/assets/demo.mp4'))
    expect(document.querySelector('audio')?.getAttribute('src')).toBe(raw('src/assets/song.mp3'))
    expect(screen.getByTitle('doc.pdf').getAttribute('src')).toBe(raw('src/assets/doc.pdf'))
    expect(calls.some((c) => c.includes('/files/text'))).toBe(false)
  })

  it('switches images between fit and actual size', () => {
    openFile('src/assets/logo.png')
    const img = screen.getByRole('img', { name: 'logo.png' })
    expect(img.className).toContain('fv-img--fit')
    fireEvent.click(screen.getByRole('radio', { name: '1:1' }))
    expect(img.className).not.toContain('fv-img--fit')
  })

  it('opens a previewed image full screen', () => {
    openFile('src/assets/logo.png')
    fireEvent.click(screen.getByRole('button', { name: '全屏查看 logo.png' }))
    const box = screen.getByRole('dialog', { name: 'logo.png' })
    expect(within(box).getByRole('img', { name: 'logo.png' }).getAttribute('src')).toBe(
      raw('src/assets/logo.png'),
    )
    fireEvent.click(within(box).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers a download when the browser cannot show the media', () => {
    openFile('clip.mkv', 'photo.heic', 'voice.aac')
    const tab = (p: string) => within(screen.getByTestId(`file:b1:${p}`))
    const video = screen.getByTestId('file:b1:clip.mkv').querySelector('video') as HTMLVideoElement
    fireEvent.error(video)
    expect(tab('clip.mkv').getByText('浏览器无法播放此视频，可下载查看')).toBeTruthy()
    expect(screen.getByTestId('file:b1:clip.mkv').querySelector('video')).toBeNull()
    fireEvent.error(tab('photo.heic').getByRole('img', { name: 'photo.heic' }))
    expect(tab('photo.heic').getByText('浏览器无法显示此图片，可下载查看')).toBeTruthy()
    fireEvent.error(screen.getByTestId('file:b1:voice.aac').querySelector('audio') as HTMLAudioElement)
    expect(tab('voice.aac').getByText('浏览器无法播放此音频，可下载查看')).toBeTruthy()
    const links = tab('voice.aac').getAllByRole('link', { name: '下载' })
    expect(links.every((l) => l.getAttribute('href') === raw('voice.aac'))).toBe(true)
  })

  it('opens a pdf in the browser, where a frame shows only its first page on phones', () => {
    openFile('src/assets/doc.pdf')
    const link = screen.getByRole('link', { name: '在浏览器中打开' })
    expect(link.getAttribute('href')).toBe(raw('src/assets/doc.pdf'))
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('shows a page skeleton until the pdf frame loads, and its size from a HEAD', async () => {
    openFile('src/assets/doc.pdf')
    const frame = screen.getByTitle('doc.pdf')
    expect(screen.getByRole('status', { name: '正在加载 PDF…' })).toBeTruthy()
    expect(frame.closest('.fv-pdf')?.hasAttribute('data-loaded')).toBe(false)
    expect(await screen.findByText('PDF 文档 · 3 B')).toBeTruthy()
    expect(calls).toContain(raw('src/assets/doc.pdf'))
    fireEvent.load(frame)
    expect(screen.queryByRole('status', { name: '正在加载 PDF…' })).toBeNull()
    expect(frame.closest('.fv-pdf')?.hasAttribute('data-loaded')).toBe(true)
  })

  it('offers the browser and the download when a pdf is slow to load', () => {
    vi.useFakeTimers()
    try {
      openFile('src/assets/doc.pdf')
      expect(screen.queryByText('加载较慢，可在浏览器中打开或下载')).toBeNull()
      act(() => {
        vi.advanceTimersByTime(8000)
      })
      const wait = within(document.querySelector('.fv-pdf__wait') as HTMLElement)
      expect(wait.getByText('加载较慢，可在浏览器中打开或下载')).toBeTruthy()
      expect(wait.getByRole('link', { name: '在浏览器中打开' }).getAttribute('href')).toBe(
        raw('src/assets/doc.pdf'),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('says why a pdf cannot load instead of framing the error, and retries', async () => {
    openFile('gone.pdf')
    expect(await screen.findByText('无法加载 PDF')).toBeTruthy()
    expect(screen.getByText('小王的 Claude 离线，无法读取文件')).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    const before = calls.length
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
  })

  it('on touch screens gives a pdf card led by opening it in the browser', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)', media: q }))
    openFile('src/assets/doc.pdf')
    expect(screen.queryByTitle('doc.pdf')).toBeNull()
    const card = within(document.querySelector('.fv-pdf-card') as HTMLElement)
    expect(card.getByText('doc.pdf')).toBeTruthy()
    expect(await card.findByText('PDF 文档 · 3 B')).toBeTruthy()
    const open = card.getByRole('link', { name: '在浏览器中打开' })
    expect(open.className).toContain('ui-btn--primary')
    expect(open.getAttribute('href')).toBe(raw('src/assets/doc.pdf'))
    expect(open.getAttribute('target')).toBe('_blank')
    expect(card.getByRole('link', { name: '下载' }).getAttribute('download')).toBe('doc.pdf')
  })

  it('shows audio as a card with its name', () => {
    openFile('src/assets/song.mp3')
    const card = document.querySelector('.fv__audio') as HTMLElement
    expect(card.querySelector('svg[data-type="audio"]')).toBeTruthy()
    expect(within(card).getByText('song.mp3')).toBeTruthy()
  })

  it('offers a download for large and binary files', async () => {
    openFile('big.log', 'data.bin')
    expect(await screen.findByText(/文件过大/)).toBeTruthy()
    const big = within(screen.getByTestId('file:b1:big.log'))
    const links = big.getAllByRole('link', { name: '下载' })
    expect(links.every((l) => l.getAttribute('href') === raw('big.log'))).toBe(true)
    expect(await screen.findByText(/二进制文件/)).toBeTruthy()
  })

  it('names the type and size under the file name', async () => {
    openFile('src/main.ts')
    expect(await screen.findByText('TS 代码 · 27 B')).toBeTruthy()
  })

  it('takes the size of a media file from the tree, and its dimensions once loaded', async () => {
    openFiles({ dir: 'src/assets', selected: 'src/assets/logo.png' })
    const img = files().getByRole('img', { name: 'logo.png' })
    Object.defineProperty(img, 'naturalWidth', { value: 640 })
    Object.defineProperty(img, 'naturalHeight', { value: 480 })
    fireEvent.load(img)
    expect(await files().findByText('PNG 图片 · 10 B · 640×480')).toBeTruthy()
  })

  it('sizes a vector image to the panel and leaves out its made-up dimensions', async () => {
    openFile('icon.svg')
    const img = screen.getByRole('img', { name: 'icon.svg' })
    expect(img.className).toContain('fv-img--svg')
    Object.defineProperty(img, 'naturalWidth', { value: 300 })
    Object.defineProperty(img, 'naturalHeight', { value: 150 })
    fireEvent.load(img)
    expect(img.hasAttribute('data-loaded')).toBe(true)
    expect(screen.getByText('SVG 图片')).toBeTruthy()
  })

  it('keeps download first and folds the other actions into 更多 when narrow', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } })
    openFile('src/assets/doc.pdf')
    expect(screen.getByRole('link', { name: '在浏览器中打开' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '下载' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '复制路径' })).toBeNull()
    expect(screen.queryByRole('button', { name: '在聊天中引用' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('menuitem', { name: '在聊天中引用' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '复制路径' }))
    await waitFor(() => expect(useToasts.getState().items[0]?.message).toBe('已复制路径'))
  })

  it('moves the actual-size toggle of an image into 更多 when narrow', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    openFile('src/assets/logo.png')
    const img = screen.getByRole('img', { name: 'logo.png' })
    expect(screen.queryByRole('radio', { name: '1:1' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '原始大小（1:1）' }))
    expect(img.className).not.toContain('fv-img--fit')
  })

  it('wraps long lines by default when narrow, from 更多', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    openFile('src/main.ts')
    await screen.findByText('console.log(a)')
    const lines = document.querySelector('.pv-lines') as HTMLElement
    expect(lines.hasAttribute('data-wrap')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    const item = screen.getByRole('menuitemcheckbox', { name: '自动换行' })
    expect(item.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(item)
    expect(lines.hasAttribute('data-wrap')).toBe(false)
    expect(localStorage.getItem('gg.fv.wrap')).toBe('off')
  })

  it('keeps long lines unwrapped when wide until asked, and remembers the choice', async () => {
    const view = openFile('src/main.ts')
    await screen.findByText('console.log(a)')
    const wrap = screen.getByRole('button', { name: '自动换行' })
    expect(wrap.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('.pv-lines[data-wrap]')).toBeNull()
    fireEvent.click(wrap)
    expect(document.querySelector('.pv-lines[data-wrap]')).toBeTruthy()
    view.unmount()
    openFile('src/main.ts')
    await screen.findByText('console.log(a)')
    expect(screen.getByRole('button', { name: '自动换行' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('copies the whole text, also from a markdown preview', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    openFile('README.md')
    await screen.findByRole('heading', { name: '标题' })
    expect(screen.queryByRole('button', { name: '自动换行' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }))
    expect(writeText).toHaveBeenCalledWith('# 标题\n\n正文')
    await waitFor(() => expect(useToasts.getState().items[0]?.message).toBe('已复制全文'))
  })

  it('switches markdown to its source with one button when narrow', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    openFile('README.md')
    await screen.findByRole('heading', { name: '标题' })
    expect(screen.queryByRole('tab', { name: '源码' })).toBeNull()
    const source = screen.getByRole('button', { name: '源码' })
    expect(source.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(source)
    expect(screen.getByText('# 标题')).toBeTruthy()
    expect(source.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows images by paths relative to the markdown file, never outside the workspace', async () => {
    openFile('docs/guide.md')
    expect((await screen.findByRole('img', { name: '标志' })).getAttribute('src')).toBe(
      raw('src/assets/logo.png'),
    )
    expect(screen.getByRole('img', { name: '远程' }).getAttribute('src')).toBe('https://example.com/a.png')
    expect(screen.queryByRole('img', { name: '外面' })).toBeNull()
    expect(screen.getByText('外面')).toBeTruthy()
  })

  it('opens relative links in the workbench and keeps outside links in the browser', async () => {
    openFile('docs/guide.md')
    fireEvent.click(await screen.findByRole('link', { name: '主程序' }))
    expect(current().at(-1)).toEqual({ kind: 'file', source: { botId: 'b1', path: 'src/main.ts' } })
    fireEvent.click(screen.getByRole('link', { name: '资源目录' }))
    expect(current().at(-1)).toMatchObject({ kind: 'files', botId: 'b1', dir: 'src/assets', selected: null })
    expect(screen.queryByRole('link', { name: '越界' })).toBeNull()
    expect(screen.getByText('越界').getAttribute('title')).toBe('链接指向工作区以外，无法打开')
    const site = screen.getByRole('link', { name: '官网' })
    expect(site.getAttribute('href')).toBe('https://example.com')
    expect(site.getAttribute('target')).toBe('_blank')
  })

  it('jumps to headings from in-page links and the outline', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    openFile('docs/guide.md')
    const heading = await screen.findByRole('heading', { name: '使用 说明' })
    expect(heading.id).toBe('使用-说明')
    fireEvent.click(screen.getByRole('link', { name: '跳到使用' }))
    expect(scroll.mock.contexts.at(-1)).toBe(heading)
    fireEvent.click(await screen.findByRole('button', { name: '大纲' }))
    const outline = screen.getByRole('navigation', { name: '大纲' })
    expect(
      within(outline)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['指南', '安装', '使用 说明'])
    fireEvent.click(within(outline).getByRole('button', { name: '安装' }))
    expect(scroll.mock.contexts.at(-1)).toBe(screen.getByRole('heading', { name: '安装' }))
    expect(screen.getByRole('button', { name: '大纲' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('offers no outline for a short markdown file', async () => {
    openFile('README.md')
    await screen.findByRole('heading', { name: '标题' })
    expect(screen.queryByRole('button', { name: '大纲' })).toBeNull()
  })

  it('says up front that a long file is cut, with its download', async () => {
    openFile('long.txt')
    const note = await screen.findByText('仅显示前 5000 行，共 5001 行，完整内容请下载')
    const box = note.closest('.fv__note') as HTMLElement
    expect(within(box).getByRole('link', { name: '下载' }).getAttribute('href')).toBe(raw('long.txt'))
    expect(box.compareDocumentPosition(document.querySelector('.pv-lines') as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('shows html as source', async () => {
    openFile('index.html')
    expect(await screen.findByText('<h1>hi</h1>')).toBeTruthy()
  })

  it('copies the path even without the async clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    const exec = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    openFile('src/main.ts')
    fireEvent.click(screen.getByRole('button', { name: '复制路径' }))
    await waitFor(() => expect(useToasts.getState().items[0]?.message).toBe('已复制路径'))
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('cites the file in the chat composer', async () => {
    const group = { id: 'g1', kind: 'group', botIds: ['b1'], members: [] } as unknown as GroupDto
    act(() => {
      useWorkbench.getState().show({ kind: 'file', source: { botId: 'b1', path: 'src/main.ts' } })
    })
    render(
      <>
        <MessageComposer group={group} onSent={() => {}} />
        <Bench />
      </>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '看看' } })
    fireEvent.click(screen.getByRole('button', { name: '在聊天中引用' }))
    expect((screen.getByRole('combobox') as HTMLTextAreaElement).value).toBe('看看 @src/main.ts ')
  })
})

describe('office documents', () => {
  beforeEach(() => vi.clearAllMocks())
  const frame = (name: string) => document.querySelector<HTMLIFrameElement>(`iframe[title="${name}"]`)
  const frameText = (name: string) => frame(name)?.contentDocument?.body.textContent

  it('renders a word document from the raw bytes in a script-free frame', async () => {
    openFile('docs/周报.docx')
    await waitFor(() => expect(frameText('周报.docx')).toContain('周报正文'))
    expect(frame('周报.docx')?.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(calls).toContain(raw('docs/周报.docx'))
    expect(office.docx.mock.calls[0]?.[0]).toBeInstanceOf(ArrayBuffer)
  })

  it('renders slides as a list', async () => {
    openFile('deck.pptx')
    await waitFor(() => expect(frameText('deck.pptx')).toContain('第一页幻灯片'))
    expect(office.pptx.mock.calls[0]?.[1]).toMatchObject({ mode: 'list' })
  })

  it('shows each sheet of a workbook as a table', async () => {
    openFile('sales.xlsx')
    expect(await screen.findByRole('cell', { name: '上海' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '0.3' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '2026-11-02' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'TRUE' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'D' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '备注' }))
    expect(screen.getByRole('cell', { name: '只看第一页' })).toBeTruthy()
  })

  it('says it is parsing until the document is drawn, then shows the frame', async () => {
    let done = () => {}
    office.docx.mockImplementationOnce(
      (_data: ArrayBuffer, body: HTMLElement) =>
        new Promise<void>((resolve) => {
          done = () => {
            body.innerHTML = '<p>周报正文</p>'
            resolve()
          }
        }),
    )
    openFile('docs/周报.docx')
    expect((await screen.findByRole('status')).textContent).toContain('正在解析…')
    const box = frame('周报.docx')?.parentElement as HTMLElement
    expect(box.dataset.loaded).toBeUndefined()
    await act(async () => done())
    await waitFor(() => expect(box.dataset.loaded).toBe('true'))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders slides at one width and scales them to the panel', async () => {
    openFile('deck.pptx')
    const root = frame('deck.pptx')?.contentDocument?.documentElement as HTMLElement
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 520 })
    await waitFor(() => expect(frameText('deck.pptx')).toContain('第一页幻灯片'))
    expect(office.pptx.mock.calls[0]?.[1]).toMatchObject({ width: 960 })
    expect(root.style.getPropertyValue('--fit')).toBe(String(520 / 992))
  })

  it('marks the current sheet and says when one is empty', async () => {
    openFile('sales.xlsx')
    await screen.findByRole('cell', { name: '上海' })
    expect(screen.getByRole('tab', { name: '销量' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: '空表' }))
    expect(screen.getByText('此工作表为空')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('explains a file it cannot parse and still offers the download', async () => {
    office.docx.mockRejectedValueOnce(new Error('end of central directory not found'))
    openFile('bad.docx')
    const box = within((await screen.findByText('无法预览文件')).parentElement as HTMLElement)
    expect(box.getByText('文件可能已损坏或格式不受支持，可下载后用本机应用打开')).toBeTruthy()
    expect(box.getByRole('link', { name: '下载' }).getAttribute('href')).toBe(raw('bad.docx'))
    expect(box.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it("shows the server's reason when the file cannot be read", async () => {
    openFile('gone.xlsx')
    expect(await screen.findByText('小王的 Claude 离线，无法读取文件')).toBeTruthy()
    expect(office.sheets).not.toHaveBeenCalled()
  })

  it('offers a download for old formats and files too large to render', async () => {
    openFile('old.doc', 'huge.docx')
    expect(screen.getByText('该类型暂不支持预览，可下载查看')).toBeTruthy()
    expect(await screen.findByText(/文件过大（99\.0 MB/)).toBeTruthy()
    expect(office.docx).not.toHaveBeenCalled()
  })

  it('previews an office attachment', async () => {
    const a: Attachment = {
      id: 'a2',
      messageId: 'm1',
      name: '方案.docx',
      size: 3,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    open({ kind: 'file', source: { attachment: a, from: '李建国' } })
    await waitFor(() => expect(frameText('方案.docx')).toContain('周报正文'))
    expect(calls).toContain('/api/attachments/a2')
  })
})

describe('attachment file tab', () => {
  const a: Attachment = { id: 'a1', messageId: 'm1', name: 'ci.log', size: 30, mime: 'text/plain' }

  it('shows an attachment in the shared viewer', async () => {
    open({ kind: 'file', source: { attachment: a, from: '李建国' } })
    expect(screen.getByRole('heading', { name: 'ci.log' }).dataset.icon).toBe('doc-text')
    expect(await screen.findByText('ERROR boom')).toBeTruthy()
    expect(screen.getByText('ERROR boom').className).toContain('pv-line--error')
    expect(screen.getByRole('link', { name: '下载' }).getAttribute('href')).toBe('/api/attachments/a1')
    expect(document.body.textContent).toContain('来源李建国')
    expect(document.body.textContent).toContain('位置.gonggong/attachments/m1/ci.log')
  })
})

describe('copyText', () => {
  it('uses the async clipboard when present', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await copyText('x')
    expect(writeText).toHaveBeenCalledWith('x')
  })

  it('rejects when the fallback copy fails', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    await expect(copyText('x')).rejects.toThrow()
  })
})
