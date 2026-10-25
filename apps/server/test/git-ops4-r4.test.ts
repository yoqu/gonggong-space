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
const noRewrite = { status: 409, body: { message: '受保护的基准分支不能改写历史' } }
const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const said = (summary: string) => `王磊 在 cc 的工作区执行了 ${summary}`

type World = Awaited<ReturnType<typeof gitWorld>>
const ops = (w: World) => w.members.get<GitOperationsDto>(`/api/groups/${w.group.id}/git/operations`)
const protect = (w: World) => t.db.update(groups).set({ protectBase: true }).where(eq(groups.id, w.group.id))
const current = (name: string) => ({ ...gitBranch(name), current: true })

const todo = [
  { action: 'pick', commit: 'a1b2c3d4' },
  { action: 'reword', commit: 'b2c3d4e5', message: '修复退款金额' },
  { action: 'reword', commit: 'c3d4e5f6', message: '补测试' },
  { action: 'drop', commit: 'd4e5f6a7' },
] as const
const interactive: GitActionInput = { action: 'rebase', onto: hash, todo: [...todo] }

describe('gitOps4 R4 actions', () => {
  it('needs gitOps4 for an interactive rebase, several files resolved, apply and restore', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, OPS3)
    const inputs: GitActionInput[] = [
      interactive,
      { action: 'resolve', path: 'a.ts', side: 'ours', paths: ['a.ts', 'b.ts'] },
      { action: 'apply', commit: hash, paths: ['a.ts'] },
      { action: 'restore', commit: hash, paths: ['a.ts'] },
    ]
    for (const input of inputs) {
      expect(await w.owners.post(`${w.base}/actions`, input), input.action).toMatchObject(old)
      expect(await w.members.post(`${w.base}/actions`, input), input.action).toMatchObject(old)
    }
    expect((await ops(w)).body.operations).toEqual([])

    // Without the new options they still reach it.
    const plain = w.owners.post<GitOperationDto>(`${w.base}/actions`, { action: 'rebase', onto: 'main' })
    expect((await d.act()).args).toEqual({ onto: 'main' })
    expect((await plain).body.status).toBe('succeeded')
    const one = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'resolve',
      path: 'a.ts',
      side: 'ours',
    })
    expect(await d.act()).toMatchObject({ paths: null, args: { path: 'a.ts', side: 'ours' } })
    expect((await one).body.status).toBe('succeeded')
  })

  it('relays them and names them for the group and the approver', async () => {
    const w = await gitWorld(t)
    const d = await gitDaemon(t, w.token, ALL)
    const cases: [GitActionInput, Record<string, unknown>, string][] = [
      [interactive, { args: { onto: hash, todo } }, 'rebase -i onto a1b2c3d (2 reword, 1 drop)'],
      [
        {
          action: 'rebase',
          onto: 'main',
          todo: [
            { action: 'pick', commit: 'a1b2' },
            { action: 'fixup', commit: 'b2c3' },
          ],
        },
        {
          args: {
            onto: 'main',
            todo: [
              { action: 'pick', commit: 'a1b2' },
              { action: 'fixup', commit: 'b2c3' },
            ],
          },
        },
        'rebase -i onto main (1 fixup)',
      ],
      [
        { action: 'apply', commit: hash, paths: ['src/a.ts'] },
        { paths: ['src/a.ts'], args: { commit: hash } },
        'cherry-pick a1b2c3d -- src/a.ts',
      ],
      [
        { action: 'apply', commit: hash, paths: ['src/a.ts', 'b.ts'], reverse: true },
        { paths: ['src/a.ts', 'b.ts'], args: { commit: hash, reverse: true } },
        'revert a1b2c3d -- 2 files',
      ],
      [
        { action: 'restore', commit: hash, paths: ['src/a.ts', 'README.md'] },
        { paths: ['src/a.ts', 'README.md'], args: { commit: hash } },
        'checkout a1b2c3d -- 2 files',
      ],
    ]
    for (const [input, stored, summary] of cases) {
      const res = w.owners.post<GitOperationDto>(`${w.base}/actions`, input)
      expect(await d.act(), summary).toMatchObject({ action: input.action, ...stored })
      expect((await res).body, summary).toMatchObject({ status: 'succeeded', ...stored })
    }
    // Resolving, one file or several, tells the group nothing.
    const resolved = w.owners.post<GitOperationDto>(`${w.base}/actions`, {
      action: 'resolve',
      path: 'src/a.ts',
      side: 'theirs',
      paths: ['src/a.ts', 'src/b.ts'],
    })
    expect(await d.act()).toMatchObject({
      paths: ['src/a.ts', 'src/b.ts'],
      args: { path: 'src/a.ts', side: 'theirs' },
    })
    expect((await resolved).body.status).toBe('succeeded')
    expect(await groupEvents(t, w.group.id)).toEqual(cases.map(([, , summary]) => said(summary)))

    // What the owner is asked to approve.
    const asks: [GitActionInput, string][] = [
      [interactive, 'rebase -i onto a1b2c3d (2 reword, 1 drop)'],
      [{ action: 'restore', commit: hash, paths: ['src/a.ts'] }, 'checkout a1b2c3d -- src/a.ts'],
      [{ action: 'resolve', path: 'a.ts', side: 'ours', paths: ['b.ts', 'a.ts'] }, 'resolve 2 files --ours'],
    ]
    for (const [input, summary] of asks) {
      const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, input)
      expect(asked.body.status).toBe('pending_approval')
      const notes = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
      const payloads = notes.map((n) => n.payload as { operationId: string; summary: string })
      expect(payloads.find((p) => p.operationId === asked.body.id)).toMatchObject({ summary })
    }
  })
})

describe('the protected base branch and an interactive rebase', () => {
  it('refuses to rewrite the base branch, asking the daemon which branch is current', async () => {
    const w = await gitWorld(t)
    await protect(w)
    const d = await gitDaemon(t, w.token, ALL)
    const post = (input: GitActionInput) => w.owners.post<GitOperationDto>(`${w.base}/actions`, input)

    const onBase = post(interactive)
    expect(
      'repo' in (await d.refs({ branches: [current('main'), gitBranch('feat')], remotes: ['origin'] })),
    ).toBe(false)
    expect(await onBase).toMatchObject(noRewrite)
    const asked = w.members.post(`${w.base}/actions`, interactive)
    await d.refs({ branches: [current('main')], remotes: ['origin'] })
    expect(await asked).toMatchObject(noRewrite)
    // Named outright: nothing to ask.
    expect(await post({ ...interactive, branch: 'main' })).toMatchObject(noRewrite)

    const onFeat = post(interactive)
    await d.refs({ branches: [gitBranch('main'), current('feat')], remotes: ['origin'] })
    expect((await d.act()).args).toEqual({ onto: hash, todo })
    expect((await onFeat).body.status).toBe('succeeded')
    // A plain rebase rewrites nothing that was not rebased before.
    const plain = post({ action: 'rebase', onto: 'origin/main' })
    expect((await d.act()).args).toEqual({ onto: 'origin/main' })
    expect((await plain).body.status).toBe('succeeded')
    expect((await ops(w)).body.operations).toHaveLength(2)
  })

  it('checks again on approval', async () => {
    const w = await gitWorld(t)
    await protect(w)
    // Offline: asked all the same.
    const asked = await w.members.post<GitOperationDto>(`${w.base}/actions`, interactive)
    expect(asked.body.status).toBe('pending_approval')
    const d = await gitDaemon(t, w.token, ALL)
    const decide = `/api/git-operations/${asked.body.id}/decide`
    const refused = w.owners.post(decide, { approve: true })
    await d.refs({ branches: [current('main')], remotes: ['origin'] })
    expect(await refused).toMatchObject(noRewrite)
    const approved = w.owners.post<GitOperationDto>(decide, { approve: true })
    await d.refs({ branches: [current('feat')], remotes: ['origin'] })
    expect((await d.act()).args).toEqual({ onto: hash, todo })
    expect((await approved).body.status).toBe('succeeded')
  })
})
