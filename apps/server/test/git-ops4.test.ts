import type { GitActionInput, GitOperationDto, GitOperationsDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groups, notifications } from '../src/db/schema.js'
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
      { action: 'unstash', stash: 0, expect: 'a1b2c3d' },
      { action: 'stash-drop', stash: 1, expect: hash },
      { action: 'discard', paths: ['a.txt'], keepAdded: true },
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
