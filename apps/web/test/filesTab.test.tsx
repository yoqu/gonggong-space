import type { Attachment, BotDto, FileTreeEntry, GroupDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { TabContent, TabLabel } from '../src/features/workbench/TabContent'
import { copyText } from '../src/lib/clipboard'
import { useToasts } from '../src/ui'

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
      return new Response('{}', { status: 404 })
    }),
  )
  useWorkspace.setState({ bots: [{ id: 'b1', name: '小王的 Claude' } as BotDto], botStates: {} })
  useWorkbench.setState({ groupId: 'g1', open: true, benches: {} })
  useToasts.setState({ items: [] })
})
afterEach(() => {
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
    expect(calls[0]).toBe('/api/groups/g1/bots/b1/files/tree?path=')
    const names = tree()
      .getAllByRole('treeitem')
      .map((r) => r.dataset.name)
    expect(names).toEqual(['src', 'README.md'])
    expect(within(row(/^src/)).getByTitle('未提交').textContent).toBe('M')
    expect(within(row(/README/)).queryByTitle('未提交')).toBeNull()
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

  it('offers a download for large and binary files', async () => {
    openFile('big.log', 'data.bin')
    expect(await screen.findByText(/文件过大/)).toBeTruthy()
    const big = within(screen.getByTestId('file:b1:big.log'))
    const links = big.getAllByRole('link', { name: '下载' })
    expect(links.every((l) => l.getAttribute('href') === raw('big.log'))).toBe(true)
    expect(await screen.findByText(/二进制文件/)).toBeTruthy()
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
