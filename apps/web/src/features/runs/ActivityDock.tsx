import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { useNow } from '../../lib/now'
import { Icon } from '../../ui'
import { classify, fmtWorked } from './activity'
import { Face, StopTask } from './ProcessView'
import type { Step } from './steps'
import { subagentFaces } from './subagents'
import './process.css'

/** Chips in the bar before the rest fold into +N; two counts leave room for only 2 chips with a readable action. */
export const chipLimit = (narrow: boolean, bothCounts = false) => (narrow || bothCounts ? 2 : 3)
const NARROW_PX = 480
/** A finished chip stays this long, marked 完成 / 失败, before it leaves. */
const LEAVE_MS = 1400
const SUMMARY_MS = 2400

type State = 'running' | 'done' | 'failed'
const stateOf = (s: Step): State => (s.running ? 'running' : s.failed ? 'failed' : 'done')
const flat = (steps: Step[]): Step[] => steps.flatMap((s) => [s, ...flat(s.children ?? [])])
const isWork = (s: Step) => s.kind === 'subagent' || s.kind === 'task'

/** What it is doing now: a subagent's last step, a background task's own summary. */
function doing(s: Step): string | undefined {
  if (s.kind === 'task') return s.body
  const last = (s.children ?? []).filter((c) => c.kind !== 'text').at(-1)
  if (!last) return undefined
  const a = classify(last, null)
  return [a.verb, a.target].filter(Boolean).join(' ')
}

/**
 * Running work, plus what finished while in sight for a moment more; once all of it has left, a one-line sum-up.
 * Work already finished when the dock first saw it (a run looked back at) never shows.
 */
function useWork(steps: Step[]) {
  const work = flat(steps).filter(isWork)
  const seen = useRef(new Set<string>())
  const ending = useRef(new Set<string>())
  const tally = useRef({ done: 0, failed: 0 })
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [, bump] = useState(0)
  const [summary, setSummary] = useState<string | null>(null)
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms))
    if (work.some((s) => s.running)) setSummary(null)
    for (const s of work) {
      if (s.running) {
        seen.current.add(s.key)
        continue
      }
      if (!seen.current.has(s.key) || ending.current.has(s.key)) continue
      ending.current.add(s.key)
      tally.current[s.failed ? 'failed' : 'done']++
      later(LEAVE_MS, () => {
        seen.current.delete(s.key)
        ending.current.delete(s.key)
        bump((n) => n + 1)
        if (seen.current.size) return
        const { done, failed } = tally.current
        tally.current = { done: 0, failed: 0 }
        setSummary(
          failed
            ? t('已全部结束：{done} 个完成，{failed} 个失败', { done, failed })
            : t('已全部结束：{n} 个完成', { n: done }),
        )
        later(SUMMARY_MS, () => setSummary(null))
      })
    }
  })
  return { shown: work.filter((s) => s.running || seen.current.has(s.key)), summary }
}

function useNarrow(el: HTMLElement | null) {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW_PX))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return narrow
}

/**
 * Pinned under a run: requests waiting on someone, and one chip per subagent or background task at work (its face,
 * name, current step, time); the rest fold into +N, the full list one click away. `onLocate` scrolls the process to a
 * row, `onStopTask` stops a background task (web only).
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
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const narrow = useNarrow(el)
  const faces = useMemo(() => subagentFaces(steps), [steps])
  const { shown, summary } = useWork(steps)
  const asks = steps.filter((s) => s.running && (s.kind === 'approval' || s.kind === 'question'))
  const [ask] = asks
  const now = useNow(shown.some((s) => s.running))
  if (!shown.length && !ask && !summary) return null
  const running = shown.filter((s) => s.running)
  const subagents = running.filter((s) => s.kind === 'subagent').length
  const tasks = running.length - subagents
  const limit = chipLimit(narrow, subagents > 0 && tasks > 0)
  const extra = shown.length - limit
  const lead = (s: Step) =>
    s.kind === 'task' ? (
      <Icon name="bolt" size={14} className="act-row__icon" />
    ) : (
      <Face face={faces.get(s.key)} state={stateOf(s)} />
    )
  const when = (s: Step) => {
    const state = stateOf(s)
    if (state !== 'running') return state === 'failed' ? t('失败') : t('完成')
    return s.at ? fmtWorked(now - Date.parse(s.at)) : null
  }
  return (
    <div className="act-dock" data-testid="activity-dock" ref={setEl}>
      {open && shown.length ? (
        <ol className="act act-dock__list" aria-label={t('后台运行')}>
          {shown.map((s) => (
            <li key={s.key} className="act-item" data-state={stateOf(s)} data-family={s.kind}>
              <div className="act-line">
                <button type="button" className="act-row act-row--head" onClick={() => onLocate?.(s.key)}>
                  {lead(s)}
                  <span className="act-row__verb">{s.title ?? s.label}</span>
                  {s.kind === 'subagent' && s.body ? (
                    <span className="act-dock__task" title={s.body}>
                      {s.body}
                    </span>
                  ) : null}
                  <span className="act-row__target" title={doing(s)}>
                    {doing(s)}
                  </span>
                  <span className="act-row__meta">{when(s)}</span>
                </button>
                {s.stop && onStopTask ? (
                  <StopTask id={s.stop} name={s.title ?? ''} onStop={onStopTask} />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {ask ? (
        <button
          type="button"
          className="act-row act-row--head act-dock__asks"
          onClick={() => onLocate?.(ask.key)}
        >
          <Icon name="bell" size={14} className="act-row__icon" />
          <span className="act-row__verb">{t('待处理 {n} 项', { n: asks.length })}</span>
        </button>
      ) : null}
      {summary && !shown.length ? (
        <div className="act-dock__summary" role="status">
          <Icon name="check" size={14} />
          {summary}
        </div>
      ) : null}
      {shown.length ? (
        <div className="act-dock__bar">
          {subagents ? (
            <Count
              icon="bot"
              n={subagents}
              narrow={narrow}
              text={t('子 agent {n} 个运行中', { n: subagents })}
            />
          ) : null}
          {tasks ? (
            <Count icon="bolt" n={tasks} narrow={narrow} text={t('后台任务 {n} 个运行中', { n: tasks })} />
          ) : null}
          <div className="act-dock__chips">
            {shown.slice(0, limit).map((s) => (
              <Chip
                key={s.key}
                step={s}
                lead={lead(s)}
                doing={narrow ? undefined : doing(s)}
                when={when(s)}
                onLocate={onLocate}
              />
            ))}
          </div>
          {extra > 0 ? (
            <button
              type="button"
              className="act-dock__more"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              +{extra}
            </button>
          ) : null}
          <button
            type="button"
            className="act-row act-dock__toggle"
            aria-expanded={open}
            aria-label={t('后台运行')}
            onClick={() => setOpen(!open)}
          >
            <Icon name="chevron-up" size={12} className="act-row__chevron act-dock__chevron" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Narrow, the count shrinks to its glyph and number so the chips keep their time. */
function Count({
  icon,
  n,
  narrow,
  text,
}: {
  icon: 'bot' | 'bolt'
  n: number
  narrow: boolean
  text: string
}) {
  return narrow ? (
    <span className="act-dock__count" role="img" title={text} aria-label={text}>
      <Icon name={icon} size={14} />
      {n}
    </span>
  ) : (
    <span className="act-dock__count">{text}</span>
  )
}

function Chip({
  step: s,
  lead,
  doing,
  when,
  onLocate,
}: {
  step: Step
  lead: ReactNode
  doing?: string
  when: string | null
  onLocate?: (key: string) => void
}) {
  return (
    <button
      type="button"
      className="act-chip"
      data-state={stateOf(s)}
      data-testid="dock-chip"
      title={s.body}
      onClick={() => onLocate?.(s.key)}
    >
      {lead}
      <span className="act-chip__name">{s.title ?? s.label}</span>
      {doing ? (
        <span className="act-chip__doing">
          <span key={doing}>{doing}</span>
        </span>
      ) : null}
      {when ? <span className="act-chip__when">{when}</span> : null}
    </button>
  )
}
