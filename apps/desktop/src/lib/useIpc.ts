import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Loads an IPC query with unmount/stale-response cancellation, initial error state (for `<Alert onRetry>` instead of
 * an eternal skeleton), and optional silent polling that preserves existing data on transient failures.
 */
export function useIpc<T>(load: () => Promise<T>, options?: { pollMs?: number }) {
  const pollMs = options?.pollMs
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const hasDataRef = useRef(false)
  const reqRef = useRef(0)

  const run = useCallback(
    async (silent: boolean) => {
      const req = ++reqRef.current
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      try {
        const value = await load()
        if (req !== reqRef.current) return
        hasDataRef.current = true
        setData(value)
        setError(null)
      } catch (e) {
        if (req !== reqRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (req === reqRef.current) setLoading(false)
      }
    },
    [load],
  )

  useEffect(() => {
    void run(false)
    if (!pollMs) {
      return () => {
        reqRef.current++
      }
    }
    const timer = setInterval(() => void run(true), pollMs)
    return () => {
      clearInterval(timer)
      reqRef.current++
    }
  }, [run, pollMs])

  const reload = useCallback(() => run(false), [run])
  return { data, error, loading, reload }
}
