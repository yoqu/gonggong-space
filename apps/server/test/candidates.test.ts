import { mkdtempSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CommandCandidatesDto, type FileCandidatesDto, PROTOCOL_VERSION } from '@aiws/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, groupRepos } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { bareRepo } from './support/git.js'
import { client } from './support/http.js'

let t: TestApp
let clock: Date
beforeEach(async () => {
  process.env.AIWS_DATA_DIR = mkdtempSync(join(tmpdir(), 'aiws-data-'))
  clock = new Date('2026-09-23T10:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

type Msg = Record<string, unknown> & { t: string }

/** A fake daemon that only surfaces files.list requests (workspace.ensure on connect is ignored). */
async function daemon(token: string, machineId: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.1.0',
      machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
      agents: [],
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  await until(() => t.ctx.hub.isOnline(machineId))
  return {
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    async request() {
      for (;;) {
        const m = await box.next<Msg>()
        if (m.t === 'files.list') return m
      }
    },
  }
}

async function until(check: () => Promise<boolean> | boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function world(o: { repo?: boolean } = {}) {
  const alice = await t.seed.user({ name: '王磊' })
  const outsider = await t.seed.user()
  const a = await t.seed.machine(alice.id)
  const other = await t.seed.machine(outsider.id)
  const bot = await t.seed.bot({ ownerId: alice.id, name: '小王的 Claude', machineId: a.machine.id })
  const stranger = await t.seed.bot({ ownerId: alice.id, name: '外部 bot', machineId: a.machine.id })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
  const remote = bareRepo()
  const repoId =
    o.repo === false
      ? null
      : (
          await t.db
            .insert(groupRepos)
            .values({ groupId: group.id, url: remote.url, baseBranch: 'main' })
            .returning()
        )[0]!.id
  const asAlice = client(t, await t.seed.cookie(alice.id))
  const files = async (q = '', botId?: string) =>
    asAlice.get<FileCandidatesDto>(
      `/api/groups/${group.id}/candidates/files?q=${encodeURIComponent(q)}${botId ? `&botId=${botId}` : ''}`,
    )
  return { alice, outsider, a, other, bot, stranger, group, remote, repoId, asAlice, files }
}

const paths = (dto: FileCandidatesDto) => dto.entries.map((e) => e.path)
const later = (sec: number) => (clock = new Date(clock.getTime() + sec * 1000))

describe('file candidates', () => {
  it('has no source for a group without repo when no bot is mentioned', async () => {
    const w = await world({ repo: false })
    expect((await w.files()).body).toEqual({ source: 'none', label: '', entries: [] })
  })

  it('falls back to the base-branch mirror, filtered and labelled with its update time', async () => {
    const w = await world()
    w.remote.commit('server/refund/handler.go', 'package refund\n')
    const all = (await w.files()).body
    expect(all.source).toBe('mirror')
    expect(all.label).toBe('main 镜像 · 刚刚更新')
    expect(paths(all)).toEqual(['README.md', 'server/', 'server/refund/', 'server/refund/handler.go'])
    expect(all.entries.find((e) => e.path === 'server/')).toEqual({
      path: 'server/',
      dir: true,
      uncommitted: false,
      notInWorkspace: false,
    })
    expect(paths((await w.files('read')).body)).toEqual(['README.md'])
    expect(paths((await w.files('refund/h')).body)).toEqual(['server/refund/handler.go'])
  })

  it('refreshes the mirror at most every 60 s and keeps the last listing when a fetch fails', async () => {
    const w = await world()
    expect(paths((await w.files()).body)).toEqual(['README.md'])
    w.remote.commit('docs/new.md', 'x\n')
    later(30)
    expect(paths((await w.files()).body)).toEqual(['README.md'])
    later(31)
    const fresh = (await w.files()).body
    expect(paths(fresh)).toEqual(['README.md', 'docs/', 'docs/new.md'])
    expect(fresh.label).toBe('main 镜像 · 刚刚更新')
    renameSync(w.remote.path, `${w.remote.path}.gone`)
    later(180)
    const stale = (await w.files()).body
    expect(paths(stale)).toEqual(['README.md', 'docs/', 'docs/new.md'])
    expect(stale.label).toBe('main 镜像 · 3 分钟前更新')
  })

  it("prefers the online bot's workspace and marks mirror-only files", async () => {
    const w = await world()
    w.remote.commit('READING.md', 'x\n')
    const d = await daemon(w.a.token, w.a.machine.id)
    const pending = w.files('READ', w.bot.id)
    const req = await d.request()
    expect(req).toMatchObject({
      t: 'files.list',
      groupId: w.group.id,
      botId: w.bot.id,
      workspace: { repo: { id: w.repoId, url: w.remote.url, branch: 'main' }, cdPath: null },
      query: 'READ',
      limit: 50,
    })
    d.send({
      t: 'files.result',
      requestId: req.requestId,
      entries: [
        { path: 'README.md', dir: false, uncommitted: false },
        { path: 'READ_local.md', dir: false, uncommitted: true },
      ],
      error: null,
    })
    const res = await pending
    expect(res.body.source).toBe('workspace')
    expect(res.body.label).toBe('小王的 Claude 工作区 · 含未提交')
    expect(res.body.entries).toEqual([
      { path: 'README.md', dir: false, uncommitted: false, notInWorkspace: false },
      { path: 'READING.md', dir: false, uncommitted: false, notInWorkspace: true },
      { path: 'READ_local.md', dir: false, uncommitted: true, notInWorkspace: false },
    ])
  })

  it('sends the /cd path and lists the workspace of a repo-less group', async () => {
    const w = await world({ repo: false })
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/Users/me/code/app' })
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    const d = await daemon(w.a.token, w.a.machine.id)
    const pending = w.files('', w.bot.id)
    const req = await d.request()
    expect(req.workspace).toEqual({ repo: null, cdPath: '/Users/me/code/app' })
    d.send({
      t: 'files.result',
      requestId: req.requestId,
      entries: [{ path: 'notes/', dir: true, uncommitted: false }],
      error: null,
    })
    expect((await pending).body).toMatchObject({
      source: 'workspace',
      entries: [{ path: 'notes/', dir: true }],
    })
  })

  it('falls back to the mirror when the bot is offline, errs or does not answer in 2 s', async () => {
    const w = await world()
    const offline = (await w.files('', w.bot.id)).body
    expect(offline.source).toBe('mirror')

    const d = await daemon(w.a.token, w.a.machine.id)
    const erring = w.files('', w.bot.id)
    const req = await d.request()
    d.send({ t: 'files.result', requestId: req.requestId, entries: [], error: '工作区不存在' })
    expect((await erring).body.source).toBe('mirror')

    const started = Date.now()
    const silent = w.files('', w.bot.id)
    await d.request()
    expect((await silent).body).toMatchObject({ source: 'mirror', entries: [{ path: 'README.md' }] })
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900)
  })

  it('rejects bots outside the group and non-members', async () => {
    const w = await world()
    expect((await w.files('', w.stranger.id)).status).toBe(404)
    const asOutsider = client(t, await t.seed.cookie(w.outsider.id))
    expect((await asOutsider.get(`/api/groups/${w.group.id}/candidates/files`)).status).toBe(404)
  })
})

describe('command candidates', () => {
  it('lists system commands and the agent commands reported over ACP, renaming clashes', async () => {
    const w = await world()
    const d = await daemon(w.a.token, w.a.machine.id)
    const commands = [
      { name: 'compact', description: 'Compact the conversation' },
      { name: 'new', description: 'Start a new conversation' },
    ]
    d.send({ t: 'commands.update', groupId: w.group.id, botId: w.bot.id, commands })
    // Reports for bots of other machines are ignored.
    const o = await daemon(w.other.token, w.other.machine.id)
    o.send({ t: 'commands.update', groupId: w.group.id, botId: w.bot.id, commands: [] })
    const url = `/api/groups/${w.group.id}/candidates/commands`
    await until(
      async () =>
        (await w.asAlice.get<CommandCandidatesDto>(`${url}?botId=${w.bot.id}`)).body.agent.length > 0,
    )
    await new Promise((r) => setTimeout(r, 100))

    const res = (await w.asAlice.get<CommandCandidatesDto>(`${url}?botId=${w.bot.id}`)).body
    expect(res.system).toEqual([
      { name: 'stop', hint: '停止运行（未 @ bot 时停止本群全部）' },
      { name: 'hold', hint: '连续占用群锁' },
      { name: 'release', hint: '释放群锁' },
      { name: 'new', hint: '开新会话' },
      { name: 'cd', hint: '绑定本机目录（仅分区）' },
    ])
    expect(res.agent).toEqual([
      { name: 'compact', hint: 'Compact the conversation', botId: w.bot.id, botName: '小王的 Claude' },
      { name: '小王的Claude:new', hint: '与系统命令重名', botId: w.bot.id, botName: '小王的 Claude' },
    ])
    expect((await w.asAlice.get<CommandCandidatesDto>(url)).body.agent).toEqual([])
  })
})
