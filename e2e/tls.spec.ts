/**
 * Opt-in (plan D18): server over HTTPS/WSS with a self-signed dev certificate; the daemon binds without pinning.
 * Run: GONGGONG_E2E_TLS=1 pnpm exec playwright test -c e2e/tls.config.ts
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, request, test } from '@playwright/test'
import { bindManaged, buildDaemon, machine, ROOT } from './helpers'

test.skip(process.env.GONGGONG_E2E_TLS !== '1', 'set GONGGONG_E2E_TLS=1 to run the TLS path')
test.beforeAll(buildDaemon)

test('tls: daemon binds and runs over HTTPS/WSS with a self-signed certificate', async () => {
  test.setTimeout(5 * 60_000)
  const dir = mkdtempSync(join(tmpdir(), 'gonggong-e2e-tls-'))
  execFileSync('bash', ['scripts/dev-cert.sh', dir], { cwd: ROOT })
  execFileSync('bash', ['scripts/pg.sh', 'reset', 'gonggong_e2e_tls'], { cwd: ROOT })
  const port = 8792
  const base = `https://127.0.0.1:${port}`
  const srv: ChildProcess = spawn('pnpm', ['--filter', '@gonggong/server', 'start'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      GONGGONG_DB: 'gonggong_e2e_tls',
      GONGGONG_ADMIN_PASSWORD: 'admin-init-pass',
      GONGGONG_TLS_CERT: join(dir, 'cert.pem'),
      GONGGONG_TLS_KEY: join(dir, 'key.pem'),
    },
    stdio: 'inherit',
  })
  const api = await request.newContext({ baseURL: base, ignoreHTTPSErrors: true })
  const m = machine(base)
  try {
    await expect
      .poll(async () => (await api.get('/api/health').catch(() => null))?.ok(), { timeout: 30_000 })
      .toBe(true)
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow()

    await api.post('/api/auth/login', { data: { account: 'admin', password: 'admin-init-pass' } })
    await api.post('/api/auth/password', {
      data: { oldPassword: 'admin-init-pass', newPassword: 'admin-pass-2' },
    })
    const me = await (await api.get('/api/me')).json()
    const { code } = await (await api.post('/api/bind-codes')).json()
    expect(m.login(code)).toContain('绑定成功')

    m.start()
    const machineOnline = async () => (await (await api.get('/api/machines')).json())[0]?.online
    await expect.poll(machineOnline, { timeout: 30_000 }).toBe(true)
    const machineId = (await (await api.get('/api/machines')).json())[0].id
    const bot = await (
      await api.post('/api/bots', {
        data: {
          name: 'TLS Claude',
          ownerId: me.id,
          agentKind: 'claude',
          avatar: 'role-no',
          machineId,
          systemPrompt: '',
        },
      })
    ).json()
    const group = await (
      await api.post('/api/groups', { data: { name: 'TLS', kind: 'dm', botIds: [bot.id] } })
    ).json()
    await bindManaged(api, group.id, [bot.id])
    await api.post(`/api/groups/${group.id}/messages`, {
      data: { body: '@TLS Claude 不要调用任何工具，只回复 pong-tls', clientId: crypto.randomUUID() },
    })
    const timeline = async () => (await api.get(`/api/groups/${group.id}/timeline`)).json()
    await expect
      .poll(async () => (await timeline()).runs[0]?.status, { timeout: 3 * 60_000 })
      .toBe('completed')
    expect((await timeline()).messages.some((x: { body: string }) => x.body.includes('pong-tls'))).toBe(true)
  } finally {
    m.stop()
    await api.dispose()
    srv.kill()
  }
})
