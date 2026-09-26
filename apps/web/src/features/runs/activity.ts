import type { Step } from './steps'

/**
 * Folding of the 过程 list, after the Codex app and ZCode (conversationAssistantWorkItems.ts): all calls between two
 * pieces of agent text fold into one segment titled by what they did (编辑了文件、运行了命令), and a finished turn
 * tucks everything before its final reply under 已工作.
 */
export type Family =
  | 'explore'
  | 'execute'
  | 'edit'
  | 'fetch'
  | 'thought'
  | 'status'
  | 'text'
  | 'approval'
  | 'context'
  | 'subagent'
  | 'task'
  | 'other'
export type Bucket = 'file' | 'search' | 'list' | 'probe'

export interface Action {
  key: string
  family: Family
  bucket?: Bucket
  /** 正在读取 / 已读取 / 执行失败 … */
  verb: string
  /** Workspace-relative path, query or command, shown on one line. */
  target?: string
  /** A failed call that is not a problem (a search without matches). */
  quiet?: boolean
  step: Step
}

export interface Group {
  key: string
  kind: 'group'
  actions: Action[]
  /** What the calls did, in order of first appearance: 编辑了文件、运行了命令. */
  title: string
  failed: number
  /** The working stage: the live tail of a running run, whatever its children report. */
  running: boolean
}

export interface Work {
  key: 'work'
  kind: 'work'
  items: Item[]
  /** 已工作 1 分 5 秒 */
  title: string
  summary: string
}

export type Item = ({ kind: 'action' } & Action) | Group | Work

// Read-only shell probes (ZCode exploreToolCall.ts); any write or redirect makes the command a plain execute.
const READ_CMD =
  /\b(rg|grep|find|ls|cat|head|tail|wc|stat|pwd|which|readlink|tree|nl|sed\s+-n)\b|^git\s+(status|log|show|diff|grep|ls-files)\b/i
const WRITE_CMD =
  /\b(sed\s+-i|perl\s+-pi|tee|mv|cp|rm|mkdir|rmdir|touch|truncate|chmod|chown)\b|^git\s+(add|commit|rm|mv|checkout|switch|restore|reset|clean|revert|cherry-pick|merge|rebase|push|pull|fetch)\b/i
const REDIRECT = /(^|[^\d<])>>?\s*\S|&>\s*\S/
const SEARCH_CMD = /^(rg|grep|egrep|fgrep|ag|ack)\b|^git\s+grep\b/
const LIST_CMD = /^(ls|find|tree|fd|du)\b|^git\s+ls-files\b/
const PROBE_CMD = /^(git\s+(status|log|show|diff)|pwd|which|stat|readlink)\b/

/** Separators inside quotes (`sed -n '1,5p;9p'`) do not split a command. */
const unquoted = (cmd: string) => cmd.replace(/'[^']*'|"[^"]*"/g, (q) => q.replace(/[;&|]/g, ','))

/** `a && b | sort` → the first command of each pipeline; later pipeline stages only format (Codex). */
const mains = (cmd: string) =>
  unquoted(cmd)
    .split(/&&|\|\||;/)
    .map((s) => (s.split('|')[0] ?? '').trim())
    .filter((s) => s && !/^(cd|echo|true|printf)\b/.test(s))

/** Shell words, quotes stripped; good enough for naming what a probe looks at. */
const words = (cmd: string) =>
  (cmd.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^(['"])(.*)\1$/, '$2'))

/** One probe's subject: the file read, `query · path` searched, or directory listed. */
function probeTarget(cmd: string, bucket: Bucket, root: string | null) {
  const [name, ...rest] = words(cmd)
  const args = rest.filter((w) => !w.startsWith('-') && !/^\d+(,\d+)?p$/.test(w) && !/^\d+$/.test(w))
  const rel = (p: string) => relative(p, root)
  if (bucket === 'search') {
    const [query, path] = args
    return query ? [query, path && rel(path)].filter(Boolean).join(' · ') : null
  }
  if (bucket === 'list') return name === 'find' || !args[0] ? (args[0] ? rel(args[0]) : '.') : rel(args[0])
  const last = args.at(-1)
  if (bucket === 'file') return last ? rel(last) : null
  return null
}

function shellTarget(cmd: string, bucket: Bucket, root: string | null) {
  const names = mains(cmd).map((m) => probeTarget(m, bucket, root))
  return names.every(Boolean) ? [...new Set(names)].join(', ') : cmd
}

function shellBucket(cmd: string): Bucket | null {
  const parts = unquoted(cmd)
    .split(/&&|\|\||;|\|/)
    .map((p) => p.trim())
  if (parts.some((p) => WRITE_CMD.test(p) || REDIRECT.test(p))) return null
  const main = mains(cmd)
  if (!main.length || !main.every((p) => READ_CMD.test(p))) return null
  if (main.some((p) => SEARCH_CMD.test(p))) return 'search'
  if (main.every((p) => LIST_CMD.test(p))) return 'list'
  if (main.every((p) => PROBE_CMD.test(p))) return 'probe'
  return 'file'
}

/** `path` without the workspace root and a trailing `:line`. */
export function relative(path: string, root: string | null) {
  const p = path.replace(/:\d+$/, '')
  if (root && p.startsWith(`${root}/`)) return p.slice(root.length + 1)
  return p
}

const VERB: Record<string, [running: string, done: string]> = {
  file: ['正在读取', '已读取'],
  search: ['正在搜索', '已搜索'],
  list: ['正在列出', '已列出'],
  probe: ['正在查看', '已查看'],
  execute: ['正在运行', '已运行'],
  edit: ['正在编辑', '已编辑'],
  delete: ['正在删除', '已删除'],
  move: ['正在移动', '已移动'],
  fetch: ['正在访问', '已访问'],
  thought: ['正在思考', '思考'],
}

const verbOf = (key: string, s: Step, failedText = '失败') => {
  const [running, done] = VERB[key] ?? ['进行中', s.label]
  return s.failed ? `${done.replace(/^已/, '')}${failedText}` : s.running ? running : done
}

export function classify(s: Step, root: string | null): Action {
  const base = { key: s.key, step: s }
  switch (s.kind) {
    case 'context':
      return { ...base, family: 'context', verb: s.label, target: s.meta }
    case 'thought':
    case 'think':
      return { ...base, family: 'thought', verb: verbOf('thought', s) }
    case 'text':
    case 'status':
    case 'approval':
      return { ...base, family: s.kind, verb: s.label, target: s.body }
    case 'read':
      return { ...base, family: 'explore', bucket: 'file', verb: verbOf('file', s), target: rel(s, root) }
    case 'search': {
      const bucket = /^(find|glob|list|ls)\b/i.test(s.title ?? '') ? 'list' : 'search'
      return { ...base, family: 'explore', bucket, verb: verbOf(bucket, s), target: named(s.title) }
    }
    case 'execute': {
      const cmd = s.mono ?? s.title ?? ''
      const bucket = shellBucket(cmd)
      if (bucket === 'search' && s.failed)
        return {
          ...base,
          family: 'explore',
          bucket,
          verb: '未找到',
          target: shellTarget(cmd, bucket, root),
          quiet: true,
        }
      if (bucket && !s.failed)
        return {
          ...base,
          family: 'explore',
          bucket,
          verb: verbOf(bucket, s),
          target: shellTarget(cmd, bucket, root),
        }
      return { ...base, family: 'execute', verb: verbOf('execute', s), target: cmd }
    }
    case 'edit':
    case 'delete':
    case 'move':
      return { ...base, family: 'edit', verb: verbOf(s.kind, s), target: rel(s, root) }
    case 'fetch':
      return { ...base, family: 'fetch', verb: verbOf('fetch', s), target: s.mono ?? s.title }
    case 'subagent':
      return { ...base, family: 'subagent', verb: s.title ?? s.label, target: s.body }
    case 'task':
      return { ...base, family: 'task', verb: s.label, target: s.title }
    default:
      return {
        ...base,
        family: 'other',
        verb: s.title ?? s.label,
        target: s.mono === s.title ? undefined : s.mono,
      }
  }
}

/** Titles adapters send before a call's input arrives. */
const PLACEHOLDER = /^(terminal|read file|preparing file…?|write|edit|read|search|grep|glob|find)$/i
const named = (title?: string) => (title && !PLACEHOLDER.test(title) ? title : undefined)
const rel = (s: Step, root: string | null) =>
  s.mono && s.mono !== s.title ? relative(s.mono, root) : named(s.title)

/** Text, approvals, the context, subagents and background tasks stay on their own lines; everything else between
 * them is one segment. */
const BOUNDARY = new Set<Family>(['text', 'approval', 'context', 'subagent', 'task'])
/** Carried along inside a segment but not counted as its calls. */
const PASSIVE = new Set<Family>(['thought', 'status'])

const WHAT = (a: Action) =>
  a.family === 'explore'
    ? a.bucket === 'search'
      ? '搜索了代码'
      : a.bucket === 'list'
        ? '查看了目录'
        : '读取了文件'
    : a.family === 'execute'
      ? '运行了命令'
      : a.family === 'edit'
        ? '编辑了文件'
        : a.family === 'fetch'
          ? '访问了网络'
          : '调用了工具'

function segment(actions: Action[], running: boolean): Item[] {
  const calls = actions.filter((a) => !PASSIVE.has(a.family))
  const [first] = actions
  if (!first || calls.length < 2) return actions.map((a) => ({ kind: 'action', ...a }))
  return [
    {
      key: `g${first.key}`,
      kind: 'group',
      actions,
      title: [...new Set(calls.map(WHAT))].join('、'),
      failed: calls.filter((a) => a.step.failed && !a.quiet).length,
      running,
    },
  ]
}

/** Segments between boundaries; a segment with a single call stays a plain row. */
export function groupActions(actions: Action[], live: boolean): Item[] {
  const items: Item[] = []
  let run: Action[] = []
  for (const a of actions) {
    if (!BOUNDARY.has(a.family)) {
      run.push(a)
      continue
    }
    items.push(...segment(run, false))
    run = []
    items.push({ kind: 'action', ...a })
  }
  items.push(...segment(run, live))
  return items
}

export function fmtWorked(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000))
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  return [h && `${h} 小时`, m && `${m} 分`, (sec || (!h && !m)) && `${sec} 秒`]
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
}

function workSummary(actions: Action[]) {
  const n = (f: Family) => actions.filter((a) => a.family === f).length
  const files = new Set(actions.filter((a) => a.family === 'edit').map((a) => a.target)).size
  return [
    n('explore') && `查阅 ${n('explore')}`,
    n('execute') && `命令 ${n('execute')}`,
    files && `改动 ${files}`,
    n('subagent') && `子 agent ${n('subagent')}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The whole 过程 list. Once a run has finished with a reply, everything before that reply folds under
 * 已工作 N (ZCode conversationTurnWorkSegments.ts): the reply is the answer, the rest is how it got there.
 */
export function buildItems(
  steps: Step[],
  root: string | null,
  live: boolean,
  workedMs: number | null,
): Item[] {
  const actions = steps
    .filter((s) => !(s.kind === 'execute' && s.running && !s.out && !named(s.title)))
    .map((s) => classify(s, root))
  const last = actions.at(-1)
  if (live || last?.family !== 'text' || actions.length < 2 || workedMs === null)
    return groupActions(actions, live)
  const before = actions.slice(0, -1)
  return [
    {
      key: 'work',
      kind: 'work',
      items: groupActions(before, false),
      title: `已工作 ${fmtWorked(workedMs)}`,
      summary: workSummary(before),
    },
    { kind: 'action', ...last },
  ]
}
