import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { adminSession, bindManaged, buildDaemon, call, memberWithMachine, SERVER_LOG } from './helpers'

/**
 * Requires the integrated daemon terminal manager, terminal tunnel target and authenticated
 * /ws/terminals/:sessionId entry. Run with GONGGONG_E2E_TERMINAL=1 after main-agent wiring.
 */
test.skip(
  process.env.GONGGONG_E2E_TERMINAL !== '1',
  'set GONGGONG_E2E_TERMINAL=1 after the real daemon, terminal routes and WebSocket entry are integrated',
)
test.beforeAll(buildDaemon)

const botName = '真实终端 Bot'

async function run(page: Page, terminal: ReturnType<Page['getByRole']>, command: string, marker: string) {
  await terminal.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  await expect(terminal.locator('.xterm-rows')).toContainText(marker, { timeout: 20_000 })
}

async function attach(page: Page, groupId: string, botId: string, sessionId: string) {
  await page.goto(`/g/${groupId}`)
  await page.evaluate(
    ({ groupId, botId, sessionId }) => {
      const saved = JSON.parse(localStorage.getItem('gonggong.workbench') ?? '{}')
      saved = {
        ...saved,
        groupId,
        open: true,
        benches: {
          ...saved.benches,
          [groupId]: {
            tabs: [{ kind: 'terminal', botId, sessionId }],
            active: `terminal:${botId}`,
            used: { [`terminal:${botId}`]: Date.now() },
          },
        },
      }
      localStorage.setItem('gonggong.workbench', JSON.stringify(saved))
    },
    { groupId, botId, sessionId },
  )
  await page.reload()
  const terminal = page.getByRole('region', { name: '终端', exact: true })
  await expect(terminal).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })
  return terminal
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
    return false
  }
}

test('real shell: input/output, control bytes, page reconnect, ownership and process-tree termination', async ({
  page,
  browser,
}) => {
  test.setTimeout(5 * 60_000)
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `term${tag}`)
  const otherContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const other = await otherContext.newPage()
  let terminalId: string | undefined
  let cleanup: APIRequestContext = page.request
  try {
    const bot = await api.call<{ id: string }>('post', '/api/bots', {
      name: botName,
      ownerId: (await api.me()).id,
      agentKind: 'claude',
      machineId: await api.machineId(),
      systemPrompt: '',
    })
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '真实终端验收',
      kind: 'group',
      memberIds: [],
      botIds: [bot.id],
      repo: null,
    })
    m.start()
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await page.getByRole('button', { name: '工作台', exact: true }).click()
    await page.getByRole('button', { name: '新建标签页' }).first().click()
    await page.getByRole('menuitem', { name: botName, exact: true }).and(page.locator('[data-value^="terminal:"]')).click()
    const terminal = page.getByRole('region', { name: '终端', exact: true })
    await expect(terminal).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })

    const sessions = await api.call<{ sessionId: string; status: string }[]>(
      'get',
      `/api/groups/${group.id}/bots/${bot.id}/terminals`,
    )
    expect(sessions).toHaveLength(1)
    terminalId = sessions[0]!.sessionId

    await run(
      page,
      terminal,
      'printf \'GG_REAL tty=%s cwd=%s\\n\' "$(test -t 0 && printf yes)" "$PWD"',
      'GG_REAL tty=yes',
    )
    const cwd = realpathSync(join(m.home, 'workspaces', group.id, bot.id, '_empty'))
    await expect(terminal.locator('.xterm-rows')).toContainText(`cwd=${cwd}`)

    await run(page, terminal, "printf 'GG_%s\\n' 'INTERRUPT_READY'; sleep 30", 'GG_INTERRUPT_READY')
    await terminal.locator('.xterm-helper-textarea').focus()
    await page.keyboard.press('Control+c')
    await run(page, terminal, "printf 'GG_%s\\n' 'AFTER_CTRL_C'", 'GG_AFTER_CTRL_C')

    await adminSession(other.request)
    const forbidden = await other.request.post(`/api/groups/${group.id}/bots/${bot.id}/terminals`, {
      data: { cols: 80, rows: 24 },
    })
    expect(forbidden.status()).toBe(403)
    const foreign = await call<{ id: string }>(other.request, 'post', '/api/admin/users', {
      account: `guest${tag}`,
      name: `guest${tag}`,
      role: 'member',
      password: 'init-pass-1',
    })
    expect(foreign.id).toBeTruthy()
    await other.request.post('/api/auth/logout')
    await other.request.post('/api/auth/login', { data: { account: `guest${tag}`, password: 'init-pass-1' } })
    await call(other.request, 'post', '/api/auth/password', {
      oldPassword: 'init-pass-1',
      newPassword: 'member-pass',
    })
    expect((await other.request.delete(`/api/terminals/${terminalId}`)).status()).toBe(403)

    await run(page, terminal, `sleep 60 & printf 'GG_%s\\n' 'CHILD='$!`, 'GG_CHILD=')
    const childPid = Number(
      /GG_CHILD=(\d+)/.exec((await terminal.locator('.xterm-rows').innerText()).replaceAll('\n', ''))?.[1],
    )
    expect(childPid).toBeGreaterThan(0)
    expect(processExists(childPid)).toBe(true)

    await page.close()
    const replacement = await otherContext.newPage()
    cleanup = replacement.request
    await replacement.request.post('/api/auth/login', {
      data: { account: `term${tag}`, password: 'member-pass' },
    })
    const reconnected = await attach(replacement, group.id, bot.id, terminalId)
    expect(
      (await api.call<{ status: string }[]>('get', `/api/groups/${group.id}/bots/${bot.id}/terminals`))[0],
    ).toMatchObject({ status: 'running' })

    await replacement.reload()
    await expect(reconnected).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })
    await run(replacement, reconnected, "printf 'GG_%s\\n' 'AFTER_RELOAD'", 'GG_AFTER_RELOAD')
    expect(processExists(childPid)).toBe(true)

    await reconnected.getByRole('button', { name: '结束终端…' }).click()
    await replacement
      .getByRole('alertdialog', { name: '结束终端？' })
      .getByRole('button', {
        name: '结束终端',
        exact: true,
      })
      .click()
    await expect(reconnected).toHaveAttribute('data-phase', 'exited')
    await expect.poll(() => processExists(childPid), { timeout: 10_000 }).toBe(false)

    await replacement.keyboard.press('Alt+w')
    await expect(reconnected).toHaveCount(0)
    await replacement.getByRole('button', { name: '新建标签页' }).first().click()
    await replacement.getByRole('menuitem', { name: botName, exact: true }).and(page.locator('[data-value^="terminal:"]')).click()
    const eofTerminal = replacement.getByRole('region', { name: '终端', exact: true })
    await expect(eofTerminal).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })
    await eofTerminal.locator('.xterm-helper-textarea').focus()
    await replacement.keyboard.press('Control+d')
    await expect(eofTerminal).toHaveAttribute('data-phase', 'exited', { timeout: 20_000 })
    await expect(eofTerminal).toContainText('Shell 已退出，退出码 0')

    const serverLog = readFileSync(SERVER_LOG, 'utf8')
    expect(serverLog).not.toContain('GG_REAL')
    expect(serverLog).not.toContain('sleep 60')
  } finally {
    if (terminalId) await cleanup.delete(`/api/terminals/${terminalId}`).catch(() => {})
    m.stop()
    await otherContext.close()
  }
})
