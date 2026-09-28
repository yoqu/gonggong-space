import { request } from 'node:http'
import type { AuditDto, CreatedPreviewShare, PreviewShareDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, groupMembers, previewShares, previews } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
let clock = new Date('2026-09-27T10:00:00Z').getTime()
beforeEach(async () => {
  clock = new Date('2026-09-27T10:00:00Z').getTime()
  t = await createTestApp({ now: () => new Date(clock) })
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: null }
})
afterEach(() => t.close())

const HOST = 'k3m9q2x7.preview.test'
type Res = { status: number; headers: Record<string, string | string[] | undefined>; text: string }
function get(path: string, headers: Record<string, string> = {}) {
  const port = Number(new URL(t.url('/')).port)
  return new Promise<Res>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: HOST, ...headers } }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '李建国' })
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
  const { machine } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, machineId: machine.id })
  const group = await t.seed.group({
    createdBy: owner.id,
    name: '支付重构',
    memberIds: [member.id],
    botIds: [bot.id],
  })
  // The group creator is its admin; make the owner a plain member so only bot ownership counts.
  await t.db.update(groupMembers).set({ isAdmin: false }).where(eq(groupMembers.userId, owner.id))
  const [preview] = await t.db
    .insert(previews)
    .values({
      slug: 'k3m9q2x7',
      kind: 'http',
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      port: 5173,
      path: '/home',
      title: '首页',
    })
    .returning()
  return {
    preview: preview!,
    owner: client(t, await t.seed.cookie(owner.id)),
    member: client(t, await t.seed.cookie(member.id)),
    admin: client(t, await t.seed.cookie(admin.id)),
  }
}

async function share(w: Awaited<ReturnType<typeof world>>, days = 3) {
  const res = await w.owner.post<CreatedPreviewShare>(`/api/previews/${w.preview.id}/shares`, { days })
  expect(res.status).toBe(200)
  return res.body
}

const visit = async (url: string) => get(new URL(url).pathname)

describe('public preview links', () => {
  it('lets anyone with the link in until it expires, counting visits', async () => {
    const w = await world()
    const { share: s, url } = await share(w, 3)
    expect(url).toMatch(new RegExp(`^http://${HOST}/__gg/share/ps_`))
    expect(s).toMatchObject({
      previewTitle: '首页',
      groupName: '支付重构',
      createdByName: '王磊',
      visitCount: 0,
      active: true,
    })
    expect(Date.parse(s.expiresAt)).toBe(clock + 3 * 86400_000)

    const first = await visit(url)
    expect(first.status).toBe(302)
    expect(first.headers.location).toBe('/home')
    const cookie = (first.headers['set-cookie'] as string[])[0]!.split(';')[0]!
    expect((await get('/', { cookie })).status).toBe(502)
    const [row] = await t.db.select().from(previewShares).where(eq(previewShares.id, s.id))
    expect(row?.visitCount).toBe(1)
    const actions = (await t.db.select().from(auditLogs)).map((a) => `${a.category}:${a.action}`)
    expect(actions).toEqual(['preview:share.create', 'preview:share.visit'])

    clock += 3 * 86400_000 + 1
    expect((await visit(url)).status).toBe(410)
    expect((await get('/', { cookie })).status).toBe(401)
  })

  it('stops a revoked link and the visitors it already let in', async () => {
    const w = await world()
    const { share: s, url } = await share(w)
    const cookie = ((await visit(url)).headers['set-cookie'] as string[])[0]!.split(';')[0]!
    expect((await w.member.post(`/api/preview-shares/${s.id}/revoke`)).status).toBe(403)
    expect((await w.owner.post(`/api/preview-shares/${s.id}/revoke`)).status).toBe(204)
    expect((await visit(url)).status).toBe(410)
    expect((await get('/', { cookie })).status).toBe(401)
  })

  it('is created by the bot owner or a group admin only, within previewShareMaxDays', async () => {
    const w = await world()
    expect((await w.member.post(`/api/previews/${w.preview.id}/shares`, { days: 1 })).status).toBe(403)
    expect((await w.owner.post(`/api/previews/${w.preview.id}/shares`, { days: 31 })).status).toBe(400)
    await share(w, 1)
    const list = await w.owner.get<PreviewShareDto[]>(`/api/previews/${w.preview.id}/shares`)
    expect(list.body).toHaveLength(1)
    expect((await w.member.get(`/api/previews/${w.preview.id}/shares`)).status).toBe(403)
  })

  it('is managed by sysadmins across all groups', async () => {
    const w = await world()
    const { share: s } = await share(w)
    expect((await w.owner.get('/api/admin/preview-shares')).status).toBe(403)
    const all = await w.admin.get<PreviewShareDto[]>('/api/admin/preview-shares')
    expect(all.body.map((x) => x.id)).toEqual([s.id])

    const later = new Date(clock + 20 * 86400_000).toISOString()
    const extended = await w.admin.patch<PreviewShareDto>(`/api/admin/preview-shares/${s.id}`, {
      expiresAt: later,
    })
    expect(extended.body.expiresAt).toBe(later)
    const tooLate = new Date(clock + 40 * 86400_000).toISOString()
    expect((await w.admin.patch(`/api/admin/preview-shares/${s.id}`, { expiresAt: tooLate })).status).toBe(
      400,
    )
    expect((await w.admin.post(`/api/preview-shares/${s.id}/revoke`)).status).toBe(204)
    const log = await w.admin.get<AuditDto[]>('/api/admin/audit?category=preview')
    expect(log.body.map((a) => a.summary)).toEqual([
      '收回预览「首页」的公开链接 · 支付重构',
      '预览「首页」的公开链接有效期改到 2026-10-17 10:00 · 支付重构',
      '生成预览「首页」的公开链接，有效 3 天 · 支付重构',
    ])
    const after = await w.admin.get<PreviewShareDto[]>('/api/admin/preview-shares')
    expect(after.body[0]).toMatchObject({ active: false })
    expect(after.body[0]!.revokedAt).not.toBeNull()
  })
})
