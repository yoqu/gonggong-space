import { describe, expect, it } from 'vitest'
import { changePatch, lineMarks, undoPatch } from '../src/features/diff/hunk'
import { type DiffFile, diffRows, parsePatch } from '../src/features/diff/patch'
import { diffBlocks } from '../src/features/diff/split'

const HEAD = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts']
/** Each change's patch, in order. */
const patches = (lines: string[], path = 'src/a.ts') => {
  const rows = diffRows(lines)
  return diffBlocks(rows)
    .filter((b) => b.change)
    .map((b) => changePatch(path, rows, b))
}
const patch = (...lines: string[]) => [...HEAD, ...lines, ''].join('\n')
const file = (lines: string[]): DiffFile => ({
  path: 'src/a.ts',
  status: 'modified',
  add: 0,
  del: 0,
  binary: false,
  lines,
})

describe('changePatch', () => {
  it('takes up to three unchanged lines around a change, numbering the hunk from them', () => {
    const lines = [
      '@@ -1,12 +1,12 @@',
      ' l1',
      '-a',
      '+A',
      ...[3, 4, 5, 6, 7].map((n) => ` l${n}`),
      '-x',
      '+X',
      ...[9, 10, 11, 12].map((n) => ` l${n}`),
    ]
    expect(patches(lines)).toEqual([
      patch('@@ -1,5 +1,5 @@', ' l1', '-a', '+A', ' l3', ' l4', ' l5'),
      patch('@@ -5,7 +5,7 @@', ' l5', ' l6', ' l7', '-x', '+X', ' l9', ' l10', ' l11'),
    ])
  })

  it('counts each side apart for lines only taken out or only added, up to the end of the file', () => {
    const lines = ['@@ -1,6 +1,7 @@', ' a', ' b', '-c', ' d', ' e', ' f', '+g', '+h']
    expect(patches(lines)).toEqual([
      patch('@@ -1,6 +1,5 @@', ' a', ' b', '-c', ' d', ' e', ' f'),
      patch('@@ -4,3 +3,5 @@', ' d', ' e', ' f', '+g', '+h'),
    ])
  })

  it('stops the context at a neighbouring change', () => {
    const lines = ['@@ -1,4 +1,4 @@', '-a', '+A', ' b', '-c', '+C', ' d']
    expect(patches(lines)).toEqual([
      patch('@@ -1,2 +1,2 @@', '-a', '+A', ' b'),
      patch('@@ -2,3 +2,3 @@', ' b', '-c', '+C', ' d'),
    ])
  })

  it('keeps the note of a last line without a newline', () => {
    const lines = ['@@ -1,3 +1,3 @@', '-x', '+y', ' m', ' n', '\\ No newline at end of file']
    expect(patches(lines)).toEqual([
      patch('@@ -1,3 +1,3 @@', '-x', '+y', ' m', ' n', '\\ No newline at end of file'),
    ])
  })

  it('numbers a change of a later hunk from that hunk', () => {
    const lines = [
      '@@ -1,4 +1,4 @@',
      '-a',
      '+A',
      ' b',
      ' c',
      ' d',
      '@@ -20,3 +20,4 @@',
      ' t',
      ' u',
      ' v',
      '+w',
    ]
    expect(patches(lines)[1]).toBe(patch('@@ -20,3 +20,4 @@', ' t', ' u', ' v', '+w'))
  })

  it('names an empty side by the line before it', () => {
    expect(patches(['@@ -1,2 +0,0 @@', '-a', '-b'])).toEqual([patch('@@ -1,2 +0,0 @@', '-a', '-b')])
  })
})

describe('undoPatch', () => {
  it('swaps the sides of a rolled back change, where it now sits', () => {
    expect(undoPatch(patch('@@ -1,6 +1,5 @@', ' a', ' b', '-c', ' d', ' e', ' f'))).toBe(
      patch('@@ -1,5 +1,6 @@', ' a', ' b', '+c', ' d', ' e', ' f'),
    )
    expect(undoPatch(patch('@@ -1,3 +1,3 @@', '-x', '+y', ' m', ' n', '\\ No newline at end of file'))).toBe(
      patch('@@ -1,3 +1,3 @@', '+x', '-y', ' m', ' n', '\\ No newline at end of file'),
    )
  })

  it('numbers both sides by the work tree, since changes before it stay', () => {
    // x and y were added above: the rolled back d now sits at line 3 of the file, not at HEAD's line 1.
    const lines = ['@@ -1,5 +1,7 @@', '+x', '+y', ' a', ' b', ' c', '-d', '+D', ' e']
    const [, second] = patches(lines)
    expect(second).toBe(patch('@@ -1,5 +3,5 @@', ' a', ' b', ' c', '-d', '+D', ' e'))
    expect(undoPatch(second ?? '')).toBe(patch('@@ -3,5 +3,5 @@', ' a', ' b', ' c', '+d', '-D', ' e'))
    expect(undoPatch(patch('@@ -4,3 +3,5 @@', ' d', ' e', ' f', '+g', '+h'))).toBe(
      patch('@@ -3,5 +3,3 @@', ' d', ' e', ' f', '-g', '-h'),
    )
  })

  it('leaves deleted lines that look like file headers alone', () => {
    expect(undoPatch(patch('@@ -1,2 +1 @@', '--- sql comment', ' x'))).toBe(
      patch('@@ -1 +1,2 @@', '+-- sql comment', ' x'),
    )
  })
})

describe('lineMarks', () => {
  it('marks each change in the new file’s lines: modified, deleted (on top of the next line) or added', () => {
    const marks = lineMarks(
      file(['@@ -1,5 +1,5 @@', ' one', '-two', '+TWO', ' three', '-gone', ' four', '+new']),
    )
    expect(marks.map(({ patch: _, ...m }) => m)).toEqual([
      { kind: 'modified', from: 2, to: 2, old: ['two'] },
      { kind: 'deleted', from: 4, to: 3, old: ['gone'] },
      { kind: 'added', from: 5, to: 5, old: [] },
    ])
    expect(marks[0]?.patch).toBe(patch('@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'))
  })
})

describe('parsePatch', () => {
  it('keeps a rename’s source', () => {
    const [f] = parsePatch(
      [
        'diff --git a/old.ts b/new.ts',
        'similarity index 90%',
        'rename from old.ts',
        'rename to new.ts',
        '--- a/old.ts',
        '+++ b/new.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        '',
      ].join('\n'),
    )
    expect(f).toMatchObject({ path: 'new.ts', oldPath: 'old.ts', status: 'modified', add: 1, del: 1 })
    expect(f?.lines).toEqual(['@@ -1 +1 @@', '-a', '+b'])
  })
})
