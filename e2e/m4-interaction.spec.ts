import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
const PNG = join(ROOT, 'docs/原型UI-AI 对话 agent系统界面设计方案/assets/chat/shot-4.png')

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

async function setup(page: Page, account: string, opts: { tier?: 'full'; repo?: boolean } = {}) {
  const { m, api } = await memberWithMachine(page, account)
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: `${account} Claude`,
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  if (opts.tier) {
    await page.request.patch(`/api/bots/${bot.id}`, {
      data: { tier: 'full', triggerScope: 'list', triggerList: [me.id] },
    })
  }
  const repo = opts.repo ? remoteRepo() : null
  m.start()
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: account,
    kind: 'group',
    botIds: [bot.id],
    repo: repo ? { url: repo.url, branch: 'main' } : null,
  })
  await bindManaged(page.request, group.id, [bot.id])
  await page.goto(`/g/${group.id}`)
  if (repo) await expect(page.getByTestId(`git-${bot.id}`)).toContainText('main', { timeout: 60_000 })
  return { m, api, me, bot, group, name: `${account} Claude` }
}

test('attachments land in the workspace (git-excluded), images are previewed, and quoting a reply re-triggers the bot', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000)
  const { m, name } = await setup(page, 'att1', { repo: true })
  try {
    await page.getByRole('button', { name: '图片' }).click()
    await page.locator('input[type=file]').first().setInputFiles(PNG)
    await expect(page.getByText('shot-4.png')).toBeVisible()
    await say(page, `@${name} 用一句话描述附件图片里最显眼的颜色。`)
    await expect(page.getByRole('main').getByRole('img', { name: 'shot-4.png' })).toBeVisible()
    await expect(page.getByTestId('run-card').last()).toContainText('已完成', { timeout: 4 * 60_000 })

    const file = m.find('shot-4.png')
    expect(file).toMatch(/\.gonggong\/attachments\/[^/]+\/shot-4\.png$/)
    const repoRoot = file!.split('/.gonggong/')[0]!
    expect(readFileSync(join(repoRoot, '.git/info/exclude'), 'utf8')).toContain('.gonggong/')

    // Quote the bot's reply without @: it still triggers the bot, with the quoted text attached.
    await page.getByTestId('bot-reply').last().getByRole('button', { name: '引用回复' }).click()
    await expect(page.getByText(`引用 ${name}`)).toBeVisible()
    await say(page, '再用三个字总结一下')
    await expect(page.getByTestId('run-card')).toHaveCount(2)
    await expect(page.getByTestId('run-card').nth(1)).toContainText('已完成', { timeout: 4 * 60_000 })
  } finally {
    m.stop()
  }
})

test('question card: the agent asks, only the trigger user or owner answers, the run continues with the answer', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000)
  const { m, name } = await setup(page, 'ask1')
  try {
    await say(
      page,
      `@${name} 在做任何事之前，先调用向群成员提问的工具问我一个单选题「用哪种语言？」，选项为 Python 和 Go，推荐 Python。拿到回答后只回复所选语言的名字。`,
    )
    const card = page.getByTestId('run-card').last()
    await expect(card).toContainText('等待回答', { timeout: 4 * 60_000 })
    await expect(card).toContainText('向群成员提问 · 1 个问题')
    await card.getByRole('button', { name: 'Go', exact: true }).click()
    await card.getByRole('button', { name: '提交回答' }).click()
    await expect(card).toContainText('已完成', { timeout: 4 * 60_000 })
    await expect(page.getByTestId('bot-reply').last()).toContainText('Go')
    await expect(card).toContainText('ask1 已回答')
  } finally {
    m.stop()
  }
})

test('interrupt-and-append continues the same run; candidates list files and agent commands; notifications and ⌘K search work', async ({
  page,
}) => {
  test.setTimeout(12 * 60_000)
  const { m, name, bot } = await setup(page, 'app1', { tier: 'full', repo: true })
  try {
    await say(
      page,
      `@${name} 用 Bash 执行 node -e "setTimeout(()=>console.log('late'),45000)"，结束后回复 done。`,
    )
    const card = page.getByTestId('run-card').last()
    await expect(card).toContainText('运行中', { timeout: 2 * 60_000 })
    await card.getByRole('button', { name: '打断并追加' }).click()
    await expect(page.getByText(`打断并追加到 ${name}`)).toBeVisible()
    await say(page, '不要等了，停止那个命令，直接只回复 appended')
    await expect(page.getByTestId('run-card')).toHaveCount(1)
    await expect(card).toContainText('已完成', { timeout: 4 * 60_000 })
    await expect(page.getByTestId('bot-reply').last()).toContainText('appended')

    // @ candidates: files from the bot's workspace; / candidates: system + agent commands reported over ACP.
    await page.getByPlaceholder(composer).fill(`@${name} @READ`)
    const pop = page.getByTestId('composer-popover')
    await expect(pop).toContainText('文件')
    await expect(pop).toContainText('README.md')
    await expect(pop).toContainText(/工作区/)
    await page.getByPlaceholder(composer).fill(`@${name} /`)
    await expect(pop).toContainText('/stop')
    await expect(pop).toContainText('AGENT 命令')
    await page.getByPlaceholder(composer).fill('')

    // ⌘K finds the reply.
    await page.keyboard.press('Meta+k')
    await page.getByPlaceholder('搜索消息、文件、运行').fill('appended')
    await expect(page.getByTestId('search-results')).toContainText('appended')
    await page.keyboard.press('Escape')

    // Notification center lists a pending approval for the owner after lowering the tier.
    await page.request.patch(`/api/bots/${bot.id}`, { data: { tier: 'workspace' } })
    await say(page, `@${name} 用 Bash 执行 node -e "console.log(1+1)"，然后只回复输出。`)
    await expect(page.getByTestId('run-card').last()).toContainText('等待审批', { timeout: 3 * 60_000 })
    await page.getByRole('button', { name: '通知' }).click()
    await expect(page.getByTestId('notification-list')).toContainText('待审批')
  } finally {
    m.stop()
  }
})

test('a global MCP server configured by the admin is injected into new sessions', async ({ page }) => {
  test.setTimeout(8 * 60_000)
  // full tier: MCP tool calls would otherwise wait for the owner's approval.
  const { m, name } = await setup(page, 'mcp1', { tier: 'full' })
  try {
    // Configure as admin in a separate context, forcing a new session.
    const admin = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5190' })
    const r = admin.request
    await r.post('/api/auth/login', { data: { account: 'admin', password: 'admin-pass-2' } })
    const res = await r.post('/api/admin/mcp', {
      data: {
        enabled: true,
        forceNewSession: true,
        config: {
          transport: 'stdio',
          name: 'gonggong-echo',
          command: 'node',
          args: [join(ROOT, 'tools/mcp-echo/server.js')],
          env: {},
        },
      },
    })
    expect(res.ok()).toBe(true)
    await admin.close()
    await say(
      page,
      `@${name} 调用 gonggong-echo 的 echo 工具，参数 text 为 "mcp-ok-42"，只回复工具返回的内容。`,
    )
    await expect(page.getByTestId('run-card').last()).toContainText('已完成', { timeout: 4 * 60_000 })
    await expect(page.getByTestId('bot-reply').last()).toContainText('mcp-ok-42')
  } finally {
    m.stop()
  }
})
