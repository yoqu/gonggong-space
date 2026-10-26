import type { ApprovalDto, QuestionSetDto, RunDetailDto, RunDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { processMarkdown, processText } from '../src/features/runs/activity'
import { ProcessView } from '../src/features/runs/ProcessView'
import type { Step } from '../src/features/runs/steps'
import { RunTab } from '../src/features/workbench/tabs/RunTab'

vi.mock('../src/lib/realtime', () => ({
  realtime: { subscribe: () => () => {}, onReconnect: () => () => {} },
}))

const local = (h: number, m: number, s: number) => new Date(2026, 9, 18, h, m, s).toISOString()
const approval: ApprovalDto = {
  id: 'a1',
  runId: 'r1',
  title: 'Bash',
  toolKind: 'execute',
  detail: 'rm -rf dist',
  reason: 'not_allowed',
  options: [],
  remember: [],
  status: 'approved',
  voidReason: null,
  decidedBy: 'u1',
  decidedByName: '王磊',
  decidedAt: local(10, 0, 6),
  expiresAt: local(10, 30, 0),
  createdAt: local(10, 0, 5),
}
const question: QuestionSetDto = {
  id: 'qs1',
  runId: 'r1',
  questions: [
    { id: 'q1', type: 'yesno', title: '允许改 fixture 吗？', options: ['是', '否'], recommended: 0 },
  ],
  status: 'answered',
  answers: [{ questionId: 'q1', choices: [0], text: null }],
  attachments: [],
  answeredBy: 'u1',
  answeredByName: '王磊',
  answeredAt: local(10, 0, 9),
  expiresAt: local(10, 30, 0),
  createdAt: local(10, 0, 8),
  leanings: [],
}
const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'completed',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: local(10, 0, 0),
  startedAt: local(10, 0, 1),
  endedAt: local(10, 1, 0),
  lastActivityAt: local(10, 1, 0),
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
  questions: [question],
  approvals: [approval],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  ...o,
})
const detail = (o: Partial<RunDetailDto> = {}): RunDetailDto => ({
  run: run(),
  patch: null,
  purged: false,
  settings: null,
  patchRepos: [],
  sessionId: null,
  retentionDays: 30,
  events: [],
  ...o,
})

function serve(d: RunDetailDto) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = input.replace(/^\/api/, '').split('?')[0]
      if (path === '/runs/r1') return new Response(JSON.stringify(d))
      if (path === '/runs/r1/session') return new Response(JSON.stringify({ rounds: [] }))
      return new Response(JSON.stringify({ scope: 'turn', patch: null, base: null, branch: null, repos: [] }))
    }),
  )
}

const patch = vi.fn()
beforeEach(() => {
  patch.mockReset()
  useWorkbench.setState({ patch })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

const tab = (view: 'process' | 'audit') => ({
  tab: { kind: 'run' as const, runId: 'r1', view, file: null },
  tabKey: 'run:r1',
  active: true,
})

const at = local(10, 0, 2)
const failing = (key: string): Step => ({
  key,
  kind: 'execute',
  label: '执行命令',
  mono: 'make test',
  out: '$ make test\nboom',
  failed: true,
  at,
})

describe('audit and process link up', () => {
  it('lists questions in the audit and leads each request to its place in the process', async () => {
    serve(detail())
    render(<RunTab {...tab('audit')} />)
    expect(await screen.findByText('提问：允许改 fixture 吗？ · 王磊 已回答')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /权限请求：rm -rf dist/ }))
    expect(patch).toHaveBeenCalledWith('run:r1', { view: 'process' })
  })

  it('leads a decided request in the process to the audit', async () => {
    serve(detail())
    render(<RunTab {...tab('process')} />)
    const list = await screen.findByRole('list', { name: '运行过程' })
    fireEvent.click(within(list).getAllByRole('button', { name: '在审批记录中查看' })[0] as HTMLElement)
    expect(patch).toHaveBeenCalledWith('run:r1', { view: 'audit' })
  })
})

describe('copying the process', () => {
  it('writes each step with its time, failures with their output', () => {
    const text = processText(
      [
        { key: 'c', kind: 'execute', label: '执行命令', mono: 'make build', out: '$ make build\nok', at },
        failing('f'),
        { key: 'aa1', kind: 'approval', label: '权限请求', mono: 'rm -rf dist', body: '王磊 已批准', at },
        { key: 't', kind: 'text', label: '回复', body: '好了\n第二行', at },
      ],
      null,
    )
    expect(text).toBe(
      [
        '10:00:02 已运行 make build',
        '10:00:02 运行失败 make test',
        '    $ make test',
        '    boom',
        '10:00:02 权限请求 rm -rf dist · 王磊 已批准',
        '10:00:02 回复',
        '    好了',
        '    第二行',
      ].join('\n'),
    )
  })

  it('writes Markdown: a list item per step, output fenced, replies quoted, subagents nested', () => {
    const md = processMarkdown(
      [
        { key: 'c', kind: 'execute', label: '执行命令', mono: 'make build', out: '$ make build\nok', at },
        failing('f'),
        { key: 'aa1', kind: 'approval', label: '权限请求', mono: 'rm -rf dist', body: '王磊 已批准', at },
        {
          key: 'sa',
          kind: 'subagent',
          label: '子 agent',
          title: 'Explore',
          body: '找入口',
          at,
          children: [{ key: 'sr', kind: 'read', label: '读取文件', mono: 'src/a.ts', at }],
        },
        { key: 't', kind: 'text', label: '回复', body: '好了\n\n第二行', at },
      ],
      null,
    )
    expect(md).toBe(
      [
        '- `10:00:02` 已运行 `make build`',
        '- `10:00:02` 运行失败 `make test`',
        '  ```',
        '  $ make test',
        '  boom',
        '  ```',
        '- `10:00:02` 权限请求 `rm -rf dist` · 王磊 已批准',
        '- `10:00:02` Explore 找入口',
        '  - `10:00:02` 已读取 `src/a.ts`',
        '- `10:00:02` 回复',
        '  > 好了',
        '  >',
        '  > 第二行',
      ].join('\n'),
    )
  })

  it('copies from the run tab as plain text or Markdown', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    serve(detail())
    render(<RunTab {...tab('process')} />)
    await screen.findByRole('list', { name: '运行过程' })
    fireEvent.click(screen.getByRole('button', { name: '复制过程' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制为纯文本' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('权限请求 rm -rf dist')
    fireEvent.click(screen.getByRole('button', { name: '复制过程' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制为 Markdown' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(String((writeText.mock.calls[1] as unknown[])[0])).toContain('权限请求 `rm -rf dist`')
  })
})

describe('purged runs', () => {
  it('still show their requests, which are kept for good', async () => {
    serve(detail({ purged: true }))
    render(<RunTab {...tab('process')} />)
    expect(await screen.findByText('运行过程已过期，仅保留摘要')).toBeTruthy()
    expect(await screen.findByText('rm -rf dist')).toBeTruthy()
    expect(screen.getByText(/允许改 fixture 吗/)).toBeTruthy()
  })
})

describe('repeated failures', () => {
  it('fold into one row with a count', () => {
    render(
      <ProcessView
        steps={[failing('f1'), failing('f2'), failing('f3')]}
        root={null}
        live={false}
        startedAt={at}
        workedMs={null}
      />,
    )
    expect(screen.getAllByText('make test')).toHaveLength(1)
    expect(screen.getByText('×3')).toBeTruthy()
  })
})
