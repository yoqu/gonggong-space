import type {
  GitActionDetail,
  GitActionInput,
  GitActionResultDetail,
  GitDiffDto,
  GitOperationDto,
  GitOperationsDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupRepos, groups, notifications } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { gitBranch, gitDaemon, gitWorld, groupEvents } from './support/git-daemon.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const OPS3 = ['gitOps', 'gitOps2', 'gitRepos', 'gitOps3']
const ALL = [...OPS3, 'gitOps4']
const old = { status: 409, body: { message: 'cc 所在机器的客户端版本过旧，升级后才能使用 Git 操作' } }
const confirm = { status: 409, body: { message: '推送基准分支需要再次确认' } }
const noForce = { status: 409, body: { message: '受保护的基准分支不能强制推送' } }
const noDelete = { status: 409, body: { message: '受保护的基准分支不能在远程删除' } }
const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

type World = Awaited<ReturnType<typeof gitWorld>>
const ops = (w: World) => w.members.get<GitOperationsDto>(`/api/groups/${w.group.id}/git/operations`)
const protect = (w: World) => t.db.update(groups).set({ protectBase: true }).where(eq(groups.id, w.group.id))
const said = (summary: string) => `王磊 在 cc 的工作区执行了 ${summary}`
const PATCH =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-const a = 1\n+const a = 2\n' +
  ' const b = 1\n@@ -9,2 +9,2 @@\n-x\n+y\n z\n'
const detail = (o: Partial<GitActionResultDetail>): GitActionResultDetail => ({
  code: null,
  paths: [],
  ahead: null,
  behind: null,
  updated: null,
  commands: null,
  ...o,
})

describe('gitOps4 names', () => {
  it('refuses with 400 any name a refspec, an option or a URL would read as more', async () => {
    const w = await gitWorld(t)
    await gitDaemon(t, w.token, ALL)
    const refused: [unknown, string][] = [
      [{ action: 'push', branch: '+feat:main' }, '无效的分支或标签名'],
      [{ action: 'push', branch: 'HEAD', force: true }, '无效的分支或标签名'],
      [{ action: 'push', branch: ':main' }, '无效的分支或标签名'],
      [{ action: 'push', branch: 'refs/heads/main' }, '无效的分支或标签名'],
      [{ action: 'push', branch: 'feat', target: ':main' }, '无效的分支或标签名'],
      [{ action: 'push', branch: 'feat', target: 'HEAD' }, '无效的分支或标签名'],
      [{ action: 'push', branch: 'feat', remote: 'git@evil.com:x/y.git' }, '无效的远程名称'],
      [{ action: 'push', branch: 'feat', remote: 'https://evil.com/x.git' }, '无效的远程名称'],
      [{ action: 'push', branch: 'feat', remote: '--receive-pack=x' }, '无效的远程名称'],
      [{ action: 'tag-push', name: 'v1', remote: '../other' }, '无效的远程名称'],
      [{ action: 'tag-delete', name: ':v1', remote: 'origin' }, '无效的分支或标签名'],
      [{ action: 'branch-delete', branch: 'origin/:main' }, '无效的分支或标签名'],
      [{ action: 'reset', commit: '--hard' }, '无效的修订'],
      [{ action: 'checkout', branch: '--orphan', detach: true }, '无效的修订'],
    ]
    for (const [input, message] of refused)
      for (const who of [w.owners, w.members])
        expect(await who.post(`${w.base}/actions`, input), JSON.stringify(input)).toMatchObject({
          status: 400,
          body: { message },
        })
    expect((await ops(w)).body.operations).toEqual([])
  })

  it('answers them in the language asked for', async () => {
    const w = await gitWorld(t)
    const cookie = await t.seed.cookie(w.owner.id)
    const post = async (payload: object) => {
      const headers = { cookie, 'accept-language': 'en' }
      const res = await t.app.inject({ method: 'POST', url: `${w.base}/actions`, headers, payload })
      return res.json<{ message: string }>().message
    }
    expect(await post({ action: 'push', branch: '+feat:main' })).toBe('Invalid branch or tag name')
    expect(await post({ action: 'push', branch: 'feat', remote: 'git@evil.com:x/y.git' })).toBe(
      'Invalid remote name',
    )
    expect(await post({ action: 'reset', commit: '--hard' })).toBe('Invalid revision')
    expect(await post({ action: 'commit', message: ' ' })).toBe('Enter a commit message')
  })
})

describe('gitOps4 actions', () => {
  it('needs gitOps4 for the new actions and options; what an older daemon does alike still reaches it', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, OPS3)
    const inputs: GitActionInput[] = [
      { action: 'add', paths: ['a.txt'] },
      { action: 'ignore', paths: ['dist'] },
      { action: 'push', branch: 'feat', target: 'feat-v2' },
      { action: 'push', branch: 'feat', commit: 'a1b2c3d' },
      { action: 'discard', paths: ['a.txt'], keepAdded: true },
      { action: 'discard', paths: ['a.txt'], patch: PATCH },
      { action: 'checkout', branch: 'origin/feat', localCommits: 'drop' },
      { action: 'pull', from: 'origin/feat' },
      { action: 'branch-create', name: 'feat', overwrite: true },
    ]
    for (const input of inputs) {
      expect(await w.owners.post(`${w.base}/actions`, input), input.action).toMatchObject(old)
      expect(await w.members.post(`${w.base}/actions`, input), input.action).toMatchObject(old)
    }
    expect((await ops(w)).body.operations).toEqual([])

    const same = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'push',
      branch: 'feat',
      target: 'feat',
    })
    expect(await d.act()).toMatchObject({ action: 'push', branch: 'feat', args: { target: 'feat' } })
    expect((await same).body.status).toBe('succeeded')
    const created = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'branch-create',
      name: 'feat',
      overwrite: false,
    })
    expect((await d.act()).args).toEqual({ checkout: true })
    expect((await created).body.status).toBe('succeeded')
    const discard = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'discard',
      paths: ['a.txt'],
      keepAdded: false,
    })
    expect('args' in (await d.act())).toBe(false)
    expect((await discard).body.status).toBe('succeeded')
  })

  it('stores the new actions and options, relays them and announces them', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const none = { branch: null, remote: null, message: null, paths: null, args: null }
    const cases: [GitActionInput, Partial<GitOperationDto>, string][] = [
      [{ action: 'add', paths: ['notes/todo.md'] }, { paths: ['notes/todo.md'] }, said('add notes/todo.md')],
      [{ action: 'add', paths: ['a.ts', 'b.ts'] }, { paths: ['a.ts', 'b.ts'] }, said('add 2 files')],
      [
        { action: 'ignore', paths: ['dist/out.log', 'tmp'] },
        { paths: ['dist/out.log', 'tmp'] },
        said('ignore 2 files'),
      ],
      [{ action: 'ignore', paths: ['tmp'] }, { paths: ['tmp'] }, said('ignore tmp')],
      [
        { action: 'push', branch: 'feat/refund', target: 'feat/refund-v2' },
        { branch: 'feat/refund', remote: 'origin', args: { target: 'feat/refund-v2' } },
        said('push feat/refund → origin/feat/refund-v2'),
      ],
      [
        { action: 'push', branch: 'feat/refund', target: 'feat/refund', force: true },
        { branch: 'feat/refund', remote: 'origin', args: { force: true, target: 'feat/refund' } },
        said('push --force-with-lease feat/refund → origin'),
      ],
      [
        { action: 'discard', paths: ['src/new.ts', 'src/a.ts'], keepAdded: true },
        { paths: ['src/new.ts', 'src/a.ts'], args: { keepAdded: true } },
        said('rollback 2 files'),
      ],
      [
        { action: 'unstash', stash: 1, expect: 'a1b2c3d', pop: true },
        { args: { stash: 1, expect: 'a1b2c3d', pop: true } },
        said('stash pop stash@{1}'),
      ],
      [
        { action: 'stash-drop', stash: 0, expect: hash },
        { args: { stash: 0, expect: hash } },
        said('stash drop stash@{0}'),
      ],
      [
        { action: 'checkout', branch: 'origin/feat', localCommits: 'rebase' },
        { branch: 'origin/feat', args: { localCommits: 'rebase' } },
        said('checkout origin/feat (rebase local commits)'),
      ],
      [
        { action: 'checkout', branch: 'origin/feat', mode: 'smart', localCommits: 'drop' },
        { branch: 'origin/feat', args: { mode: 'smart', localCommits: 'drop' } },
        said('checkout origin/feat (drop local commits)'),
      ],
      [
        { action: 'pull', mode: 'rebase', from: 'origin/feat' },
        { args: { mode: 'rebase', from: 'origin/feat' } },
        said('pull --rebase from origin/feat'),
      ],
      [
        { action: 'branch-create', name: 'feat/x', from: 'origin/feat/x', overwrite: true },
        { branch: 'feat/x', args: { from: 'origin/feat/x', checkout: true, force: true } },
        said('checkout -B feat/x origin/feat/x'),
      ],
      [
        { action: 'branch-create', name: 'feat/x', checkout: false, overwrite: true },
        { branch: 'feat/x', args: { force: true } },
        said('branch -f feat/x'),
      ],
    ]
    for (const [input, stored] of cases) {
      const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
      const req = await d.act()
      const { args, ...columns } = { ...none, ...stored }
      expect(req, input.action).toMatchObject({ action: input.action, ...columns })
      expect(req.args, input.action).toEqual(args ?? undefined)
      const op = (await res).body
      expect(op, input.action).toMatchObject({ status: 'succeeded', action: input.action, ...columns })
      expect(op.args, input.action).toEqual(args)
    }
    expect(await groupEvents(t, w.group.id)).toEqual(cases.map(([, , event]) => event))
  })

  it('runs add and ignore at once for the owner and asks the owner for a member', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const added = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'add',
      paths: ['notes/todo.md'],
    })
    expect(await d.act()).toMatchObject({ action: 'add', paths: ['notes/todo.md'] })
    expect((await added).body).toMatchObject({ status: 'succeeded', requestedBy: { id: w.owner.id } })

    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'ignore',
      paths: ['dist'],
    })
    expect(asked.body).toMatchObject({ status: 'pending_approval', action: 'ignore', paths: ['dist'] })
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note!.payload).toMatchObject({ summary: 'ignore dist', operationId: asked.body.id })
    const decide = `/api/git-operations/${asked.body.id}/decide`
    expect(await w.members.post(decide, { approve: true })).toMatchObject({ status: 403 })
    const approved = w.owners.post<GitOperationDto>(decide, { approve: true })
    expect(await d.act()).toMatchObject({ action: 'ignore', paths: ['dist'] })
    expect((await approved).body).toMatchObject({ status: 'succeeded', decidedBy: { id: w.owner.id } })
    expect(await groupEvents(t, w.group.id)).toEqual([
      said('add notes/todo.md'),
      '陈晨 在 cc 的工作区执行了 ignore dist（王磊 批准）',
    ])
  })

  it('reverts hunks of one file, the patch kept out of what members see', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    expect(
      await w.owners.post(`${w.base}/actions`, { action: 'discard', paths: ['a.ts', 'b.ts'], patch: PATCH }),
    ).toMatchObject({ status: 400, body: { message: '逐块回滚只能针对一个文件' } })

    const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'discard',
      paths: ['src/a.ts'],
      patch: PATCH,
    })
    expect(await d.act()).toMatchObject({ action: 'discard', paths: ['src/a.ts'], args: { patch: PATCH } })
    const op = (await res).body
    expect(op).toMatchObject({ status: 'succeeded', paths: ['src/a.ts'] })
    expect(op.args).toEqual({})

    const one = PATCH.slice(0, PATCH.lastIndexOf('@@ -9'))
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'discard',
      paths: ['src/a.ts'],
      patch: one,
    })
    expect(asked.body.args).toEqual({})
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note!.payload).toMatchObject({ summary: 'rollback 1 hunk in src/a.ts' })
    const approved = w.owners.post(`/api/git-operations/${asked.body.id}/decide`, { approve: true })
    expect((await d.act()).args).toEqual({ patch: one })
    expect((await approved).status).toBe(200)
    expect((await ops(w)).body.operations.map((o) => o.args)).toEqual([{}, {}])
    const logs = await t.db.select().from(auditLogs)
    expect(logs.map((l) => l.action).sort()).toEqual(['git.decide', 'git.request', 'git.run', 'git.run'])
    expect(JSON.stringify(logs.map((l) => l.detail))).not.toContain('const a')
    expect(await groupEvents(t, w.group.id)).toEqual([
      said('rollback 2 hunks in src/a.ts'),
      '陈晨 在 cc 的工作区执行了 rollback 1 hunk in src/a.ts（王磊 批准）',
    ])
  })

  it('keeps what a checkout or a pull came to and tells the group', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const post = (input: GitActionInput) => w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
    const conflicts = detail({ code: 'conflicts', paths: ['src/a.ts'] })
    const checkout = post({ action: 'checkout', branch: 'main', mode: 'smart' })
    await d.act({ output: '[main a1b2c3d] init', detail: conflicts })
    const switched = (await checkout).body
    expect(switched).toMatchObject({ status: 'succeeded', detail: conflicts })

    const updated = { from: '1a2b3c4', to: '5d6e7f8', commits: 2, files: 3 }
    const pulled = post({ action: 'pull' })
    await d.act({ detail: detail({ updated }) })
    expect((await pulled).body).toMatchObject({ status: 'succeeded', detail: { updated } })
    const merged = post({ action: 'pull', mode: 'merge', from: 'origin/feat' })
    const both = { code: 'conflicts', paths: ['a.ts', 'b.ts'], updated: { ...updated, commits: 1, files: 1 } }
    await d.act({ detail: detail(both as Partial<GitActionDetail>) })
    expect((await merged).body.status).toBe('succeeded')
    const nothing = post({ action: 'pull' })
    await d.act({ detail: detail({}) })
    expect((await nothing).body.detail).toEqual(detail({}))

    const diverged = detail({ code: 'diverged', ahead: 1, behind: 2 })
    const refused = post({ action: 'checkout', branch: 'origin/feat' })
    await d.act({ ok: false, error: 'feat 与 origin/feat 已分叉', detail: diverged })
    expect((await refused).body).toMatchObject({ status: 'failed', detail: diverged })
    // An older daemon's answer has none.
    const older = post({ action: 'pull' })
    await d.act()
    expect((await older).body.detail).toBeNull()

    const listed = (await ops(w)).body.operations
    expect(listed.find((o) => o.id === switched.id)?.detail).toEqual(conflicts)
    expect(await groupEvents(t, w.group.id)).toEqual([
      said('checkout main (local changes restored with conflicts in 1 file)'),
      said('pull (2 commits, 3 files)'),
      said(
        'pull --no-rebase from origin/feat (1 commit, 1 file; local changes restored with conflicts in 2 files)',
      ),
      '王磊 为 cc 拉取了更新',
      '王磊 为 cc 拉取了更新',
    ])
  })
})

describe('gitOps4 diffs', () => {
  it("passes a whitespace mode and a rename's source on to a daemon that has them, else as before", async () => {
    const w = await gitWorld(t)
    const answer = (d: Awaited<ReturnType<typeof gitDaemon>>, requestId: string) =>
      d.send({ t: 'git.diff.result', requestId, patch: null, truncated: false, error: null })
    const url = `${w.base}/diff?${new URLSearchParams({
      from: 'HEAD',
      path: '/src/new.ts',
      oldPath: 'src/old.ts/',
      whitespace: 'ignore-blank',
    })}`
    let d = await gitDaemon(t, w.token, ALL)
    let res = w.members.get<GitDiffDto>(url)
    const r1 = await d.next('git.diff')
    expect(r1).toMatchObject({ path: 'src/new.ts', oldPath: 'src/old.ts', whitespace: 'ignore-blank' })
    expect('ignoreWhitespace' in r1).toBe(false)
    answer(d, r1.requestId)
    expect((await res).status).toBe(200)

    d = await gitDaemon(t, w.token, OPS3)
    res = w.members.get<GitDiffDto>(url)
    const r2 = await d.next('git.diff')
    expect(r2).toMatchObject({ path: 'src/new.ts', ignoreWhitespace: true })
    expect('oldPath' in r2 || 'whitespace' in r2).toBe(false)
    answer(d, r2.requestId)
    expect((await res).status).toBe(200)

    // Only the rename's source: left out, so the oldest daemon still answers.
    d = await gitDaemon(t, w.token, ['gitOps', 'gitOps2'])
    res = w.members.get<GitDiffDto>(`${w.base}/diff?from=HEAD&path=src%2Fnew.ts&oldPath=src%2Fold.ts`)
    const r3 = await d.next('git.diff')
    expect(r3).toMatchObject({ path: 'src/new.ts' })
    expect('oldPath' in r3 || 'ignoreWhitespace' in r3).toBe(false)
    answer(d, r3.requestId)
    expect((await res).status).toBe(200)
    expect(await w.members.get(`${w.base}/diff?from=HEAD&whitespace=trim`)).toMatchObject(old)
  })
})

describe('the protected base branch', () => {
  it('judges a push by the remote branch it lands on', async () => {
    const w = await gitWorld(t)
    await protect(w)
    const d = await gitDaemon(t, w.token, ALL)
    const post = (input: GitActionInput) => w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
    const toBase = { action: 'push', branch: 'feat', target: 'main' } as const
    expect(await post(toBase)).toMatchObject(confirm)
    expect(await post({ ...toBase, force: true, confirmBase: true })).toMatchObject(noForce)
    expect(await w.members.post(`${w.base}/actions`, { ...toBase, force: true })).toMatchObject(noForce)
    const confirmed = post({ ...toBase, confirmBase: true })
    expect((await d.act()).args).toEqual({ target: 'main' })
    expect((await confirmed).body).toMatchObject({ status: 'succeeded', pushesBase: true })

    // The local base branch pushed elsewhere lands on no base branch.
    const away = post({ action: 'push', branch: 'main', target: 'main-copy', force: true })
    expect((await d.act()).args).toEqual({ force: true, target: 'main-copy' })
    expect((await away).body).toMatchObject({ status: 'succeeded', pushesBase: false })
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, toBase)
    expect(asked.body).toMatchObject({ status: 'pending_approval', pushesBase: true })
  })

  it("judges a push in an extra repo by that repo's own base branch", async () => {
    const w = await gitWorld(t)
    await protect(w)
    const [web] = await t.db
      .insert(groupRepos)
      .values({
        groupId: w.group.id,
        url: 'git@git.corp:pay/web.git',
        baseBranch: 'develop',
        isPrimary: false,
      })
      .returning()
    const d = await gitDaemon(t, w.token, ALL)
    const repo = `/home/wl/.gonggong/workspaces/${w.group.id}/${w.bot.id}/${web!.id}/web`
    const post = (input: GitActionInput) => w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
    expect(await post({ action: 'push', branch: 'feat', target: 'develop', repo })).toMatchObject(confirm)
    const toMain = post({ action: 'push', branch: 'feat', target: 'main', repo })
    expect((await d.act()).repo).toBe(repo)
    expect((await toMain).body).toMatchObject({ status: 'succeeded', pushesBase: false })
  })

  it('takes a push without a target to the upstream branch the daemon reports, and pins it', async () => {
    const w = await gitWorld(t)
    await protect(w)
    const d = await gitDaemon(t, w.token, ALL)
    const post = (input: GitActionInput) => w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
    const tracking = (upstream: string | null) => ({
      branches: [gitBranch('feat', 'local', upstream), gitBranch('origin/main', 'remote')],
      remotes: ['origin', 'origin/x', 'up'],
    })
    const forced = post({ action: 'push', branch: 'feat', force: true })
    const asked = await d.refs(tracking('origin/main'))
    expect(asked).toMatchObject({ groupId: w.group.id, botId: w.bot.id })
    expect('repo' in asked).toBe(false)
    expect(await forced).toMatchObject(noForce)
    const plain = post({ action: 'push', branch: 'feat' })
    await d.refs(tracking('origin/main'))
    expect(await plain).toMatchObject(confirm)
    const confirmed = post({ action: 'push', branch: 'feat', confirmBase: true })
    await d.refs(tracking('origin/main'))
    expect((await d.act()).args).toEqual({ target: 'main' })
    expect((await confirmed).body).toMatchObject({
      status: 'succeeded',
      pushesBase: true,
      args: { target: 'main' },
    })

    // Tracking a branch of another remote (`origin/x` is one), or nothing: its own name.
    for (const upstream of ['up/main', 'origin/x/main', null]) {
      const res = post({ action: 'push', branch: 'feat', force: true })
      await d.refs(tracking(upstream))
      expect((await d.act()).args, String(upstream)).toEqual({ force: true, target: 'feat' })
      expect((await res).body).toMatchObject({ status: 'succeeded', pushesBase: false })
    }
    // A daemon that can't tell: its own name too.
    const unknown = post({ action: 'push', repo: 'libs/core', branch: 'feat' })
    expect((await d.refs({ error: 'not a git repository' })).repo).toBe('libs/core')
    expect((await d.act()).args).toEqual({ target: 'feat' })
    expect((await unknown).body.status).toBe('succeeded')
    // An older daemon pushes the same name: nothing to ask.
    await gitDaemon(t, w.token, OPS3)
    const older = await post({ action: 'push', branch: 'main', force: true, confirmBase: true })
    expect(older).toMatchObject(noForce)
    expect(await groupEvents(t, w.group.id)).toEqual([
      said('push feat → origin/main'),
      said('push --force-with-lease feat → origin'),
      said('push --force-with-lease feat → origin'),
      said('push --force-with-lease feat → origin'),
      '王磊 在 cc 的 libs/core 执行了 push feat → origin',
    ])
  })

  it('asks the daemon on approval when it could not be asked before', async () => {
    const w = await gitWorld(t)
    await protect(w)
    // The machine is offline: the member's push is taken to land on its own name.
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'push',
      branch: 'feat',
    })
    expect(asked.body).toMatchObject({ status: 'pending_approval', pushesBase: false, args: null })
    const d = await gitDaemon(t, w.token, ALL)
    const decide = `/api/git-operations/${asked.body.id}/decide`
    // It would land on the base branch, which the owner was not shown.
    const refused = w.owners.post(decide, { approve: true })
    await d.refs({ branches: [gitBranch('feat', 'local', 'origin/main')], remotes: ['origin'] })
    expect(await refused).toMatchObject(confirm)
    expect((await ops(w)).body.operations[0]?.status).toBe('pending_approval')
    const approved = w.owners.post<GitOperationDto>(decide, { approve: true })
    await d.refs({ branches: [gitBranch('feat', 'local', 'origin/feat')], remotes: ['origin'] })
    expect((await d.act()).args).toEqual({ target: 'feat' })
    expect((await approved).body).toMatchObject({ status: 'succeeded', args: { target: 'feat' } })
  })

  it('deletes a local branch named like the remote base branch, never the remote one', async () => {
    const w = await gitWorld(t)
    await protect(w)
    const d = await gitDaemon(t, w.token, ALL)
    const post = (branch: string) =>
      w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'branch-delete', branch })
    const refs = {
      branches: [
        gitBranch('backup/main'),
        gitBranch('main', 'local', 'origin/main'),
        gitBranch('origin/main', 'remote'),
      ],
      remotes: ['origin', 'backup'],
    }
    const local = post('backup/main')
    await d.refs(refs)
    expect((await d.act()).branch).toBe('backup/main')
    expect((await local).body.status).toBe('succeeded')
    const remote = post('origin/main')
    await d.refs(refs)
    expect(await remote).toMatchObject(noDelete)
    // Without a local backup/main, it names the main of the remote backup.
    const theirs = post('backup/main')
    await d.refs({ ...refs, branches: refs.branches.slice(1) })
    expect(await theirs).toMatchObject(noDelete)
    // A daemon that can't tell: any `<x>/<base>` counts as a remote one.
    const unknown = post('backup/main')
    await d.refs({ error: 'not a git repository' })
    expect(await unknown).toMatchObject(noDelete)
    // Not ending in the base branch: nothing to ask.
    const other = post('backup/feat')
    expect((await d.act()).branch).toBe('backup/feat')
    expect((await other).body.status).toBe('succeeded')
  })
})

describe('pushing up to a commit, and HEAD expected', () => {
  const undo = { action: 'reset', commit: 'HEAD~1', mode: 'soft', expectHead: hash } as const
  const reword: GitActionInput = {
    action: 'commit',
    message: '改说明',
    paths: [],
    amend: true,
    expectHead: hash,
  }
  const guarded: [GitActionInput, Record<string, unknown>, string][] = [
    [{ action: 'unstash', stash: 0, expect: 'a1b2c3d' }, { stash: 0 }, 'a1b2c3d'],
    [{ action: 'stash-drop', stash: 1, expect: hash }, { stash: 1 }, hash],
    [undo, { commit: 'HEAD~1', mode: 'soft' }, hash],
    [reword, { amend: true }, hash],
  ]

  it("runs the owner's own operation on an older daemon without the guard, which only a wait needs", async () => {
    const w = await gitWorld(t)
    let d = await gitDaemon(t, w.token, OPS3)
    for (const [input, args] of guarded) {
      const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
      expect((await d.act()).args, input.action).toEqual(args)
      expect((await res).body, input.action).toMatchObject({ status: 'succeeded', args })
    }
    // A daemon that has it gets it.
    d = await gitDaemon(t, w.token, ALL)
    for (const [input, args, expect_] of guarded) {
      const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
      expect((await d.act()).args, input.action).toEqual({ ...args, expect: expect_ })
      expect((await res).body.status).toBe('succeeded')
    }
    const events = await groupEvents(t, w.group.id)
    expect(events).toContain(said('reset --soft HEAD~1'))
    expect(events).toContain(said('reset --soft HEAD~1 (undo a1b2c3d)'))
  })

  it("keeps a member's guard, whose approval then needs gitOps4", async () => {
    const w = await gitWorld(t)
    // Offline: asked all the same.
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, undo)
    expect(asked.body).toMatchObject({ status: 'pending_approval', args: { expect: hash } })
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note!.payload).toMatchObject({ summary: 'reset --soft HEAD~1 (undo a1b2c3d)' })
    const decide = `/api/git-operations/${asked.body.id}/decide`
    await gitDaemon(t, w.token, OPS3)
    for (const [input] of guarded) expect(await w.members.post(`${w.base}/actions`, input)).toMatchObject(old)
    expect(await w.owners.post(decide, { approve: true })).toMatchObject(old)
    const d = await gitDaemon(t, w.token, ALL)
    const approved = w.owners.post<GitOperationDto>(decide, { approve: true })
    expect((await d.act()).args).toEqual({ commit: 'HEAD~1', mode: 'soft', expect: hash })
    expect((await approved).body.status).toBe('succeeded')
    expect(await groupEvents(t, w.group.id)).toEqual([
      '陈晨 在 cc 的工作区执行了 reset --soft HEAD~1 (undo a1b2c3d)（王磊 批准）',
    ])
  })

  it('refuses a stash guard naming no stash, which would clear them all without it', async () => {
    const w = await gitWorld(t)
    await gitDaemon(t, w.token, OPS3)
    expect(await w.owners.post(`${w.base}/actions`, { action: 'stash-drop', expect: hash })).toMatchObject({
      status: 400,
      body: { message: '请选择要删除的贮藏' },
    })
  })

  it('pushes up to a commit, named in the summary and judged by where it lands', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const post = (input: GitActionInput) => w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
    const upTo = post({ action: 'push', branch: 'feat', target: 'feat', commit: hash })
    expect(await d.act()).toMatchObject({ action: 'push', branch: 'feat', args: { commit: hash } })
    expect((await upTo).body).toMatchObject({ status: 'succeeded', args: { commit: hash } })

    await protect(w)
    const toBase = { action: 'push', branch: 'feat', target: 'main', commit: hash } as const
    expect(await post(toBase)).toMatchObject(confirm)
    expect(await post({ ...toBase, force: true, confirmBase: true })).toMatchObject(noForce)
    expect(await w.members.post(`${w.base}/actions`, { ...toBase, force: true })).toMatchObject(noForce)
    const confirmed = post({ ...toBase, confirmBase: true })
    expect((await d.act()).args).toEqual({ target: 'main', commit: hash })
    expect((await confirmed).body).toMatchObject({ status: 'succeeded', pushesBase: true })
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, toBase)
    expect(asked.body).toMatchObject({ status: 'pending_approval', pushesBase: true })
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note!.payload).toMatchObject({ summary: 'push feat (up to a1b2c3d) → origin/main' })
    expect(await groupEvents(t, w.group.id)).toEqual([
      said('push feat (up to a1b2c3d) → origin'),
      said('push feat (up to a1b2c3d) → origin/main'),
    ])
  })
})
