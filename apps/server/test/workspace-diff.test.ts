import { PROTOCOL_VERSION, type ServerToDaemon, type WorkspaceDiffDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function daemon(token: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  send({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    token,
    daemonVersion: '0.1.0',
    machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
    agents: [],
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return { send, next: () => box.next<ServerToDaemon>() }
}

const PATCH = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '陈晨' })
  const outsider = await t.seed.user({ name: '路人' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const group = await t.seed.group({ createdBy: owner.id, memberIds: [member.id], botIds: [bot.id] })
  const members = client(t, await t.seed.cookie(member.id))
  const outsiders = client(t, await t.seed.cookie(outsider.id))
  const url = (q: string) => `/api/groups/${group.id}/bots/${bot.id}/diff?${q}`
  const run = async (status: string, patch: string | null = null) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: owner.id, body: '@cc' })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        originUserId: owner.id,
        status,
        patch: patch && seal(patch),
      })
      .returning()
    return r!
  }
  return { owner, bot, group, members, outsiders, url, run, token }
}

describe('GET /api/groups/:id/bots/:botId/diff', () => {
  it('asks the bot daemon for the workspace diff and relays its answer', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const pending = w.members.get<WorkspaceDiffDto>(w.url('scope=base'))
    const req = await d.next()
    expect(req).toMatchObject({
      t: 'workspace.diff',
      groupId: w.group.id,
      botId: w.bot.id,
      workspace: { repo: null, cdPath: null },
      scope: 'base',
      runId: null,
    })
    if (req.t !== 'workspace.diff') throw new Error(req.t)
    d.send({
      t: 'workspace.diff.result',
      requestId: req.requestId,
      patch: PATCH,
      base: 'origin/main',
      branch: 'feat/x',
      error: null,
    })
    const res = await pending
    expect(res).toEqual({
      status: 200,
      body: { scope: 'base', patch: PATCH, base: 'origin/main', branch: 'feat/x' },
    })
  })

  it('asks the daemon for a live turn and reads a finished one from the database', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const live = await w.run('running')
    const pending = w.members.get<WorkspaceDiffDto>(w.url(`scope=turn&runId=${live.id}`))
    const req = await d.next()
    expect(req).toMatchObject({ t: 'workspace.diff', scope: 'turn', runId: live.id })
    if (req.t !== 'workspace.diff') throw new Error(req.t)
    d.send({
      t: 'workspace.diff.result',
      requestId: req.requestId,
      patch: null,
      base: null,
      branch: 'main',
      error: null,
    })
    expect((await pending).body).toEqual({ scope: 'turn', patch: null, base: null, branch: 'main' })

    const done = await w.run('completed', PATCH)
    const res = await w.members.get<WorkspaceDiffDto>(w.url(`scope=turn&runId=${done.id}`))
    expect(res.body).toEqual({ scope: 'turn', patch: PATCH, base: null, branch: null })
  })

  it('reports an offline bot, a daemon error, and refuses outsiders or bad input', async () => {
    const w = await world()
    expect((await w.members.get(w.url('scope=uncommitted'))).body).toMatchObject({
      error: 'conflict',
      message: 'Bot 离线，无法读取工作区改动',
    })
    const d = await daemon(w.token)
    const pending = w.members.get(w.url('scope=uncommitted'))
    const req = await d.next()
    if (req.t !== 'workspace.diff') throw new Error(req.t)
    d.send({
      t: 'workspace.diff.result',
      requestId: req.requestId,
      patch: null,
      base: null,
      branch: null,
      error: '工作区不是 git 仓库',
    })
    expect((await pending).body).toMatchObject({ error: 'conflict', message: '工作区不是 git 仓库' })

    expect((await w.outsiders.get(w.url('scope=uncommitted'))).status).toBe(404)
    expect((await w.members.get(w.url('scope=nope'))).status).toBe(400)
    expect((await w.members.get(w.url('scope=turn'))).status).toBe(400)
  })
})
