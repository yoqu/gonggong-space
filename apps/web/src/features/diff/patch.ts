export interface DiffFile {
  path: string
  status: 'added' | 'deleted' | 'modified'
  add: number
  del: number
  binary: boolean
  /** Hunk headers and lines (or the binary notice), without the file header. */
  lines: string[]
}

const HEADER = /^diff --git (?:"?a\/(.+?)"? )"?b\/(.+?)"?$/

/** Splits a unified git patch into files with +/− counts. */
export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let inHunks = false
  for (const line of patch.split('\n')) {
    const path = HEADER.exec(line)?.[2]
    if (path !== undefined) {
      file = { path, status: 'modified', add: 0, del: 0, binary: false, lines: [] }
      files.push(file)
      inHunks = false
      continue
    }
    if (!file) continue
    if (!inHunks) {
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('Binary files ')) {
        file.binary = true
        inHunks = true
        file.lines.push(line)
      } else if (line.startsWith('@@')) inHunks = true
      if (!inHunks || file.binary) continue
    }
    if (line.startsWith('+')) file.add += 1
    else if (line.startsWith('-')) file.del += 1
    file.lines.push(line)
  }
  for (const f of files) while (f.lines.at(-1) === '') f.lines.pop()
  return files
}

/** A path from a reply (relative, `./`-prefixed or absolute inside the workspace) against the patch's paths. */
export function findFile(files: DiffFile[], path: string) {
  const p = path.replace(/^\.\//, '')
  return files.find((f) => p === f.path || p.endsWith(`/${f.path}`))
}

export type DiffCell = 'add' | 'del' | 'none'

/** GitHub-style five-cell bar: one cell per changed line up to five, split by ratio, each present side kept visible. */
export function diffCells(add: number, del: number): DiffCell[] {
  const total = add + del
  const colored = Math.min(5, total)
  let adds = total ? Math.round((add / total) * colored) : 0
  if (add && !adds) adds = 1
  if (del && adds === colored) adds = colored - 1
  return Array.from({ length: 5 }, (_, i) => (i < adds ? 'add' : i < colored ? 'del' : 'none'))
}
