import type { DiffRepo } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import { type DiffFile, diffRows, listOrder, repoOf } from '../src/features/diff/patch'
import { changeLine, diffBlocks, foldBlocks } from '../src/features/diff/split'

/** Unchanged lines `from`..`to` of a patch. */
const same = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => ` line ${from + k}`)
const layout = (lines: string[]) => {
  const rows = diffRows(lines)
  const blocks = diffBlocks(rows)
  return { rows, blocks, shown: foldBlocks(rows, blocks) }
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)

describe('foldBlocks', () => {
  it('folds the unchanged lines of a whole-file diff but the three next to each change', () => {
    // Row 0 is the hunk header; rows 1-9 are lines 1-9, rows 10-11 the change of line 10, rows 12-21 lines 11-20.
    const { shown } = layout(['@@ -1,20 +1,20 @@', ...same(1, 9), '-old 10', '+new 10', ...same(11, 20)])
    expect(shown).toEqual([
      [0, { at: 1, rows: range(1, 6) }, 7, 8, 9],
      [10, 11],
      [12, 13, 14, { at: 15, rows: range(15, 21) }],
    ])
  })

  it('folds between two changes, keeping context on both sides', () => {
    const { shown } = layout(['@@ -1,12 +1,12 @@', '-a', '+A', ...same(2, 11), '-l', '+L'])
    expect(shown[2]).toEqual([3, 4, 5, { at: 6, rows: range(6, 9) }, 10, 11, 12])
  })

  it('leaves git’s own hunks and short stretches as they are', () => {
    const hunks = layout([
      '@@ -1,7 +1,7 @@',
      ...same(1, 3),
      '-d',
      '+D',
      ...same(5, 7),
      '@@ -20,4 +20,4 @@',
      ...same(20, 22),
      '-x',
      '+X',
    ])
    expect(hunks.shown.flat().every((i) => typeof i === 'number')).toBe(true)
    const short = layout(['@@ -1,9 +1,9 @@', '-a', '+A', ...same(2, 8), '-i', '+I'])
    expect(short.shown.flat().every((i) => typeof i === 'number')).toBe(true)
  })

  it('folds up to a note, which stays shown', () => {
    const { shown } = layout(['@@ -1,9 +1,9 @@', '-a', '+A', ...same(2, 9), '\\ No newline at end of file'])
    expect(shown[2]).toEqual([3, 4, 5, { at: 6, rows: range(6, 10) }, 11])
  })
})

describe('changeLine', () => {
  it('is the first added line of a change, or the line now in place of deletions', () => {
    const { rows, blocks } = layout(['@@ -1,6 +1,6 @@', ' a', '-b', '+B', ' c', '-d', ' e', '-f'])
    expect(blocks.filter((b) => b.change).map((b) => changeLine(rows, b))).toEqual([2, 4, 4])
  })
})

const file = (path: string): DiffFile => ({
  path,
  status: 'modified',
  add: 1,
  del: 0,
  binary: false,
  lines: [],
})
const repo = (path: string): DiffRepo => ({
  path,
  kind: path ? 'submodule' : 'root',
  branch: 'main',
  base: null,
  truncated: false,
})

describe('listOrder', () => {
  const files = ['src/b.ts', 'README.md', 'lib/z.ts', 'src/a/x.ts'].map(file)

  it('follows the list: patch order, or the tree’s folders first, per repo', () => {
    const paths = (fs: DiffFile[]) => fs.map((f) => f.path)
    expect(paths(listOrder(files, [], false))).toEqual(['src/b.ts', 'README.md', 'lib/z.ts', 'src/a/x.ts'])
    expect(paths(listOrder(files, [], true))).toEqual(['lib/z.ts', 'src/a/x.ts', 'src/b.ts', 'README.md'])
    expect(paths(listOrder(files, [repo(''), repo('lib')], false))).toEqual([
      'src/b.ts',
      'README.md',
      'src/a/x.ts',
      'lib/z.ts',
    ])
  })
})

describe('repoOf', () => {
  it('is the repo with the longest path holding the file', () => {
    const repos = [repo(''), repo('lib'), repo('lib/sub')]
    expect(repoOf('lib/sub/a.ts', repos)?.path).toBe('lib/sub')
    expect(repoOf('libs/a.ts', repos)?.path).toBe('')
    expect(repoOf('a.ts', [])).toBeUndefined()
  })
})
