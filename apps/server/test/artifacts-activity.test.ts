import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactActivityDto, ArtifactDto, WebEvent } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runs } from '../src/db/schema.js'
import { ACTIVITY_IDLE_MS } from '../src/modules/artifacts/activity.js'
import { refreshRunArtifacts } from '../src/modules/artifacts/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld } from './support/artifacts.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => {
  vi.useRealTimers()
  return t.close()
})

async function setup() {
  const w = await artifactWorld(t)
  const a = await w.artifact()
  const prev = await w.run([a.id], { status: 'succeeded' })
  await w.submit(prev.id, a.id, {
    'gg-artifact.json': JSON.stringify({
      title: 't',
      device: 'mobile',
      entry: 'home',
      screens: [{ id: 'home', title: '首页', file: 'screens/home.html' }],
    }),
    'screens/home.html': '<p>',
  })
  const current = await w.run([a.id])
  const sent: { to: string[]; e: WebEvent }[] = []
  vi.spyOn(t.ctx.bus, 'publish').mockImplementation((to, e) => {
    sent.push({ to: [...to], e: e as WebEvent })
  })
  const report = (paths: string[], o: { machine?: string; runId?: string; artifactId?: string } = {}) =>
    t.ctx.hub.emit('message', o.machine ?? w.A.machine.id, {
      t: 'artifact.activity',
      runId: o.runId ?? current.id,
      artifactId: o.artifactId ?? a.id,
      paths,
    })
  const events = () =>
    sent.flatMap((s) => (s.e.t === 'artifact.activity' ? [{ to: s.to, ...s.e }] : [])) as {
      to: string[]
      artifactId: string
      activity: ArtifactActivityDto[]
    }[]
  const detail = async () => {
    const cookie = await t.seed.cookie(w.li.id)
    return (
      await t.app.inject({ method: 'GET', url: `/api/artifacts/${a.id}`, headers: { cookie } })
    ).json() as ArtifactDto
  }
  return { ...w, a, current, report, events, detail }
}

describe('artifact.activity (plan 原型协作 P1)', () => {
  it('tells the group which screens a run is writing, and anything else as global', async () => {
    const s = await setup()
    s.report(['screens/home.html', 'screens/done.html'])
    await vi.waitFor(() => expect(s.events()).toHaveLength(1))
    const [first] = s.events()
    expect(first!.artifactId).toBe(s.a.id)
    expect(first!.to.sort()).toEqual([s.wang.id, s.li.id].sort())
    expect(first!.activity).toEqual([
      {
        runId: s.current.id,
        botId: s.bot.id,
        title: '活动报名',
        screens: [
          { id: 'home', title: '首页' },
          { id: 'done', title: 'done' },
        ],
        global: false,
      },
    ])
    s.report(['screens/home.html', 'tokens.css', 'rules/home.md'])
    await vi.waitFor(() => expect(s.events()).toHaveLength(2))
    expect(s.events()[1]!.activity[0]).toMatchObject({
      screens: [{ id: 'home', title: '首页' }],
      global: true,
    })
    // A reload gets it with the artifact.
    expect((await s.detail()).activity).toEqual(s.events()[1]!.activity)
  })

  it('ignores reports from another machine, of another run, or of an artifact the run was not sent', async () => {
    const s = await setup()
    const other = await s.artifact()
    s.report(['screens/home.html'], { machine: s.B.machine.id })
    s.report(['screens/home.html'], { artifactId: other.id })
    s.report(['screens/home.html'], { runId: '00000000-0000-4000-8000-000000000000' })
    const done = await s.run([s.a.id], { status: 'succeeded' })
    s.report(['screens/home.html'], { runId: done.id })
    s.report(['screens/home.html'])
    await vi.waitFor(() => expect(s.events()).toHaveLength(1))
    expect(s.events()[0]!.activity.map((x) => x.runId)).toEqual([s.current.id])
  })

  it('keeps a private artifact’s activity to the members who may open it', async () => {
    const s = await setup()
    const hidden = await s.artifact({ visibility: 'private', createdBy: s.wang.id })
    await t.db
      .update(runs)
      .set({ artifacts: [s.a.id, hidden.id] })
      .where(eq(runs.id, s.current.id))
    s.report(['screens/home.html'], { artifactId: hidden.id })
    await vi.waitFor(() => expect(s.events()).toHaveLength(1))
    expect(s.events()[0]!.to).toEqual([s.wang.id])
  })

  it('clears when the run ends, its machine goes offline, or nothing is written for a while', async () => {
    const s = await setup()
    s.report(['screens/home.html'])
    await vi.waitFor(() => expect(s.events()).toHaveLength(1))
    await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, s.current.id))
    await refreshRunArtifacts(t.ctx, [{ ...s.current, status: 'completed' }])
    await vi.waitFor(() => expect(s.events().at(-1)?.activity).toEqual([]))

    const live = await s.run([s.a.id])
    s.report(['screens/home.html'], { runId: live.id })
    await vi.waitFor(() => expect(s.events().at(-1)?.activity).toHaveLength(1))
    t.ctx.hub.emit('offline', s.A.machine.id)
    await vi.waitFor(() => expect(s.events().at(-1)?.activity).toEqual([]))

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    s.report(['screens/done.html'], { runId: live.id })
    await vi.waitFor(() => expect(s.events().at(-1)?.activity).toHaveLength(1))
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1)
    await vi.waitFor(() => expect(s.events().at(-1)?.activity).toEqual([]))
    expect((await s.detail()).activity ?? []).toEqual([])
  })
})
