import { useEffect, useState } from 'react'
import { Button, toast } from '../../ui'
import './live.css'

/** Seconds until `at`, ticking; 0 once past. */
function useSecondsLeft(at: string | undefined) {
  const left = () => (at ? Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 1000)) : 0)
  const [secs, setSecs] = useState(left)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `left` reads `at`.
  useEffect(() => {
    setSecs(left())
    if (!at) return
    const timer = setInterval(() => setSecs(left()), 1000)
    return () => clearInterval(timer)
  }, [at])
  return secs
}

/**
 * A failed live preview's next automatic try, and 立即重试 for when its cause is fixed (a window shown again). The
 * button spins until the machine reports again (`attempt` changes).
 */
export function CastRetry({
  retryAt,
  attempt,
  retry,
}: {
  retryAt?: string
  attempt: unknown
  retry: () => Promise<unknown>
}) {
  const secs = useSecondsLeft(retryAt)
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new report from the machine ends the wait.
  useEffect(() => setBusy(false), [attempt])
  const click = async () => {
    setBusy(true)
    try {
      await retry()
    } catch (e) {
      setBusy(false)
      toast({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <span className="cast-retry">
      {retryAt ? <span>{busy || secs === 0 ? '正在重试…' : `${secs} 秒后自动重试`}</span> : null}
      <Button size="small" loading={busy} onClick={() => void click()}>
        立即重试
      </Button>
    </span>
  )
}
