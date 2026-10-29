import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ArtifactCard,
  type ArtifactSubmitRes,
  type MessageDto,
  PROTOCOL_VERSION,
  type RunStart,
  type ServerToDaemon,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { artifacts, artifactVersions, messages, plugins, runs } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { BUILTIN_PLUGINS, syncBuiltinPlugins } from '../src/modules/plugins/builtin.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'
import { client } from './support/http.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

describe('RunStart.artifacts', () => {
  async function dispatch(
    w: Awaited<ReturnType<typeof artifactWorld>>,
    meta: object,
    features = ['artifacts'],
  ) {
    const sent: ServerToDaemon[] = []
    vi.spyOn(t.ctx.hub, 'isOnline').mockImplementation((id) => id === w.A.machine.id)
    vi.spyOn(t.ctx.hub, 'features').mockReturnValue(features)
    vi.spyOn(t.ctx.hub, 'send').mockImplementation((id, m) => {
      if (id !== w.A.machine.id) return false
      sent.push(m)
      return true
    })
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: w.g.id, kind: 'user', authorUserId: w.wang.id, body: '@小王的 Claude 改一下', meta })
      .returning()
    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: w.g.id,
        botId: w.bot.id,
        triggerMessageId: m!.id,
        triggerUserId: w.wang.id,
        originUserId: w.wang.id,
        status: 'queued',
      })
      .returning()
    await schedule(t.ctx, w.bot.id)
    const start = sent.find((x): x is RunStart => x.t === 'run.start')!
    const [row] = await t.db.select().from(runs).where(eq(runs.id, run!.id))
    return { start, run: row! }
  }

  it("sends the trigger's artifacts first, then the bot's own up to 20, and every directory to exclude", async () => {
    const w = await artifactWorld(t)
    const old = new Date('2026-01-01T00:00:00Z')
    const own = []
    for (let i = 0; i < 21; i++)
      own.push(await w.artifact({ updatedAt: new Date(old.getTime() + (i + 1) * 60_000) }))
    const target = await w.artifact({ botId: null, updatedAt: old })
    const others = await w.artifact({ botId: w.other.id })
    const archived = await w.artifact({ archivedAt: new Date(), updatedAt: new Date() })

    const { start, run } = await dispatch(w, { mentions: [w.bot.id], artifactRefs: [target.id] })
    expect(start.artifacts).toHaveLength(20)
    expect(start.artifacts[0]).toEqual({ id: target.id, dir: target.dir, headVersionId: null, digest: null })
    // The 19 most recently updated of the bot's own.
    expect(start.artifacts.slice(1).map((a) => a.id)).toEqual(
      own
        .slice(-19)
        .reverse()
        .map((a) => a.id),
    )
    expect(start.artifactExclude.sort()).toEqual([...own, target, others, archived].map((a) => a.dir).sort())
    expect(run.artifacts).toEqual(start.artifacts.map((a) => a.id))
  })

  it("counts artifacts the bot's runs changed and the artifact card a message quotes", async () => {
    const w = await artifactWorld(t)
    const changed = await w.artifact({ botId: null })
    const quoted = await w.artifact({ botId: null })
    const untouched = await w.artifact({ botId: null })
    const prev = await w.run([changed.id], { status: 'succeeded' })
    const v1 = (await w.submit(prev.id, changed.id, L1)).json() as ArtifactSubmitRes
    const [card] = await t.db
      .insert(messages)
      .values({
        groupId: w.g.id,
        kind: 'event',
        body: '产物',
        meta: { card: { type: 'artifact', artifactId: quoted.id } },
      })
      .returning()
    const quote = { kind: 'message', id: card!.id, who: '共工空间', text: '产物' }

    const { start } = await dispatch(w, { mentions: [w.bot.id], quote })
    expect(start.artifacts.map((a) => a.id)).toEqual([quoted.id, changed.id])
    const [head] = await t.db.select().from(artifactVersions).where(eq(artifactVersions.id, v1.versionId))
    expect(start.artifacts[1]).toMatchObject({ headVersionId: v1.versionId, digest: head!.digest })
    expect(start.artifacts.map((a) => a.id)).not.toContain(untouched.id)
  })

  it("tells the agent the checked-out heads' design issues", async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const prev = await w.run([a.id], { status: 'succeeded' })
    await w.submit(prev.id, a.id, { ...L1, 'screens/home.html': '<p style="color:#f00">x</p>' })
    const { start } = await dispatch(w, { mentions: [w.bot.id] })
    const note = start.prompt.context.find((c) => c.body.includes('规范问题'))
    expect(note?.body).toContain(`${a.dir}/screens/home.html（v1）[hardcoded-color]`)
  })

  it('sends none to a daemon without the artifacts feature', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const { start, run } = await dispatch(w, { mentions: [w.bot.id], artifactRefs: [a.id] }, ['plugins'])
    expect(start.artifacts).toEqual([])
    expect(start.artifactExclude).toEqual([])
    expect(run.artifacts).toEqual([])
  })
})

describe('creations', () => {
  async function creationWorld(features: string[]) {
    const w = await artifactWorld(t)
    const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
    await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
    await syncBuiltinPlugins(t.ctx, BUILTIN_PLUGINS)
    const [p] = await t.db.select().from(plugins).where(eq(plugins.name, 'web-prototype'))
    const wang = client(t, await t.seed.cookie(w.wang.id))
    expect((await wang.put(`/api/groups/${w.g.id}/plugins/${p!.id}`, { enabled: true })).status).toBe(200)
    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token: w.A.token,
        daemonVersion: '0.9.0',
        machine: { name: 'wang-mac', os: 'macos', arch: 'aarch64' },
        agents: [],
        features,
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    const next = async () => {
      for (;;) {
        const m = await box.next<ServerToDaemon>()
        if (m.t === 'run.start') return m
      }
    }
    const req = {
      pluginId: p!.id,
      templateId: 'app-screens',
      designSystemId: 'luke-plus',
      inputs: { title: '麓客活动报名' },
      directions: false,
      botId: w.bot.id,
    }
    return { ...w, wang, ws, next, req }
  }

  it('makes the artifact up front, posts its card and updates it as versions arrive', async () => {
    const w = await creationWorld(['plugins', 'artifacts'])
    const res = await w.wang.post<MessageDto>(`/api/groups/${w.g.id}/creations`, w.req)
    expect(res.status).toBe(200)
    const [a] = await t.db.select().from(artifacts)
    expect(a).toMatchObject({
      groupId: w.g.id,
      title: '麓客活动报名',
      botId: w.bot.id,
      designSystemId: 'luke-plus',
    })
    expect(a!.dir).toMatch(/^design\/app-screens-[a-z0-9]{4}$/)
    expect(a!.pluginVersionId).not.toBeNull()
    for (const s of [`${a!.dir}/`, 'gg-artifact.json', 'screens/<id>.html', '不需要 preview_static'])
      expect(res.body.body).toContain(s)
    expect(res.body.body).not.toContain('design/<slug>/index.html')

    const [card] = await t.db.select().from(messages).where(eq(messages.id, a!.messageId!))
    expect(card).toMatchObject({ kind: 'event', body: '产物「麓客活动报名」' })
    expect((card!.meta as { card: ArtifactCard }).card).toEqual({
      type: 'artifact',
      artifactId: a!.id,
      title: '麓客活动报名',
      versionN: null,
      status: 'generating',
      thumbnailUrl: null,
      issueCount: 0,
    })

    const start = (await w.next()) as RunStart
    expect(start.artifacts).toEqual([{ id: a!.id, dir: a!.dir, headVersionId: null, digest: null }])
    const v1 = (await w.submit(start.runId, a!.id, L1)).json() as ArtifactSubmitRes
    expect(v1).toMatchObject({ n: 1, head: true })
    const [updated] = await t.db.select().from(messages).where(eq(messages.id, card!.id))
    expect((updated!.meta as { card: ArtifactCard }).card).toMatchObject({
      versionN: 1,
      status: 'ready',
      issueCount: 0,
    })
    w.ws.close()
  })

  it('keeps the old instructions for a daemon without the artifacts feature', async () => {
    const w = await creationWorld(['plugins'])
    const res = await w.wang.post<MessageDto>(`/api/groups/${w.g.id}/creations`, w.req)
    expect(res.status).toBe(200)
    expect(res.body.body).toContain('preview_static')
    expect(await t.db.select().from(artifacts)).toEqual([])
    const start = (await w.next()) as RunStart
    expect(start.artifacts).toEqual([])
    w.ws.close()
  })
})
