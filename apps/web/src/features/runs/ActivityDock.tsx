import { useState } from 'react'
import { t } from '../../i18n'
import { useNow } from '../../lib/now'
import { Icon } from '../../ui'
import { fmtWorked } from './activity'
import { StopTask } from './ProcessView'
import { runningWork, type Step } from './steps'
import './process.css'

/**
 * Pinned under a run: how many subagents and background tasks are running, the list one click away. Hidden while
 * none is; `onLocate` scrolls the process to a row, `onStopTask` stops a background task (web only).
 */
export function ActivityDock({
  steps,
  onStopTask,
  onLocate,
}: {
  steps: Step[]
  onStopTask?: (taskId: string) => Promise<unknown>
  onLocate?: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const work = runningWork(steps)
  const now = useNow(open && work.length > 0)
  if (!work.length) return null
  const subagents = work.filter((s) => s.kind === 'subagent').length
  const tasks = work.length - subagents
  return (
    <div className="act-dock" data-testid="activity-dock">
      {open ? (
        <ol className="act act-dock__list" aria-label={t('后台运行')}>
          {work.map((s) => (
            <li key={s.key} className="act-item" data-state="running" data-family={s.kind}>
              <div className="act-line">
                <button type="button" className="act-row act-row--head" onClick={() => onLocate?.(s.key)}>
                  <Icon name={s.kind === 'task' ? 'bolt' : 'bot'} size={14} className="act-row__icon" />
                  <span className="act-row__verb act-shimmer">{s.title ?? s.label}</span>
                  <span className="act-row__target" title={s.body}>
                    {s.body}
                  </span>
                  {s.at ? <span className="act-row__meta">{fmtWorked(now - Date.parse(s.at))}</span> : null}
                </button>
                {s.stop && onStopTask ? (
                  <StopTask id={s.stop} name={s.title ?? ''} onStop={onStopTask} />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <button
        type="button"
        className="act-row act-row--head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {subagents ? (
          <span className="act-dock__count">
            <Icon name="bot" size={14} className="act-row__icon" />
            {t('子 agent {n} 个运行中', { n: subagents })}
          </span>
        ) : null}
        {tasks ? (
          <span className="act-dock__count">
            <Icon name="bolt" size={14} className="act-row__icon" />
            {t('后台任务 {n} 个运行中', { n: tasks })}
          </span>
        ) : null}
        <Icon name="chevron-up" size={12} className="act-row__chevron act-dock__chevron" />
      </button>
    </div>
  )
}
