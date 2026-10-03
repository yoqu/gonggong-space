import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, request, test } from '@playwright/test'
import { bindManaged, buildDaemon, machine, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

async function asAdmin(page: Page) {
  const ctx = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5190' })
  const admin = await ctx.newPage()
  await admin.request.post('/api/auth/login', { data: { account: 'admin', password: 'admin-pass-2' } })
  return { admin, close: () => ctx.close() }
}

test('disabling an account revokes its sessions and daemon, wipes managed workspaces and removes its bots', async ({
  page,
}) => {
  test.setTimeout(8 * 60_000)
  const { m, api } = await memberWithMachine(page, 'gone1')
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: '将停用 Claude',
    ownerId: me.id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  const { admin, close } = await asAdmin(page)
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '停用',
      kind: 'dm',
      botIds: [bot.id],
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await say(page, '@将停用 Claude 在当前目录创建 keep.txt，只回复 ok')
    await expect(page.getByTestId('run-card').last()).toHaveAttribute('data-status', 'completed', {
      timeout: 4 * 60_000,
    })
    expect(m.find('keep.txt')).toBeTruthy()

    await admin.goto('/admin/users')
    const row = admin.getByRole('row').filter({ hasText: 'gone1' })
    await row.getByRole('button', { name: '操作' }).click()
    await admin.getByRole('menuitem', { name: '停用…' }).click()
    await admin.getByRole('alertdialog').getByRole('button', { name: '停用' }).click()
    await expect(row).toContainText('已停用')

    // Web session revoked; the daemon is rejected, exits and wipes its managed workspaces.
    await page.reload()
    await expect(page).toHaveURL(/\/login(\?next=|$)/)
    expect(await m.exited()).not.toBe(0)
    expect(m.find('keep.txt')).toBeUndefined()
    const bots = await admin.request.get('/api/bots')
    expect(((await bots.json()) as { id: string }[]).some((b) => b.id === bot.id)).toBe(false)

    await admin.goto('/admin/audit')
    await expect(admin.getByTestId('audit-list')).toContainText('停用账号 gone1')
  } finally {
    m.stop()
    await close()
  }
})

test('group settings: name + notice, group params, mute/pin, leaving and dissolving', async ({ page }) => {
  const { api } = await memberWithMachine(page, 'set1')
  const group = await api.call<{ id: string }>('post', '/api/groups', { name: '设置前', kind: 'group' })
  await page.goto(`/g/${group.id}`)
  await page.getByRole('button', { name: '群设置' }).click()
  await page.getByRole('button', { name: /群名称与公告/ }).click()
  await page.getByLabel('群名称').fill('设置后')
  await page.getByLabel(/群公告/).fill('每个 Bot 独立分支，走 PR')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByTestId('group-notice')).toContainText('每个 Bot 独立分支，走 PR')
  await expect(page.getByRole('heading', { name: '设置后' })).toBeVisible()

  // Saving returns the inspector to its root view; it stays open.
  const settings = page.getByRole('complementary', { name: '群设置' })
  await settings.getByRole('button', { name: /群级参数/ }).click()
  await page.getByLabel('接力链长上限（跳）').fill('1')
  await page.getByRole('button', { name: '保存' }).click()
  const hops = async () =>
    (await api.call<{ chainMaxHops: number }>('get', `/api/groups/${group.id}/params`)).chainMaxHops
  await expect.poll(hops).toBe(1)

  // The switch input is visually hidden; a pointer toggles it through its track (the wrapping label).
  const toggle = (name: string) => settings.getByRole('switch', { name }).locator('xpath=..').click()
  await toggle('置顶群')
  await toggle('消息免打扰')
  await expect(settings.getByRole('switch', { name: '消息免打扰' })).toBeChecked()
  await expect(page.getByTestId(`group-item-${group.id}`).getByLabel('已置顶')).toBeVisible()
  await page.getByRole('button', { name: '解散群' }).click()
  await page.getByRole('button', { name: '确认解散' }).click()
  await expect(page.getByTestId(`group-item-${group.id}`)).toHaveCount(0)
})

test('ops: a run survives a server outage; a daemon restart reconciles the lost run; old protocols are refused', async () => {
  test.setTimeout(10 * 60_000)
  // A private server instance this test can stop and restart.
  execFileSync('bash', ['scripts/pg.sh', 'reset', 'gonggong_e2e_ops'], { cwd: ROOT })
  const port = 8791
  const base = `http://127.0.0.1:${port}`
  let srv: ChildProcess | undefined
  const startServer = async () => {
    srv = spawn('pnpm', ['--filter', '@gonggong/server', 'start'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        GONGGONG_DB: 'gonggong_e2e_ops',
        GONGGONG_ADMIN_PASSWORD: 'admin-init-pass',
      },
      stdio: 'inherit',
    })
    await expect
      .poll(async () => (await fetch(`${base}/api/health`).catch(() => null))?.ok, { timeout: 30_000 })
      .toBe(true)
  }
  const stopServer = () =>
    new Promise<void>((r) => {
      srv?.on('exit', () => r())
      srv?.kill()
    })
  await startServer()
  const api = await request.newContext({ baseURL: base })
  const m = machine(base)
  try {
    await api.post('/api/auth/login', { data: { account: 'admin', password: 'admin-init-pass' } })
    await api.post('/api/auth/password', {
      data: { oldPassword: 'admin-init-pass', newPassword: 'admin-pass-2' },
    })
    const me = await (await api.get('/api/me')).json()
    const { code } = await (await api.post('/api/bind-codes')).json()
    m.login(code)
    m.start()
    const machineId = (await (await api.get('/api/machines')).json())[0].id
    const bot = await (
      await api.post('/api/bots', {
        data: {
          name: '运维 Claude',
          ownerId: me.id,
          agentKind: 'claude',
          avatar: 'role-no',
          machineId,
          systemPrompt: '',
        },
      })
    ).json()
    await api.patch(`/api/bots/${bot.id}`, {
      data: { tier: 'full', triggerScope: 'list', triggerList: [me.id] },
    })
    const group = await (
      await api.post('/api/groups', { data: { name: '运维', kind: 'dm', botIds: [bot.id] } })
    ).json()
    await bindManaged(api, group.id, [bot.id])
    const post = (body: string) =>
      api.post(`/api/groups/${group.id}/messages`, { data: { body, clientId: crypto.randomUUID() } })
    const runs = async () =>
      (await (await api.get(`/api/groups/${group.id}/timeline`)).json()).runs as {
        id: string
        status: string
        step: string
      }[]

    // Outage mid-run: the daemon keeps going, reconnects and the run completes on the server.
    await post('@运维 Claude 用 Bash 执行 node -e "setTimeout(()=>{},25000)"，结束后只回复 survived')
    await expect.poll(async () => (await runs())[0]?.status, { timeout: 3 * 60_000 }).toBe('running')
    await stopServer()
    await new Promise((r) => setTimeout(r, 8_000))
    await startServer()
    await expect.poll(async () => (await runs())[0]?.status, { timeout: 4 * 60_000 }).toBe('completed')
    const tl = await (await api.get(`/api/groups/${group.id}/timeline`)).json()
    expect(tl.messages.some((x: { body: string }) => x.body.includes('survived'))).toBe(true)

    // Daemon restart mid-run: the lost run is reconciled as interrupted on reconnect.
    await post('@运维 Claude 用 Bash 执行 node -e "setTimeout(()=>{},60000)"，结束后只回复 never')
    await expect.poll(async () => (await runs())[1]?.status, { timeout: 3 * 60_000 }).toBe('running')
    m.stop()
    await m.exited()
    m.start()
    await expect.poll(async () => (await runs())[1]?.status, { timeout: 60_000 }).toBe('interrupted')
    expect((await runs())[1]?.step).toContain('daemon 重启')

    // An old protocol is refused with upgrade info.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/daemon`)
    const reply = await new Promise<Record<string, unknown>>((resolve) => {
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            t: 'hello',
            protocol: 0,
            token: 'x',
            daemonVersion: '0.0.1',
            machine: { name: 'old', os: 'macos', arch: 'aarch64' },
            agents: [],
          }),
        )
      ws.onmessage = (e) => resolve(JSON.parse(String(e.data)))
    })
    expect(reply).toMatchObject({ t: 'reject', reason: 'protocol' })
    expect(existsSync(join(m.home, 'config.json'))).toBe(true)
  } finally {
    m.stop()
    await api.dispose()
    await stopServer()
  }
})
