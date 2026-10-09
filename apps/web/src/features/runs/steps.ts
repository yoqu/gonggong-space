import type { RunDetailDto, RunEvent } from '@gonggong/protocol'
import { t } from '../../i18n'
import { type DiffFile, findFile } from '../diff/patch'
import { argSummary, type McpCall, mcpLabel } from './mcp'

export interface Step {
  key: string
  /** context | thought | text | status | approval | an ACP tool kind */
  kind: string
  label: string
  meta?: string
  body?: string
  mono?: string
  /** Command output etc., shown in a <pre>. */
  out?: string
  failed?: boolean
  /** The step still in progress: a running tool, a pending approval, or the reply being streamed. */
  running?: boolean
  /** Lines this step's file changed in the run's patch. */
  diff?: { add: number; del: number }
  /** When the step began and last changed, for an activity group's duration. */
  at?: string
  end?: string
  /** The agent's own title of a tool call; a subagent's or background task's name. */
  title?: string
  /** A subagent's own process. */
  children?: Step[]
  /** A background task that can be stopped: its id. */
  stop?: string
  /** An MCP tool call's arguments and result. */
  mcp?: McpCall
}

const SLOW_MS = 2000

export const TOOL_LABEL: Record<string, string> = {
  read: t('读取文件'),
  edit: t('编辑文件'),
  delete: t('删除文件'),
  move: t('移动文件'),
  search: t('搜索'),
  execute: t('执行命令'),
  think: t('思考'),
  fetch: t('访问网络'),
}

export type Timed = { at: string; step: Step }
export type TimedEvent = RunDetailDto['events'][number]

/** Time-ordered; the last step of a live list is the current one when it is streamed text. Calls the agent never
 * named nor described (bookkeeping of adapters) are left out. */
function finish(timed: Timed[], live: boolean): Step[] {
  timed.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
  const steps = timed.map((t) => t.step).filter((s) => s.title !== '' || s.mono)
  const last = steps.at(-1)
  if (live && (last?.kind === 'text' || last?.kind === 'thought')) last.running = true
  return steps
}

/**
 * The main agent's steps, each subagent's nested under its spawn row. Updates of one tool call, subagent or
 * background task merge into the row of its first report. `extra` (approvals) joins the main agent's list.
 */
export function processSteps(
  events: TimedEvent[],
  files: DiffFile[],
  live: boolean,
  extra: Timed[] = [],
): Step[] {
  const lists = new Map<string, Timed[]>([['', extra]])
  const merged = new Map<string, { step: Step; first: string }>()
  const subagents: [string, Step][] = []
  for (const { id, at, event } of events) {
    const step = eventStep(id, event)
    if (!step) continue
    step.at = at
    const owner =
      (event.kind === 'subagent' ? event.parentId : 'agentId' in event ? event.agentId : undefined) ?? ''
    const key =
      event.kind === 'tool'
        ? `t${owner}/${event.toolCallId}`
        : event.kind === 'subagent'
          ? `s${event.agentId}`
          : event.kind === 'task'
            ? `k${event.taskId}`
            : null
    if (key) {
      const seen = merged.get(key)
      if (event.kind === 'tool')
        Object.assign(step, toolStep(event, seen ? Date.parse(at) - Date.parse(seen.first) : 0, files, live))
      if (seen) {
        Object.assign(seen.step, step, { key: seen.step.key, at: seen.first, end: at })
        continue
      }
      merged.set(key, { step, first: at })
      if (event.kind === 'subagent') subagents.push([event.agentId, step])
    }
    const list = lists.get(owner)
    if (list) list.push({ at, step })
    else lists.set(owner, [{ at, step }])
  }
  for (const [agentId, step] of subagents)
    step.children = finish(lists.get(agentId) ?? [], live && !!step.running)
  return finish(lists.get('') ?? [], live)
}

/** Subagents (nested ones too) and background tasks still running; tasks may outlive the run. */
export function runningWork(steps: Step[]): Step[] {
  return steps.flatMap((s) => [
    ...(s.running && (s.kind === 'subagent' || s.kind === 'task') ? [s] : []),
    ...runningWork(s.children ?? []),
  ])
}

const SUBAGENT_STATE: Record<string, string> = {
  running: t('进行中'),
  completed: t('已完成'),
  failed: t('失败'),
  cancelled: t('已取消'),
  disconnected: t('已断开'),
}
const TASK_STATE: Record<string, string> = {
  running: t('运行中'),
  paused: t('已暂停'),
  completed: t('已完成'),
  failed: t('失败'),
  stopped: t('已停止'),
}

function eventStep(id: number, e: RunEvent): Step | null {
  const key = `e${id}`
  switch (e.kind) {
    case 'thought':
      return { key, kind: 'thought', label: t('思考'), body: e.delta }
    case 'text':
      return { key, kind: 'text', label: t('回复'), body: e.delta }
    case 'status':
      return { key, kind: 'status', label: t('状态'), body: e.step }
    case 'tool':
      return e.mcp
        ? { key, kind: 'mcp', label: t('工具调用'), title: mcpLabel(e.mcp.server, e.mcp.tool) }
        : { key, kind: e.toolKind, label: TOOL_LABEL[e.toolKind] ?? t('工具调用'), title: e.title }
    case 'subagent':
      return {
        key,
        kind: 'subagent',
        label: t('子 agent'),
        title: e.name,
        body: e.task,
        meta: SUBAGENT_STATE[e.state],
        running: e.state === 'running',
        failed: e.state === 'failed' || e.state === 'disconnected',
      }
    case 'task':
      return {
        key,
        kind: 'task',
        label: t('后台任务'),
        title: e.name,
        body: e.summary,
        mono: e.outputPath,
        meta: TASK_STATE[e.state],
        running: e.state === 'running' || e.state === 'paused',
        failed: e.state === 'failed',
        stop: e.canStop && (e.state === 'running' || e.state === 'paused') ? e.taskId : undefined,
      }
    case 'usage':
      return null
  }
}

/** A call the adapter never closed is not running once the run has ended. */
function toolStep(
  e: Extract<RunEvent, { kind: 'tool' }>,
  ms: number,
  files: DiffFile[],
  live: boolean,
): Partial<Step> {
  const failed = e.status === 'failed'
  const running = live && (e.status === 'pending' || e.status === 'in_progress')
  if (e.mcp) return { mcp: e.mcp, mono: argSummary(e.mcp), failed, running }
  if (e.toolKind === 'execute')
    return {
      // The output block opens with `$ <command>`: the one-line row shows that command, not the agent's title.
      mono: e.detail?.startsWith('$ ') ? e.detail.slice(2).split('\n')[0] : e.title,
      out: e.detail,
      failed,
      running,
      // Quick calls are the norm; only slow ones earn a duration (Codex shows none per call).
      meta: failed
        ? t('失败')
        : running
          ? t('进行中')
          : ms >= SLOW_MS
            ? `${(ms / 1000).toFixed(1)}s`
            : undefined,
    }
  const file = e.detail ? findFile(files, e.detail.replace(/:\d+$/, '')) : undefined
  const diff = file && !file.binary ? { add: file.add, del: file.del } : undefined
  return {
    mono: e.detail ?? e.title,
    failed,
    running,
    diff,
    meta: failed ? t('失败') : running ? t('进行中') : diff ? `+${diff.add} −${diff.del}` : undefined,
  }
}
