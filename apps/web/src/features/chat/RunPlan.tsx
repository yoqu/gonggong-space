import type { PlanItem, ProgressCard, RunDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Icon } from '../../ui'
import { RunProgress } from './ProgressCard'

export { walkable } from './ProgressCard'

import './run-plan.css'

/** Past this many entries the list folds: done ones into a line, then the active ones and the next two. */
const FOLD_OVER = 5
const AHEAD = 2

const done = (plan: PlanItem[]) => plan.filter((e) => e.status === 'completed').length

/** What a long plan shows: the open entries up to two past the last one in progress. */
function shownOf(plan: PlanItem[], all: boolean) {
  if (all || plan.length <= FOLD_OVER) return { folded: 0, items: plan, more: 0 }
  const open = plan.filter((e) => e.status !== 'completed')
  const active = open.findLastIndex((e) => e.status === 'in_progress')
  const items = open.slice(0, active + 1 + AHEAD)
  return { folded: plan.length - open.length, items, more: open.length - items.length }
}

function PlanEntry({ entry, live }: { entry: PlanItem; live: boolean }) {
  const spinning = live && entry.status === 'in_progress'
  return (
    <li className="run-plan__item" data-testid="plan-item" data-status={entry.status}>
      {entry.status === 'completed' ? (
        <Icon name="checkmark-circle" size={13} />
      ) : entry.status === 'in_progress' ? (
        <Icon name="arrow-clockwise" size={13} className={cx(spinning && 'run-plan__spin')} />
      ) : (
        <span className="run-plan__dot" aria-hidden />
      )}
      <span className="run-plan__text">{entry.content}</span>
    </li>
  )
}

/**
 * The agent's own plan (ACP `plan`, e.g. Claude's todos) in its run card or atop the run tab. Open while the run goes
 * on unless `folded` (a progress card leads); once it ended it opens on demand, unfinished entries left as they were.
 */
export function RunPlan({
  plan,
  live,
  folded = false,
  panel = false,
}: {
  plan: PlanItem[]
  live: boolean
  folded?: boolean
  /** The run tab's panel: always open, long plans folded the same way. */
  panel?: boolean
}) {
  const [open, setOpen] = useState<boolean | null>(null)
  const [all, setAll] = useState(false)
  const expanded = panel || (open ?? (live && !folded))
  const { folded: hidden, items, more } = shownOf(plan, all)
  const collapsedPreview = all ? shownOf(plan, false) : null
  const canCollapse = !!collapsedPreview && (collapsedPreview.folded > 0 || collapsedPreview.more > 0)
  const head = (
    <>
      <Icon name="checklist" size={12} />
      <span className="run-plan__title">{t('计划')}</span>
      <span className="run-plan__count">
        {done(plan)}/{plan.length}
      </span>
    </>
  )
  return (
    <div className={cx('run-plan', panel && 'run-plan--panel')} data-testid="run-plan">
      {panel ? (
        <div className="run-plan__head">{head}</div>
      ) : (
        <button
          type="button"
          className="run-plan__head"
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
        >
          {head}
          <Icon name="chevron-right" size={12} className="run-plan__chevron" />
        </button>
      )}
      {expanded ? (
        <ol className="run-plan__list">
          {hidden ? (
            <li>
              <button type="button" className="run-plan__fold" onClick={() => setAll(true)}>
                <Icon name="checkmark-circle" size={13} />
                {t('已完成 {n} 项', { n: hidden })}
              </button>
            </li>
          ) : null}
          {items.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a plan is replaced whole and may repeat an entry
            <PlanEntry key={i} entry={e} live={live} />
          ))}
          {more ? (
            <li>
              <button type="button" className="run-plan__fold" onClick={() => setAll(true)}>
                {t('还有 {n} 项', { n: more })}
              </button>
            </li>
          ) : null}
          {canCollapse ? (
            <li>
              <button type="button" className="run-plan__fold" onClick={() => setAll(false)}>
                {collapsedPreview.folded > 0
                  ? t('收起已完成（{n} 项）', { n: collapsedPreview.folded })
                  : t('收起其余项')}
              </button>
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  )
}

/** A run card's todo blocks: its progress cards (`walked`: the one 共字君 walks), then the agent's plan behind them. */
export function RunTodos({
  run,
  live,
  progress,
  walked,
}: {
  run: RunDto
  live: boolean
  progress?: ProgressCard[]
  walked?: ProgressCard
}) {
  return (
    <>
      {progress?.map((c) => (
        <RunProgress key={c.id} card={c} walker={c === walked} />
      ))}
      {run.plan ? <RunPlan plan={run.plan} live={live} folded={!!progress?.length} /> : null}
    </>
  )
}

const STAGE = { pending: 'pending', in_progress: 'running', completed: 'done' } as const

/** The run's plan as a progress card, for the task dock's ring and popover when the run posted none. */
export function planCard(run: RunDto): ProgressCard | undefined {
  if (!run.plan?.length) return undefined
  const all = done(run.plan) === run.plan.length
  return {
    id: `plan:${run.id}`,
    botId: run.botId,
    runId: run.id,
    title: t('计划'),
    stages: run.plan.map((e) => ({ name: e.content, status: STAGE[e.status] })),
    percent: null,
    detail: null,
    link: null,
    status: all ? 'done' : 'running',
    updatedAt: run.lastActivityAt,
  }
}
