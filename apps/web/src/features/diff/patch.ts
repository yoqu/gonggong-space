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

/** A path from a reply (relative, `./`-prefixed or absolute inside the workspace) against the patch's paths. */
export function findFile(files: DiffFile[], path: string) {
  const p = path.replace(/^\.\//, '')
  return files.find((f) => p === f.path || p.endsWith(`/${f.path}`))
}

export interface DiffDir {
  kind: 'dir'
  path: string
  name: string
  children: DiffNode[]
}
export type DiffNode = DiffDir | { kind: 'file'; name: string; file: DiffFile }

/** Files grouped by folder, folders first; a folder holding only one folder folds into `a/b` like IDE trees. */
export function diffTree(files: DiffFile[], prefix = ''): DiffNode[] {
  const root: DiffDir = { kind: 'dir', path: '', name: '', children: [] }
  for (const file of files) {
    const parts = file.path.slice(prefix.length).split('/')
    const name = parts.pop() ?? file.path
    let dir = root
    for (const part of parts) {
      const path = dir.path ? `${dir.path}/${part}` : part
      let next = dir.children.find((c): c is DiffDir => c.kind === 'dir' && c.path === path)
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

function tidy(dir: DiffDir): DiffDir {
  const children = dir.children
    .map((c) => (c.kind === 'dir' ? fold(tidy(c)) : c))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  return { ...dir, children }
}

function fold(dir: DiffDir): DiffDir {
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

/** Each file goes to the repo with the longest path prefixing it; groups keep the repos' order. */
export function groupByRepo(files: DiffFile[], repos: DiffRepo[]): RepoGroup[] {
  const groups = repos.map((repo) => ({ repo, files: [] as DiffFile[], add: 0, del: 0 }))
  const byDepth = [...groups].sort((a, b) => b.repo.path.length - a.repo.path.length)
  for (const file of files) {
    const g = byDepth.find((g) => file.path.startsWith(repoPrefix(g.repo.path)))
    if (!g) continue
    g.files.push(file)
    g.add += file.add
    g.del += file.del
  }
  return groups
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
