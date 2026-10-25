import type { GitCommit, GitLogDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { api, errorText } from '../../../lib/api'
import { gitUrls, type LogFilter } from '../api'

interface LogState {
  key: string
  commits: GitCommit[]
  hasMore: boolean
  loading: boolean
  error: string | null
}

const same = (a: GitCommit, b: GitCommit | undefined) =>
  !!b && a.hash === b.hash && a.refs.join('\n') === b.refs.join('\n')

/**
 * A repo's log, a page at a time (`more` appends the next). A new query starts over; a new `stamp` (the git status
 * changed) re-reads as many commits as are listed, keeping the list as it was when nothing changed.
 */
export function useLog(
  base: string,
  repo: string | null,
  ref: string | null,
  filter: LogFilter,
  stamp: string,
) {
  const page = (skip: number) => gitUrls.log(base, ref, skip, repo, filter)
  const key = page(0)
  const fresh: LogState = { key, commits: [], hasMore: false, loading: true, error: null }
  const [state, setState] = useState(fresh)
  const shown = state.key === key ? state : fresh

  const load = (skip: number) => {
    setState((s) => (s.key !== key ? fresh : { ...s, loading: true, error: null }))
    api.get<GitLogDto>(page(skip)).then(
      (r) =>
        setState((s) => {
          if (s.key !== key) return s
          const kept = s.commits.slice(0, skip)
          // A commit made between two pages shifts the history: the next page repeats the last ones listed.
          const listed = new Set(kept.map((c) => c.hash))
          const commits = [...kept, ...r.commits.filter((c) => !listed.has(c.hash))]
          // A page with nothing new would only be asked for again.
          const hasMore = r.hasMore && commits.length > kept.length
          return { key, commits, hasMore, loading: false, error: null }
        }),
      (e: unknown) => setState((s) => (s.key !== key ? s : { ...s, loading: false, error: errorText(e) })),
    )
  }
  const loaded = useRef(shown.commits.length)
  loaded.current = shown.commits.length
  /** Reads as many commits as are listed again (IDEA keeps the scroll), keeping the list when nothing changed. */
  const refresh = async () => {
    const want = Math.max(loaded.current, 1)
    let commits: GitCommit[] = []
    let hasMore = true
    try {
      while (hasMore && commits.length < want) {
        const r = await api.get<GitLogDto>(page(commits.length))
        const listed = new Set(commits.map((c) => c.hash))
        const added = r.commits.filter((c) => !listed.has(c.hash))
        commits = [...commits, ...added]
        hasMore = r.hasMore && added.length > 0
      }
    } catch (e) {
      // A failed refresh keeps the list it would have replaced.
      setState((s) => (s.key !== key || s.commits.length ? s : { ...s, loading: false, error: errorText(e) }))
      return
    }
    setState((s) => {
      if (s.key !== key) return s
      if (s.commits.length === commits.length && commits.every((c, i) => same(c, s.commits[i])))
        return s.loading ? { ...s, loading: false } : s
      return { key, commits, hasMore, loading: false, error: null }
    })
  }
  const latest = useRef({ load, refresh })
  latest.current = { load, refresh }

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts the list over
  useEffect(() => latest.current.load(0), [key])
  const seen = useRef(stamp)
  useEffect(() => {
    if (seen.current === stamp) return
    seen.current = stamp
    void latest.current.refresh()
  }, [stamp])

  return {
    ...shown,
    more: () => {
      if (shown.hasMore && !shown.loading) load(shown.commits.length)
    },
    /** Reads what is listed again. */
    reload: () => void refresh(),
    /** Retries the page that failed. */
    retry: () => load(shown.commits.length),
  }
}
