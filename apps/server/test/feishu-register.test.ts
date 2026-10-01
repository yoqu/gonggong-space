import type { FeishuAppView, FeishuRegisterDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, feishuApps } from '../src/db/schema.js'
import { BOT_CALLBACKS, BOT_EVENTS, BOT_TENANT_SCOPES, USER_SCOPES } from '../src/modules/feishu/client.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function sysadmin() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  return client(t, await t.seed.cookie(admin.id))
}

const settled = (http: ReturnType<typeof client>, id: string) =>
  expect
    .poll(async () => (await http.get<FeishuRegisterDto>(`/api/feishu/register/${id}`)).body.status)
    .not.toBe('waiting')

describe('扫码创建 · main app', () => {
  it('returns the QR link, then saves and configures the app the admin confirmed', async () => {
    const http = await sysadmin()
    await http.put('/api/admin/params', { publicUrl: 'https://gg.example.com' })
    const start = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    expect(start.status).toBe(200)
    expect(start.body).toMatchObject({ status: 'waiting', app: null, error: null })
    expect(start.body.url).toMatch(/^https:\/\/feishu\.test\/register\//)
    expect(new Date(start.body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const reg = t.feishu.registrations[0]!
    expect(reg.name).toBe('共工')
    expect(reg.appId).toBeUndefined()
    expect(reg.scopes.user).toEqual(USER_SCOPES)
    expect(reg.scopes.tenant).toContain('im:chat.members:write_only')
    expect(reg.events).toEqual([])

    t.feishu.approve({ appId: 'cli_new01', appSecret: 'new-secret' })
    await settled(http, start.body.id)
    const done = (await http.get<FeishuRegisterDto>(`/api/feishu/register/${start.body.id}`)).body
    expect(done).toMatchObject({ status: 'succeeded', configError: null, app: { appId: 'cli_new01' } })
    expect(JSON.stringify(done)).not.toContain('new-secret')
    expect((await http.get<FeishuAppView>('/api/admin/feishu')).body.app?.appId).toBe('cli_new01')
    expect(t.feishu.connected('cli_new01')).toBe(true)
    expect(t.feishu.configs).toEqual([
      {
        appId: 'cli_new01',
        config: { redirectUrls: ['https://gg.example.com/api/auth/feishu/callback'] },
      },
    ])
    const audits = await t.db.select().from(auditLogs)
    expect(audits.map((a) => a.action)).toContain('feishu.app.save')
  })

  it('skips the redirect URL until 对外地址 is set, and says so', async () => {
    const http = await sysadmin()
    const start = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    t.feishu.approve({ appId: 'cli_new01', appSecret: 's' })
    await settled(http, start.body.id)
    const done = (await http.get<FeishuRegisterDto>(`/api/feishu/register/${start.body.id}`)).body
    expect(done.status).toBe('succeeded')
    expect(done.configError).toMatch(/对外地址/)
    expect(t.feishu.configs).toEqual([])
  })

  it('keeps the app but reports when Feishu refuses the dev config', async () => {
    const http = await sysadmin()
    await http.put('/api/admin/params', { publicUrl: 'https://gg.example.com' })
    t.feishu.configureError = 'no permission'
    const start = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    t.feishu.approve({ appId: 'cli_new01', appSecret: 's' })
    await settled(http, start.body.id)
    const done = (await http.get<FeishuRegisterDto>(`/api/feishu/register/${start.body.id}`)).body
    expect(done).toMatchObject({ status: 'succeeded', app: { appId: 'cli_new01' } })
    expect(done.configError).toContain('no permission')
  })

  it('ends as expired / failed when Feishu says so, saving nothing', async () => {
    const http = await sysadmin()
    const a = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    t.feishu.deny('expired_token')
    await settled(http, a.body.id)
    expect((await http.get<FeishuRegisterDto>(`/api/feishu/register/${a.body.id}`)).body.status).toBe(
      'expired',
    )

    const b = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    t.feishu.deny('access_denied')
    await settled(http, b.body.id)
    const failed = (await http.get<FeishuRegisterDto>(`/api/feishu/register/${b.body.id}`)).body
    expect(failed.status).toBe('failed')
    expect(failed.error).toBeTruthy()
    expect(await t.db.select().from(feishuApps)).toEqual([])
  })

  it('is cancelled by DELETE, and a new start replaces the pending one', async () => {
    const http = await sysadmin()
    const a = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    const b = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    await settled(http, a.body.id)
    expect((await http.get<FeishuRegisterDto>(`/api/feishu/register/${a.body.id}`)).body.status).toBe(
      'cancelled',
    )
    expect(t.feishu.registrations).toHaveLength(1)

    expect((await http.del(`/api/feishu/register/${b.body.id}`)).status).toBe(204)
    await settled(http, b.body.id)
    expect((await http.get<FeishuRegisterDto>(`/api/feishu/register/${b.body.id}`)).body.status).toBe(
      'cancelled',
    )
    expect(t.feishu.registrations).toHaveLength(0)
  })

  it('更新权限 targets the bound app instead of creating one', async () => {
    const http = await sysadmin()
    await http.put('/api/admin/feishu', { appId: 'cli_main01', appSecret: 's' })
    expect((await http.post('/api/admin/feishu/register', { update: true })).status).toBe(200)
    expect(t.feishu.registrations[0]!.appId).toBe('cli_main01')
  })

  it('更新权限 needs a bound app', async () => {
    const http = await sysadmin()
    expect((await http.post('/api/admin/feishu/register', { update: true })).status).toBe(400)
  })

  it('is sysadmin only; a session is visible to its starter only', async () => {
    const member = await t.seed.user()
    const other = client(t, await t.seed.cookie(member.id))
    expect((await other.post('/api/admin/feishu/register', {})).status).toBe(403)

    const http = await sysadmin()
    const start = await http.post<FeishuRegisterDto>('/api/admin/feishu/register', {})
    expect((await other.get(`/api/feishu/register/${start.body.id}`)).status).toBe(404)
    expect((await other.del(`/api/feishu/register/${start.body.id}`)).status).toBe(404)
  })
})

describe('扫码创建 · bot app', () => {
  it('creates the bot app with its scopes, then sets events and callbacks over the long connection', async () => {
    const owner = await t.seed.user()
    const bot = await t.seed.bot({ ownerId: owner.id, name: 'codex-bot' })
    const http = client(t, await t.seed.cookie(owner.id))
    const start = await http.post<FeishuRegisterDto>(`/api/bots/${bot.id}/feishu/register`, {})
    expect(start.status).toBe(200)
    const reg = t.feishu.registrations[0]!
    expect(reg).toMatchObject({
      name: 'codex-bot',
      scopes: { tenant: BOT_TENANT_SCOPES, user: [] },
      events: BOT_EVENTS,
      callbacks: BOT_CALLBACKS,
    })

    t.feishu.approve({ appId: 'cli_bot01', appSecret: 's' })
    await settled(http, start.body.id)
    expect((await http.get<FeishuRegisterDto>(`/api/feishu/register/${start.body.id}`)).body).toMatchObject({
      status: 'succeeded',
      configError: null,
    })
    expect((await http.get<FeishuAppView>(`/api/bots/${bot.id}/feishu`)).body.app?.appId).toBe('cli_bot01')
    expect(t.feishu.configs).toEqual([
      { appId: 'cli_bot01', config: { websocket: { events: BOT_EVENTS, callbacks: BOT_CALLBACKS } } },
    ])
  })

  it('cannot be started by other members', async () => {
    const owner = await t.seed.user()
    const bot = await t.seed.bot({ ownerId: owner.id })
    const other = client(t, await t.seed.cookie((await t.seed.user()).id))
    expect((await other.post(`/api/bots/${bot.id}/feishu/register`, {})).status).toBe(403)
  })
})
