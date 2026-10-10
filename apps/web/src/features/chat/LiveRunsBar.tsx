import type { RunDto, RunStatus } from '@gonggong/protocol'
import { useMemo, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { useNow } from '../../lib/now'
import { Button } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { fmtWorked } from '../runs/activity'
import { stepText, toolTitle } from '../runs/mcp'
import { openTab } from '../workbench/open'
import { STATUS_LABEL } from './RunGraphics'
import './live-runs.css'

const AWAITING: RunStatus[] = ['awaiting_approval', 'awaiting_answer']
const SHOWN = 3

/** Pinned above the composer: the group's executing runs, so cards pushed up by new messages stay reachable. */
export function LiveRunsBar({ runs, onLocate }: { runs: RunDto[]; onLocate: (run: RunDto) => void }) {
  const [all, setAll] = useState(false)
  const live = useMemo(
    () =>
      runs
        .filter((r) => r.status === 'running' || AWAITING.includes(r.status))
        .sort(
          (a, b) =>
            Number(AWAITING.includes(b.status)) - Number(AWAITING.includes(a.status)) ||
            a.queuedAt.localeCompare(b.queuedAt),
        ),
    [runs],
  )
  const now = useNow(live.length > 0)
  if (!live.length) return null
  const rest = live.length - SHOWN
  return (
    <div className="lr-bar" data-testid="live-runs">
      <ul className="lr-list">
        {(all ? live : live.slice(0, SHOWN)).map((r) => (
          <LiveRun key={r.id} run={r} now={now} onLocate={onLocate} />
        ))}
      </ul>
      {rest > 0 ? (
        <button type="button" className="lr-more" onClick={() => setAll(!all)}>
          {all ? t('收起') : `+${rest}`}
        </button>
      ) : null}
    </div>
  )
}

function LiveRun({ run, now, onLocate }: { run: RunDto; now: number; onLocate: (run: RunDto) => void }) {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === run.botId)?.name ?? 'Bot')
  const awaiting = AWAITING.includes(run.status)
  const status = awaiting ? STATUS_LABEL[run.status] : toolTitle(stepText(run)) || STATUS_LABEL.running
  return (
    <li className={cx('lr-row', awaiting && 'lr-row--awaiting')}>
      <button type="button" className="lr-row__main" onClick={() => onLocate(run)}>
        <BotAvatar id={run.botId} name={name} size={20} />
        <span className="lr-row__name">{name}</span>
        <span className="lr-row__status" title={status}>
          {status}
        </span>
        <span className="lr-row__time">{fmtWorked(now - Date.parse(run.startedAt ?? run.queuedAt))}</span>
      </button>
      <Button
        size="small"
        variant="plain"
        icon="sidebar-right"
        onClick={() => openTab({ kind: 'run', runId: run.id, view: 'process', file: null })}
      >
        {t('过程')}
      </Button>
    </li>
  )
}
