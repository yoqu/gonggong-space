import { useState } from 'react'
import { cx } from '../../lib/cx'
import { useNow } from '../../lib/now'
import { Button, Icon, type IconName, Mascot } from '../../ui'
import { Markdown } from '../chat/Markdown'
import { type Action, buildItems, fmtWorked, type Item } from './activity'
import { McpDetail } from './McpDetail'
import type { Step } from './steps'
import './process.css'

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
}: {
  steps: Step[]
  root: string | null
  live: boolean
  startedAt: string | null
  workedMs: number | null
  onOpenDiff?: (path: string) => void
  onStopTask?: (taskId: string) => Promise<unknown>
}) {
  // Only the user's own folding is remembered; everything starts folded (ZCode / Codex).
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const items = buildItems(steps, root, live, workedMs)
  // Between calls the model is thinking: say so, like Codex's `Working (12s)` line.
  const idle = live && !steps.some((s) => s.running)
  const now = useNow(idle)
  const ctx: Ctx = {
    open,
    toggle: (key, current = !!open[key]) => setOpen((o) => ({ ...o, [key]: !current })),
    root,
    live,
    onOpenDiff,
    onStopTask,
  }
  return (
    <ol className="act" aria-label="运行过程">
      {items.map((item) => (
        <ItemRow key={item.key} item={item} {...ctx} />
      ))}
      {idle ? (
        <li className="act-item act-working" aria-live="polite">
          <Mascot className="act-working__mascot" action="think" size={32} />
          <span className="act-shimmer">正在处理</span>
          {startedAt ? <span className="act-row__meta">{fmtWorked(now - Date.parse(startedAt))}</span> : null}
        </li>
      ) : null}
    </ol>
  )
}

type Ctx = {
  open: Record<string, boolean>
  toggle: (key: string, current?: boolean) => void
  root: string | null
  live: boolean
  onOpenDiff?: (path: string) => void
  onStopTask?: (taskId: string) => Promise<unknown>
}

const GROUP_ICON: Record<string, IconName> = {
  编辑了文件: 'textformat',
  运行了命令: 'terminal',
  读取了文件: 'doc-text',
  搜索了代码: 'search',
  查看了目录: 'folder',
  访问了网络: 'globe',
}

function ItemRow({ item, ...ctx }: { item: Item } & Ctx) {
  const { open, toggle } = ctx
  if (item.kind === 'action')
    return item.family === 'subagent' ? (
      <SubagentRow action={item} {...ctx} />
    ) : (
      <ActionRow action={item} {...ctx} />
    )
  // A segment still being worked on stays open unless the user folded it.
  const expanded = open[item.key] ?? (item.kind === 'group' && item.running)
  const children =
    item.kind === 'work'
      ? item.items.map((i) => <ItemRow key={i.key} item={i} {...ctx} />)
      : item.actions.map((a) => <ItemRow key={a.key} item={{ kind: 'action', ...a }} {...ctx} />)
  const work = item.kind === 'work'
  const icon: IconName = work ? 'clock' : (GROUP_ICON[item.title.split('、')[0] ?? ''] ?? 'gear')
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
          <span className="act-row__fail">{item.failed} 个失败</span>
        ) : null}
        <Icon name="chevron-right" size={12} className="act-row__chevron" />
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
    <li className="act-item" data-state={state} data-family="subagent">
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
        <span className="act-row__state">{calls ? `${calls} 次调用 · ${s.meta}` : s.meta}</span>
        <Icon name="chevron-right" size={12} className="act-row__chevron" />
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
  other: 'gear',
}

const OUT_LINES = 6
/** Paths show as their file name (Codex app); the full path stays in the tooltip. */
const FILE_TARGET = (a: Action) => a.family === 'edit' || (a.family === 'explore' && a.bucket === 'file')

function ActionRow({ action: a, open: opened, toggle, onOpenDiff, onStopTask }: { action: Action } & Ctx) {
  const s = a.step
  const open = !!opened[a.key]
  const onToggle = () => toggle(a.key)
  if (a.family === 'text')
    return (
      <li className="act-item act-text">
        <Markdown text={s.body ?? ''} />
      </li>
    )
  if (a.family === 'context')
    return (
      <li className="act-item">
        <button type="button" className="act-row act-row--head" aria-expanded={open} onClick={onToggle}>
          <Icon name="tray" size={14} className="act-row__icon" />
          <span className="act-row__verb">本轮上下文</span>
          <span className="act-row__target">{s.meta}</span>
          <Icon name="chevron-right" size={12} className="act-row__chevron" />
        </button>
        {open ? <div className="act-detail act-detail--text">{s.body}</div> : null}
      </li>
    )
  if (a.family === 'approval')
    return (
      <li className="act-item act-approval" data-state={s.running ? 'running' : undefined}>
        <div className="act-row">
          <Icon name="shield-warning" size={14} className="act-row__icon" />
          <span className="act-row__verb">权限请求</span>
          <span className="act-row__target act-row__target--mono">{s.mono}</span>
        </div>
        <div className="act-approval__state">{s.body}</div>
      </li>
    )
  const state = stateOf(s, a.quiet)
  const task = a.family === 'task'
  const out =
    a.family === 'thought'
      ? s.body
      : task
        ? [s.body, s.mono && `日志：${s.mono}`].filter(Boolean).join('\n')
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
            FILE_TARGET(a)
              ? 'act-row__target--file'
              : a.family !== 'thought' && a.family !== 'status' && 'act-row__target--mono',
          )}
          title={a.target ?? s.mono}
        >
          {target}
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
      title={`查看 ${a.target} 的改动`}
      onClick={() => onOpenDiff?.(a.target ?? '')}
    >
      {head}
    </button>
  ) : (
    <div className="act-row">{head}</div>
  )
  return (
    <li className="act-item" data-state={state} data-family={a.family}>
      {s.stop && onStopTask ? (
        <div className="act-line">
          {row}
          <StopTask id={s.stop} name={s.title ?? ''} onStop={onStopTask} />
        </div>
      ) : (
        row
      )}
      {open && mcp ? <McpDetail call={mcp} /> : null}
      {open && out ? <Output text={out} mono={a.family !== 'thought' && !task} /> : null}
    </li>
  )
}

/** Stays disabled once asked: the task's own update ends the row's running state. */
function StopTask({
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
      aria-label={`停止后台任务 ${name}`}
      onClick={() => {
        setBusy(true)
        onStop(id).catch(() => setBusy(false))
      }}
    >
      停止
    </Button>
  )
}

/** Tail of a command's output (Codex keeps the last lines), the rest one click away. */
function Output({ text, mono }: { text: string; mono: boolean }) {
  const [all, setAll] = useState(false)
  const lines = text.replace(/\n+$/, '').split('\n')
  const hidden = mono && !all ? Math.max(0, lines.length - OUT_LINES) : 0
  return (
    <div className={cx('act-detail', mono ? 'act-detail--mono' : 'act-detail--text')}>
      {hidden ? (
        <button type="button" className="act-detail__more" onClick={() => setAll(true)}>
          … 另有 {hidden} 行
        </button>
      ) : null}
      {mono ? <pre>{lines.slice(hidden).join('\n')}</pre> : text}
    </div>
  )
}
