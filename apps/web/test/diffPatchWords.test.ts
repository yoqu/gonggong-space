import { describe, expect, it } from 'vitest'
import { diffRows } from '../src/features/diff/patch'
import { diffBlocks } from '../src/features/diff/split'
import { wordDiff, wordMarks } from '../src/features/diff/words'

describe('wordDiff', () => {
  it('marks the words that changed on each side', () => {
    expect(wordDiff('const total = price * 2', 'const total = cost * 3')).toEqual([
      [
        [14, 19],
        [22, 23],
      ],
      [
        [14, 18],
        [21, 22],
      ],
    ])
  })

  it('marks only what was inserted when nothing was taken out', () => {
    expect(wordDiff('call(a)', 'call(a, b)')).toEqual([[], [[6, 9]]])
  })

  it('compares Chinese text character by character', () => {
    expect(wordDiff('今天天气很好', '今天天气不好')).toEqual([[[4, 5]], [[4, 5]]])
  })

  it('marks changed indentation', () => {
    expect(wordDiff('  return x', '    return x')).toEqual([[[0, 2]], [[0, 4]]])
  })

  it('marks single characters when asked to (IDEA’s Highlight characters)', () => {
    expect(wordDiff('const total = price * 2', 'const total = cost * 2', 'chars')).toEqual([
      [
        [14, 17],
        [18, 19],
      ],
      [[15, 18]],
    ])
  })

  it('gives up on rewritten lines and very long ones', () => {
    expect(wordDiff('old', 'new')).toBeNull()
    expect(wordDiff('const a = 1', 'return fetchAll()')).toBeNull()
    const long = `x = ${'a'.repeat(600)}`
    expect(wordDiff(long, `${long} + 1`)).toBeNull()
  })
})

describe('wordMarks', () => {
  it('marks each deleted line against the added line beside it', () => {
    const rows = diffRows(['@@ -1,3 +1,2 @@', '-let a = 1', '-let b = 2', '+let a = 10', ' end'])
    expect(wordMarks(rows, diffBlocks(rows))).toEqual(
      new Map([
        [1, [[8, 9]]],
        [3, [[8, 10]]],
      ]),
    )
  })
})
