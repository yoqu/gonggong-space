import type { FeishuWebAppDto, SystemParams } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const BASE = 'https://gg.example.com'

async function sysadmin(o: { main?: boolean; publicUrl?: string } = {}) {
  const admin = await t.seed.user({ role: 'sysadmin' })
  const http = client(t, await t.seed.cookie(admin.id))
  if (o.main !== false) await http.put('/api/admin/feishu', { appId: 'cli_main01', appSecret: 's' })
  await http.put('/api/admin/params', { publicUrl: o.publicUrl ?? BASE })
  return http
}

const enabled = async (http: Awaited<ReturnType<typeof sysadmin>>) =>
  (await http.get<SystemParams>('/api/admin/params')).body.feishuWebApp

describe('飞书网页应用 (main app opens 共工 inside Feishu)', () => {
  it('turning it on enables the web app on the main app, homepage = 对外地址, and submits a version', async () => {
    const http = await sysadmin()
    expect(await enabled(http)).toBe(false)
    const res = await http.put<FeishuWebAppDto>('/api/admin/feishu/web-app', { enabled: true })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: true, manual: false })
    expect(t.feishu.webApps).toEqual([{ appId: 'cli_main01', url: BASE }])
    expect(await enabled(http)).toBe(true)

    const off = await http.put<FeishuWebAppDto>('/api/admin/feishu/web-app', { enabled: false })
    expect(off.body).toEqual({ enabled: false, manual: false })
    expect(t.feishu.webApps).toHaveLength(1)
    expect(await enabled(http)).toBe(false)
  })

  it('needs the main app and the public URL', async () => {
    const noMain = await sysadmin({ main: false })
    expect((await noMain.put('/api/admin/feishu/web-app', { enabled: true })).status).toBe(400)
    await t.close()
    t = await createTestApp()
    const noUrl = await sysadmin({ publicUrl: '' })
    expect((await noUrl.put('/api/admin/feishu/web-app', { enabled: true })).status).toBe(400)
    expect(t.feishu.webApps).toEqual([])
  })

  it('an app Feishu will not modify is turned on for the admin to set up by hand; other refusals keep it off', async () => {
    const http = await sysadmin()
    t.feishu.webAppError = { code: 99991672, message: 'scope not granted' }
    const refused = await http.put<{ message: string }>('/api/admin/feishu/web-app', { enabled: true })
    expect(refused.status).toBe(400)
    expect(refused.body.message).toContain('scope not granted')
    expect(await enabled(http)).toBe(false)

    t.feishu.webAppError = { code: 210021, message: 'not modifiable' }
    const manual = await http.put<FeishuWebAppDto>('/api/admin/feishu/web-app', { enabled: true })
    expect(manual.body).toEqual({ enabled: true, manual: true })
    expect(await enabled(http)).toBe(true)
  })

  it('is for the sysadmin only', async () => {
    await sysadmin()
    const member = client(t, await t.seed.cookie((await t.seed.user()).id))
    expect((await member.put('/api/admin/feishu/web-app', { enabled: true })).status).toBe(403)
  })
})
