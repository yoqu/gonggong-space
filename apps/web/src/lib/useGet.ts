import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from './api'

/** GET `path` (skipped while null); `data` resets to null when the path changes, `reload` keeps it until fresh data arrives. */
export function useGet<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!!path)
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the path changes
  useEffect(() => {
    setData(null)
    setError('')
  }, [path])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-runs the request
  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    api.get<T>(path).then(
      (d) => {
        if (!live) return
        setData(d)
        setError('')
        setLoading(false)
      },
      (e) => {
        if (!live) return
        setError(errorText(e))
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}
