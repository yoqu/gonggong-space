import { describe, expect, it } from 'vitest'
import {
  applySide,
  diffLines,
  ignoreSide,
  initialState,
  isResolved,
  joinText,
  magic,
  type Piece,
  simpleMerge,
  splitTexts,
  threeWay,
} from '../src/features/git/merge'

const L = (s: string) => (s ? s.split(' ') : [])

describe('line diff', () => {
  it('lists the changed runs as base and side ranges', () => {
    expect(diffLines(L('a b c d'), L('a x c d e'))).toEqual([
      { bs: 1, be: 2, ss: 1, se: 2 },
      { bs: 4, be: 4, ss: 4, se: 5 },
    ])
    expect(diffLines([], L('a b'))).toEqual([{ bs: 0, be: 0, ss: 0, se: 2 }])
    expect(diffLines(L('a b'), L('a b'))).toEqual([])
  })

  it('compares through a key, e.g. without whitespace', () => {
    const key = (s: string) => s.replace(/\s+/g, '')
    expect(diffLines(['a', ' b'], ['a', 'b  '], key)).toEqual([])
  })
})

describe('three-way merge', () => {
  const kinds = (ps: Piece[]) => ps.map((p) => p.kind)

  it('splits into agreed runs, changes of one side only, the same change on both, and conflicts', () => {
    const base = L('1 2 3 4 5 6 7 8 9')
    const ours = L('1 A 3 4 5 6 7 8 9 Z')
    const theirs = L('1 2 3 4 B 6 C 8 9 Z')
    const ps = threeWay(base, ours, theirs)
    expect(kinds(ps)).toEqual(['same', 'ours', 'same', 'theirs', 'same', 'theirs', 'same', 'both'])
    expect(ps[1]).toEqual({ kind: 'ours', base: ['2'], ours: ['A'], theirs: ['2'] })
    expect(ps[7]).toEqual({ kind: 'both', base: [], ours: ['Z'], theirs: ['Z'] })
  })

  it('takes changes to the same or touching lines as a conflict', () => {
    const ps = threeWay(L('1 2 3 4'), L('1 X 3 4'), L('1 2 Y 4'))
    expect(kinds(ps)).toEqual(['same', 'conflict', 'same'])
    expect(ps[1]).toEqual({ kind: 'conflict', base: ['2', '3'], ours: ['X', '3'], theirs: ['2', 'Y'] })
    expect(kinds(threeWay(L('1 2'), L('1 x 2'), L('1 y 2')))).toEqual(['same', 'conflict', 'same'])
  })

  it('moves the lines both sides added alike out of a conflict, as zdiff3 does (both added the file)', () => {
    const ps = threeWay([], L('h a t'), L('h b t'))
    expect(ps).toEqual([
      { kind: 'both', base: [], ours: ['h'], theirs: ['h'] },
      { kind: 'conflict', base: [], ours: ['a'], theirs: ['b'] },
      { kind: 'both', base: [], ours: ['t'], theirs: ['t'] },
    ])
  })

  it('covers each side whole, in order (random edits)', () => {
    let seed = 7
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const edit = (xs: string[]) =>
      xs.flatMap((x) => [[x], [x], [x], [], [`${x}'`], [x, `n${rnd(9)}`]][rnd(6)] as string[])
    for (let run = 0; run < 200; run++) {
      const base = Array.from({ length: rnd(30) }, () => `l${rnd(6)}`)
      const ours = edit(base)
      const theirs = edit(base)
      const ps = threeWay(base, ours, theirs)
      expect(ps.flatMap((p) => p.base)).toEqual(base)
      expect(ps.flatMap((p) => p.ours)).toEqual(ours)
      expect(ps.flatMap((p) => p.theirs)).toEqual(theirs)
    }
  })

  it('ignores whitespace-only changes when asked', () => {
    expect(kinds(threeWay(L('a b'), ['a', ' b'], L('a b')))).toEqual(['same', 'ours'])
    expect(kinds(threeWay(L('a b'), ['a', ' b'], L('a b'), true))).toEqual(['same'])
  })
})

describe('settling a change', () => {
  const conflict: Piece = { kind: 'conflict', base: ['b'], ours: ['o'], theirs: ['t'] }

  it('starts non-conflicting changes applied and conflicts open on the base', () => {
    expect(initialState({ kind: 'theirs', base: ['b'], ours: ['b'], theirs: ['t'] })).toEqual({
      lines: ['t'],
      ours: 'ignored',
      theirs: 'applied',
      edited: false,
    })
    const open = initialState(conflict)
    expect(open).toEqual({ lines: ['b'], ours: 'open', theirs: 'open', edited: false })
    expect(isResolved(open)).toBe(false)
  })

  it('accepts a side, then the other one after it (both), or ignores it', () => {
    const left = applySide(conflict, initialState(conflict), 'ours')
    expect(left.lines).toEqual(['o'])
    expect(isResolved(left)).toBe(false)
    const both = applySide(conflict, left, 'theirs')
    expect(both.lines).toEqual(['o', 't'])
    expect(isResolved(both)).toBe(true)
    const ignored = ignoreSide(left, 'theirs')
    expect(ignored.lines).toEqual(['o'])
    expect(isResolved(ignored)).toBe(true)
    // Ignoring both sides keeps the base.
    expect(ignoreSide(ignoreSide(initialState(conflict), 'ours'), 'theirs').lines).toEqual(['b'])
  })

  it('resolves simple conflicts whose changes do not overlap line by line (the magic wand)', () => {
    expect(simpleMerge(L('1 2 3'), L('X 2 3'), L('1 2 Y'))).toEqual(L('X 2 Y'))
    expect(simpleMerge(L('1 2'), L('1 a 2'), L('1 2 b'))).toEqual(L('1 a 2 b'))
    expect(simpleMerge(L('1 2'), L('X 2'), L('Y 2'))).toBeNull()
    expect(simpleMerge(L('1 2'), L('1 a 2'), L('1 b 2'))).toBeNull()
    const touching: Piece = { kind: 'conflict', base: L('2 3'), ours: L('X 3'), theirs: L('2 Y') }
    expect(magic(touching, initialState(touching))?.lines).toEqual(L('X Y'))
    expect(magic(conflict, initialState(conflict))).toBeNull()
  })
})

describe('line ends', () => {
  it('reads CRLF files, writes the result back with CRLF and the final newline', () => {
    const t = splitTexts(['a\r\nb\r\n', 'a\r\nB\r\n', 'a\r\nb\r\nc\r\n'])
    expect(t).toEqual({
      sides: [
        ['a', 'b'],
        ['a', 'B'],
        ['a', 'b', 'c'],
      ],
      eol: '\r\n',
      trailing: true,
    })
    expect(joinText(['a', 'B', 'c'], t.eol, t.trailing)).toBe('a\r\nB\r\nc\r\n')
    expect(splitTexts(['', 'x', 'y'])).toEqual({ sides: [[], ['x'], ['y']], eol: '\n', trailing: false })
    expect(joinText([], '\n', true)).toBe('')
  })

  it('merges CRLF sides line by line, not as one changed blob', () => {
    const t = splitTexts(['a\r\nb\r\nc\r\n', 'A\r\nb\r\nc\r\n', 'a\r\nb\r\nC\r\n'])
    const [base = [], ours = [], theirs = []] = t.sides
    const ps = threeWay(base, ours, theirs)
    expect(ps.map((p) => p.kind)).toEqual(['ours', 'same', 'theirs'])
    expect(
      joinText(
        ps.flatMap((p) => initialState(p).lines),
        t.eol,
        t.trailing,
      ),
    ).toBe('A\r\nb\r\nC\r\n')
  })
})
