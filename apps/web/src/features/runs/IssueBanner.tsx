import { useState } from 'react'
import { t } from '../../i18n'
import { copyWithToast } from '../../lib/clipboard'
import { Button, Icon } from '../../ui'
import type { RunIssue } from './issue'
import './runs.css'

const HEAD_LINES = 4

/**
 * Why the run failed or waits, its reason in full (folded past a few lines) and what to do about it.
 * `onRetry` resolves whether it worked; after success the button stays disabled so one click starts one run.
 */
export function IssueBanner({ issue, onRetry }: { issue: RunIssue; onRetry?: () => Promise<boolean> }) {
  const [all, setAll] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    if (!onRetry) return
    setRetrying(true)
    if (!(await onRetry())) setRetrying(false)
  }
  const lines = issue.detail.replace(/\n+$/, '').split('\n')
  const folded = !all && lines.length > HEAD_LINES
  const error = issue.tone === 'error'
  return (
    <div className="run-issue" data-tone={issue.tone} role={error ? 'alert' : 'status'}>
      <div className="run-issue__head">
        <Icon name={error ? 'exclamation-circle' : 'info'} size={14} />
        <span className="run-issue__title">{issue.title}</span>
        {error && issue.detail ? (
          <button
            type="button"
            className="run-tab__copy"
            aria-label={t('复制错误信息')}
            title={t('复制错误信息')}
            onClick={() => void copyWithToast(issue.detail, t('已复制错误信息'))}
          >
            <Icon name="copy" size={12} />
          </button>
        ) : null}
        {onRetry ? (
          <Button size="small" icon="arrow-clockwise" disabled={retrying} onClick={() => void retry()}>
            {t('重新运行')}
          </Button>
        ) : null}
      </div>
      {issue.detail ? (
        issue.mono ? (
          <pre className="run-issue__detail run-issue__detail--mono">
            {(folded ? lines.slice(0, HEAD_LINES) : lines).join('\n')}
          </pre>
        ) : (
          <div className="run-issue__detail">{(folded ? lines.slice(0, HEAD_LINES) : lines).join('\n')}</div>
        )
      ) : null}
      {folded ? (
        <button type="button" className="run-issue__more" onClick={() => setAll(true)}>
          {t('展开全部')}
        </button>
      ) : null}
      {issue.hint ? <div className="run-issue__hint">{issue.hint}</div> : null}
    </div>
  )
}
