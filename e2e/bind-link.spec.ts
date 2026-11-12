import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import {
  adminSession,
  bindManaged,
  buildDaemon,
  call,
  GONGGONG_BIN,
  memberWithMachine,
  SERVER,
} from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

test('bind via 接入链接; the owner allows a command on the web and the daemon applies it', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000)
  const { m, api } = await memberWithMachine(page, 'link1', { bind: 'link' })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: '白名单',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })

  // Only the owner may change the approval settings, not even a sysadmin.
  const ctx = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5190' })
  await adminSession(ctx.request)
  const denied = await ctx.request.patch(`/api/bots/${bot.id}`, { data: { alwaysAllow: ['node -e'] } })
  expect(denied.status()).toBe(403)
  await ctx.close()

  // 每次问我 (set by `call`), so only the rule can allow it.
  const saved = await api.call<{ alwaysAllow: string[] }>('patch', `/api/bots/${bot.id}`, {
    alwaysAllow: ['node  -e', 'node -e'],
  })
  expect(saved.alwaysAllow).toEqual(['node -e'])

  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: '接入链接',
    kind: 'group',
    memberIds: [],
    botIds: [bot.id],
  })
  m.start()
  try {
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await say(
      page,
      "@白名单 请用 Bash 工具执行命令 `node -e \"console.log('allow-' + 'listed')\"`，然后只回复命令的输出。",
    )
    const card = page.getByTestId('run-card').filter({ hasText: '白名单' })
    await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 3 * 60_000 })
    await expect(card).not.toContainText('等待审批')
    await expect(page.getByTestId('bot-reply').filter({ hasText: 'allow-listed' })).toHaveCount(1)
  } finally {
    m.stop()
  }
})

test('an expired code binds after the owner allows it on the web', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  const { api } = await memberWithMachine(page, 'link2')
  // A code is spent once a machine binds with it: a second machine using it gets code_expired.
  const { code } = await call<{ code: string }>(page.request, 'post', '/api/bind-codes')
  const first = mkdtempSync(join(tmpdir(), 'gonggong-e2e-'))
  const second = mkdtempSync(join(tmpdir(), 'gonggong-e2e-'))
  const login = (home: string) =>
    spawn(GONGGONG_BIN, ['login', '--server', SERVER, '--code', code], {
      env: { ...process.env, GG_LANG: 'zh', GONGGONG_HOME: home, GONGGONG_MACHINE_ID: home },
    })
  const exit = (p: ReturnType<typeof login>) => new Promise<number | null>((r) => p.on('exit', r))
  expect(await exit(login(first))).toBe(0)

  const gg = login(second)
  let out = ''
  gg.stdout.on('data', (d) => {
    out += String(d)
  })
  gg.stderr.on('data', (d) => {
    out += String(d)
  })
  const done = exit(gg)
  await expect.poll(() => /\/link\/([0-9a-f-]{36})/.exec(out)?.[1], { timeout: 30_000 }).toBeTruthy()
  const id = /\/link\/([0-9a-f-]{36})/.exec(out)![1]
  const userCode = /\b([A-Z0-9]{4})\b/.exec(out.slice(out.indexOf('/link/')))?.[1]

  await page.goto(`/link/${id}`)
  const card = page.getByRole('region', { name: '机器接入申请' })
  if (userCode) await expect(card).toContainText(userCode)
  await card.getByRole('button', { name: '允许接入' }).click()
  await expect(card).toContainText('已允许接入')
  expect(await done).toBe(0)
  expect(await api.call<unknown[]>('get', '/api/machines')).toHaveLength(3)
})
