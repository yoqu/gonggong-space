import {
  GIT_RESOLVE_MAX_BYTES,
  type GitActionInput,
  type GitBlameDto,
  type GitChangesDto,
  type GitConflictDto,
  type GitLogDto,
  type GitOperationDto,
  type GitOperationsDto,
  type GitRefsDto,
  type GitShowDto,
  type GitStashesDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groups, notifications } from '../src/db/schema.js'
import { MASK } from '../src/modules/runs/redact.js'
import { createTestApp, type TestApp } from './support/app.js'
import { gitBranch, gitDaemon, gitWorld, groupEvents } from './support/git-daemon.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const ALL = ['gitOps', 'gitOps2', 'gitRepos', 'gitOps3']
const OLD = ['gitOps', 'gitOps2', 'gitRepos']
const old = { status: 409, body: { message: 'cc 所在机器的客户端版本过旧，升级后才能使用 Git 操作' } }
const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB'
const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const commit = {
  hash,
  shortHash: 'a1b2c3d',
  author: '张三',
  email: 'zhang@corp.com',
  at: '2026-10-21T08:00:00+08:00',
  subject: '修复退款金额',
  parents: ['9f8e7d6c5b4a39281706f5e4d3c2b1a098765432'],
  refs: ['HEAD -> feat/refund'],
}

type World = Awaited<ReturnType<typeof gitWorld>>
const query = (q: Record<string, string>) => new URLSearchParams(q).toString()
const ops = (w: World) => w.members.get<GitOperationsDto>(`/api/groups/${w.group.id}/git/operations`)
const identity = (w: World) => ({ name: 'cc', email: `${w.bot.id.slice(0, 8)}@bots.gonggong.local` })

describe('gitOps3 reads', () => {
  it('relays show with the repo and redacts the message body', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const show = w.members.get<GitShowDto>(
      `${w.base}/show?${query({ commit: 'a1b2c3d', repo: 'libs/core' })}`,
    )
    const r1 = await d.next('git.show')
    expect(r1).toMatchObject({
      groupId: w.group.id,
      botId: w.bot.id,
      workspace: { repo: { url: 'git@git.corp:pay/pay.git' } },
      repo: 'libs/core',
      commit: 'a1b2c3d',
    })
    const rest = {
      committer: '李四',
      committerEmail: 'li@corp.com',
      committedAt: '2026-10-21T09:00:00+08:00',
      branches: ['feat/refund', 'origin/feat/refund'],
    }
    const body = `修复退款金额\n\ntoken ${secret}`
    d.send({ t: 'git.show.result', requestId: r1.requestId, commit, body, ...rest, error: null })
    expect(await show).toEqual({
      status: 200,
      body: { commit, body: `修复退款金额\n\ntoken ${MASK}`, ...rest },
    })

    const gone = w.members.get(`${w.base}/show?commit=HEAD`)
    const r2 = await d.next('git.show')
    expect('repo' in r2).toBe(false)
    const none = { commit: null, body: '', committer: '', committerEmail: '', committedAt: '', branches: [] }
    d.send({ t: 'git.show.result', requestId: r2.requestId, ...none, error: null })
    expect(await gone).toMatchObject({ status: 404, body: { message: '提交不存在' } })

    const bad = w.members.get(`${w.base}/show?commit=nope`)
    const r3 = await d.next('git.show')
    d.send({ t: 'git.show.result', requestId: r3.requestId, ...none, error: 'bad revision' })
    expect(await bad).toMatchObject({ status: 409, body: { message: 'bad revision' } })
    expect((await w.members.get(`${w.base}/show`)).status).toBe(400)
    expect((await w.outsiders.get(`${w.base}/show?commit=HEAD`)).status).toBe(404)
  })

  it('relays the work-tree changes, not limited', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const changes = w.members.get<GitChangesDto>(`${w.base}/changes`)
    const r1 = await d.next('git.changes')
    expect(r1).toMatchObject({ groupId: w.group.id, botId: w.bot.id })
    expect('repo' in r1).toBe(false)
    const state = {
      changes: [
        { path: 'src/refund.ts', change: 'modified', oldPath: null, untracked: false, add: 12, del: 3 },
        { path: 'notes/todo.md', change: 'added', oldPath: null, untracked: true, add: 4, del: 0 },
      ],
      conflicts: [{ path: 'src/order.ts', ours: 'modified', theirs: 'deleted' }],
      ongoing: {
        kind: 'merge',
        subject: 'feat/refund',
        step: null,
        total: null,
        message: "Merge 'feat/refund'",
      },
      head: { hash, shortHash: 'a1b2c3d', message: '修复退款金额', pushed: false },
    }
    d.send({ t: 'git.changes.result', requestId: r1.requestId, ...state, error: null })
    expect(await changes).toEqual({ status: 200, body: { ...state, limited: false } })

    const sub = w.members.get(`${w.base}/changes?repo=libs%2Fcore`)
    const r2 = await d.next('git.changes')
    expect(r2.repo).toBe('libs/core')
    const empty = { changes: [], conflicts: [], ongoing: null, head: null }
    d.send({ t: 'git.changes.result', requestId: r2.requestId, ...empty, error: 'not a git repository' })
    expect(await sub).toMatchObject({ status: 409, body: { message: 'not a git repository' } })
  })

  it('relays blame, stashes and conflicts, redacting the conflicting texts', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const blame = w.members.get<GitBlameDto>(
      `${w.base}/blame?${query({ path: '/src/a.ts', ref: 'main', repo: 'libs/core' })}`,
    )
    const r1 = await d.next('git.blame')
    expect(r1).toMatchObject({ repo: 'libs/core', ref: 'main', path: 'src/a.ts' })
    const ranges = [
      { start: 1, count: 2, commit: hash },
      { start: 3, count: 1, commit: '' },
    ]
    const commits = [
      { hash, shortHash: 'a1b2c3d', author: '张三', email: 'z@corp.com', at: commit.at, subject: 's' },
    ]
    d.send({ t: 'git.blame.result', requestId: r1.requestId, ranges, commits, error: null })
    expect(await blame).toEqual({ status: 200, body: { ranges, commits } })

    const work = w.members.get<GitBlameDto>(`${w.base}/blame?path=a.ts`)
    const r2 = await d.next('git.blame')
    expect(r2).toMatchObject({ ref: null, path: 'a.ts' })
    expect('repo' in r2).toBe(false)
    d.send({ t: 'git.blame.result', requestId: r2.requestId, ranges: [], commits: [], error: null })
    expect((await work).body).toEqual({ ranges: [], commits: [] })
    expect((await w.members.get(`${w.base}/blame`)).status).toBe(400)
    expect(await w.members.get(`${w.base}/blame?path=%2F`)).toMatchObject({
      status: 400,
      body: { message: '缺少文件路径' },
    })

    const stashes = w.members.get<GitStashesDto>(`${w.base}/stashes?repo=libs%2Fcore`)
    const r3 = await d.next('git.stashes')
    expect(r3.repo).toBe('libs/core')
    const list = [
      { index: 0, hash, message: 'WIP on main: 修复', branch: 'main', at: commit.at, untracked: true },
      { index: 1, hash, message: 'On (no branch): x', branch: null, at: commit.at, untracked: false },
    ]
    d.send({ t: 'git.stashes.result', requestId: r3.requestId, stashes: list, error: null })
    expect(await stashes).toEqual({ status: 200, body: { stashes: list } })

    const conflict = w.members.get<GitConflictDto>(`${w.base}/conflict?path=src%2Forder.ts`)
    const r4 = await d.next('git.conflict')
    expect(r4).toMatchObject({ path: 'src/order.ts', maxBytes: GIT_RESOLVE_MAX_BYTES })
    expect('repo' in r4).toBe(false)
    d.send({
      t: 'git.conflict.result',
      requestId: r4.requestId,
      base: 'fee = 1\n',
      ours: `fee = 2 // ${secret}\n`,
      theirs: null,
      merged: `<<<<<<< ours\nfee = 2 // ${secret}\n=======\n>>>>>>> theirs\n`,
      binary: false,
      error: null,
    })
    expect(await conflict).toEqual({
      status: 200,
      body: {
        base: 'fee = 1\n',
        ours: `fee = 2 // ${MASK}\n`,
        theirs: null,
        merged: `<<<<<<< ours\nfee = 2 // ${MASK}\n=======\n>>>>>>> theirs\n`,
        binary: false,
      },
    })
    expect((await w.members.get(`${w.base}/conflict`)).status).toBe(400)
    expect((await w.outsiders.get(`${w.base}/stashes`)).status).toBe(404)
  })

  it('passes the repo, the set log filters and the diff options on', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const refs = w.members.get<GitRefsDto>(`${w.base}/refs`)
    const r1 = await d.next('git.refs')
    const tags = [{ name: 'v1.2', commit: hash, annotated: true, subject: '发布', at: commit.at }]
    d.send({
      t: 'git.refs.result',
      requestId: r1.requestId,
      branches: [],
      remotes: [],
      tags,
      recent: ['feat/x'],
      error: null,
    })
    expect(await refs).toEqual({ status: 200, body: { branches: [], remotes: [], tags, recent: ['feat/x'] } })

    const filtered = w.members.get<GitLogDto>(
      `${w.base}/log?${query({
        repo: 'libs/core',
        skip: '50',
        all: '1',
        author: '张三',
        text: '退款',
        regexp: '0',
        matchCase: 'true',
        since: '2026-10-01',
        until: '2026-10-31',
        path: '/src/refund.ts',
        firstParent: 'false',
        noMerges: '1',
        order: 'topo',
      })}`,
    )
    const r2 = await d.next('git.log')
    expect(r2).toMatchObject({ repo: 'libs/core', ref: null, skip: 50, limit: 50 })
    expect(r2.filter).toEqual({
      all: true,
      author: '张三',
      text: '退款',
      matchCase: true,
      since: '2026-10-01',
      until: '2026-10-31',
      path: 'src/refund.ts',
      noMerges: true,
      order: 'topo',
    })
    d.send({ t: 'git.log.result', requestId: r2.requestId, commits: [commit], hasMore: false, error: null })
    expect((await filtered).body).toEqual({ commits: [commit], hasMore: false })

    const plain = w.members.get<GitLogDto>(`${w.base}/log?ref=main&all=0`)
    const r3 = await d.next('git.log')
    expect(r3).toMatchObject({ ref: 'main', skip: 0 })
    expect('filter' in r3 || 'repo' in r3).toBe(false)
    d.send({ t: 'git.log.result', requestId: r3.requestId, commits: [], hasMore: false, error: null })
    expect((await plain).status).toBe(200)

    const tree = w.members.get(`${w.base}/tree?${query({ repo: 'libs/core', ref: 'main', path: 'src' })}`)
    const r4 = await d.next('git.tree')
    expect(r4).toMatchObject({ repo: 'libs/core', ref: 'main', path: 'src' })
    d.send({ t: 'git.tree.result', requestId: r4.requestId, entries: [], truncated: false, error: null })
    expect((await tree).body).toEqual({ path: 'src', entries: [], truncated: false })

    const text = w.members.get(`${w.base}/text?${query({ repo: 'libs/core', ref: 'main', path: 'a.txt' })}`)
    const r5 = await d.next('git.read')
    expect(r5).toMatchObject({ repo: 'libs/core', ref: 'main', path: 'a.txt' })
    const file = { size: 2, binary: false, mime: 'text/plain', text: 'hi' }
    d.send({ t: 'git.read.result', requestId: r5.requestId, ...file, error: null })
    expect((await text).body).toEqual({ path: 'a.txt', ...file })

    const cmp = w.members.get(`${w.base}/compare?${query({ repo: 'libs/core', from: 'main' })}`)
    const r6 = await d.next('git.compare')
    expect(r6).toMatchObject({ repo: 'libs/core', from: 'main', to: null })
    d.send({ t: 'git.compare.result', requestId: r6.requestId, changes: [], error: null })
    expect((await cmp).body).toEqual({ changes: [] })

    const diff = w.members.get(
      `${w.base}/diff?${query({
        repo: 'libs/core',
        from: 'HEAD',
        path: 'src/refund.ts',
        ignoreWhitespace: '1',
        context: '100000',
      })}`,
    )
    const r7 = await d.next('git.diff')
    expect(r7).toMatchObject({
      repo: 'libs/core',
      from: 'HEAD',
      to: null,
      path: 'src/refund.ts',
      maxBytes: 1024 * 1024,
      ignoreWhitespace: true,
      context: 100000,
    })
    d.send({ t: 'git.diff.result', requestId: r7.requestId, patch: null, truncated: false, error: null })
    expect((await diff).body).toEqual({ patch: null, truncated: false })

    const zero = w.members.get(`${w.base}/diff?from=HEAD&ignoreWhitespace=0&context=0`)
    const r8 = await d.next('git.diff')
    expect(r8).toMatchObject({ context: 0 })
    expect('ignoreWhitespace' in r8 || 'repo' in r8).toBe(false)
    d.send({ t: 'git.diff.result', requestId: r8.requestId, patch: null, truncated: false, error: null })
    expect((await zero).status).toBe(200)
  })

  it('refuses what an older daemon lacks, but answers the changes from a compare against HEAD', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, OLD)
    const sub = 'repo=libs%2Fcore'
    for (const url of [
      'show?commit=HEAD',
      'blame?path=a.ts',
      'stashes',
      'conflict?path=a.ts',
      `changes?${sub}`,
      'log?author=x',
      'log?firstParent=1',
      `log?${sub}`,
      `tree?ref=main&${sub}`,
      `text?ref=main&path=a.txt&${sub}`,
      `compare?from=main&${sub}`,
      'diff?from=HEAD&ignoreWhitespace=1',
      'diff?from=HEAD&context=3',
      `diff?from=HEAD&${sub}`,
    ])
      expect(await w.members.get(`${w.base}/${url}`), url).toMatchObject(old)

    const changes = w.members.get<GitChangesDto>(`${w.base}/changes`)
    const r1 = await d.next('git.compare')
    expect(r1).toMatchObject({ from: 'HEAD', to: null })
    expect('repo' in r1).toBe(false)
    d.send({
      t: 'git.compare.result',
      requestId: r1.requestId,
      changes: [
        { path: 'a.ts', change: 'modified', oldPath: null },
        { path: 'b.ts', change: 'renamed', oldPath: 'c.ts' },
      ],
      error: null,
    })
    const plain = { untracked: false, add: null, del: null }
    expect(await changes).toEqual({
      status: 200,
      body: {
        changes: [
          { path: 'a.ts', change: 'modified', oldPath: null, ...plain },
          { path: 'b.ts', change: 'renamed', oldPath: 'c.ts', ...plain },
        ],
        conflicts: [],
        ongoing: null,
        head: null,
        limited: true,
      },
    })

    const log = w.members.get(`${w.base}/log?all=0&noMerges=false`)
    const r2 = await d.next('git.log')
    expect('filter' in r2).toBe(false)
    d.send({ t: 'git.log.result', requestId: r2.requestId, commits: [], hasMore: false, error: null })
    expect((await log).status).toBe(200)
  })
})

describe('gitOps3 actions', () => {
  it("stores each action's columns and args, relays them with the bot's identity and announces it", async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const none = { branch: null, remote: null, message: null, paths: null, args: null }
    const said = (summary: string) => `王磊 在 cc 的工作区执行了 ${summary}`
    const cases: [GitActionInput, Partial<GitOperationDto>, string | null][] = [
      [
        { action: 'checkout', branch: hash, detach: true, mode: 'force' },
        { branch: hash, args: { detach: true, mode: 'force' } },
        said('checkout --force --detach a1b2c3d'),
      ],
      [{ action: 'pull', mode: 'rebase' }, { args: { mode: 'rebase' } }, said('pull --rebase')],
      [{ action: 'pull', branch: 'feat/x' }, { branch: 'feat/x' }, said('pull feat/x')],
      [
        { action: 'commit', message: '改说明\n\n细节', paths: [], amend: true },
        { message: '改说明\n\n细节', paths: [], args: { amend: true } },
        said('commit --amend「改说明」'),
      ],
      [
        { action: 'push', branch: 'feat/x', force: true },
        { branch: 'feat/x', remote: 'origin', args: { force: true } },
        said('push --force-with-lease feat/x → origin'),
      ],
      [
        { action: 'push', branch: 'feat/x', remote: 'up', tags: true },
        { branch: 'feat/x', remote: 'up', args: { tags: true } },
        said('push --tags feat/x → up'),
      ],
      [
        { action: 'branch-create', name: 'feat/fee', from: 'origin/main' },
        { branch: 'feat/fee', args: { from: 'origin/main', checkout: true } },
        said('checkout -b feat/fee origin/main'),
      ],
      [
        { action: 'branch-create', name: 'feat/y', checkout: false },
        { branch: 'feat/y' },
        said('branch feat/y'),
      ],
      [
        { action: 'branch-rename', branch: 'old', name: 'new' },
        { branch: 'old', args: { name: 'new' } },
        said('branch -m old new'),
      ],
      [
        { action: 'branch-delete', branch: 'origin/feat/x', force: true },
        { branch: 'origin/feat/x', args: { force: true } },
        said('branch -D origin/feat/x'),
      ],
      [{ action: 'branch-delete', branch: 'feat/x' }, { branch: 'feat/x' }, said('branch -d feat/x')],
      [
        { action: 'merge', branch: 'feat/refund', mode: 'no-ff', noCommit: true, message: '合并退款' },
        { branch: 'feat/refund', message: '合并退款', args: { mode: 'no-ff', noCommit: true } },
        said('merge --no-ff --no-commit feat/refund'),
      ],
      [
        { action: 'merge', repo: 'libs/core', branch: 'dev' },
        { repo: 'libs/core', branch: 'dev', args: { mode: 'default' } },
        '王磊 在 cc 的 libs/core 执行了 merge dev',
      ],
      [{ action: 'rebase', onto: 'main' }, { args: { onto: 'main' } }, said('rebase onto main')],
      [
        { action: 'rebase', onto: hash, branch: 'feat/x' },
        { branch: 'feat/x', args: { onto: hash } },
        said('rebase feat/x onto a1b2c3d'),
      ],
      [
        { action: 'cherry-pick', commits: [hash, 'b2c3d4e', 'c3d4e5f'] },
        { args: { commits: [hash, 'b2c3d4e', 'c3d4e5f'] } },
        said('cherry-pick a1b2c3d (+2)'),
      ],
      [
        { action: 'revert', commits: ['b2c3d4e'] },
        { args: { commits: ['b2c3d4e'] } },
        said('revert b2c3d4e'),
      ],
      [
        { action: 'reset', commit: hash, mode: 'hard' },
        { args: { commit: hash, mode: 'hard' } },
        said('reset --hard a1b2c3d'),
      ],
      [
        { action: 'reset', commit: 'HEAD~1' },
        { args: { commit: 'HEAD~1', mode: 'mixed' } },
        said('reset --mixed HEAD~1'),
      ],
      [
        { action: 'discard', paths: ['src/a.ts', 'src/b.ts', 'c.ts'] },
        { paths: ['src/a.ts', 'src/b.ts', 'c.ts'] },
        said('rollback 3 files'),
      ],
      [{ action: 'discard', paths: ['src/a.ts'] }, { paths: ['src/a.ts'] }, said('rollback src/a.ts')],
      [
        { action: 'stash', message: '半成品', untracked: true, paths: ['src/a.ts'] },
        { message: '半成品', paths: ['src/a.ts'], args: { untracked: true } },
        said('stash push -u「半成品」 (1 file)'),
      ],
      [{ action: 'stash' }, {}, said('stash push')],
      [
        { action: 'unstash', stash: 0, pop: true },
        { args: { stash: 0, pop: true } },
        said('stash pop stash@{0}'),
      ],
      [
        { action: 'unstash', stash: 1, index: true },
        { args: { stash: 1, index: true } },
        said('stash apply --index stash@{1}'),
      ],
      [
        { action: 'unstash', stash: 2, branch: 'feat/z' },
        { branch: 'feat/z', args: { stash: 2 } },
        said('stash branch feat/z stash@{2}'),
      ],
      [{ action: 'stash-drop', stash: 1 }, { args: { stash: 1 } }, said('stash drop stash@{1}')],
      [{ action: 'stash-drop' }, {}, said('stash clear')],
      [
        { action: 'tag-create', name: 'v1.2', commit: hash, message: '发布 1.2' },
        { message: '发布 1.2', args: { name: 'v1.2', from: hash } },
        said('tag -a v1.2 a1b2c3d'),
      ],
      [{ action: 'tag-create', name: 'v1.3' }, { args: { name: 'v1.3' } }, said('tag v1.3')],
      [
        { action: 'tag-delete', name: 'v1.2', remote: 'origin' },
        { remote: 'origin', args: { name: 'v1.2' } },
        said('tag -d v1.2 (local + origin)'),
      ],
      [{ action: 'tag-delete', name: 'v1.3' }, { args: { name: 'v1.3' } }, said('tag -d v1.3')],
      [
        { action: 'tag-push', name: 'v1.2' },
        { remote: 'origin', args: { name: 'v1.2' } },
        said('push tag v1.2 → origin'),
      ],
      [{ action: 'continue', message: '合并' }, { message: '合并' }, said('continue')],
      [{ action: 'abort' }, {}, said('abort')],
      [{ action: 'skip' }, {}, said('skip')],
      [
        { action: 'resolve', path: 'src/order.ts', side: 'theirs' },
        { args: { path: 'src/order.ts', side: 'theirs' } },
        null,
      ],
    ]
    for (const [input, stored] of cases) {
      const row = { repo: null, ...none, ...stored }
      const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
      const req = await d.act()
      const { args, repo, ...columns } = row
      expect(req, input.action).toMatchObject({ action: input.action, ...columns, identity: identity(w) })
      expect(req.repo, input.action).toBe(repo ?? undefined)
      expect(req.args, input.action).toEqual(args ?? undefined)
      const op = (await res).body
      expect(op, input.action).toMatchObject({ status: 'succeeded', action: input.action, ...columns, repo })
      expect(op.args, input.action).toEqual(args)
    }
    expect(await groupEvents(t, w.group.id)).toEqual(cases.flatMap(([, , event]) => (event ? [event] : [])))
  })

  it('keeps an action without the new options at args null, so an older daemon still runs it', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token)
    const legacy: GitActionInput[] = [
      { action: 'checkout', branch: 'feat/x', detach: false, mode: 'keep' },
      { action: 'pull', mode: 'ff-only' },
      { action: 'commit', message: '修复', amend: false },
      { action: 'push', branch: 'feat/x', force: false, tags: false },
    ]
    for (const input of legacy) {
      const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
      const req = await d.act()
      expect('args' in req, input.action).toBe(false)
      expect(req.identity).toEqual(identity(w))
      expect((await res).body).toMatchObject({ status: 'succeeded', args: null })
    }
    expect(await groupEvents(t, w.group.id)).toEqual([
      '王磊 将 cc 切换到 feat/x',
      '王磊 为 cc 拉取了更新',
      '王磊 提交了 cc 的改动：修复',
      '王磊 将 cc 的 feat/x 推送到 origin',
    ])
  })

  it('refuses the new actions and options an older daemon lacks, for owners and members alike', async () => {
    const w = await gitWorld(t)
    await gitDaemon(t, w.token, OLD)
    const inputs: GitActionInput[] = [
      { action: 'merge', branch: 'feat/x' },
      { action: 'abort' },
      { action: 'push', branch: 'feat/x', force: true },
      { action: 'checkout', branch: 'feat/x', mode: 'smart' },
      { action: 'pull', branch: 'feat/x' },
      { action: 'pull', mode: 'merge' },
      { action: 'commit', message: 'x', paths: [], amend: true },
    ]
    for (const input of inputs) {
      expect(await w.owners.post(`${w.base}/actions`, input), input.action).toMatchObject(old)
      expect(await w.members.post(`${w.base}/actions`, input), input.action).toMatchObject(old)
    }
    expect((await ops(w)).body.operations).toEqual([])
  })

  it('queues a member request with its args; approving needs a daemon that can run it', async () => {
    const w = await gitWorld(t)
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'merge',
      branch: 'feat/x',
      mode: 'squash',
    })
    expect(asked.body).toMatchObject({
      status: 'pending_approval',
      action: 'merge',
      branch: 'feat/x',
      args: { mode: 'squash' },
    })
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note!.payload).toMatchObject({ summary: 'merge --squash feat/x', operationId: asked.body.id })
    const [log] = await t.db.select().from(auditLogs)
    expect(log).toMatchObject({
      action: 'git.request',
      detail: { action: 'merge', branch: 'feat/x', args: { mode: 'squash' } },
    })

    const decide = `/api/git-operations/${asked.body.id}/decide`
    await gitDaemon(t, w.token, OLD)
    expect(await w.owners.post(decide, { approve: true })).toMatchObject(old)
    expect((await ops(w)).body.operations[0]?.status).toBe('pending_approval')

    const d = await gitDaemon(t, w.token, ALL)
    const approved = w.owners.post<GitOperationDto>(decide, { approve: true })
    expect(await d.act()).toMatchObject({
      action: 'merge',
      branch: 'feat/x',
      identity: identity(w),
      args: { mode: 'squash' },
    })
    expect((await approved).body).toMatchObject({ status: 'succeeded', decidedBy: { id: w.owner.id } })
    expect(await groupEvents(t, w.group.id)).toEqual([
      '陈晨 在 cc 的工作区执行了 merge --squash feat/x（王磊 批准）',
    ])
  })

  it('never force-pushes the protected base branch nor deletes it on the remote', async () => {
    const w = await gitWorld(t)
    const protect = (on: boolean) =>
      t.db.update(groups).set({ protectBase: on }).where(eq(groups.id, w.group.id))
    await protect(true)
    const d = await gitDaemon(t, w.token, ALL)
    const noForce = { status: 409, body: { message: '受保护的基准分支不能强制推送' } }
    const force = { action: 'push', branch: 'main', force: true, confirmBase: true }
    expect(await w.owners.post(`${w.base}/actions`, force)).toMatchObject(noForce)
    expect(await w.members.post(`${w.base}/actions`, force)).toMatchObject(noForce)
    const noDelete = { status: 409, body: { message: '受保护的基准分支不能在远程删除' } }
    const remote = { action: 'branch-delete', branch: 'origin/main' }
    // A branch ending in the base branch's name is looked up: a local one of that name is deleted locally instead.
    const refs = {
      branches: [gitBranch('origin/main', 'remote'), gitBranch('origin/feat/main', 'remote')],
      remotes: ['origin'],
    }
    const owned = w.owners.post(`${w.base}/actions`, remote)
    await d.refs(refs)
    expect(await owned).toMatchObject(noDelete)
    const requested = w.members.post(`${w.base}/actions`, { ...remote, force: true })
    await d.refs(refs)
    expect(await requested).toMatchObject(noDelete)
    expect((await ops(w)).body.operations).toEqual([])

    for (const input of [
      { action: 'push', branch: 'feat/x', force: true },
      { action: 'branch-delete', branch: 'main' },
      { action: 'branch-delete', branch: 'origin/feat/main' },
    ]) {
      const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
      if (input.branch.endsWith('/main')) await d.refs(refs)
      expect(await d.act()).toMatchObject({ action: input.action, branch: input.branch })
      expect((await res).body.status).toBe('succeeded')
    }

    await protect(false)
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'push',
      branch: 'main',
      force: true,
    })
    expect(asked.body).toMatchObject({ status: 'pending_approval', pushesBase: false })
    await protect(true)
    const decide = `/api/git-operations/${asked.body.id}/decide`
    expect(await w.owners.post(decide, { approve: true })).toMatchObject(noForce)

    await protect(false)
    const unprotected = w.owners.post<GitOperationDto>(`${w.base}/actions`, remote)
    expect((await d.act()).branch).toBe('origin/main')
    expect((await unprotected).body.status).toBe('succeeded')
  })

  it('refuses an empty commit without amend and a resolution that is not exactly one side or a text', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const post = (input: GitActionInput) => w.owners.post(`${w.base}/actions`, input)
    expect(await post({ action: 'commit', message: 'x', paths: [] })).toMatchObject({
      status: 400,
      body: { message: '请选择要提交的文件' },
    })
    const pick = { status: 400, body: { message: '请选择保留哪一方或填写合并结果' } }
    expect(await post({ action: 'resolve', path: 'a.ts' })).toMatchObject(pick)
    expect(
      await w.members.post(`${w.base}/actions`, {
        action: 'resolve',
        path: 'a.ts',
        side: 'ours',
        content: 'x',
      }),
    ).toMatchObject(pick)
    expect(await post({ action: 'resolve', path: 'a.ts', content: `password=${MASK}\n` })).toMatchObject({
      status: 400,
      body: { message: '合并结果含有已脱敏的内容，请保留一方或在本机解决' },
    })
    expect((await ops(w)).body.operations).toEqual([])

    const empty = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'resolve',
      path: 'a.ts',
      content: '',
    })
    expect((await d.act()).args).toEqual({ path: 'a.ts', content: '' })
    expect((await empty).body.status).toBe('succeeded')
  })

  it('takes a resolution of about 1.5 MB and keeps it out of the audit log', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const content = 'const fee = 3 // 退款手续费\n'.repeat(50_000)
    expect(Buffer.byteLength(content)).toBeGreaterThan(1_500_000)
    const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'resolve',
      path: 'src/order.ts',
      content,
    })
    const req = await d.act()
    expect(req.args).toEqual({ path: 'src/order.ts', content })
    const done = (await res).body
    expect(done).toMatchObject({ status: 'succeeded', args: { path: 'src/order.ts' } })
    expect(done.args).not.toHaveProperty('content')
    const [log] = await t.db.select().from(auditLogs)
    expect(log!.detail).toMatchObject({ action: 'resolve', args: { path: 'src/order.ts' } })
    expect(JSON.stringify(log!.detail)).not.toContain('const fee')
    expect(await groupEvents(t, w.group.id)).toEqual([])
  })
})
