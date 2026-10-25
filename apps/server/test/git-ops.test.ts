import type {
  FilesTreeDto,
  FileTextDto,
  GitCompareDto,
  GitDiffDto,
  GitLogDto,
  GitOperationDto,
  GitOperationsDto,
  GitRefsDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  auditLogs,
  gitOperations,
  groupBots,
  groupRepos,
  groups,
  messages,
  notifications,
  runs,
} from '../src/db/schema.js'
import { expireGitOperations } from '../src/modules/git/service.js'
import { MASK } from '../src/modules/runs/redact.js'
import { createTestApp, type TestApp } from './support/app.js'
import { groupEvents as eventsOf, gitDaemon, gitWorld } from './support/git-daemon.js'
import { events } from './support/http.js'

let t: TestApp
let clock: Date
beforeEach(async () => {
  clock = new Date('2026-10-21T08:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

const daemon = (token: string, features?: string[]) => gitDaemon(t, token, features)
const world = () => gitWorld(t)
const groupEvents = (groupId: string) => eventsOf(t, groupId)

const ops = (w: Awaited<ReturnType<typeof world>>) =>
  w.members.get<GitOperationsDto>(`/api/groups/${w.group.id}/git/operations`)

describe('git reads', () => {
  it('tells an older daemon apart at once instead of waiting for it', async () => {
    const w = await world()
    await daemon(w.token, [])
    const refs = await w.members.get(`${w.base}/refs`)
    expect(refs.status).toBe(409)
    expect(JSON.stringify(refs.body)).toContain('客户端版本过旧')
    const act = await w.owners.post(`${w.base}/actions`, { action: 'pull' })
    expect(act.status).toBe(409)
  })

  it('needs a daemon with gitOps2 for diff, refresh and committing chosen paths', async () => {
    const w = await world()
    await daemon(w.token, ['gitOps'])
    const old = { status: 409, body: { message: 'cc 所在机器的客户端版本过旧，升级后才能使用 Git 操作' } }
    expect(await w.members.get(`${w.base}/diff?from=HEAD`)).toMatchObject(old)
    expect(await w.members.post(`${w.base}/refresh`, { fetch: true })).toMatchObject(old)
    const pick = { action: 'commit', message: 'x', paths: ['a.ts'] }
    expect(await w.owners.post(`${w.base}/actions`, pick)).toMatchObject(old)
    expect(await w.members.post(`${w.base}/actions`, pick)).toMatchObject(old)
    expect((await ops(w)).body.operations).toEqual([])
  })

  it('relays a diff to members, redacted', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const one = w.members.get<GitDiffDto>(`${w.base}/diff?from=HEAD&path=%2Fsrc%2Fa.ts`)
    const r1 = await d.next('git.diff')
    expect(r1).toMatchObject({
      groupId: w.group.id,
      botId: w.bot.id,
      workspace: { repo: { url: 'git@git.corp:pay/pay.git' } },
      from: 'HEAD',
      to: null,
      path: 'src/a.ts',
      maxBytes: 1024 * 1024,
    })
    const patch = '+token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB\n'
    d.send({ t: 'git.diff.result', requestId: r1.requestId, patch, truncated: true, error: null })
    expect(await one).toEqual({ status: 200, body: { patch: `+token ${MASK}\n`, truncated: true } })

    const range = w.members.get<GitDiffDto>(`${w.base}/diff?from=main&to=feat%2Fx`)
    const r2 = await d.next('git.diff')
    expect(r2).toMatchObject({ from: 'main', to: 'feat/x', path: null })
    d.send({ t: 'git.diff.result', requestId: r2.requestId, patch: null, truncated: false, error: null })
    expect((await range).body).toEqual({ patch: null, truncated: false })

    const bad = w.members.get(`${w.base}/diff?from=nope`)
    const r3 = await d.next('git.diff')
    d.send({ t: 'git.diff.result', requestId: r3.requestId, patch: null, truncated: false, error: 'bad ref' })
    expect(await bad).toMatchObject({ status: 409, body: { message: 'bad ref' } })
    expect((await w.outsiders.get(`${w.base}/diff?from=HEAD`)).status).toBe(404)
    expect((await w.members.get(`${w.base}/diff`)).status).toBe(400)
  })

  it('lets any member refresh the git status, even while the bot runs', async () => {
    const w = await world()
    const d = await daemon(w.token)
    await w.run('running')
    const fetched = w.members.post(`${w.base}/refresh`, { fetch: true })
    const r1 = await d.next('git.refresh')
    expect(r1).toMatchObject({ groupId: w.group.id, botId: w.bot.id, fetch: true })
    d.send({ t: 'git.refresh.result', requestId: r1.requestId, error: null })
    expect((await fetched).status).toBe(204)

    const plain = w.members.post(`${w.base}/refresh`)
    const r2 = await d.next('git.refresh')
    expect(r2.fetch).toBe(false)
    d.send({ t: 'git.refresh.result', requestId: r2.requestId, error: 'could not resolve host' })
    expect(await plain).toMatchObject({ status: 409, body: { message: 'could not resolve host' } })
    expect((await w.outsiders.post(`${w.base}/refresh`)).status).toBe(404)
  })

  it('relays refs, log, tree, text and compare to members', async () => {
    const w = await world()
    const d = await daemon(w.token)

    const refs = w.members.get<GitRefsDto>(`${w.base}/refs`)
    const r1 = await d.next('git.refs')
    expect(r1).toMatchObject({
      groupId: w.group.id,
      botId: w.bot.id,
      workspace: { repo: { url: 'git@git.corp:pay/pay.git', branch: 'main' }, cdPath: null },
    })
    const branch = {
      name: 'main',
      kind: 'local',
      current: true,
      upstream: 'origin/main',
      ahead: 0,
      behind: 1,
      commit: 'abc',
      subject: 's',
      at: '2026-10-20T00:00:00Z',
    }
    const remotes = [{ name: 'origin', url: 'git@git.corp:pay/pay.git' }]
    d.send({ t: 'git.refs.result', requestId: r1.requestId, branches: [branch], remotes, error: null })
    expect(await refs).toEqual({ status: 200, body: { branches: [branch], remotes, tags: [], recent: [] } })

    const log = w.members.get<GitLogDto>(`${w.base}/log?ref=feat%2Fx&skip=50`)
    const r2 = await d.next('git.log')
    expect(r2).toMatchObject({ ref: 'feat/x', skip: 50, limit: 50 })
    d.send({ t: 'git.log.result', requestId: r2.requestId, commits: [], hasMore: true, error: null })
    expect((await log).body).toEqual({ commits: [], hasMore: true })

    const tree = w.members.get<FilesTreeDto>(`${w.base}/tree?ref=main&path=%2Fsrc%2F`)
    const r3 = await d.next('git.tree')
    expect(r3).toMatchObject({ ref: 'main', path: 'src' })
    d.send({ t: 'git.tree.result', requestId: r3.requestId, entries: [], truncated: false, error: null })
    expect((await tree).body).toEqual({ path: 'src', entries: [], truncated: false })

    const text = w.members.get<FileTextDto>(`${w.base}/text?ref=main&path=a.txt`)
    const r4 = await d.next('git.read')
    expect(r4).toMatchObject({ ref: 'main', path: 'a.txt' })
    d.send({
      t: 'git.read.result',
      requestId: r4.requestId,
      size: 2,
      binary: false,
      mime: 'text/plain',
      text: 'hi',
      error: null,
    })
    expect((await text).body).toEqual({
      path: 'a.txt',
      size: 2,
      binary: false,
      mime: 'text/plain',
      text: 'hi',
    })

    const cmp = w.members.get<GitCompareDto>(`${w.base}/compare?from=main`)
    const r5 = await d.next('git.compare')
    expect(r5).toMatchObject({ from: 'main', to: null })
    const changes = [{ path: 'a.txt', change: 'modified', oldPath: null }]
    d.send({ t: 'git.compare.result', requestId: r5.requestId, changes, error: null })
    expect((await cmp).body).toEqual({ changes })

    const bad = w.members.get(`${w.base}/log`)
    const r6 = await d.next('git.log')
    expect(r6.ref).toBeNull()
    d.send({ t: 'git.log.result', requestId: r6.requestId, commits: [], hasMore: false, error: 'bad ref' })
    expect(await bad).toMatchObject({ status: 409, body: { message: 'bad ref' } })
  })

  it('needs a daemon with gitRepos for a sub-repo; the root repo asks as before', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const old = { status: 409, body: { message: 'cc 所在机器的客户端版本过旧，升级后才能使用 Git 操作' } }
    expect(await w.members.get(`${w.base}/refs?repo=libs%2Fcore`)).toMatchObject(old)
    expect(await w.owners.post(`${w.base}/actions`, { action: 'pull', repo: 'libs/core' })).toMatchObject(old)
    expect(await w.members.post(`${w.base}/actions`, { action: 'pull', repo: 'libs/core' })).toMatchObject(
      old,
    )
    expect((await ops(w)).body.operations).toEqual([])

    const root = w.members.get<GitRefsDto>(`${w.base}/refs`)
    const r1 = await d.next('git.refs')
    expect('repo' in r1).toBe(false)
    d.send({ t: 'git.refs.result', requestId: r1.requestId, branches: [], remotes: [], error: null })
    expect((await root).status).toBe(200)
    const pull = w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    expect('repo' in (await d.act())).toBe(false)
    expect((await pull).body).toMatchObject({ status: 'succeeded', repo: null })
  })

  it('relays refs of a sub-repo with the extra dirs', async () => {
    const w = await world()
    await t.db
      .update(groupBots)
      .set({ extraDirs: ['/x/shared'] })
      .where(eq(groupBots.groupId, w.group.id))
    const d = await daemon(w.token, ['gitOps', 'gitOps2', 'gitRepos'])
    const refs = w.members.get<GitRefsDto>(`${w.base}/refs?repo=libs%2Fcore`)
    const r1 = await d.next('git.refs')
    expect(r1).toMatchObject({ repo: 'libs/core', workspace: { extraDirs: ['/x/shared'] } })
    d.send({ t: 'git.refs.result', requestId: r1.requestId, branches: [], remotes: [], error: null })
    expect(await refs).toEqual({ status: 200, body: { branches: [], remotes: [], tags: [], recent: [] } })
  })

  it('refuses outsiders, groups without a repo or not in partition mode, and offline bots', async () => {
    const w = await world()
    expect((await w.outsiders.get(`${w.base}/refs`)).status).toBe(404)
    expect((await w.members.get(`${w.base}/refs`)).status).toBe(409)

    await t.db.update(groups).set({ mode: 'force' }).where(eq(groups.id, w.group.id))
    const force = await w.members.get(`${w.base}/refs`)
    expect(force).toMatchObject({
      status: 409,
      body: { message: '仅绑定了仓库的分区模式群可以使用 Git 操作' },
    })
    await t.db.update(groups).set({ mode: 'partition' }).where(eq(groups.id, w.group.id))
    await t.db.delete(groupRepos).where(eq(groupRepos.groupId, w.group.id))
    expect((await w.members.get(`${w.base}/refs`)).status).toBe(409)
    expect((await w.owners.post(`${w.base}/actions`, { action: 'pull' })).status).toBe(409)
  })
})

describe('git actions', () => {
  it("runs the owner's commit at once with the bot's identity, and records the outcome", async () => {
    const w = await world()
    const d = await daemon(w.token)
    const got = events(t, w.member.id)
    const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'commit', message: '修复退款' })
    const req = await d.act({ output: 'pushed with ghp_abcdefghijklmnopqrstuvwxyz0123456789AB' })
    expect(req).toMatchObject({
      action: 'commit',
      message: '修复退款',
      branch: null,
      remote: null,
      identity: { name: 'cc', email: `${w.bot.id.slice(0, 8)}@bots.gonggong.local` },
    })
    const op = await res
    expect(op.status).toBe(200)
    expect(op.body).toMatchObject({
      action: 'commit',
      status: 'succeeded',
      requestedBy: { id: w.owner.id, name: '王磊' },
      decidedBy: null,
      error: null,
      finishedAt: clock.toISOString(),
    })
    expect(op.body.output).toBe(`pushed with ${MASK}`)
    expect(
      got
        .filter((e) => e.t === 'group.gitOperation')
        .map((e) => (e as { operation: GitOperationDto }).operation.status),
    ).toEqual(['running', 'succeeded'])
    const logs = await t.db.select().from(auditLogs)
    expect(logs.map((l) => l.action)).toEqual(['git.run'])
    expect(logs[0]).toMatchObject({ category: 'admin', actorUserId: w.owner.id, groupId: w.group.id })
    expect(JSON.stringify(logs[0]!.detail)).not.toContain('ghp_')

    expect(op.body.paths).toBeNull()
    expect(req.paths).toBeNull()
    const [event] = await t.db.select().from(messages).where(eq(messages.kind, 'event'))
    expect(event).toMatchObject({
      groupId: w.group.id,
      body: '王磊 提交了 cc 的改动：修复退款',
      meta: {
        i18n: {
          key: '{user} 提交了 {bot} 的改动：{subject}{approval}',
          params: { user: '王磊', bot: 'cc', subject: '修复退款', approval: '' },
        },
      },
    })

    const fail = w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    expect((await d.act({ ok: false, output: null, error: 'not a fast-forward' })).paths).toBeNull()
    expect((await fail).body).toMatchObject({ status: 'failed', error: 'not a fast-forward' })
    expect((await ops(w)).body.operations.map((o) => o.status)).toEqual(['failed', 'succeeded'])
    expect(await groupEvents(w.group.id)).toHaveLength(1)
  })

  it('persists and reads back redacted command logs, while accepting an old daemon', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const commands = [
      {
        command: 'git push origin main',
        startedAt: '2026-10-25T04:00:00.000Z',
        durationMs: 12,
        exitCode: 1,
        stdout: 'src/a.ts\0src/b.ts\0\ntoken ghp_abcdefghijklmnopqrstuvwxyz0123456789AB',
        stderr: 'rejected\0\x07\n',
        truncated: false,
      },
    ]
    const pending = w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    await d.act({
      ok: false,
      output: null,
      error: 'not a fast-forward',
      detail: { code: null, paths: [], ahead: null, behind: null, updated: null, commands },
    })
    const failed = (await pending).body
    expect(failed.detail?.commands).toEqual([
      { ...commands[0], stdout: `src/a.ts\\0src/b.ts\\0\ntoken ${MASK}`, stderr: 'rejected\\0\\x07\n' },
    ])
    const [stored] = await t.db.select().from(gitOperations).where(eq(gitOperations.id, failed.id))
    expect(stored!.detail).toEqual(failed.detail)
    expect((await ops(w)).body.operations[0]?.detail).toEqual(failed.detail)

    const old = w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    await d.act({ output: 'old daemon summary' })
    expect((await old).body).toMatchObject({ output: 'old daemon summary', detail: null })
  })

  it('commits only the chosen paths, for the owner and on approval', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const paths = ['src/a.ts', 'src/gone.ts']
    const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'commit',
      message: '改两处',
      paths,
    })
    expect(await d.act()).toMatchObject({ action: 'commit', message: '改两处', paths })
    expect((await res).body).toMatchObject({ status: 'succeeded', paths })
    const [log] = await t.db.select().from(auditLogs)
    expect(log!.detail).toMatchObject({ action: 'commit', files: 2 })

    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'commit',
      message: '只改一处\n\n细节',
      paths: ['src/a.ts'],
    })
    expect(asked.body).toMatchObject({ status: 'pending_approval', paths: ['src/a.ts'] })
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note!.payload).toMatchObject({ summary: 'commit「只改一处」 (1 file)' })
    const approved = w.owners.post<GitOperationDto>(`/api/git-operations/${asked.body.id}/decide`, {
      approve: true,
    })
    expect((await d.act()).paths).toEqual(['src/a.ts'])
    expect((await approved).body.status).toBe('succeeded')
    expect(await groupEvents(w.group.id)).toEqual([
      '王磊 提交了 cc 的改动：改两处',
      '陈晨 提交了 cc 的改动：只改一处（王磊 批准）',
    ])
  })

  it("fails the owner's action when the machine is offline", async () => {
    const w = await world()
    const res = await w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    expect(res.body).toMatchObject({ status: 'failed', error: 'cc 离线，无法执行 Git 操作' })
  })

  it('queues a member request for the owner, who approves it to run', async () => {
    const w = await world()
    const got = events(t, w.member.id)
    const res = await w.members.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'checkout',
      branch: 'feat/x',
    })
    expect(res.body).toMatchObject({
      status: 'pending_approval',
      branch: 'feat/x',
      requestedBy: { id: w.member.id, name: '陈晨' },
      expiresAt: new Date(clock.getTime() + 30 * 60_000).toISOString(),
    })
    expect(got.some((e) => e.t === 'group.gitOperation')).toBe(true)
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note).toMatchObject({
      type: 'git_operation_request',
      payload: {
        groupId: w.group.id,
        botId: w.bot.id,
        botName: 'cc',
        byName: '陈晨',
        operationId: res.body.id,
        summary: 'checkout feat/x',
      },
    })
    const decide = `/api/git-operations/${res.body.id}/decide`
    expect((await w.members.post(decide, { approve: true })).status).toBe(403)

    const d = await daemon(w.token)
    const approved = w.owners.post<GitOperationDto>(decide, { approve: true })
    expect(await d.act()).toMatchObject({ action: 'checkout', branch: 'feat/x' })
    expect((await approved).body).toMatchObject({
      status: 'succeeded',
      decidedBy: { id: w.owner.id, name: '王磊' },
    })
    const [after] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(after!.resolvedAt).not.toBeNull()
    expect((await w.owners.post(decide, { approve: true })).status).toBe(409)
    const actions = (await t.db.select().from(auditLogs)).map((l) => l.action)
    expect(actions).toEqual(['git.request', 'git.decide', 'git.run'])
    expect(await groupEvents(w.group.id)).toEqual(['陈晨 将 cc 切换到 feat/x（王磊 批准）'])
  })

  it('rejects and expires member requests', async () => {
    const w = await world()
    const a = await w.members.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    const rejected = await w.owners.post<GitOperationDto>(`/api/git-operations/${a.body.id}/decide`, {
      approve: false,
    })
    expect(rejected.body).toMatchObject({ status: 'rejected', decidedBy: { id: w.owner.id } })

    const b = await w.members.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    clock = new Date(clock.getTime() + 31 * 60_000)
    expect((await w.owners.post(`/api/git-operations/${b.body.id}/decide`, { approve: true })).status).toBe(
      409,
    )
    await expireGitOperations(t.ctx)
    const list = (await ops(w)).body.operations
    expect(list.find((o) => o.id === b.body.id)?.status).toBe('expired')
    const notes = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(notes.every((n) => n.resolvedAt)).toBe(true)
    expect(await groupEvents(w.group.id)).toEqual([])
  })

  it('refuses while the bot, or a bot sharing its directory, has a live run', async () => {
    const w = await world()
    await daemon(w.token)
    const busy = { message: 'cc 正在运行，等运行结束后再操作' }
    await w.run('running')
    expect(await w.owners.post(`${w.base}/actions`, { action: 'pull' })).toMatchObject({
      status: 409,
      body: busy,
    })
    await t.db.update(runs).set({ status: 'succeeded' })

    const twin = await t.seed.bot({ ownerId: w.owner.id, name: 'twin', machineId: w.machine.id })
    const other = await t.seed.group({ createdBy: w.owner.id, botIds: [twin.id] })
    await t.db.update(groupBots).set({ workspacePath: '/w/pay' }).where(eq(groupBots.groupId, other.id))
    await w.run('awaiting_approval', other.id, twin.id)
    expect((await w.owners.post(`${w.base}/actions`, { action: 'pull' })).status).toBe(409)

    const pending = await w.members.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    expect(pending.body.status).toBe('pending_approval')
    const decided = await w.owners.post(`/api/git-operations/${pending.body.id}/decide`, { approve: true })
    expect(decided).toMatchObject({ status: 409, body: busy })
    expect((await ops(w)).body.operations[0]?.status).toBe('pending_approval')
  })

  it('maps a busy daemon to 409 and records the failure', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const res = w.owners.post(`${w.base}/actions`, { action: 'pull' })
    await d.act({ ok: false, busy: true, output: null })
    expect(await res).toMatchObject({ status: 409, body: { message: 'cc 正在运行，等运行结束后再操作' } })
    expect((await ops(w)).body.operations[0]?.status).toBe('failed')
  })

  it('asks the owner to confirm pushing the protected base branch; approving a member request confirms it', async () => {
    const w = await world()
    await t.db.update(groups).set({ protectBase: true }).where(eq(groups.id, w.group.id))
    const d = await daemon(w.token)
    const push = { action: 'push', branch: 'main' }
    expect(await w.owners.post(`${w.base}/actions`, push)).toMatchObject({
      status: 409,
      body: { message: '推送基准分支需要再次确认' },
    })
    const confirmed = w.owners.post<GitOperationDto>(`${w.base}/actions`, { ...push, confirmBase: true })
    expect(await d.act()).toMatchObject({
      action: 'push',
      branch: 'main',
      remote: 'origin',
      identity: { name: 'cc', email: `${w.bot.id.slice(0, 8)}@bots.gonggong.local` },
    })
    expect((await confirmed).body).toMatchObject({ status: 'succeeded', pushesBase: true })

    const feature = w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'push', branch: 'feat/x' })
    await d.act()
    expect((await feature).body).toMatchObject({ status: 'succeeded', pushesBase: false })

    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, push)
    expect(asked.body).toMatchObject({ status: 'pending_approval', pushesBase: true })
    const approved = w.owners.post<GitOperationDto>(`/api/git-operations/${asked.body.id}/decide`, {
      approve: true,
    })
    await d.act()
    expect((await approved).body.status).toBe('succeeded')

    const pull = w.owners.post(`${w.base}/actions`, { action: 'pull' })
    await d.act()
    await pull
    expect(await groupEvents(w.group.id)).toEqual([
      '王磊 将 cc 的 main 推送到 origin',
      '王磊 将 cc 的 feat/x 推送到 origin',
      '陈晨 将 cc 的 main 推送到 origin（王磊 批准）',
      '王磊 为 cc 拉取了更新',
    ])
  })

  it('acts on a sub-repo: stored, relayed, listed and announced with the repo', async () => {
    const w = await world()
    const d = await daemon(w.token, ['gitOps', 'gitOps2', 'gitRepos'])
    const repo = 'libs/core'
    const checkout = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'checkout',
      repo,
      branch: 'dev',
    })
    expect(await d.act()).toMatchObject({ action: 'checkout', repo, branch: 'dev' })
    expect((await checkout).body).toMatchObject({ status: 'succeeded', repo, branch: 'dev' })

    const pull = w.owners.post(`${w.base}/actions`, { action: 'pull', repo })
    expect((await d.act()).repo).toBe(repo)
    await pull
    const commit = w.owners.post(`${w.base}/actions`, { action: 'commit', repo, message: '改核心' })
    expect((await d.act()).repo).toBe(repo)
    await commit
    const push = w.owners.post(`${w.base}/actions`, { action: 'push', repo, branch: 'dev' })
    expect((await d.act()).repo).toBe(repo)
    await push

    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull', repo })
    expect(asked.body).toMatchObject({ status: 'pending_approval', repo })
    const [note] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
    expect(note!.payload).toMatchObject({ summary: 'libs/core: pull' })
    const approved = w.owners.post(`/api/git-operations/${asked.body.id}/decide`, { approve: true })
    expect((await d.act()).repo).toBe(repo)
    await approved

    expect((await ops(w)).body.operations.every((o) => o.repo === repo)).toBe(true)
    const [log] = await t.db.select().from(auditLogs)
    expect(log!.detail).toMatchObject({ action: 'checkout', repo })
    expect(await groupEvents(w.group.id)).toEqual([
      '王磊 将 cc 的 libs/core 切换到 dev',
      '王磊 为 cc 的 libs/core 拉取了更新',
      '王磊 提交了 cc 的 libs/core 改动：改核心',
      '王磊 将 cc 的 libs/core 的 dev 推送到 origin',
      '陈晨 为 cc 的 libs/core 拉取了更新（王磊 批准）',
    ])
  })

  it('lists pending operations plus the latest 20 settled ones, newest first', async () => {
    const w = await world()
    const pending = await w.members.post<GitOperationDto>(`${w.base}/actions`, { action: 'pull' })
    for (let i = 0; i < 22; i++) {
      clock = new Date(clock.getTime() + 1000)
      await w.owners.post(`${w.base}/actions`, { action: 'pull' })
    }
    const list = (await ops(w)).body.operations
    expect(list).toHaveLength(21)
    expect(list.at(-1)?.id).toBe(pending.body.id)
    expect(list[0]!.createdAt > list[1]!.createdAt).toBe(true)
    expect((await w.outsiders.get(`/api/groups/${w.group.id}/git/operations`)).status).toBe(404)
  })
})
