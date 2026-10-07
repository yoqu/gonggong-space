import type { AuthOptionsDto, FeishuAppView, SystemParams } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuApps, users } from '../src/db/schema.js'
import { BOT_CALLBACKS, BOT_EVENTS } from '../src/modules/feishu/client.js'
import { onFeishu, reloadFeishu } from '../src/modules/feishu/gateway.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = { appId: 'cli_main01', appSecret: 'main-secret' }

async function sysadmin() {
  const admin = await t.seed.user({ role: 'sysadmin' })
  return { admin, http: client(t, await t.seed.cookie(admin.id)) }
}

describe('main app (管理后台 · 飞书)', () => {
  it('is configured by the sysadmin after Feishu accepts the credentials; the secret never comes back', async () => {
    const { http } = await sysadmin()
    expect((await http.get<FeishuAppView>('/api/admin/feishu')).body).toEqual({ app: null })

    t.feishu.invalid.add('cli_bad')
    const refused = await http.put('/api/admin/feishu', { appId: 'cli_bad', appSecret: 'x' })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe('invalid')

    const saved = await http.put<FeishuAppView>('/api/admin/feishu', MAIN)
    expect(saved.status).toBe(200)
    expect(saved.body.app).toMatchObject({ appId: 'cli_main01', status: 'connected', error: null })
    expect(JSON.stringify(saved.body)).not.toContain('main-secret')
    const [row] = await t.db.select().from(feishuApps)
    expect(row).toMatchObject({ kind: 'main', teamId: null, botId: null })
    expect(row!.appSecret).not.toContain('main-secret')
    expect(t.feishu.connected('cli_main01')).toBe(true)
  })

  it('applies the redirect URL to an existing app bound by hand, or says why it could not', async () => {
    const { http } = await sysadmin()
    const unset = await http.put<FeishuAppView>('/api/admin/feishu', MAIN)
    expect(unset.body.app?.configError).toMatch(/对外地址/)

    await http.put('/api/admin/params', { publicUrl: 'https://gg.example.com' })
    t.feishu.configureError = 'scope not granted'
    const refused = await http.put<FeishuAppView>('/api/admin/feishu', MAIN)
    expect(refused.body.app?.configError).toContain('scope not granted')

    t.feishu.configureError = null
    const ok = await http.put<FeishuAppView>('/api/admin/feishu', MAIN)
    expect(ok.body.app?.configError).toBeNull()
    expect(t.feishu.configs).toEqual([
      { appId: 'cli_main01', config: { redirectUrls: ['https://gg.example.com/api/auth/feishu/callback'] } },
    ])
  })

  it('rejects an App ID that is not a Feishu app id', async () => {
    const { http } = await sysadmin()
    const res = await http.put('/api/admin/feishu', { appId: 'main', appSecret: 's' })
    expect(res.status).toBe(400)
  })

  it('reconnects when the credentials change and disconnects when removed', async () => {
    const { http } = await sysadmin()
    await http.put('/api/admin/feishu', MAIN)
    await http.put('/api/admin/feishu', { appId: 'cli_main02', appSecret: 's2' })
    expect(t.feishu.connected('cli_main01')).toBe(false)
    expect(t.feishu.connected('cli_main02')).toBe(true)
    expect(await t.db.select().from(feishuApps)).toHaveLength(1)

    expect((await http.del('/api/admin/feishu')).status).toBe(204)
    expect(t.feishu.connected('cli_main02')).toBe(false)
    expect((await http.get<FeishuAppView>('/api/admin/feishu')).body.app).toBeNull()
  })

  it('shows the connection state reported by the long connection', async () => {
    const { http } = await sysadmin()
    await http.put('/api/admin/feishu', MAIN)
    t.feishu.setStatus('cli_main01', 'error', 'endpoint unreachable')
    await expect
      .poll(async () => (await http.get<FeishuAppView>('/api/admin/feishu')).body.app)
      .toMatchObject({ status: 'error', error: 'endpoint unreachable' })
  })

  it('is sysadmin only', async () => {
    const member = await t.seed.user()
    const http = client(t, await t.seed.cookie(member.id))
    expect((await http.get('/api/admin/feishu')).status).toBe(403)
    expect((await http.put('/api/admin/feishu', MAIN)).status).toBe(403)
  })

  it('turns on 飞书登录 in the login options once 对外地址 is set too', async () => {
    const { http } = await sysadmin()
    const anon = () => t.app.inject({ url: '/api/auth/options' }).then((r) => r.json<AuthOptionsDto>())
    expect((await anon()).feishuLogin).toBe(false)
    await http.put('/api/admin/feishu', MAIN)
    expect((await anon()).feishuLogin).toBe(false)
    await http.put('/api/admin/params', { publicUrl: 'https://gg.example.com' })
    expect((await anon()).feishuLogin).toBe(true)
  })
})

describe('bot app', () => {
  it('is bound by the bot owner, verified and connected', async () => {
    const owner = await t.seed.user()
    const bot = await t.seed.bot({ ownerId: owner.id })
    const http = client(t, await t.seed.cookie(owner.id))
    expect((await http.get<FeishuAppView>(`/api/bots/${bot.id}/feishu`)).body).toEqual({ app: null })

    const res = await http.put<FeishuAppView>(`/api/bots/${bot.id}/feishu`, {
      appId: 'cli_bot01',
      appSecret: 'bot-secret',
    })
    expect(res.status).toBe(200)
    expect(res.body.app).toMatchObject({ appId: 'cli_bot01', status: 'connected' })
    const [row] = await t.db.select().from(feishuApps)
    expect(row).toMatchObject({ kind: 'bot', botId: bot.id, teamId: bot.teamId })
    expect(t.feishu.connected('cli_bot01')).toBe(true)
    expect(t.feishu.configs).toEqual([
      { appId: 'cli_bot01', config: { websocket: { events: BOT_EVENTS, callbacks: BOT_CALLBACKS } } },
    ])

    expect((await http.del(`/api/bots/${bot.id}/feishu`)).status).toBe(204)
    expect(t.feishu.connected('cli_bot01')).toBe(false)
  })

  it('cannot be managed by other members', async () => {
    const owner = await t.seed.user()
    const other = await t.seed.user()
    const bot = await t.seed.bot({ ownerId: owner.id })
    const http = client(t, await t.seed.cookie(other.id))
    expect((await http.get(`/api/bots/${bot.id}/feishu`)).status).toBe(403)
    expect((await http.put(`/api/bots/${bot.id}/feishu`, { appId: 'cli_x', appSecret: 's' })).status).toBe(
      403,
    )
  })

  it('refuses an app already used by the main app or another bot', async () => {
    const { admin, http } = await sysadmin()
    await http.put('/api/admin/feishu', MAIN)
    const bot = await t.seed.bot({ ownerId: admin.id })
    const res = await http.put(`/api/bots/${bot.id}/feishu`, MAIN)
    expect(res.status).toBe(409)
  })

  it('disconnects when the bot is deleted', async () => {
    const owner = await t.seed.user()
    const bot = await t.seed.bot({ ownerId: owner.id })
    const http = client(t, await t.seed.cookie(owner.id))
    await http.put(`/api/bots/${bot.id}/feishu`, { appId: 'cli_bot01', appSecret: 's' })
    expect((await http.del(`/api/bots/${bot.id}`)).status).toBe(204)
    expect(t.feishu.connected('cli_bot01')).toBe(false)
  })
})

describe('gateway', () => {
  it('connects the apps already configured and hands inbound events to the registered handler', async () => {
    const { admin, http } = await sysadmin()
    await http.put('/api/admin/feishu', MAIN)
    const got: unknown[] = []
    onFeishu(t.ctx, 'im.message.receive_v1', async (app, e) => {
      got.push([app.kind, e.message.chat_id])
    })
    onFeishu(t.ctx, 'card.action.trigger', async () => ({ toast: { type: 'success', content: 'ok' } }))
    const user = t.feishu.user()
    await t.feishu.message('cli_main01', { chatId: 'oc_1', from: user, text: 'hi' }).done
    expect(got).toEqual([['main', 'oc_1']])
    expect(
      await t.feishu.cardAction('cli_main01', {
        messageId: 'om_x',
        chatId: 'oc_1',
        operator: user,
        value: {},
      }),
    ).toEqual({ toast: { type: 'success', content: 'ok' } })

    // A restart connects every stored app again.
    const bot = await t.seed.bot({ ownerId: admin.id })
    await http.put(`/api/bots/${bot.id}/feishu`, { appId: 'cli_bot01', appSecret: 's' })
    await reloadFeishu(t.ctx)
    expect(t.feishu.connected('cli_main01')).toBe(true)
    expect(t.feishu.connected('cli_bot01')).toBe(true)
  })
})

describe('feishuAutoSignup', () => {
  it('defaults to on and is a system param', async () => {
    const { http } = await sysadmin()
    expect((await http.get<SystemParams>('/api/admin/params')).body.feishuAutoSignup).toBe(true)
    expect(
      (await http.put<SystemParams>('/api/admin/params', { feishuAutoSignup: false })).body.feishuAutoSignup,
    ).toBe(false)
  })
})

describe('accounts without a password', () => {
  it('cannot log in with any password', async () => {
    const u = await t.seed.user({ account: 'feishu-only' })
    await t.db.update(users).set({ passwordHash: null }).where(eq(users.id, u.id))
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: 'feishu-only', password: 'password123' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('larkApi', () => {
  it('builds the OAuth authorization page of the main app', async () => {
    const { larkApi, USER_SCOPES } = await import('../src/modules/feishu/client.js')
    const url = new URL(
      larkApi().authorizeUrl('cli_main01', 'http://10.0.0.2:8787/api/auth/feishu/callback', 's1'),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cli_main01',
      response_type: 'code',
      redirect_uri: 'http://10.0.0.2:8787/api/auth/feishu/callback',
      scope: USER_SCOPES.join(' '),
      state: 's1',
    })
    expect(USER_SCOPES).toContain('offline_access')
  })
})
