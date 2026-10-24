import type { DiffRepo } from '@gonggong/protocol'

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

export interface DiffRow {
  kind: 'context' | 'add' | 'del' | 'hunk' | 'note'
  oldNo: number | null
  newNo: number | null
  /** The code without its +/-/space mark; hunk headers and notes as they are. */
  text: string
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** A file's patch lines numbered in the old and the new file; lines before any hunk header count from 1. */
export function diffRows(lines: string[]): DiffRow[] {
  let oldNo = 1
  let newNo = 1
  return lines.map((line): DiffRow => {
    if (line.startsWith('@@')) {
      const hunk = HUNK.exec(line)
      if (hunk) {
        oldNo = Number(hunk[1])
        newNo = Number(hunk[2])
      }
      return { kind: 'hunk', oldNo: null, newNo: null, text: line }
    }
    const text = line.slice(1)
    if (line.startsWith('+')) return { kind: 'add', oldNo: null, newNo: newNo++, text }
    if (line.startsWith('-')) return { kind: 'del', oldNo: oldNo++, newNo: null, text }
    // A blank line is a context line whose space was trimmed.
    if (line.startsWith(' ') || line === '') return { kind: 'context', oldNo: oldNo++, newNo: newNo++, text }
    return { kind: 'note', oldNo: null, newNo: null, text: line }
  })
}

/** A path from a reply (relative, `./`-prefixed or absolute inside the workspace) against the patch's paths. */
export function findFile(files: DiffFile[], path: string) {
  const p = path.replace(/^\.\//, '')
  return files.find((f) => p === f.path || p.endsWith(`/${f.path}`))
}

export interface DiffDir<F = DiffFile> {
  kind: 'dir'
  path: string
  name: string
  children: DiffNode<F>[]
}
export type DiffNode<F = DiffFile> = DiffDir<F> | { kind: 'file'; name: string; file: F }

/** Files grouped by folder, folders first; a folder holding only one folder folds into `a/b` like IDE trees. */
export function diffTree<F extends { path: string }>(files: F[], prefix = ''): DiffNode<F>[] {
  const root: DiffDir<F> = { kind: 'dir', path: '', name: '', children: [] }
  for (const file of files) {
    const parts = file.path.slice(prefix.length).split('/')
    const name = parts.pop() ?? file.path
    let dir = root
    for (const part of parts) {
      const path = dir.path ? `${dir.path}/${part}` : part
      let next = dir.children.find((c): c is DiffDir<F> => c.kind === 'dir' && c.path === path)
      if (!next) {
        next = { kind: 'dir', path, name: part, children: [] }
        dir.children.push(next)
      }
      dir = next
    }
    dir.children.push({ kind: 'file', name, file })
  }
  return tidy(root).children
}

function tidy<F>(dir: DiffDir<F>): DiffDir<F> {
  const children = dir.children
    .map((c) => (c.kind === 'dir' ? fold(tidy(c)) : c))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  return { ...dir, children }
}

function fold<F>(dir: DiffDir<F>): DiffDir<F> {
  const [only, ...rest] = dir.children
  return only?.kind === 'dir' && !rest.length ? { ...only, name: `${dir.name}/${only.name}` } : dir
}

export interface RepoGroup {
  repo: DiffRepo
  files: DiffFile[]
  add: number
  del: number
}

/** The path prefix of a repo's files ('' for the root). */
export const repoPrefix = (path: string) => (path ? `${path}/` : '')

/** Whether the patch spans more than the root repo, so its files are listed per repo. */
export const isMultiRepo = (repos: DiffRepo[]) =>
  repos.length > 1 || (repos.length === 1 && repos[0]?.path !== '')

/** The repo holding a file: the one with the longest path prefixing it. */
export function repoOf(path: string, repos: DiffRepo[]) {
  let best: DiffRepo | undefined
  for (const r of repos)
    if (path.startsWith(repoPrefix(r.path)) && (!best || r.path.length > best.path.length)) best = r
  return best
}

/** Each file goes to the repo holding it; groups keep the repos' order. */
export function groupByRepo(files: DiffFile[], repos: DiffRepo[]): RepoGroup[] {
  const groups = repos.map((repo) => ({ repo, files: [] as DiffFile[], add: 0, del: 0 }))
  for (const file of files) {
    const repo = repoOf(file.path, repos)
    const g = groups.find((g) => g.repo === repo)
    if (!g) continue
    g.files.push(file)
    g.add += file.add
    g.del += file.del
  }
  return groups
}

/** Files in the order the list shows them: per repo when it spans several, folders first when shown as a tree. */
export function listOrder(files: DiffFile[], repos: DiffRepo[], tree: boolean): DiffFile[] {
  const groups = isMultiRepo(repos)
    ? groupByRepo(files, repos).map((g) => ({ files: g.files, prefix: repoPrefix(g.repo.path) }))
    : [{ files, prefix: '' }]
  const walk = (nodes: DiffNode[]): DiffFile[] =>
    nodes.flatMap((n) => (n.kind === 'file' ? [n.file] : walk(n.children)))
  return groups.flatMap((g) => (tree ? walk(diffTree(g.files, g.prefix)) : g.files))
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
