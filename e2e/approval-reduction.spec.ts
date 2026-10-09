import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

/** Sends `text` and returns the run card it starts. */
async function ask(page: Page, text: string) {
  const cards = page.getByTestId('run-card')
  const before = await cards.count()
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
  await expect(cards).toHaveCount(before + 1, { timeout: 60_000 })
  return cards.last()
}

const run = (command: string, reply: string, bot = '降频 Bot') =>
  `@${bot} 请用 Bash 工具执行命令 \`${command}\`，不要改写或拆分命令，然后只回复「${reply}」。`

async function bot(api: Awaited<ReturnType<typeof memberWithMachine>>['api'], name: string) {
  return api.call<{ id: string }>('post', '/api/bots', {
    name,
    ownerId: (await api.me()).id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
}

test('ask mode: read-only chains run unasked; 始终允许 persists a prefix across groups and restarts until removed', async ({
  page,
}) => {
  test.setTimeout(15 * 60_000)
  const repo = remoteRepo()
  const { m, api } = await memberWithMachine(page, 'reduce1')
  const b = await bot(api, '降频 Bot')
  const group = (name: string) =>
    api.call<{ id: string }>('post', '/api/groups', {
      name,
      kind: 'group',
      botIds: [b.id],
      repo: { url: repo.url, branch: 'main' },
    })
  const g1 = await group('降频一')
  const g2 = await group('降频二')
  const alwaysAllow = async () =>
    (await api.call<{ id: string; alwaysAllow: string[] }[]>('get', '/api/bots')).find((x) => x.id === b.id)
      ?.alwaysAllow
  m.start()
  try {
    await bindManaged(page.request, g1.id, [b.id])
    await bindManaged(page.request, g2.id, [b.id])
    await page.goto(`/g/${g1.id}`)

    // 1. Read-only chain: no request reaches the owner.
    const readOnly = await ask(page, run('git status && ls', '只读完成'))
    await expect(readOnly).toHaveAttribute('data-status', 'completed', { timeout: 3 * 60_000 })
    await expect(readOnly).toContainText('只读完成')
    await expect(readOnly).not.toContainText('权限请求')

    // 2. 始终允许 on the card remembers the smallest prefix, shown before deciding.
    const first = await ask(page, run('git tag -f e2e-one', '已打标签'))
    await expect(first).toContainText('等待审批', { timeout: 3 * 60_000 })
    await expect(first).toContainText('将始终允许：git tag')
    await first.getByRole('button', { name: '始终允许' }).click()
    await expect(first).toContainText('reduce1 已批准')
    await expect(first).toHaveAttribute('data-status', 'completed', { timeout: 3 * 60_000 })
    await expect.poll(alwaysAllow).toEqual(['git tag'])

    await page.goto(`/bot/${b.id}`)
    await page.getByRole('button', { name: '编辑 Bot' }).click()
    const dialog = page.getByRole('dialog', { name: 'Bot 详情' })
    await dialog.getByRole('tab', { name: '权限' }).click()
    await expect(dialog.getByRole('button', { name: '移除 git tag' })).toBeVisible()
    await page.keyboard.press('Escape')

    // Another group (a new conversation) after a daemon restart: only the server-side rule can allow it.
    m.stop()
    await m.exited()
    m.start()
    await page.goto(`/g/${g2.id}`)
    const second = await ask(page, run('git tag -f e2e-two', '已打标签'))
    await expect(second).toHaveAttribute('data-status', 'completed', { timeout: 4 * 60_000 })
    await expect(second).toContainText('已打标签')
    await expect(second).not.toContainText('权限请求')

    // 4. Removing the rule in Bot settings brings the request back.
    await page.goto(`/bot/${b.id}`)
    await page.getByRole('button', { name: '编辑 Bot' }).click()
    await dialog.getByRole('tab', { name: '权限' }).click()
    await dialog.getByRole('button', { name: '移除 git tag' }).click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('降频 Bot 已保存')).toBeVisible()
    await expect.poll(alwaysAllow).toEqual([])
    await page.keyboard.press('Escape')

    await page.goto(`/g/${g2.id}`)
    const third = await ask(page, run('git tag -f e2e-three', '已打标签'))
    await expect(third).toContainText('等待审批', { timeout: 3 * 60_000 })
    await expect(third).toContainText('将始终允许：git tag')
    await third.getByRole('button', { name: '拒绝' }).click()
    await expect(third).toContainText('reduce1 已拒绝')
  } finally {
    m.stop()
  }
})

test('全部自动 still sends floor commands to the owner', async ({ page }) => {
  test.setTimeout(10 * 60_000)
  const { m, api } = await memberWithMachine(page, 'floor1')
  const b = await bot(api, '底线 Bot')
  await api.call('patch', `/api/bots/${b.id}`, { approval: 'all' })
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: '底线',
    kind: 'group',
    botIds: [b.id],
  })
  m.start()
  try {
    await bindManaged(page.request, group.id, [b.id])
    await page.goto(`/g/${group.id}`)
    const card = await ask(page, run('sudo -n true', '已执行', '底线 Bot'))
    await expect(card).toContainText('等待审批', { timeout: 3 * 60_000 })
    await expect(card).toContainText('sudo -n true')
    // The floor is never remembered, so only 批准 / 拒绝 are offered.
    await expect(card.getByRole('button', { name: '始终允许' })).toHaveCount(0)
    await card.getByRole('button', { name: '拒绝' }).click()
    await expect(card).toContainText('floor1 已拒绝')
  } finally {
    m.stop()
  }
})
