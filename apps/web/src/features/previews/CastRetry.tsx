import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { useNow } from '../../lib/now'
import { Button } from '../../ui'
import './live.css'

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
  const now = useNow(!!retryAt)
  const secs = retryAt ? Math.max(0, Math.ceil((Date.parse(retryAt) - now) / 1000)) : 0
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new report from the machine ends the wait.
  useEffect(() => setBusy(false), [attempt])
  const click = async () => {
    setBusy(true)
    try {
      await retry()
    } catch (e) {
      setBusy(false)
      toastError(e)
    }
  }
  return (
    <span className="cast-retry">
      {retryAt ? (
        <span>{busy || secs === 0 ? t('正在重试…') : t('{n} 秒后自动重试', { n: secs })}</span>
      ) : null}
      <Button size="small" loading={busy} onClick={() => void click()}>
        {t('立即重试')}
      </Button>
    </span>
  )
}
