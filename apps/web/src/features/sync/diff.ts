/** Beyond this many line pairs the diff is not aligned: every old line shows removed, every new one added. */
const ALIGN_MAX = 4_000_000

/** Unified-style lines (` ` kept, `-` removed, `+` added) taking `a` to `b`, by longest common subsequence. */
export function lineDiff(a: string, b: string): string[] {
  const x = a === '' ? [] : a.replace(/\n$/, '').split('\n')
  const y = b === '' ? [] : b.replace(/\n$/, '').split('\n')
  if (x.length * y.length > ALIGN_MAX) return [...x.map((l) => `-${l}`), ...y.map((l) => `+${l}`)]
  const w = y.length + 1
  const lcs = new Uint32Array((x.length + 1) * w)
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i * w + j] =
        x[i] === y[j]
          ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0)
  const out: string[] = []
  let i = 0
  let j = 0
  const at = (i: number, j: number) => lcs[i * w + j] ?? 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push(` ${x[i]}`)
      i++
      j++
    } else if (j < y.length && (i === x.length || at(i, j + 1) >= at(i + 1, j))) out.push(`+${y[j++]}`)
    else out.push(`-${x[i++]}`)
  }
  return out
}
