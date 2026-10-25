import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeTarget } from '../src/features/diff/DiffToolbar'
import { GitFileDiff } from '../src/features/diff/GitFileDiff'
import { useDiffSettings } from '../src/features/diff/store'
import { mockApi } from './mockApi'

const URL = '/groups/g1/bots/b1/git/diff?from=main&path=a.txt'
/** Read with the whole file as context: unchanged lines fold in the view. */
const WHOLE = `${URL}&context=100000`
const reply = (...lines: string[]) => ({
  patch: lines.length ? ['diff --git a/a.txt b/a.txt', ...lines, ''].join('\n') : '',
  truncated: false,
})
const lines = () => Array.from(document.querySelectorAll('.diff__line'), (l) => l.textContent)
/** Unchanged lines `from`..`to` of a patch. */
const same = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => ` line ${from + k}`)
const key = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init })
/** Which changes carry the mark of the one stepped to. */
const marked = () =>
  Array.from(document.querySelectorAll('[data-change]'), (b) => b.hasAttribute('data-current'))
const TWO = reply('@@ -1,4 +1,4 @@', '-a', '+A', ' b', ' c', '-d', '+D')
/** Picks `option` from the toolbar's pop-up button named `name`. */
const pick = (name: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: option }))
}

beforeEach(() => {
  localStorage.clear()
  useDiffSettings.setState({ view: 'unified', whitespace: 'none', highlight: 'words', fullContext: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('diff toolbar', () => {
  it('switches to side by side and back, remembering the choice', async () => {
    mockApi({ [`GET ${WHOLE}`]: reply('@@ -1 +1 @@', '-a', '+b') })
    render(<GitFileDiff url={URL} path="a.txt" />)
    await waitFor(() => expect(lines()).toEqual(['@@ -1 +1 @@', '-a', '+b']))
    expect(screen.getByRole('radio', { name: '统一' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('radio', { name: '并排' }))
    expect(localStorage.getItem('gonggong.diffView')).toBe('split')
    expect(document.querySelectorAll('.diff__pair')).toHaveLength(1)

    fireEvent.click(screen.getByRole('radio', { name: '统一' }))
    expect(localStorage.getItem('gonggong.diffView')).toBe('unified')
    expect(document.querySelector('.diff__pair')).toBeNull()
  })

  it('reads the whole file, folding what is unchanged until 显示完整文件, and reads again without whitespace', async () => {
    const calls = mockApi({
      [`GET ${WHOLE}`]: reply('@@ -1,12 +1,12 @@', ...same(1, 10), '-a  b', '+a b', ' c'),
      [`GET ${URL}&whitespace=ignore&context=100000`]: reply(),
    })
    render(<GitFileDiff url={URL} path="a.txt" />)
    await waitFor(() =>
      expect(lines()).toEqual(['@@ -1,12 +1,12 @@', ' line 8', ' line 9', ' line 10', '-a  b', '+a b', ' c']),
    )
    expect(screen.getByRole('button', { name: '展开 7 行未改动的内容' })).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: '显示完整文件' }))
    expect(localStorage.getItem('gonggong.diffFullContext')).toBe('1')
    expect(lines()).toHaveLength(14)
    expect(screen.queryByRole('button', { name: '展开 7 行未改动的内容' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '显示完整文件' }))
    expect(lines()).toHaveLength(7)

    pick('空白处理', '忽略空白')
    expect(localStorage.getItem('gonggong.diffWhitespace')).toBe('ignore')
    expect(await screen.findByText('忽略空白后没有差异')).toBeTruthy()
    expect(calls.map((c) => c.path)).toEqual([WHOLE, `${URL}&whitespace=ignore&context=100000`])
  })

  it.each([
    ['去掉首尾空白', 'trim'],
    ['忽略空白和空行', 'ignore-blank'],
  ])('reads again with whitespace as IDEA’s %s does, and as it is', async (label, mode) => {
    const calls = mockApi({ [`GET ${WHOLE}`]: TWO, [`GET ${URL}&whitespace=${mode}&context=100000`]: TWO })
    render(<GitFileDiff url={URL} path="a.txt" />)
    await waitFor(() => expect(marked()).toHaveLength(2))
    expect(screen.getByRole('button', { name: '空白处理' }).textContent).toBe('不忽略')
    pick('空白处理', label)
    await waitFor(() => expect(calls.at(-1)?.path).toBe(`${URL}&whitespace=${mode}&context=100000`))
    expect(useDiffSettings.getState().whitespace).toBe(mode)
    pick('空白处理', '不忽略')
    await waitFor(() => expect(calls.at(-1)?.path).toBe(WHOLE))
    expect(calls).toHaveLength(3)
  })

  it('picks how changes are highlighted, kept across visits', async () => {
    mockApi({ [`GET ${WHOLE}`]: reply('@@ -1 +1 @@', '-const total = price * 2', '+const total = cost * 2') })
    render(<GitFileDiff url={URL} path="a.txt" />)
    const words = () =>
      Array.from(document.querySelectorAll('.diff__word--del, .diff__word--add'), (w) => w.textContent)
    await waitFor(() => expect(words()).toEqual(['price', 'cost']))
    expect(screen.getByRole('button', { name: '高亮方式' }).textContent).toBe('按词高亮')

    pick('高亮方式', '按字符高亮')
    expect(localStorage.getItem('gonggong.diffHighlight')).toBe('chars')
    expect(words()).toEqual(['pri', 'e', 'ost'])
    pick('高亮方式', '只高亮行')
    expect(words()).toEqual([])
    expect(document.querySelectorAll('.diff__line--add')).toHaveLength(1)
    pick('高亮方式', '不高亮')
    expect(document.querySelector('.diff')?.getAttribute('data-highlight')).toBe('none')
    expect(localStorage.getItem('gonggong.diffHighlight')).toBe('none')
  })

  it('reads with git’s own context when the whole file is too big, unless the whole file is asked for', async () => {
    const calls = mockApi({
      [`GET ${WHOLE}`]: {
        patch: ['diff --git a/a.txt b/a.txt', '@@ -1,90000 +1,90000 @@', ' top', ''].join('\n'),
        truncated: true,
      },
      [`GET ${URL}`]: reply('@@ -50000 +50000 @@', '-x', '+y'),
    })
    render(<GitFileDiff url={URL} path="a.txt" />)
    await waitFor(() => expect(lines()).toEqual(['@@ -50000 +50000 @@', '-x', '+y']))
    expect(screen.queryByText('差异过大，已截断')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: '显示完整文件' }))
    expect(await screen.findByText('差异过大，已截断')).toBeTruthy()
    expect(lines()).toEqual(['@@ -1,90000 +1,90000 @@', ' top'])
    expect(calls.map((c) => c.path)).toEqual([WHOLE, URL])
  })

  it('loads the saved settings, an old 忽略空白 as ignoring whitespace', async () => {
    localStorage.setItem('gonggong.diffView', 'split')
    localStorage.setItem('gonggong.diffIgnoreWhitespace', '1')
    localStorage.setItem('gonggong.diffFullContext', '1')
    vi.resetModules()
    const { useDiffSettings: fresh } = await import('../src/features/diff/store')
    expect(fresh.getState()).toMatchObject({
      view: 'split',
      whitespace: 'ignore',
      highlight: 'words',
      fullContext: true,
    })

    localStorage.setItem('gonggong.diffWhitespace', 'trim')
    localStorage.setItem('gonggong.diffHighlight', 'chars')
    vi.resetModules()
    const { useDiffSettings: again } = await import('../src/features/diff/store')
    expect(again.getState()).toMatchObject({ whitespace: 'trim', highlight: 'chars' })
  })

  it('steps through the changes, flashing the one it moves to', async () => {
    mockApi({ [`GET ${WHOLE}`]: TWO })
    render(<GitFileDiff url={URL} path="a.txt" />)
    await waitFor(() => expect(document.querySelectorAll('[data-change]')).toHaveLength(2))
    const flashed = () =>
      Array.from(document.querySelectorAll('[data-change]'), (b) => b.hasAttribute('data-flash'))
    const next = screen.getByRole('button', { name: '下一处改动' })
    const prev = screen.getByRole('button', { name: '上一处改动' })

    fireEvent.click(next)
    expect(flashed()).toEqual([true, false])
    fireEvent.click(next)
    expect(flashed()).toEqual([false, true])
    expect(marked()).toEqual([false, true])
    fireEvent.click(next)
    expect(flashed()).toEqual([false, true])
    expect(screen.getByRole('status').textContent).toBe('已是最后一处改动')
    fireEvent.click(prev)
    expect(flashed()).toEqual([true, false])
    expect(marked()).toEqual([true, false])
  })

  it('steps with F7 / ⇧F7 while the diff is shown, leaving the keys to a field being typed in', async () => {
    mockApi({ [`GET ${WHOLE}`]: TWO })
    const tab = (hidden: boolean) => (
      <div hidden={hidden}>
        <input aria-label="说明" />
        <GitFileDiff url={URL} path="a.txt" />
      </div>
    )
    const { rerender } = render(tab(false))
    await waitFor(() => expect(marked()).toEqual([false, false]))
    key('F7')
    expect(marked()).toEqual([true, false])
    key('F7')
    expect(marked()).toEqual([false, true])
    key('F7', { shiftKey: true })
    expect(marked()).toEqual([true, false])
    key('F7', { shiftKey: true })
    expect(screen.getByRole('status').textContent).toBe('已是第一处改动')
    // Side by side the same change stays the current one.
    fireEvent.click(screen.getByRole('radio', { name: '并排' }))
    expect(marked()).toEqual([true, false])
    key('F7')
    expect(marked()).toEqual([false, true])
    fireEvent.click(screen.getByRole('radio', { name: '统一' }))
    key('F7', { shiftKey: true })

    fireEvent.keyDown(screen.getByRole('textbox', { name: '说明' }), { key: 'F7' })
    expect(marked()).toEqual([true, false])
    // A hidden workbench tab keeps its diff mounted.
    rerender(tab(true))
    key('F7')
    expect(marked()).toEqual([true, false])
  })

  it('goes on to the next file with F7 again past the last change, and back with ⇧F7 past the first', async () => {
    mockApi({ [`GET ${WHOLE}`]: reply('@@ -1 +1 @@', '-a', '+A') })
    const steps: string[] = []
    const files = {
      next: (s: number) => steps.push(`next ${s}`),
      prev: (s: number) => steps.push(`prev ${s}`),
    }
    render(<GitFileDiff url={URL} path="a.txt" files={files} />)
    await waitFor(() => expect(marked()).toEqual([false]))
    key('F7')
    expect(marked()).toEqual([true])
    key('F7')
    expect(screen.getByRole('status').textContent).toBe('已是最后一处改动，再按 F7 转到下一个文件')
    expect(steps).toEqual([])
    key('F7')
    expect(steps).toEqual(['next 1'])
    key('F7', { shiftKey: true })
    expect(screen.getByRole('status').textContent).toBe('已是第一处改动，再按 ⇧F7 转到上一个文件')
    key('F7', { shiftKey: true })
    expect(steps).toEqual(['next 1', 'prev -1'])
    expect(screen.queryByRole('status')).toBeNull()

    // ⌥⇧← / ⌥⇧→ and the toolbar buttons go to a neighbour as such.
    key('ArrowRight', { altKey: true, shiftKey: true })
    key('ArrowLeft', { altKey: true, shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: '下一个文件' }))
    fireEvent.click(screen.getByRole('button', { name: '上一个文件' }))
    expect(steps.slice(2)).toEqual(['next 1', 'prev 1', 'next 1', 'prev 1'])
  })

  it('offers the neighbouring files only to a diff among several, disabling a missing one', async () => {
    mockApi({ [`GET ${WHOLE}`]: TWO })
    const { unmount } = render(<GitFileDiff url={URL} path="a.txt" />)
    await waitFor(() => expect(marked()).toHaveLength(2))
    expect(screen.queryByRole('button', { name: '下一个文件' })).toBeNull()
    unmount()

    render(<GitFileDiff url={URL} path="a.txt" files={{ next: () => {} }} />)
    await waitFor(() => expect(marked()).toHaveLength(2))
    expect(screen.getByRole('button', { name: '上一个文件' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '下一个文件' })).toHaveProperty('disabled', false)
  })

  it('lands on the first or last change once read, when asked to', async () => {
    mockApi({ [`GET ${WHOLE}`]: TWO })
    render(<GitFileDiff url={URL} path="a.txt" start={-1} />)
    await waitFor(() => expect(marked()).toEqual([false, true]))
  })

  it('jumps to the source with F4 or its button: the new version at the change it is on', async () => {
    mockApi({ [`GET ${WHOLE}`]: reply('@@ -1,8 +1,8 @@', '-a', '+A', ...same(2, 6), '-g', '+G', ' h') })
    const opened: number[] = []
    render(<GitFileDiff url={URL} path="a.txt" onOpenLine={(n) => opened.push(n)} />)
    await waitFor(() => expect(marked()).toHaveLength(2))
    key('F4')
    key('F7')
    key('F7')
    key('F4')
    fireEvent.click(screen.getByRole('button', { name: '跳到源文件' }))
    expect(opened).toEqual([1, 7, 7])
  })

  it('holds the caller’s actions, and can be left out', async () => {
    mockApi({ [`GET ${WHOLE}`]: reply('@@ -1 +1 @@', '-a', '+b') })
    const { unmount } = render(
      <GitFileDiff url={URL} path="a.txt" actions={<button type="button">回滚</button>} />,
    )
    expect(screen.getByRole('button', { name: '回滚' })).toBeTruthy()
    await waitFor(() => expect(lines()).toHaveLength(3))
    unmount()

    render(<GitFileDiff url={URL} path="a.txt" toolbar={false} />)
    await waitFor(() => expect(lines()).toHaveLength(3))
    expect(screen.queryByRole('radio', { name: '并排' })).toBeNull()
    expect(screen.queryByRole('button', { name: '下一处改动' })).toBeNull()
    key('F7')
    expect(marked()).toEqual([false])
  })
})

describe('changeTarget', () => {
  const view = { top: 100, bottom: 500 }
  const blocks = [
    { top: 40, bottom: 80 },
    { top: 120, bottom: 160 },
    { top: 300, bottom: 340 },
    { top: 700, bottom: 760 },
  ]

  it('steps from the current change while it is on screen', () => {
    expect(changeTarget(blocks, view, 1, 1)).toBe(2)
    expect(changeTarget(blocks, view, 2, -1)).toBe(1)
  })

  it('otherwise starts from the top of the view', () => {
    expect(changeTarget(blocks, view, -1, 1)).toBe(1)
    expect(changeTarget(blocks, view, 3, 1)).toBe(1)
    expect(changeTarget(blocks, view, -1, -1)).toBe(0)
  })

  it('stops at either end', () => {
    expect(changeTarget(blocks.slice(0, 3), view, 2, 1)).toBe(-1)
    expect(changeTarget(blocks, { top: 0, bottom: 400 }, -1, -1)).toBe(-1)
  })
})
