import type { ApprovalDto, RunDetailDto, RunEvent } from '@aiws/protocol'
import { newSessionNote } from '../chat/TimelineItems'

export interface DiffFile {
  path: string
  status: 'added' | 'deleted' | 'modified'
  add: number
  del: number
  binary: boolean
  /** Hunk headers and lines (or the binary notice), without the file header. */
  lines: string[]
}

const HEADER = /^diff --git (?:"?a\/(.+?)"? )"?b\/(.+?)"?$/

/** Splits a unified git patch into files with +/− counts. */
export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let inHunks = false
  for (const line of patch.split('\n')) {
    const path = HEADER.exec(line)?.[2]
    if (path !== undefined) {
      file = { path, status: 'modified', add: 0, del: 0, binary: false, lines: [] }
      files.push(file)
      inHunks = false
      continue
    }
    if (!file) continue
    if (!inHunks) {
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('Binary files ')) {
        file.binary = true
        inHunks = true
        file.lines.push(line)
      } else if (line.startsWith('@@')) inHunks = true
      if (!inHunks || file.binary) continue
    }
    if (line.startsWith('+')) file.add += 1
    else if (line.startsWith('-')) file.del += 1
    file.lines.push(line)
  }
  for (const f of files) while (f.lines.at(-1) === '') f.lines.pop()
  return files
}

/** A path from a reply (relative, `./`-prefixed or absolute inside the workspace) against the patch's paths. */
export function findFile(files: DiffFile[], path: string) {
  const p = path.replace(/^\.\//, '')
  return files.find((f) => p === f.path || p.endsWith(`/${f.path}`))
}

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
}

export const TOOL_LABEL: Record<string, string> = {
  read: '读取文件',
  edit: '编辑文件',
  delete: '删除文件',
  move: '移动文件',
  search: '搜索',
  execute: '执行命令',
  think: '思考',
  fetch: '访问网络',
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function approvalText(a: ApprovalDto) {
  switch (a.status) {
    case 'pending':
      return '等待 bot 主人审批'
    case 'approved':
      return `${a.decidedByName ?? ''} 已批准`.trim()
    case 'rejected':
      return `${a.decidedByName ?? ''} 已拒绝`.trim()
    case 'expired':
      return '超时未审批，已自动拒绝'
    case 'void':
      return '运行已停止，请求作废'
  }
}

function contextStep(d: RunDetailDto, gitStep: string | undefined): Step {
  const reason = d.run.newSessionReason
  const session =
    reason === null
      ? '续用上次会话，补送上次被 @ 以来的群消息'
      : (newSessionNote(reason) ?? '首次会话，补送此前的群消息')
  const git = gitStep ? `git 默认动作：${gitStep.replace(/^git /, '')}` : null
  return {
    key: 'context',
    kind: 'context',
    label: '开场上下文',
    meta: reason === null ? '续用会话' : '新会话',
    body: [session, git].filter(Boolean).join('。'),
  }
}

/** Side-panel 过程 steps: opening context, then thoughts / replies / tool calls / statuses / approvals in time order. */
export function buildSteps(d: RunDetailDto): Step[] {
  const files = parsePatch(d.patch ?? '')
  const firstReal = d.events.findIndex((e) => e.event.kind !== 'status')
  const opening = d.events.slice(0, firstReal < 0 ? d.events.length : firstReal)
  const gitEvent = opening.find((e) => e.event.kind === 'status' && e.event.step.startsWith('git '))
  const timed: { at: string; step: Step }[] = []
  const tools = new Map<string, { step: Step; first: string }>()
  for (const { id, at, event } of d.events) {
    if (event === gitEvent?.event) continue
    const step = eventStep(id, event)
    if (!step) continue
    if (event.kind === 'tool') {
      const seen = tools.get(event.toolCallId)
      const ms = seen ? Date.parse(at) - Date.parse(seen.first) : 0
      Object.assign(step, toolStep(event, ms, files))
      if (seen) {
        Object.assign(seen.step, step, { key: seen.step.key })
        continue
      }
      tools.set(event.toolCallId, { step, first: at })
    }
    timed.push({ at, step })
  }
  for (const a of d.run.approvals)
    timed.push({
      at: a.createdAt,
      step: {
        key: `a${a.id}`,
        kind: 'approval',
        label: '权限请求',
        meta: hhmm(a.createdAt),
        mono: a.detail,
        body: approvalText(a),
      },
    })
  timed.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))
  const gitStep = gitEvent?.event.kind === 'status' ? gitEvent.event.step : undefined
  return [contextStep(d, gitStep), ...timed.map((t) => t.step)]
}

function eventStep(id: number, e: RunEvent): Step | null {
  const key = `e${id}`
  switch (e.kind) {
    case 'thought':
      return { key, kind: 'thought', label: '思考', body: e.delta }
    case 'text':
      return { key, kind: 'text', label: '回复', body: e.delta }
    case 'status':
      return { key, kind: 'status', label: '状态', body: e.step }
    case 'tool':
      return { key, kind: e.toolKind, label: TOOL_LABEL[e.toolKind] ?? '工具调用' }
    case 'usage':
      return null
  }
}

function toolStep(e: Extract<RunEvent, { kind: 'tool' }>, ms: number, files: DiffFile[]): Partial<Step> {
  const failed = e.status === 'failed'
  const running = e.status === 'pending' || e.status === 'in_progress'
  if (e.toolKind === 'execute')
    return {
      // Claude titles a shell call with the command itself, which the output block already starts with.
      mono: e.detail?.startsWith(`$ ${e.title}`) ? undefined : e.title,
      out: e.detail,
      failed,
      meta: failed ? '失败' : running ? '进行中' : ms ? `${(ms / 1000).toFixed(1)}s` : undefined,
    }
  const file = e.detail ? findFile(files, e.detail.replace(/:\d+$/, '')) : undefined
  return {
    mono: e.detail ?? e.title,
    failed,
    meta: failed
      ? '失败'
      : running
        ? '进行中'
        : file && !file.binary
          ? `+${file.add} −${file.del}`
          : undefined,
  }
}
