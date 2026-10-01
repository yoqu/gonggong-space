import { expect, test } from '@playwright/test'
import { adminSession, bindManaged, buildDaemon, call, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)

test('A creates a team and invites B by link → B @s own bot there → A removes B, B’s bot leaves the group', async ({
  page,
  browser,
}) => {
  test.setTimeout(10 * 60_000)
  // Both accounts start in the default team (created while single-team mode is still on).
  await memberWithMachine(page, 'teamowner')
  const bCtx = await browser.newContext({ baseURL: 'http://127.0.0.1:5190' })
  const bPage = await bCtx.newPage()
  const b = await memberWithMachine(bPage, 'teamguest')
  const admin = (await browser.newContext({ baseURL: 'http://127.0.0.1:5190' })).request
  await adminSession(admin)
  const params = async (data: object) =>
    expect((await admin.put('/api/admin/params', { data })).ok()).toBe(true)
  await params({ singleTeamMode: false, teamCreation: 'all' })
  let teamId = ''

  try {
    // A creates a team from the switcher and lands in it.
    await page.goto('/')
    await page.getByRole('button', { name: /^切换团队，当前：/ }).click()
    await page.getByRole('menuitem', { name: '新建团队' }).click()
    await page.getByRole('dialog', { name: '新建团队' }).getByLabel('团队名称').fill('端到端团队')
    await page.getByRole('button', { name: '创建' }).click()
    const switcher = page.getByRole('button', { name: '切换团队，当前：端到端团队' })
    await expect(switcher).toBeVisible()
    teamId = (await page.evaluate(() => localStorage.getItem('gg.team'))) ?? ''

    // …and creates an invite link in 团队设置.
    await switcher.click()
    await page.getByRole('menuitem', { name: '团队设置' }).click()
    await page.getByRole('button', { name: '邀请' }).click()
    await page.getByRole('button', { name: '生成邀请链接' }).click()
    const link = (await page.locator('.team-link__url').textContent()) ?? ''
    expect(link).toMatch(/\/join\/ggi_/)
    await page.keyboard.press('Escape')

    // B opens the link and joins.
    await bPage.goto(new URL(link).pathname)
    await expect(bPage.getByText('teamowner 邀请你加入团队「端到端团队」。')).toBeVisible()
    await bPage.getByRole('button', { name: '加入团队' }).click()
    await expect(bPage.getByRole('button', { name: '切换团队，当前：端到端团队' })).toBeVisible()

    // B's bot in the new team; A's group there with B and the bot.
    const inTeam = { 'x-gg-team': teamId }
    const bMe = await b.api.me()
    const bot = await (
      await bPage.request.post('/api/bots', {
        headers: inTeam,
        data: {
          name: '访客 Claude',
          ownerId: bMe.id,
          agentKind: 'claude',
          avatar: 'role-no',
          machineId: await b.api.machineId(),
          systemPrompt: '',
        },
      })
    ).json()
    const group = await (
      await page.request.post('/api/groups', {
        headers: inTeam,
        data: { name: '跨团队验证', kind: 'group', memberIds: [bMe.id], botIds: [bot.id] },
      })
    ).json()
    b.m.start()
    await bindManaged(bPage.request, group.id, [bot.id])

    // B @s their own bot and gets a reply.
    await bPage.goto(`/g/${group.id}`)
    await bPage.getByPlaceholder('输入消息，@ 触发 Bot 或引用文件，/ 查看命令').fill('@访客 Claude 只回复 ok')
    await bPage.getByRole('button', { name: '发送' }).click()
    const card = bPage.getByTestId('run-card').last()
    await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 4 * 60_000 })

    // A removes B from the team: B's bot leaves the group.
    await page.goto(`/g/${group.id}`)
    await page.getByRole('button', { name: '切换团队，当前：端到端团队' }).click()
    await page.getByRole('menuitem', { name: '团队设置' }).click()
    await page.getByRole('button', { name: '成员', exact: true }).click()
    await page.getByTestId(`team-member-${bMe.id}`).getByRole('button', { name: '管理' }).click()
    await page.getByRole('menuitem', { name: '移出团队' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '移出团队' }).click()
    await expect(page.getByTestId(`team-member-${bMe.id}`)).toBeHidden()
    await page.keyboard.press('Escape')
    const log = page.getByRole('log', { name: '消息' })
    await expect(log.getByText('访客 Claude 被移出 · 工作区保留')).toBeVisible()
    await expect(log.getByText('teamguest 被移出团队')).toBeVisible()
    const after = await call<{ botIds: string[] }>(page.request, 'get', `/api/groups/${group.id}`)
    expect(after.botIds).toEqual([])
    // B is back in the default team.
    await expect(bPage.getByRole('button', { name: /^切换团队，当前：/ })).not.toHaveAccessibleName(
      '切换团队，当前：端到端团队',
    )
  } finally {
    b.m.stop()
    // Leave one live team in single-team mode for the other specs.
    if (teamId) await page.request.post(`/api/teams/${teamId}/archive`)
    await params({ singleTeamMode: true, teamCreation: 'sysadmin' })
    await bCtx.close()
  }
})
