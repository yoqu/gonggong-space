import type { DiffRow } from './patch'

/** Rows kept together: a change (the deletions and additions between context lines) or a run of other rows. */
export interface DiffBlock {
  change: boolean
  /** Row indices in patch order, as the unified view shows them. */
  rows: number[]
  /** The same rows side by side as [old, new] row indices; null leaves that side empty. */
  pairs: [number | null, number | null][]
}

/**
 * Groups rows into blocks. Side by side, a change lists its deletions left and its additions right, paired row by
 * row; a note (no newline at end of file) stays on the side of the line before it; other rows fill both sides.
 */
export function diffBlocks(rows: DiffRow[]): DiffBlock[] {
  const blocks: DiffBlock[] = []
  const sides: [number[], number[]] = [[], []]
  let side: 0 | 1 = 0
  const pair = (b: DiffBlock) => {
    for (let k = 0; k < Math.max(sides[0].length, sides[1].length); k++)
      b.pairs.push([sides[0][k] ?? null, sides[1][k] ?? null])
    sides[0] = []
    sides[1] = []
  }
  rows.forEach((row, i) => {
    let block = blocks.at(-1)
    const change = row.kind === 'add' || row.kind === 'del' || (row.kind === 'note' && !!block?.change)
    if (block?.change !== change) {
      if (block?.change) pair(block)
      block = { change, rows: [], pairs: [] }
      blocks.push(block)
    }
    block.rows.push(i)
    if (!change) block.pairs.push([i, i])
    else {
      if (row.kind !== 'note') side = row.kind === 'del' ? 0 : 1
      sides[side].push(i)
    }
  })
  const last = blocks.at(-1)
  if (last?.change) pair(last)
  return blocks
}

/** A stretch of unchanged rows shown as one row to expand. */
export interface Fold {
  /** Its first row, which names it. */
  at: number
  rows: number[]
}

/** Unchanged lines kept beside a change when the rest fold (git's default context). */
const FOLD_CONTEXT = 3
/** Shorter stretches stay shown: a row to expand them would hardly save room. */
const FOLD_MIN = 3

/**
 * Each block's rows with its stretches of unchanged lines folded (IDEA's Collapse Unchanged Fragments): a run of
 * context lines keeps FOLD_CONTEXT lines beside each change it borders and folds the rest.
 */
export function foldBlocks(rows: DiffRow[], blocks: DiffBlock[]): (number | Fold)[][] {
  return blocks.map((block, b) => {
    if (block.change) return block.rows
    const out: (number | Fold)[] = []
    let run: number[] = []
    const flush = (ends: boolean) => {
      const head = run[0] === block.rows[0] && blocks[b - 1]?.change ? FOLD_CONTEXT : 0
      const tail = ends && blocks[b + 1]?.change ? FOLD_CONTEXT : 0
      const hidden = run.slice(head, Math.max(head, run.length - tail))
      const [at] = hidden
      if (at !== undefined && hidden.length >= FOLD_MIN)
        out.push(...run.slice(0, head), { at, rows: hidden }, ...run.slice(head + hidden.length))
      else out.push(...run)
      run = []
    }
    for (const i of block.rows) {
      if (rows[i]?.kind === 'context') run.push(i)
      else {
        flush(false)
        out.push(i)
      }
    }
    flush(true)
    return out
  })
}

/** Where a change sits in the new file: its first added line, or for deletions only the line now in their place. */
export function changeLine(rows: DiffRow[], block: DiffBlock) {
  const first = block.rows[0] ?? 0
  const added = block.rows.find((i) => rows[i]?.newNo != null)
  return rows[added ?? (block.rows.at(-1) ?? first) + 1]?.newNo ?? rows[first - 1]?.newNo ?? 1
}
