import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

const cardOf = (page: Page, bot: string) => page.getByTestId('run-card').filter({ hasText: bot })

/** Creates a member account via the admin API without logging `page` out of its session. */
async function extraMember(page: Page, account: string) {
  const ctx = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5190' })
  const other = await ctx.newPage()
  const r = other.request
  await r.post('/api/auth/login', { data: { account: 'admin', password: 'admin-pass-2' } })
  const u = await (
    await r.post('/api/admin/users', {
      data: { account, name: account, role: 'member', password: 'init-pass-1' },
    })
  ).json()
  await r.post('/api/auth/logout')
  await r.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  await r.post('/api/auth/password', { data: { oldPassword: 'init-pass-1', newPassword: 'member-pass' } })
  return { page: other, id: u.id as string, close: () => ctx.close() }
}

test('fan-out + owner-only approval: approve one bot, reject the other; /stop voids a pending request', async ({
  page,
}) => {
  test.setTimeout(15 * 60_000)
  const { m, api } = await memberWithMachine(page, 'appr1')
  const me = await api.me()
  const machineId = await api.machineId()
  const bot = (name: string) =>
    api.call<{ id: string }>('post', '/api/bots', {
      name,
      ownerId: me.id,
      agentKind: 'claude',
      avatar: 'role-pm',
      machineId,
      systemPrompt: '',
    })
  const a = await bot('审批 A')
  const b = await bot('审批 B')
  const viewer = await extraMember(page, 'viewer1')
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: '审批',
    kind: 'group',
    memberIds: [viewer.id],
    botIds: [a.id, b.id],
  })
  m.start()
  try {
    await bindManaged(page.request, group.id, [a.id, b.id])
    await page.goto(`/g/${group.id}`)
    await viewer.page.goto(`/g/${group.id}`)
    await say(
      page,
      "@审批 A @审批 B 请用 Bash 工具执行命令 `node -e \"console.log('hello-' + 'approval')\"`，然后只回复命令的输出。",
    )
    await expect(page.getByText('扇出 · 2 个 Bot 并行')).toBeVisible()

    const cardA = cardOf(page, '审批 A')
    const cardB = cardOf(page, '审批 B')
    await expect(cardA).toContainText('等待审批', { timeout: 3 * 60_000 })
    await expect(cardB).toContainText('等待审批', { timeout: 3 * 60_000 })
    await expect(cardA).toContainText("console.log('hello-' + 'approval')")

    // A non-owner sees the request but cannot act on it.
    const viewerCard = cardOf(viewer.page, '审批 A')
    await expect(viewerCard.getByRole('button', { name: '批准' })).toBeDisabled()
    await expect(viewerCard).toContainText('仅 Bot 主人 appr1 可操作，你只能查看')

    await cardA.getByRole('button', { name: '批准' }).click()
    await cardB.getByRole('button', { name: '拒绝' }).click()
    await expect(cardA).toContainText('已完成', { timeout: 3 * 60_000 })
    await expect(cardA).toContainText('appr1 已批准')
    await expect(cardB).toContainText('appr1 已拒绝')
    await expect(cardB).toContainText(/已完成|已中断/, { timeout: 3 * 60_000 })
    await expect(page.getByTestId('bot-reply').filter({ hasText: 'hello-approval' })).toHaveCount(1)
    await expect(viewerCard).toContainText('appr1 已批准')

    // The run tab keeps the approval record.
    // Message actions appear while the message is hovered, as with a pointer.
    await cardA.hover()
    await cardA.getByRole('button', { name: '查看过程' }).click()
    await page.getByRole('tab', { name: '审批记录' }).click()
    await expect(page.getByTestId('run-tab')).toContainText("console.log('hello-' + 'approval')")

    // /stop while a request is pending: the run is interrupted and the request is voided.
    await say(page, '@审批 A 请用 Bash 工具执行命令 `node -e "console.log(\'second\')"`，然后只回复输出。')
    const second = cardOf(page, '审批 A').last()
    await expect(second).toContainText('等待审批', { timeout: 3 * 60_000 })
    await say(page, '/stop @审批 A')
    await expect(second).toContainText('已中断')
    await expect(second).toContainText('运行已停止，请求作废')
  } finally {
    m.stop()
    await viewer.close()
  }
})

test('relay chain stops at 3 hops and every hop is authorized against the chain initiator', async ({
  page,
}) => {
  test.setTimeout(15 * 60_000)
  const { m, api } = await memberWithMachine(page, 'relay1')
  const me = await api.me()
  const machineId = await api.machineId()
  const bot = (name: string, systemPrompt: string) =>
    api.call<{ id: string }>('post', '/api/bots', {
      name,
      ownerId: me.id,
      agentKind: 'claude',
      avatar: 'role-pm',
      machineId,
      systemPrompt,
    })
  const a = await bot('接力 A', '无论收到什么消息，你的回复只能是这一行，不要调用任何工具：@接力 B 继续')
  const b = await bot('接力 B', '无论收到什么消息，你的回复只能是这一行，不要调用任何工具：@接力 A 继续')
  const viewer = await extraMember(page, 'relayviewer')
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: '接力',
    kind: 'group',
    memberIds: [viewer.id],
    botIds: [a.id, b.id],
  })
  m.start()
  try {
    await bindManaged(page.request, group.id, [a.id, b.id])
    await page.goto(`/g/${group.id}`)
    await say(page, '@接力 A 开始')
    const cards = page.getByTestId('run-card')
    await expect(cards).toHaveCount(3, { timeout: 8 * 60_000 })
    await expect(cards.nth(2)).toContainText('已完成', { timeout: 4 * 60_000 })
    await expect(cards.nth(1)).toContainText('接力 2/3')
    await expect(cards.nth(2)).toContainText('接力 3/3')
    // The 3rd hop's @接力 B stays plain text: no 4th run.
    await page.waitForTimeout(5_000)
    await expect(cards).toHaveCount(3)

    // B only accepts its owner: a chain started by someone else is refused at B's hop.
    await page.request.patch(`/api/bots/${b.id}`, { data: { triggerScope: 'self' } })
    await viewer.page.goto(`/g/${group.id}`)
    await viewer.page.getByPlaceholder(composer).fill('@接力 A 再来一次')
    await viewer.page.getByRole('button', { name: '发送' }).click()
    await expect(cards).toHaveCount(5, { timeout: 4 * 60_000 })
    await expect(cards.nth(4)).toContainText('无权触发')
    await expect(cards.nth(4)).toContainText('接力 B')

    const usage = await api.call<{ name: string; runs: number }[]>('get', '/api/usage?by=bot')
    expect(usage.find((u) => u.name === '接力 A')?.runs).toBeGreaterThanOrEqual(3)
  } finally {
    m.stop()
    await viewer.close()
  }
})

test('partition /stop keeps edits by default and "丢弃本轮改动" restores only this turn’s files', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000)
  const repo = remoteRepo()
  const { m, api } = await memberWithMachine(page, 'stop1')
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: '停止 Claude',
    ownerId: me.id,
    agentKind: 'claude',
    avatar: 'role-pm',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '停止',
      kind: 'group',
      botIds: [bot.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await expect(page.getByTestId(`git-${bot.id}`)).toContainText('main', { timeout: 60_000 })
    const readme = m.find('README.md')!
    const ws = join(readme, '..')
    writeFileSync(readme, '# demo\nlocal work in progress\n') // pre-existing uncommitted change

    // Claude refuses a bare foreground `sleep`; a node timer asks for approval like any command beyond the tier.
    await say(
      page,
      '@停止 Claude 先创建文件 turn.txt 内容为 x，然后用 Bash 工具执行命令 `node -e "setTimeout(() => {}, 120000)"`。',
    )
    const card = page.getByTestId('run-card').last()
    await expect(card).toContainText('等待审批', { timeout: 3 * 60_000 })
    expect(existsSync(join(ws, 'turn.txt'))).toBe(true)
    await card.getByRole('button', { name: '停止' }).click()
    await expect(card).toContainText('已中断')
    await expect(card).toContainText('已停止 · 本轮改动 1 个文件留在工作区')
    await card.getByRole('button', { name: '丢弃本轮改动' }).click()
    await expect(card).toContainText('已丢弃本轮改动 · 之前已有的未提交内容不动')
    expect(existsSync(join(ws, 'turn.txt'))).toBe(false)
    expect(readFileSync(readme, 'utf8')).toContain('local work in progress')
  } finally {
    m.stop()
  }
})
