import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiffView } from '../src/features/diff/DiffParts'
import type { DiffFile } from '../src/features/diff/patch'
import { useDiffSettings } from '../src/features/diff/store'

const file = (lines: string[], path = 'notes.txt'): DiffFile => ({
  path,
  status: 'modified',
  add: 0,
  del: 0,
  binary: false,
  lines,
})
const nums = (el: Element) =>
  Array.from(el.querySelectorAll('.diff__num'), (n) => n.getAttribute('data-n') ?? '')
/** A side-by-side row as [old number, old code] and [new number, new code]. */
const sides = (row: Element) =>
  Array.from(row.querySelectorAll('.diff__side'), (s) => [
    s.querySelector('.diff__num')?.getAttribute('data-n') ?? '',
    s.querySelector('.diff__code')?.textContent ?? '',
  ])
const marks = (el: Element) => ({
  del: Array.from(el.querySelectorAll('.diff__word--del'), (m) => m.textContent),
  add: Array.from(el.querySelectorAll('.diff__word--add'), (m) => m.textContent),
})

beforeEach(() => useDiffSettings.setState({ view: 'unified', ignoreWhitespace: false, fullContext: false }))
afterEach(() => vi.restoreAllMocks())

describe('unified diff view', () => {
  it('numbers old and new lines in a gutter that stays out of the text', () => {
    const lines = ['@@ -9,3 +9,3 @@', ' a', '-b', '+c', ' d']
    render(<DiffView file={file(lines)} />)
    const rows = [...document.querySelectorAll('.diff__line')]
    expect(rows.map(nums)).toEqual([
      ['', ''],
      ['9', '9'],
      ['10', ''],
      ['', '10'],
      ['11', '11'],
    ])
    expect(rows.map((r) => r.textContent)).toEqual(lines)
  })

  it('groups each change so it can be stepped to', () => {
    render(<DiffView file={file(['@@ -1,4 +1,4 @@', '-a', '+A', ' b', ' c', '-d', '+D'])} />)
    expect(Array.from(document.querySelectorAll('[data-change]'), (b) => b.textContent)).toEqual([
      '-a+A',
      '-d+D',
    ])
  })
})

describe('side-by-side diff view', () => {
  it('shows the old file left and the new one right, pairing deletions with additions', () => {
    render(<DiffView file={file(['@@ -1,4 +1,3 @@', ' a', '-b', '-c', '+B', ' d'])} view="split" />)
    expect(document.querySelector('.diff__line--hunk')?.textContent).toBe('@@ -1,4 +1,3 @@')
    const rows = [...document.querySelectorAll('.diff__pair')]
    expect(rows.map(sides)).toEqual([
      [
        ['1', 'a'],
        ['1', 'a'],
      ],
      [
        ['2', 'b'],
        ['2', 'B'],
      ],
      [
        ['3', 'c'],
        ['', ''],
      ],
      [
        ['4', 'd'],
        ['3', 'd'],
      ],
    ])
    expect(rows[2]?.querySelectorAll('.diff__side--empty')).toHaveLength(1)
    expect(document.querySelectorAll('[data-change]')).toHaveLength(1)
  })

  it('follows the stored view and falls back to unified when narrow', () => {
    useDiffSettings.setState({ view: 'split' })
    const f = file(['@@ -1 +1 @@', '-a', '+b'])
    const { unmount } = render(<DiffView file={f} />)
    expect(document.querySelectorAll('.diff__pair')).toHaveLength(1)
    unmount()

    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500)
    render(<DiffView file={f} />)
    expect(document.querySelector('.diff__pair')).toBeNull()
    expect(document.querySelectorAll('.diff__line')).toHaveLength(3)
  })
})

describe('word highlights', () => {
  it('marks the changed words of an edited line in both views, over the syntax colours', async () => {
    const f = file(['@@ -1 +1 @@', '-const total = price * 2', '+const total = cost * 2'], 'a.ts')
    const { container, rerender } = render(<DiffView file={f} />)
    expect(marks(container)).toEqual({ del: ['price'], add: ['cost'] })
    await waitFor(() => expect(container.querySelector('.diff__word--add .hl')?.textContent).toBe('cost'))
    expect(Array.from(container.querySelectorAll('.diff__line'), (l) => l.textContent)).toEqual(f.lines)

    rerender(<DiffView file={f} view="split" />)
    expect(marks(container)).toEqual({ del: ['price'], add: ['cost'] })
    expect(container.querySelector('.diff__word--del .hl')?.textContent).toBe('price')
  })

  it('leaves rewritten lines whole', () => {
    const { container } = render(<DiffView file={file(['@@ -1 +1 @@', '-old', '+new'])} />)
    expect(marks(container)).toEqual({ del: [], add: [] })
  })
})

/** Unchanged lines `from`..`to` of a patch. */
const same = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => ` line ${from + k}`)

describe('folded unchanged lines', () => {
  // Lines 1-9 unchanged, line 10 changed, lines 11-20 unchanged.
  const whole = file(['@@ -1,20 +1,20 @@', ...same(1, 9), '-old 10', '+new 10', ...same(11, 20)])
  const texts = () => Array.from(document.querySelectorAll('.diff__line'), (l) => l.textContent)
  const fold = (n: number) => screen.getByRole('button', { name: `展开 ${n} 行未改动的内容` })

  it('keeps three lines next to each change, the rest a row to expand, one by one or all at once', () => {
    render(<DiffView file={whole} fold />)
    expect(texts()).toEqual([
      '@@ -1,20 +1,20 @@',
      ' line 7',
      ' line 8',
      ' line 9',
      '-old 10',
      '+new 10',
      ' line 11',
      ' line 12',
      ' line 13',
    ])
    fireEvent.click(fold(6))
    expect(texts()).toHaveLength(15)
    expect(texts()[1]).toBe(' line 1')
    expect(fold(7)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
    expect(texts()).toEqual(whole.lines)
    expect(screen.queryByRole('button', { name: /展开 \d+ 行未改动的内容/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '全部展开' })).toBeNull()
  })

  it('folds side by side too', () => {
    render(<DiffView file={whole} fold view="split" />)
    expect(document.querySelectorAll('.diff__pair')).toHaveLength(7)
    fireEvent.click(fold(7))
    expect(document.querySelectorAll('.diff__pair')).toHaveLength(14)
    expect(sides(document.querySelectorAll('.diff__pair')[13]!)).toEqual([
      ['20', 'line 20'],
      ['20', 'line 20'],
    ])
  })

  it('shows every line unless asked to fold', () => {
    render(<DiffView file={whole} />)
    expect(texts()).toEqual(whole.lines)
    expect(screen.queryByRole('button', { name: '全部展开' })).toBeNull()
  })
})

describe('jumping to the source', () => {
  const f = file(['@@ -4,2 +4,2 @@', ' a', '-b', '+B'])

  it('opens the new version at the line whose number is clicked; old numbers stay put', () => {
    const opened: number[] = []
    render(<DiffView file={f} onOpenLine={(n) => opened.push(n)} />)
    const [, a, b, B] = [...document.querySelectorAll('.diff__line')].map((l) =>
      l.querySelectorAll('.diff__num'),
    )
    fireEvent.click(a![1]!)
    fireEvent.click(b![0]!)
    fireEvent.click(b![1]!)
    fireEvent.click(B![1]!)
    expect(opened).toEqual([4, 5])
  })

  it('takes the new side’s numbers side by side', () => {
    const opened: number[] = []
    render(<DiffView file={f} view="split" onOpenLine={(n) => opened.push(n)} />)
    for (const n of document.querySelectorAll('[data-side] .diff__num')) fireEvent.click(n)
    expect(opened).toEqual([4, 5])
  })

  it('leaves the numbers alone without a file to open', () => {
    render(<DiffView file={f} />)
    expect(document.querySelector('[data-jump]')).toBeNull()
  })
})
