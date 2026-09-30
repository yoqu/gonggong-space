import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from './api'

/** GET `path` (skipped while null); `data` resets to null when the path changes, `reload` keeps it until fresh data arrives. */
export function useGet<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the path changes
  useEffect(() => {
    setData(null)
    setError('')
  }, [path])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-runs the request
  useEffect(() => {
    if (!path) return
    let live = true
    api.get<T>(path).then(
      (d) => {
        if (!live) return
        setData(d)
        setError('')
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, reload }
}
