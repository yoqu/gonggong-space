import { useState } from 'react'
import { t } from '../i18n'
import { useDaemon } from '../store'
import { ConnectionDiagnosticsDialog, statusConnSummary } from './ConnectionDiagnosticsDialog'

export function StatusLine({ onOpenOverview }: { onOpenOverview?: () => void }) {
  const info = useDaemon((s) => s.info)
  const snapshot = useDaemon((s) => s.snapshot)
  const [diagOpen, setDiagOpen] = useState(false)

  const status = snapshot.phase === 'running' ? snapshot.status : null
  const conn = statusConnSummary(snapshot)
  const runs = status?.runs ?? []
  const running = runs.filter((r) => !r.queued).length
  const queued = runs.filter((r) => r.queued).length
  const taskLabel =
    running === 0 && queued === 0
      ? t('空闲')
      : queued === 0
        ? t('运行中 {n}', { n: running })
        : t('运行中 {n} · 排队 {m}', { n: running, m: queued })

  return (
    <>
      <footer className="dk-statusline" data-testid="status-line">
        <button
          type="button"
          className="dk-statusline__btn"
          data-testid="status-conn"
          title={t('查看连接诊断')}
          onClick={() => setDiagOpen(true)}
        >
          <span className={`dk-statusline__dot dk-statusline__dot--${conn.tone}`} aria-hidden="true" />
          <span>{conn.label}</span>
        </button>
        <button
          type="button"
          className="dk-statusline__btn"
          data-testid="status-tasks"
          onClick={onOpenOverview}
        >
          {taskLabel}
        </button>
        <span className="dk-flex" />
        {info ? <span data-testid="status-version">{`v${info.version}`}</span> : null}
      </footer>
      <ConnectionDiagnosticsDialog open={diagOpen} onClose={() => setDiagOpen(false)} />
    </>
  )
}
