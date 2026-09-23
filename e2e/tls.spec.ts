/**
 * Opt-in (plan D18): server over HTTPS/WSS with a dev certificate, daemon pinning it.
 * Run: AIWS_E2E_TLS=1 pnpm exec playwright test -c e2e/tls.config.ts
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, request, test } from '@playwright/test'
import { AIWS_BIN, buildDaemon, machine, ROOT } from './helpers'

test.skip(process.env.AIWS_E2E_TLS !== '1', 'set AIWS_E2E_TLS=1 to run the TLS path')
test.beforeAll(buildDaemon)

test('tls: daemon pins the server certificate over HTTPS/WSS and refuses a changed one', async () => {
  test.setTimeout(5 * 60_000)
  const dir = mkdtempSync(join(tmpdir(), 'aiws-e2e-tls-'))
  const out = execFileSync('bash', ['scripts/dev-cert.sh', dir], { cwd: ROOT, encoding: 'utf8' })
  const fingerprint = out.match(/^sha256:(.+)$/m)![1]!
  execFileSync('bash', ['scripts/pg.sh', 'reset', 'aiws_e2e_tls'], { cwd: ROOT })
  const port = 8792
  const base = `https://127.0.0.1:${port}`
  const srv: ChildProcess = spawn('pnpm', ['--filter', '@aiws/server', 'start'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      AIWS_DB: 'aiws_e2e_tls',
      AIWS_ADMIN_PASSWORD: 'admin-init-pass',
      AIWS_TLS_CERT: join(dir, 'cert.pem'),
      AIWS_TLS_KEY: join(dir, 'key.pem'),
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
    // Trust on first use: the pinned fingerprint is printed and recorded.
    expect(m.login(code)).toContain(`sha256:${fingerprint}`)
    const configPath = join(m.home, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(config.certSha256).toBe(fingerprint)

    m.start()
    const machineOnline = async () => (await (await api.get('/api/machines')).json())[0]?.online
    await expect.poll(machineOnline, { timeout: 30_000 }).toBe(true)
    const machineId = (await (await api.get('/api/machines')).json())[0].id
    const bot = await (
      await api.post('/api/bots', {
        data: { name: 'TLS Claude', ownerId: me.id, agentKind: 'claude', machineId, systemPrompt: '' },
      })
    ).json()
    const group = await (
      await api.post('/api/groups', { data: { name: 'TLS', kind: 'dm', botIds: [bot.id] } })
    ).json()
    await api.post(`/api/groups/${group.id}/messages`, {
      data: { body: '@TLS Claude 不要调用任何工具，只回复 pong-tls', clientId: crypto.randomUUID() },
    })
    const timeline = async () => (await api.get(`/api/groups/${group.id}/timeline`)).json()
    await expect
      .poll(async () => (await timeline()).runs[0]?.status, { timeout: 3 * 60_000 })
      .toBe('completed')
    expect((await timeline()).messages.some((x: { body: string }) => x.body.includes('pong-tls'))).toBe(true)

    // A different certificate (here: a tampered pin) is refused by every connection.
    m.stop()
    await m.exited()
    await expect.poll(machineOnline, { timeout: 30_000 }).toBe(false)
    const wrong = `${fingerprint.startsWith('00') ? 'FF' : '00'}${fingerprint.slice(2)}`
    writeFileSync(configPath, JSON.stringify({ ...config, certSha256: wrong }))
    expect(() =>
      execFileSync(AIWS_BIN, ['bots'], { env: { ...process.env, AIWS_HOME: m.home }, stdio: 'pipe' }),
    ).toThrow(/证书指纹不匹配/)
    m.start()
    await new Promise((r) => setTimeout(r, 8_000))
    expect(await machineOnline()).toBe(false)
  } finally {
    m.stop()
    await api.dispose()
    srv.kill()
  }
})
