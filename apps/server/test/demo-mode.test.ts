import { request } from 'node:http'
import type { CreatedPreviewShare, MeDto, SystemParams } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupMembers, previews } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: null }
})
afterEach(() => t.close())

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
  const guest = await t.seed.user({ name: '访客' })
  const { machine } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id })
  const group = await t.seed.group({ createdBy: owner.id, memberIds: [guest.id], botIds: [bot.id] })
  const [preview] = await t.db
    .insert(previews)
    .values({
      slug: 'k3m9q2x7',
      kind: 'http',
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      port: 5173,
      title: '首页',
    })
    .returning()
  const http = {
    admin: client(t, await t.seed.cookie(admin.id)),
    owner: client(t, await t.seed.cookie(owner.id)),
    guest: client(t, await t.seed.cookie(guest.id)),
  }
  const demo = async (on: boolean) =>
    expect((await http.admin.put<SystemParams>('/api/admin/params', { demoMode: on })).body.demoMode).toBe(on)
  return { admin, owner, guest, machine, bot, group, preview: preview!, http, demo }
}

/** GET on the preview origin. */
const status = (path: string) =>
  new Promise<number>((resolve, reject) => {
    const port = Number(new URL(t.url('/')).port)
    const headers = { host: 'k3m9q2x7.preview.test' }
    request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume()
      resolve(res.statusCode!)
    })
      .on('error', reject)
      .end()
  })

describe('demo mode', () => {
  it('is off by default, switched by the sysadmin and reported to every account', async () => {
    const w = await world()
    expect((await w.http.owner.get<MeDto>('/api/me')).body.demoMode).toBe(false)
    expect((await w.http.owner.put('/api/admin/params', { demoMode: true })).status).toBe(403)
    await w.demo(true)
    expect((await w.http.owner.get<MeDto>('/api/me')).body.demoMode).toBe(true)
  })

  it('refuses new public preview links and stops the existing ones', async () => {
    const w = await world()
    const created = await w.http.owner.post<CreatedPreviewShare>(`/api/previews/${w.preview.id}/shares`, {
      days: 1,
    })
    expect(created.status).toBe(200)
    const path = new URL(created.body.url).pathname
    await w.demo(true)
    expect((await w.http.owner.post(`/api/previews/${w.preview.id}/shares`, { days: 1 })).status).toBe(403)
    expect(await status(path)).toBe(410)
  })

  it('keeps the live view watch-only', async () => {
    const w = await world()
    await t.db.update(previews).set({ kind: 'gui', port: null }).where(eq(previews.id, w.preview.id))
    await w.demo(true)
    for (const c of [w.http.owner, w.http.guest])
      expect((await c.post(`/api/previews/${w.preview.id}/control`, { action: 'request' })).status).toBe(403)
  })

  it('keeps accounts as they are, apart from a forced first password change', async () => {
    const w = await world()
    await w.demo(true)
    expect((await w.http.guest.patch('/api/me', { name: '改名' })).status).toBe(403)
    expect((await w.http.guest.patch('/api/me', { gitProtocol: 'ssh' })).status).toBe(200)
    const change = { oldPassword: 'password123', newPassword: 'password456' }
    expect((await w.http.guest.post('/api/auth/password', change)).status).toBe(403)
    expect((await w.http.admin.patch('/api/me', { name: '演示管理员' })).status).toBe(200)
    const fresh = await t.seed.user({ mustChangePassword: true })
    const freshHttp = client(t, await t.seed.cookie(fresh.id))
    expect((await freshHttp.post('/api/auth/password', change)).status).toBe(200)
  })

  it('leaves tearing down shared data to the sysadmin', async () => {
    const w = await world()
    const team = (await w.http.owner.get<MeDto>('/api/me')).body.teams[0]!
    await w.demo(true)
    const o = w.http.owner
    expect((await o.post(`/api/groups/${w.group.id}/dissolve`)).status).toBe(403)
    expect((await o.del(`/api/groups/${w.group.id}/members/${w.guest.id}`)).status).toBe(403)
    expect((await o.del(`/api/bots/${w.bot.id}`)).status).toBe(403)
    expect((await o.del(`/api/machines/${w.machine.id}`)).status).toBe(403)
    expect((await o.post(`/api/teams/${team.id}/archive`)).status).toBe(403)
    expect((await o.del(`/api/teams/${team.id}/members/${w.guest.id}`)).status).toBe(403)
    // Leaving is one's own business.
    expect((await w.http.guest.post(`/api/groups/${w.group.id}/leave`)).status).toBe(200)
    const members = await t.db.select().from(groupMembers).where(eq(groupMembers.groupId, w.group.id))
    expect(members.map((m) => m.userId)).toEqual([w.owner.id])
    expect((await w.http.admin.del(`/api/bots/${w.bot.id}`)).status).toBe(204)
  })
})
