import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText } from '../../lib/api'

export interface UsageQueryState<T> {
  data: T | null
  error: string
  /** True only before the first payload arrives (no previous data to keep visible). */
  initialLoading: boolean
  /** True while refetching with previous data still rendered (stale-while-revalidate). */
  stale: boolean
  loading: boolean
  reload: () => void
}

/**
 * Stale-while-revalidate GET hook with AbortController cancellation:
 * rapid filter/tab switches abort superseded requests and keep previous data mounted so the layout never flashes to a spinner.
 */
export function useUsageQuery<T>(path: string | null, refreshKey = 0): UsageQueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!!path)
  const [tick, setTick] = useState(0)
  const reqId = useRef(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey and tick intentionally re-trigger fetches
  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    const id = ++reqId.current
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api.get<T>(path, controller.signal).then(
      (res) => {
        if (controller.signal.aborted || id !== reqId.current) return
        setData(res)
        setError('')
        setLoading(false)
      },
      (err) => {
        if (controller.signal.aborted || id !== reqId.current) return
        setError(errorText(err))
        setLoading(false)
      },
    )
    return () => {
      controller.abort()
    }
  }, [path, refreshKey, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])

  return {
    data,
    error,
    loading,
    initialLoading: loading && data === null && !error,
    stale: loading && data !== null,
    reload,
  }
}

/** Runs `onTick` on an interval (seconds) while the document is visible; interval <= 0 disables it. */
export function useAutoRefresh(intervalSec: number, onTick: () => void) {
  const cb = useRef(onTick)
  cb.current = onTick
  useEffect(() => {
    if (intervalSec <= 0) return
    const ms = intervalSec * 1000
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) cb.current()
    }, ms)
    return () => window.clearInterval(id)
  }, [intervalSec])
}
