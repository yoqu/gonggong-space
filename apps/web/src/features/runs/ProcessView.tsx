import { type ReactNode, useMemo, useState } from 'react'
import { copyWithToast } from '../../lib/clipboard'
import { cx } from '../../lib/cx'
import { Elapsed } from '../../lib/now'
import { fullTime, stamp } from '../../lib/time'
import { Button, Icon, type IconName, Mascot, type MascotCostume } from '../../ui'
import { Markdown } from '../chat/Markdown'
import {
  type Action,
  buildItems,
  classify,
  fmtSpan,
  fmtWorked,
  foldRepeats,
  GROUP_SEP,
  type Item,
  itemSteps,
  timeRange,
} from './activity'
import { McpDetail } from './McpDetail'
import type { Step } from './steps'
import './process.css'
import { t } from '../../i18n'

/**
 * 过程 list of one run, shared by the web run rail and the desktop app. Pure view: steps in, folding state kept
 * here; `onOpenDiff` makes edited files open their change, `onStopTask` stops a background task (web only).
 */
export function ProcessView({
  steps,
  root,
  live,
  startedAt,
  workedMs,
  onOpenDiff,
  onStopTask,
  costume,
  active = true,
  renderAsk,
  filterable = false,
}: {
  steps: Step[]
  root: string | null
  live: boolean
  startedAt: string | null
  workedMs: number | null
  onOpenDiff?: (path: string) => void
  onStopTask?: (taskId: string) => Promise<unknown>
  /** The bot's role, acting out the thinking between calls. */
  costume?: MascotCostume
  /** False while out of sight (a hidden workbench tab): its clock stops. */
  active?: boolean
  /** A permission request's or question's own card in place of its row; null keeps the row (web only). */
  renderAsk?: (step: Step) => ReactNode
  /** Offers 失败 / 需处理 / 命令 filters above the list. */
  filterable?: boolean
}) {
  // Only the user's own folding is remembered; everything starts folded (ZCode / Codex).
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const matched = useMemo(() => {
    const all = filterable ? flat(steps).map((s) => classify(s, root)) : []
    return Object.fromEntries(
      Object.entries(MATCH).map(([f, match]) => [f, foldRepeats(all.filter(match))]),
    ) as Record<keyof typeof MATCH, Action[]>
  }, [filterable, steps, root])
  const items = useMemo(
    () =>
      filter === 'all'
        ? buildItems(steps, root, live, workedMs)
        : matched[filter].map((a): Item => ({ kind: 'action', ...a })),
    [steps, root, live, workedMs, filter, matched],
  )
  // Between calls the model is thinking: say so, like Codex's `Working (12s)` line.
  const idle = live && filter === 'all' && !steps.some((s) => s.running)
  const ctx: Ctx = {
    open,
    toggle: (key, current = !!open[key]) => setOpen((o) => ({ ...o, [key]: !current })),
    root,
    live,
    day: startedAt ?? steps.find((s) => s.at)?.at ?? null,
    onOpenDiff,
    onStopTask,
    renderAsk,
  }
  return (
    <>
      {filterable ? (
        <fieldset className="act-filters" aria-label={t('筛选过程')}>
          {FILTERS.map((f) => {
            const n = f.value === 'all' ? 0 : matched[f.value].length
            return (
              <button
                key={f.value}
                type="button"
                className="act-filter"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                {n ? (
                  <span className="act-filter__n" aria-hidden>
                    {n}
                  </span>
                ) : null}
              </button>
            )
          })}
        </fieldset>
      ) : null}
      <ol className="act act-root" aria-label={t('运行过程')}>
        {items.map((item) => (
          <ItemRow key={item.key} item={item} {...ctx} />
        ))}
        {filter !== 'all' && !items.length ? <li className="act-empty">{t('没有符合条件的步骤')}</li> : null}
        {idle ? (
          <li className="act-item act-working" aria-live="polite">
            <Mascot className="act-working__mascot" action="think" costume={costume} size={32} />
            <span className="act-shimmer">{t('正在处理')}</span>
            {startedAt ? (
              <span className="act-row__meta">
                <Elapsed from={Date.parse(startedAt)} ticking={active} format={fmtWorked} />
              </span>
            ) : null}
          </li>
        ) : null}
      </ol>
    </>
  )
}

type Filter = 'all' | 'failed' | 'ask' | 'command'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: t('全部') },
  { value: 'failed', label: t('失败') },
  { value: 'ask', label: t('需处理') },
  { value: 'command', label: t('命令#filter') },
]

const MATCH: Record<Exclude<Filter, 'all'>, (a: Action) => boolean> = {
  failed: (a) => !!a.step.failed && !a.quiet,
  ask: (a) => a.family === 'approval',
  command: (a) => a.step.kind === 'execute',
}

/** Subagents' steps after their own row, for filtering across the whole run. */
const flat = (steps: Step[]): Step[] => steps.flatMap((s) => [s, ...flat(s.children ?? [])])

type Ctx = {
  open: Record<string, boolean>
  toggle: (key: string, current?: boolean) => void
  root: string | null
  live: boolean
  /** Rows on another day than this (the run's start) show their date. */
  day: string | null
  onOpenDiff?: (path: string) => void
  onStopTask?: (taskId: string) => Promise<unknown>
  renderAsk?: (step: Step) => ReactNode
}

/** When a row happened: its start, a range for segments and subagents; the tooltip has full times and the duration. */
function When({ steps, day, range }: { steps: Step[]; day: string | null; range?: boolean }) {
  const r = timeRange(steps)
  if (!r) return null
  const spans = r.to !== r.from
  const ms = Date.parse(r.to) - Date.parse(r.from)
  const text = range && spans ? `${stamp(r.from, day)}–${stamp(r.to, r.from)}` : stamp(r.from, day)
  const full = range && spans ? `${fullTime(r.from)} – ${fullTime(r.to)}` : fullTime(r.from)
  return (
    <time
      className="act-row__time"
      dateTime={r.from}
      title={spans ? t('{time} · 耗时 {span}', { time: full, span: fmtSpan(ms) }) : full}
    >
      {text}
    </time>
  )
}

const GROUP_ICON: Record<string, IconName> = {
  [t('编辑了文件')]: 'textformat',
  [t('运行了命令')]: 'terminal',
  [t('读取了文件')]: 'doc-text',
  [t('搜索了代码')]: 'search',
  [t('查看了目录')]: 'folder',
  [t('访问了网络')]: 'globe',
}

function ItemRow({ item, ...ctx }: { item: Item } & Ctx) {
  const { open, toggle } = ctx
  if (item.kind === 'action')
    return item.family === 'subagent' ? (
      <SubagentRow action={item} {...ctx} />
    ) : (
      <ActionRow action={item} {...ctx} />
    )
  // A segment still being worked on or holding a failure stays open unless the user folded it.
  const expanded = open[item.key] ?? (item.kind === 'group' && (item.running || item.failed > 0))
  const children =
    item.kind === 'work'
      ? item.items.map((i) => <ItemRow key={i.key} item={i} {...ctx} />)
      : item.actions.map((a) => <ItemRow key={a.key} item={{ kind: 'action', ...a }} {...ctx} />)
  const work = item.kind === 'work'
  const icon: IconName = work ? 'clock' : (GROUP_ICON[item.title.split(GROUP_SEP)[0] ?? ''] ?? 'gear')
  return (
    <li
      className={cx('act-item', work ? 'act-item--work' : 'act-item--group')}
      data-state={item.kind === 'group' && item.running ? 'running' : undefined}
    >
      <button
        type="button"
        className="act-row act-row--head"
        aria-expanded={expanded}
        onClick={() => toggle(item.key, expanded)}
      >
        <Icon name={icon} size={14} className="act-row__icon" />
        <span className="act-row__verb">{item.title}</span>
        {work ? <span className="act-row__target">{item.summary}</span> : null}
        {item.kind === 'group' && item.failed ? (
          <span className="act-row__fail">{t('{n} 个失败', { n: item.failed })}</span>
        ) : null}
        <Icon name="chevron-right" size={12} className="act-row__chevron" />
        <When steps={itemSteps(item)} day={ctx.day} range />
      </button>
      {expanded ? <ol className={cx('act', work ? 'act--nested' : 'act--flat')}>{children}</ol> : null}
    </li>
  )
}

const stateOf = (s: Step, quiet?: boolean) => (s.failed && !quiet ? 'failed' : s.running ? 'running' : 'done')

/** A delegated subagent: name, task and state; its own process folds out beneath, open while it works. */
function SubagentRow({ action: a, ...ctx }: { action: Action } & Ctx) {
  const s = a.step
  const children = s.children ?? []
  const expanded = ctx.open[a.key] ?? !!s.running
  const calls = children.filter((c) => !['text', 'thought', 'status'].includes(c.kind)).length
  const state = stateOf(s)
  return (
    <li className="act-item" data-state={state} data-family="subagent" data-step={a.key}>
      <button
        type="button"
        className="act-row act-row--head"
        aria-expanded={expanded}
        onClick={() => ctx.toggle(a.key, expanded)}
      >
        <Icon name="bot" size={14} className="act-row__icon" />
        <span className={cx('act-row__verb', state === 'running' && 'act-shimmer')}>{a.verb}</span>
        <span className="act-row__target" title={a.target}>
          {a.target}
        </span>
        <span className="act-row__state">
          {calls ? t('{n} 次调用 · {state}', { n: calls, state: s.meta ?? '' }) : s.meta}
        </span>
        <Icon name="chevron-right" size={12} className="act-row__chevron" />
        <When steps={[s, ...children]} day={ctx.day} range />
      </button>
      {expanded ? (
        <ol className="act act--nested">
          {buildItems(children, ctx.root, ctx.live && !!s.running, null).map((i) => (
            <ItemRow key={i.key} item={i} {...ctx} />
          ))}
        </ol>
      ) : null}
    </li>
  )
}

const ACTION_ICON: Record<string, IconName> = {
  file: 'doc-text',
  search: 'search',
  list: 'folder',
  probe: 'doc-text',
  execute: 'terminal',
  edit: 'textformat',
  fetch: 'globe',
  thought: 'more',
  status: 'activity',
  approval: 'shield-warning',
  task: 'bolt',
  delegate: 'bot',
  mcp: 'plug',
  compaction: 'archive',
  other: 'gear',
}

const OUT_LINES = 6
/** Families whose one-line target is prose, not code. */
const PROSE = new Set<string>(['thought', 'status', 'compaction'])
/** Paths show as their file name (Codex app); the full path stays in the tooltip. */
const FILE_TARGET = (a: Action) => a.family === 'edit' || (a.family === 'explore' && a.bucket === 'file')

function ActionRow({
  action: a,
  open: opened,
  toggle,
  day,
  onOpenDiff,
  onStopTask,
  renderAsk,
}: { action: Action } & Ctx) {
  const s = a.step
  // A failed call shows its error output until folded.
  const open = opened[a.key] ?? (!!s.failed && !a.quiet && (!!s.out || !!s.mcp?.output))
  const onToggle = () => toggle(a.key, open)
  if (a.family === 'text')
    return (
      <li className="act-item act-text">
        <When steps={[s]} day={day} />
        <Markdown text={s.body ?? ''} />
      </li>
    )
  if (a.family === 'prompt')
    return (
      <li className="act-item act-prompt" data-step={a.key}>
        <div className="act-row">
          <Icon name="person" size={14} className="act-row__icon" />
          <span className="act-row__verb">{s.label}</span>
          <When steps={[s]} day={day} />
        </div>
        <div className="act-prompt__body">{s.body}</div>
      </li>
    )
  if (a.family === 'context')
    return (
      <li className="act-item">
        <button type="button" className="act-row act-row--head" aria-expanded={open} onClick={onToggle}>
          <Icon name="tray" size={14} className="act-row__icon" />
          <span className="act-row__verb">{t('本轮上下文')}</span>
          <span className="act-row__target">{s.meta}</span>
          <Icon name="chevron-right" size={12} className="act-row__chevron" />
        </button>
        {open ? <div className="act-detail act-detail--text">{s.body}</div> : null}
      </li>
    )
  if (a.family === 'approval') {
    const card = renderAsk?.(s)
    if (card)
      return (
        <li className="act-item act-ask-card" data-step={a.key}>
          {card}
        </li>
      )
    return (
      <li className="act-item act-approval" data-state={s.running ? 'running' : undefined} data-step={a.key}>
        <div className="act-row">
          <Icon
            name={s.kind === 'question' ? 'bubble-question' : 'shield-warning'}
            size={14}
            className="act-row__icon"
          />
          <span className="act-row__verb">{s.label}</span>
          <span className="act-row__target act-row__target--mono">{s.mono}</span>
          <When steps={[s]} day={day} />
        </div>
        <div className="act-approval__state">{s.body}</div>
        {s.out ? <div className="act-approval__answers">{s.out}</div> : null}
      </li>
    )
  }
  const state = stateOf(s, a.quiet)
  const task = a.family === 'task'
  const out =
    a.family === 'thought'
      ? s.body
      : task
        ? [s.body, s.mono && t('日志：{path}', { path: s.mono })].filter(Boolean).join('\n')
        : s.out
  const edit = a.family === 'edit' && !!a.target && !!onOpenDiff
  const mcp = s.mcp?.input || s.mcp?.output ? s.mcp : undefined
  const expandable = !!out || !!mcp
  const thought = a.family === 'thought' ? (s.body ?? '').trim().split('\n').at(-1) : undefined
  const target = thought ?? (a.target && FILE_TARGET(a) ? a.target.split('/').at(-1) : a.target)
  const head = (
    <>
      <Icon name={ACTION_ICON[a.bucket ?? a.family] ?? 'gear'} size={14} className="act-row__icon" />
      <span className={cx('act-row__verb', state === 'running' && 'act-shimmer')}>{a.verb}</span>
      {target ? (
        <span
          className={cx(
            'act-row__target',
            FILE_TARGET(a) ? 'act-row__target--file' : !PROSE.has(a.family) && 'act-row__target--mono',
          )}
          title={a.target ?? s.mono}
        >
          {target}
        </span>
      ) : null}
      {a.repeat ? (
        <span className="act-row__repeat" title={t('同一错误重复 {n} 次', { n: a.repeat })}>
          ×{a.repeat}
        </span>
      ) : null}
      {s.diff ? (
        <span className="act-row__meta act-row__meta--diff">
          <span className="act-add">+{s.diff.add}</span> <span className="act-del">−{s.diff.del}</span>
        </span>
      ) : null}
      {task ? (
        <span className="act-row__state">{s.meta}</span>
      ) : s.meta && !s.diff && state === 'done' && !s.failed ? (
        <span className="act-row__meta">{s.meta}</span>
      ) : null}
      {expandable ? <Icon name="chevron-right" size={12} className="act-row__chevron" /> : null}
      <When steps={[s]} day={day} />
    </>
  )
  const row = expandable ? (
    <button type="button" className="act-row act-row--head" aria-expanded={open} onClick={onToggle}>
      {head}
    </button>
  ) : edit ? (
    <button
      type="button"
      className="act-row act-row--head"
      title={t('查看 {path} 的改动', { path: a.target ?? '' })}
      onClick={() => onOpenDiff?.(a.target ?? '')}
    >
      {head}
    </button>
  ) : (
    <div className="act-row">{head}</div>
  )
  return (
    <li className="act-item" data-state={state} data-family={a.family} data-step={a.key}>
      {s.stop && onStopTask ? (
        <div className="act-line">
          {row}
          <StopTask id={s.stop} name={s.title ?? ''} onStop={onStopTask} />
        </div>
      ) : (
        row
      )}
      {open && mcp ? <McpDetail call={mcp} /> : null}
      {open && out ? (
        <Output text={out} mono={a.family !== 'thought' && a.family !== 'compaction' && !task} />
      ) : null}
    </li>
  )
}

/** Stays disabled once asked: the task's own update ends the row's running state. */
export function StopTask({
  id,
  name,
  onStop,
}: {
  id: string
  name: string
  onStop: (id: string) => Promise<unknown>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="small"
      variant="plain"
      disabled={busy}
      aria-label={t('停止后台任务 {name}', { name })}
      onClick={() => {
        setBusy(true)
        onStop(id).catch(() => setBusy(false))
      }}
    >
      {t('停止')}
    </Button>
  )
}

/** Tail of a command's output (Codex keeps the last lines), the rest one click away; long ones can be searched. */
function Output({ text, mono }: { text: string; mono: boolean }) {
  const [all, setAll] = useState(false)
  const [query, setQuery] = useState('')
  const lines = text.replace(/\n+$/, '').split('\n')
  const q = query.trim().toLowerCase()
  const matched = q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines
  const hidden = mono && !all && !q ? Math.max(0, lines.length - OUT_LINES) : 0
  return (
    <div className={cx('act-detail', mono ? 'act-detail--mono' : 'act-detail--text')}>
      {mono ? (
        <div className="act-detail__tools">
          {lines.length > OUT_LINES ? (
            <input
              type="search"
              className="act-detail__search"
              aria-label={t('搜索输出')}
              placeholder={t('搜索输出')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}
          {q ? <span className="act-detail__hits">{t('{n} 行匹配', { n: matched.length })}</span> : null}
          <button
            type="button"
            className="act-detail__copy"
            aria-label={t('复制输出')}
            title={t('复制输出')}
            onClick={() => void copyWithToast(text, t('已复制输出'))}
          >
            <Icon name="copy" size={12} />
          </button>
        </div>
      ) : null}
      {hidden ? (
        <button type="button" className="act-detail__more" onClick={() => setAll(true)}>
          {t('… 另有 {n} 行', { n: hidden })}
        </button>
      ) : null}
      {mono ? <pre>{matched.slice(hidden).join('\n')}</pre> : text}
    </div>
  )
}
