import { describe, expect, it } from 'vitest'
import {
  buildItems,
  classify,
  fmtWorked,
  type Group,
  groupActions,
  relative,
} from '../src/features/runs/activity'
import type { Step } from '../src/features/runs/process'

const ROOT = '/ws/proj'
let n = 0
const step = (kind: string, o: Partial<Step> = {}): Step => ({ key: `s${++n}`, kind, label: kind, ...o })
const exec = (cmd: string, o: Partial<Step> = {}) => step('execute', { mono: cmd, title: cmd, ...o })
const read = (path: string, o: Partial<Step> = {}) => step('read', { mono: `${ROOT}/${path}:1`, ...o })

describe('classify', () => {
  it('treats read-only shell probes as exploring and bucketizes them like Codex', () => {
    const c = (cmd: string) => {
      const a = classify(exec(cmd), ROOT)
      return [a.family, a.bucket ?? null, a.verb]
    }
    expect(c('rg -n buildSteps apps/web')).toEqual(['explore', 'search', '已搜索'])
    expect(c('cd apps && grep -rn "x" src | head -20')).toEqual(['explore', 'search', '已搜索'])
    expect(c('ls -la apps/web/src')).toEqual(['explore', 'list', '已列出'])
    expect(c("sed -n '1,80p' a.ts")).toEqual(['explore', 'file', '已读取'])
    expect(c('git log -5 --oneline')).toEqual(['explore', 'probe', '已查看'])
    expect(c('git status')).toEqual(['explore', 'probe', '已查看'])
    // Formatting stages of a pipeline (Codex drops them) do not change what the command does.
    expect(c("find apps -name '*.ts' | sort")).toEqual(['explore', 'list', '已列出'])
    expect(c('cat a.ts | head -40')).toEqual(['explore', 'file', '已读取'])
    expect(c('ls src | wc -l')).toEqual(['explore', 'list', '已列出'])
    expect(c("sed -n '68,125p;168,182p' src/a.ts")).toEqual(['explore', 'file', '已读取'])
    expect(c('pnpm test')).toEqual(['execute', null, '已运行'])
    expect(c('cat a.ts > b.ts')).toEqual(['execute', null, '已运行'])
    expect(c("sed -i 's/a/b/' a.ts")).toEqual(['execute', null, '已运行'])
    expect(c('git commit -m x')).toEqual(['execute', null, '已运行'])
  })

  it('names what a shell probe looks at instead of echoing the command (Codex parse_command)', () => {
    const t = (cmd: string) => classify(exec(cmd), ROOT).target
    expect(t('cat notes/deps.md')).toBe('notes/deps.md')
    expect(t(`sed -n '1,80p' ${ROOT}/src/a.ts`)).toBe('src/a.ts')
    expect(t('head -n 40 src/b.ts | cat')).toBe('src/b.ts')
    expect(t('rg -n "fmtDuration" apps/web')).toBe('fmtDuration · apps/web')
    expect(t("grep -rn 'useRunRail' src")).toBe('useRunRail · src')
    expect(t('rg --files')).toBe('rg --files')
    expect(t('ls -la apps/web/src')).toBe('apps/web/src')
    expect(t('cd apps && ls')).toBe('.')
    expect(t('git status')).toBe('git status')
    expect(t('cat a.ts && cat b.ts')).toBe('a.ts, b.ts')
  })

  it('shows workspace-relative paths and live / failed verbs', () => {
    expect(classify(read('src/a.ts'), ROOT)).toMatchObject({ verb: '已读取', target: 'src/a.ts' })
    expect(classify(read('src/a.ts', { running: true }), ROOT).verb).toBe('正在读取')
    expect(classify(exec('make', { failed: true }), ROOT).verb).toBe('运行失败')
    // grep exits 1 on no match: that is an answer, not a failure (Codex).
    expect(classify(exec('rg nothing-here', { failed: true }), ROOT)).toMatchObject({
      family: 'explore',
      verb: '未找到',
      quiet: true,
    })
    expect(classify(step('edit', { mono: `${ROOT}/notes/x.md` }), ROOT)).toMatchObject({
      family: 'edit',
      verb: '已编辑',
      target: 'notes/x.md',
    })
    expect(classify(step('search', { title: 'Find `**/*.ts`' }), ROOT)).toMatchObject({ bucket: 'list' })
    expect(relative('/elsewhere/a.ts:3', ROOT)).toBe('/elsewhere/a.ts')
    // Adapters open a call with a generic title before its input streams in.
    expect(classify(step('read', { title: 'Read File', running: true }), ROOT).target).toBeUndefined()
    expect(classify(step('edit', { title: 'Preparing file…', running: true }), ROOT).target).toBeUndefined()
  })
})

describe('groupActions', () => {
  const acts = (steps: Step[]) => steps.map((s) => classify(s, ROOT))

  it('folds every call between two pieces of text into one segment titled by what it did (Codex app)', () => {
    const items = groupActions(
      acts([
        step('edit', { mono: `${ROOT}/a.ts` }),
        read('a.ts'),
        step('thought', { body: '再看看' }),
        exec('rg foo'),
        exec('pnpm test', { failed: true }),
        step('text', { body: '回归通过，接着跑全量' }),
        exec('pnpm test'),
        step('text', { body: '好了' }),
      ]),
      false,
    )
    expect(
      items.map((i) =>
        i.kind === 'group' ? `group:${i.actions.length}` : i.kind === 'action' ? i.family : 'work',
      ),
    ).toEqual(['group:5', 'text', 'execute', 'text'])
    expect(items[0]).toMatchObject({
      title: '编辑了文件、读取了文件、搜索了代码、运行了命令',
      failed: 1,
      running: false,
    })
  })

  it('keeps approvals and the context outside segments', () => {
    const items = groupActions(
      acts([step('context'), read('a.ts'), step('approval'), read('b.ts'), exec('ls')]),
      false,
    )
    expect(
      items.map((i) =>
        i.kind === 'group' ? `group:${i.actions.length}` : i.kind === 'action' ? i.family : 'work',
      ),
    ).toEqual(['context', 'explore', 'approval', 'group:2'])
    expect(items[3]).toMatchObject({ title: '读取了文件、查看了目录' })
  })

  it('keeps subagents and background tasks on their own rows, named by what they do', () => {
    const sub = step('subagent', { title: 'Explore', body: '找调用方', meta: '进行中', running: true })
    const task = step('task', { label: '后台任务', title: 'pnpm dev', meta: '运行中', running: true })
    const items = groupActions(acts([read('a.ts'), sub, read('b.ts'), exec('ls'), task]), true)
    expect(
      items.map((i) => (i.kind === 'group' ? 'group' : i.kind === 'action' ? i.family : 'work')),
    ).toEqual(['explore', 'subagent', 'group', 'task'])
    expect(items[1]).toMatchObject({ verb: 'Explore', target: '找调用方' })
    expect(items[3]).toMatchObject({ verb: '后台任务', target: 'pnpm dev' })
    const worked = buildItems([sub, step('text', { body: '完成' })], ROOT, false, 1000)[0]
    expect(worked).toMatchObject({ kind: 'work', summary: '子 agent 1' })
  })

  it('a segment is running while it is the live tail, even if its calls have all finished', () => {
    const steps = acts([read('a.ts'), read('b.ts')])
    expect((groupActions(steps, true)[0] as Group).running).toBe(true)
    expect((groupActions([...steps, ...acts([step('text')])], true)[0] as Group).running).toBe(false)
  })
})

describe('buildItems', () => {
  it('hides a shell call until its command is known, so it cannot split a group early', () => {
    const steps = [read('a.ts'), step('execute', { title: 'Terminal', mono: 'Terminal', running: true })]
    expect(buildItems(steps, ROOT, true, null).map((i) => i.kind)).toEqual(['action'])
  })

  it('folds a finished turn under 已工作 and keeps the final reply outside', () => {
    const steps = [
      step('context'),
      read('a.ts'),
      read('b.ts'),
      exec('pnpm test'),
      step('text', { body: '完成' }),
    ]
    const [work, reply] = buildItems(steps, ROOT, false, 65_000)
    expect(work).toMatchObject({
      kind: 'work',
      title: '已工作 1 分 5 秒',
      summary: '查阅 2 · 命令 1',
    })
    expect(reply).toMatchObject({ kind: 'action', family: 'text' })
    expect(buildItems(steps, ROOT, true, 65_000).map((i) => i.kind)).toEqual(['action', 'group', 'action'])
  })

  it('keeps background tasks still running outside 已工作, where they can be stopped', () => {
    const task = step('task', { label: '后台任务', title: 'pnpm dev', running: true, stop: 'bg1' })
    const steps = [step('context'), exec('ls'), task, step('text', { body: 'started' })]
    const items = buildItems(steps, ROOT, false, 5000)
    expect(items.map((i) => (i.kind === 'action' ? i.family : i.kind))).toEqual(['work', 'task', 'text'])
  })

  it('does not fold a run that ended without a reply', () => {
    const steps = [step('context'), exec('make', { failed: true })]
    expect(buildItems(steps, ROOT, false, 3000).map((i) => i.kind)).toEqual(['action', 'action'])
  })

  it('formats the worked time with at most two units', () => {
    expect([fmtWorked(400), fmtWorked(32_000), fmtWorked(3_725_000)]).toEqual([
      '1 秒',
      '32 秒',
      '1 小时 2 分',
    ])
  })
})
