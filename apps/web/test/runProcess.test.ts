import type { ApprovalDto, RunDetailDto, RunDto } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import { diffCells, findFile, parsePatch } from '../src/features/diff/patch'
import { filePaths } from '../src/features/runs/paths'
import { buildSteps } from '../src/features/runs/process'

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '-old',
  '+new',
  '+more',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1 @@',
  '+fresh',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
  'diff --git a/logo.png b/logo.png',
  'new file mode 100644',
  'index 0000000..4444444',
  'Binary files /dev/null and b/logo.png differ',
  '… 补丁超过 512 KB，已截断',
  '',
].join('\n')

describe('patch parsing', () => {
  it('lists files with +/− counts, binaries and hunk lines', () => {
    const files = parsePatch(patch)
    expect(files.map((f) => [f.path, f.status, f.add, f.del, f.binary])).toEqual([
      ['src/a.ts', 'modified', 2, 1, false],
      ['new.txt', 'added', 1, 0, false],
      ['gone.txt', 'deleted', 0, 1, false],
      ['logo.png', 'added', 0, 0, true],
    ])
    expect(files[0]!.lines).toEqual(['@@ -1,2 +1,3 @@', ' keep', '-old', '+new', '+more'])
    expect(files[3]!.lines).toEqual([
      'Binary files /dev/null and b/logo.png differ',
      '… 补丁超过 512 KB，已截断',
    ])
    expect(parsePatch('')).toEqual([])
  })

  it('matches reply paths against patch paths by suffix', () => {
    const files = parsePatch(patch)
    expect(findFile(files, 'src/a.ts')?.path).toBe('src/a.ts')
    expect(findFile(files, '/Users/me/ws/src/a.ts')?.path).toBe('src/a.ts')
    expect(findFile(files, './new.txt')?.path).toBe('new.txt')
    expect(findFile(files, 'a.ts')).toBeUndefined()
    expect(findFile(files, 'other.go')).toBeUndefined()
  })
})

describe('file paths in replies', () => {
  it('finds paths ending in a file extension or dotfiles, outside code blocks and URLs', () => {
    const md = [
      '已修改 `server/refund/v2/handler.go` 和README.md，新增了src/a.ts文件。',
      '已推送到 origin/main，比对 feat/refund-v2 分支，另改了 .env 与 config/.env.local。',
      '参考 https://example.com/docs/x.html 与 @接力 B，版本 v1.2.3，耗时 1.5 秒。',
      '```sh',
      'cat build/out.log',
      '```',
      '再看 ./scripts/run.sh 与 `handler.go`。',
    ].join('\n')
    expect(filePaths(md)).toEqual([
      'server/refund/v2/handler.go',
      'README.md',
      'src/a.ts',
      '.env',
      'config/.env.local',
      './scripts/run.sh',
      'handler.go',
    ])
  })
})

const at = (s: number) => new Date(Date.UTC(2026, 8, 23, 2, 21, s)).toISOString()
const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'completed',
  step: '',
  filesChanged: 1,
  usage: null,
  newSessionReason: null,
  queuedAt: at(0),
  startedAt: at(0),
  endedAt: at(30),
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  ...o,
})
const approval = (o: Partial<ApprovalDto>): ApprovalDto => ({
  id: 'a1',
  runId: 'r1',
  title: 'Bash',
  toolKind: 'execute',
  detail: 'go build ./...',
  options: [],
  status: 'pending',
  voidReason: null,
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  expiresAt: at(59),
  createdAt: at(9),
  ...o,
})

describe('process steps', () => {
  it('opens with the context step and merges tool updates in order', () => {
    const detail: RunDetailDto = {
      run: run({ newSessionReason: 'resume_failed', approvals: [approval({})] }),
      patch,
      purged: false,
      sessionId: 's1',
      retentionDays: 30,
      events: [
        {
          id: 1,
          at: at(1),
          event: { kind: 'status', status: 'running', step: 'git fetch 完成，当前分支 main' },
        },
        { id: 2, at: at(2), event: { kind: 'thought', delta: '先看调用方' } },
        {
          id: 3,
          at: at(3),
          event: {
            kind: 'tool',
            toolCallId: 't1',
            title: '查找调用方',
            toolKind: 'execute',
            status: 'in_progress',
          },
        },
        {
          id: 4,
          at: at(4),
          event: {
            kind: 'tool',
            toolCallId: 'e1',
            title: 'Edit src/a.ts',
            toolKind: 'edit',
            status: 'completed',
            detail: '/ws/src/a.ts',
          },
        },
        {
          id: 5,
          at: at(7),
          event: {
            kind: 'tool',
            toolCallId: 't1',
            title: '查找调用方',
            toolKind: 'execute',
            status: 'completed',
            detail: '$ rg RefundV1\nrouter.go:42',
          },
        },
        { id: 6, at: at(8), event: { kind: 'usage', usage: { totalTokens: 10 } } },
        { id: 7, at: at(10), event: { kind: 'text', delta: '完成' } },
      ],
    }
    const steps = buildSteps(detail)
    expect(steps.map((s) => [s.kind, s.label])).toEqual([
      ['context', '本轮上下文'],
      ['thought', '思考'],
      ['execute', '执行命令'],
      ['edit', '编辑文件'],
      ['approval', '权限请求'],
      ['text', '回复'],
    ])
    expect(steps[0]).toMatchObject({
      meta: '新会话',
      body: '会话恢复失败，已开新会话并补送最近 50 条群消息。git 默认动作：fetch 完成，当前分支 main',
    })
    expect(steps[2]).toMatchObject({ mono: 'rg RefundV1', out: '$ rg RefundV1\nrouter.go:42', meta: '4.0s' })
    expect(steps[3]).toMatchObject({ mono: '/ws/src/a.ts', meta: '+2 −1' })
    expect(steps[4]).toMatchObject({ mono: 'go build ./...', body: '等待 Bot 主人审批' })
  })

  it('keeps one row per approval, dropping the status rows that mirror its lifecycle', () => {
    const status = (id: number, step: string) => ({
      id,
      at: at(id),
      event: { kind: 'status' as const, status: 'running' as const, step },
    })
    const steps = buildSteps({
      run: run({
        approvals: [
          approval({ status: 'approved', decidedByName: '系统管理员' }),
          approval({ id: 'ap2', status: 'rejected', decidedByName: '系统管理员', createdAt: at(21) }),
        ],
      }),
      patch: null,
      purged: false,
      sessionId: 's1',
      retentionDays: 30,
      events: [
        { id: 1, at: at(1), event: { kind: 'text', delta: '开始' } },
        status(10, '等待审批：go build ./...'),
        status(12, '已批准：go build ./...'),
        status(22, '等待审批：rm -rf dist'),
        status(24, '请求被拒绝，agent 自行绕路'),
        status(30, '档位已切换为「完全访问」，自动批准：ls'),
      ],
    })
    expect(steps.map((s) => [s.kind, s.body])).toEqual([
      ['context', '续用上次会话，补送上次被 @ 以来的群消息'],
      ['text', '开始'],
      ['approval', '系统管理员 已批准'],
      ['approval', '系统管理员 已拒绝'],
      ['status', '档位已切换为「完全访问」，自动批准：ls'],
    ])
  })

  it('folds session config echoes into the context step', () => {
    const steps = buildSteps({
      run: run(),
      patch: null,
      purged: false,
      sessionId: 's1',
      retentionDays: 30,
      events: [
        { id: 1, at: at(1), event: { kind: 'status', status: 'running', step: '已切换模型：Opus' } },
        { id: 2, at: at(2), event: { kind: 'status', status: 'running', step: '已切换推理强度：High' } },
        { id: 3, at: at(3), event: { kind: 'text', delta: '好' } },
      ],
    })
    expect(steps.map((s) => s.kind)).toEqual(['context', 'text'])
    expect(steps[0]!.body).toBe(
      '续用上次会话，补送上次被 @ 以来的群消息。已切换模型：Opus。已切换推理强度：High',
    )
  })

  it('without git or a new session the context step says the session was resumed', () => {
    const steps = buildSteps({
      run: run(),
      patch: null,
      purged: false,
      sessionId: null,
      retentionDays: 30,
      events: [],
    })
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'context',
        meta: '续用会话',
        body: '续用上次会话，补送上次被 @ 以来的群消息',
      }),
    ])
  })

  it('marks running and failed steps and carries per-file diff counts', () => {
    const tool = (
      id: number,
      toolCallId: string,
      toolKind: string,
      status: 'completed' | 'in_progress' | 'failed',
      detail?: string,
    ) => ({
      id,
      at: at(id),
      event: { kind: 'tool' as const, toolCallId, title: toolCallId, toolKind, status, detail },
    })
    const steps = buildSteps({
      run: run({ status: 'running', approvals: [approval({ createdAt: at(1) })] }),
      patch,
      purged: false,
      sessionId: null,
      retentionDays: 30,
      events: [
        tool(2, 'e1', 'edit', 'completed', '/ws/src/a.ts'),
        tool(3, 'x1', 'execute', 'failed', '$ make\nboom'),
        tool(4, 'r1', 'read', 'in_progress', 'README.md'),
        { id: 5, at: at(5), event: { kind: 'text', delta: '正在' } },
      ],
    })
    const by = (kind: string) => steps.find((s) => s.kind === kind)
    expect(by('approval')).toMatchObject({ running: true })
    expect(by('edit')).toMatchObject({ diff: { add: 2, del: 1 } })
    expect(by('edit')?.running).toBeFalsy()
    expect(by('execute')).toMatchObject({ failed: true })
    expect(by('read')).toMatchObject({ running: true })
    // The reply being streamed is the current step of a running run.
    expect(by('text')).toMatchObject({ running: true })
  })

  it('nests subagent work under its spawn row and shows background tasks at their latest state', () => {
    const sub = (id: number, agentId: string, state: 'running' | 'completed', parentId?: string) => ({
      id,
      at: at(id),
      event: {
        kind: 'subagent' as const,
        agentId,
        parentId,
        name: agentId === 'a1' ? 'Explore' : 'Plan',
        task: '找调用方',
        state,
      },
    })
    const read = (id: number, status: 'in_progress' | 'completed') => ({
      id,
      at: at(id),
      event: {
        kind: 'tool' as const,
        agentId: 'a1',
        toolCallId: 't1',
        title: 'Read',
        toolKind: 'read',
        status,
        detail: '/ws/src/a.ts',
      },
    })
    const task = (id: number, state: 'running' | 'completed', summary?: string) => ({
      id,
      at: at(id),
      event: {
        kind: 'task' as const,
        taskId: 'bg1',
        agentId: 'a1',
        name: 'pnpm dev',
        taskType: 'shell',
        state,
        summary,
      },
    })
    const steps = buildSteps({
      run: run({ status: 'running' }),
      patch: null,
      purged: false,
      sessionId: null,
      retentionDays: 30,
      events: [
        sub(1, 'a1', 'running'),
        { id: 2, at: at(2), event: { kind: 'thought', delta: '子想', agentId: 'a1' } },
        read(3, 'in_progress'),
        { id: 4, at: at(4), event: { kind: 'text', delta: '主进度' } },
        read(5, 'completed'),
        sub(6, 'a2', 'running', 'a1'),
        { id: 7, at: at(7), event: { kind: 'text', delta: '嵌套', agentId: 'a2' } },
        task(8, 'running'),
        sub(9, 'a1', 'completed'),
        task(10, 'completed', 'exit 0'),
        {
          id: 11,
          at: at(11),
          event: { kind: 'tool', toolCallId: 'x', title: '', toolKind: 'other', status: 'pending' },
        },
      ],
    })
    expect(steps.map((s) => s.kind)).toEqual(['context', 'subagent', 'text'])
    const [, explore, text] = steps
    expect(explore).toMatchObject({ label: '子 agent', title: 'Explore', body: '找调用方', running: false })
    expect(explore!.children!.map((s) => [s.kind, s.running ?? false])).toEqual([
      ['thought', false],
      ['read', false],
      ['subagent', true],
      ['task', false],
    ])
    expect(explore!.children![2]!.children).toEqual([
      expect.objectContaining({ kind: 'text', body: '嵌套', running: true }),
    ])
    expect(explore!.children![3]).toMatchObject({
      label: '后台任务',
      title: 'pnpm dev',
      body: 'exit 0',
      meta: '已完成',
    })
    expect(text).toMatchObject({ body: '主进度', running: true })
  })

  it('no call is still running once the run has ended', () => {
    const steps = buildSteps({
      run: run({ status: 'completed' }),
      patch: null,
      purged: false,
      sessionId: null,
      retentionDays: 30,
      events: [
        {
          id: 1,
          at: at(1),
          event: {
            kind: 'tool',
            toolCallId: 'c1',
            title: 'spawnAgent',
            toolKind: 'other',
            status: 'in_progress',
          },
        },
      ],
    })
    expect(steps.at(-1)).toMatchObject({ title: 'spawnAgent', running: false })
  })

  it('stops marking the streamed reply once the run has ended', () => {
    const steps = buildSteps({
      run: run({ status: 'completed' }),
      patch: null,
      purged: false,
      sessionId: null,
      retentionDays: 30,
      events: [{ id: 1, at: at(1), event: { kind: 'text', delta: '完成' } }],
    })
    expect(steps.some((s) => s.running)).toBe(false)
  })
})

describe('diff bar', () => {
  it('splits five cells between additions and deletions like GitHub', () => {
    expect(diffCells(0, 0)).toEqual(['none', 'none', 'none', 'none', 'none'])
    expect(diffCells(2, 1)).toEqual(['add', 'add', 'del', 'none', 'none'])
    expect(diffCells(100, 0)).toEqual(['add', 'add', 'add', 'add', 'add'])
    expect(diffCells(0, 7)).toEqual(['del', 'del', 'del', 'del', 'del'])
    expect(diffCells(30, 20)).toEqual(['add', 'add', 'add', 'del', 'del'])
    // A side that exists always keeps at least one cell.
    expect(diffCells(1, 99)).toEqual(['add', 'del', 'del', 'del', 'del'])
    expect(diffCells(99, 1)).toEqual(['add', 'add', 'add', 'add', 'del'])
  })
})
