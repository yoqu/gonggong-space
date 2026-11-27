import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { adminSession, call } from './helpers'

/** Set to keep screenshots for review (e.g. GONGGONG_E2E_SHOTS=/tmp/shots). */
const SHOTS = process.env.GONGGONG_E2E_SHOTS ?? join(tmpdir(), 'gonggong-thread-layout')
const shot = async (page: Page, name: string) => {
  // Past the rail's enter animation.
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

async function member(page: Page, account: string) {
  await adminSession(page.request)
  await call(page.request, 'post', '/api/admin/users', {
    account,
    name: '王磊',
    role: 'member',
    password: 'init-pass-1',
  })
  await call(page.request, 'post', '/api/auth/logout')
  await page.request.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  await call(page.request, 'post', '/api/auth/password', {
    oldPassword: 'init-pass-1',
    newPassword: 'member-pass',
  })
  const group = await call<{ id: string }>(page.request, 'post', '/api/groups', {
    name: '发版协调',
    kind: 'group',
    botIds: [],
    repo: null,
  })
  let n = 0
  const send = (body: string, threadRootId?: string) =>
    call<{ id: string }>(page.request, 'post', `/api/groups/${group.id}/messages`, {
      body,
      clientId: `layout-${account}-${++n}`,
      threadRootId,
    })
  await send('大家早，今天下午三点发版评审。')
  const root = await send('发版前要不要先冻结主干？\n我倾向周四开始冻结，周五发。')
  await send('要，周四开始，冻结期间只合修复。', root.id)
  await send('同意，我来发通知并更新发版手册。', root.id)
  await send('评审材料我放在群文件里了。')
  return { groupId: group.id, rootId: root.id }
}

const chatMain = (page: Page) => page.locator('main#main')
const rail = (page: Page) => page.getByRole('complementary', { name: '话题' })

test('a thread sits beside the chat or takes its place, by the account’s choice, and can be renamed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { groupId, rootId } = await member(page, 'layout1')
  await page.goto(`/g/${groupId}?thread=${rootId}`)

  const title = rail(page).getByRole('button', { name: /^话题名称：发版前要不要先冻结主干？/ })
  await expect(title).toBeVisible()
  await expect(chatMain(page)).toBeVisible()
  await shot(page, '1-side-by-side')

  await title.click()
  const input = rail(page).getByRole('textbox', { name: '话题名称' })
  await input.fill('周四冻结主干安排')
  await input.press('Enter')
  await expect(rail(page).getByRole('button', { name: '话题名称：周四冻结主干安排，点击修改' })).toBeVisible()
  await expect(rail(page).getByText('王磊 把话题改名为「周四冻结主干安排」')).toBeVisible()
  await shot(page, '2-renamed')

  await rail(page).getByRole('button', { name: '顶掉群聊查看' }).click()
  await expect(chatMain(page)).toBeHidden()
  await expect(rail(page).getByRole('button', { name: '返回群聊' })).toBeVisible()
  await shot(page, '3-replace')

  // The choice is kept on the account.
  await page.goto(`/g/${groupId}?thread=${rootId}`)
  await expect(rail(page).getByRole('button', { name: '返回群聊' })).toBeVisible()
  await expect(chatMain(page)).toBeHidden()
  await rail(page).getByRole('button', { name: '返回群聊' }).click()
  await expect(chatMain(page)).toBeVisible()

  // The group's thread list shows the name.
  await page.getByRole('button', { name: /^话题/ }).first().click()
  await expect(page.getByTestId('group-thread')).toContainText('周四冻结主干安排')
  await shot(page, '4-thread-list')

  await call(page.request, 'patch', '/api/me', { uiPrefs: { threadLayout: 'side' } })

  // Too narrow for two columns: the thread takes the chat's place instead of covering it.
  await page.evaluate(() => localStorage.setItem('gonggong.theme', 'dark'))
  await page.setViewportSize({ width: 1000, height: 760 })
  await page.goto(`/g/${groupId}?thread=${rootId}`)
  await expect(rail(page).getByRole('button', { name: '返回群聊' })).toBeVisible()
  await expect(chatMain(page)).toBeHidden()
  await expect(rail(page).getByRole('button', { name: '顶掉群聊查看' })).toHaveCount(0)
  await shot(page, '5-narrow-dark')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/g/${groupId}?thread=${rootId}`)
  await expect(chatMain(page)).toBeVisible()
  await shot(page, '6-side-dark')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => localStorage.setItem('gonggong.theme', 'light'))
  await page.goto(`/g/${groupId}?thread=${rootId}`)
  await expect(rail(page).getByRole('button', { name: /^话题名称：周四冻结主干安排/ })).toBeVisible()
  await shot(page, '7-phone')
})
