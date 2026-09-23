/** Same ranking as the daemon (crates/aiws/src/files.rs), so workspace and mirror entries interleave consistently. */
export interface PathEntry {
  path: string
  dir: boolean
}

/**
 * Lower is better, null = no match: [kind, length] with kinds 0 path prefix, 1 name prefix, 2 substring, 3 name
 * subsequence. An empty query ranks by depth. Case-insensitive.
 */
export function rank(path: string, query: string): [number, number] | null {
  const p = path.toLowerCase()
  const q = query.toLowerCase()
  const bare = p.replace(/\/$/, '')
  if (!q) return [bare.split('/').length - 1, 0]
  const name = bare.slice(bare.lastIndexOf('/') + 1)
  if (p.startsWith(q)) return [0, p.length]
  if (name.startsWith(q)) return [1, p.length]
  if (p.includes(q)) return [2, p.length]
  let i = 0
  for (const c of name) if (c === q[i]) i++
  return i === q.length ? [3, p.length] : null
}

/** Matching entries, best first (ties by path), at most `limit`. */
export function pick<T extends PathEntry>(entries: T[], query: string, limit: number): T[] {
  return entries
    .flatMap((e) => {
      const r = rank(e.path, query)
      return r ? [{ e, r }] : []
    })
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || (a.e.path < b.e.path ? -1 : 1))
    .slice(0, limit)
    .map(({ e }) => e)
}

/** Files plus every ancestor folder (`a/`, `a/b/`). */
export function withDirs(files: string[]): PathEntry[] {
  const dirs = new Set<string>()
  for (const f of files)
    for (let i = f.indexOf('/'); i >= 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i + 1))
  return [...files.map((path) => ({ path, dir: false })), ...[...dirs].map((path) => ({ path, dir: true }))]
}
