import { expect, type Page, test } from '@playwright/test'
import { adminSession, call } from './helpers'

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

/** A fresh member logged into `page`. */
async function member(page: Page, account: string) {
  const api = page.request
  await adminSession(api)
  await call(api, 'post', '/api/admin/users', {
    account,
    name: account,
    role: 'member',
    password: 'init-pass-1',
  })
  await call(api, 'post', '/api/auth/logout')
  await api.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  await call(api, 'post', '/api/auth/password', { oldPassword: 'init-pass-1', newPassword: 'member-pass' })
  await call(api, 'patch', '/api/me/onboarding', { guide: 'skipped' })
  return call<{ id: string }>(api, 'get', '/api/me')
}

test('an admin @所有人 shows as a mention count; the reader saves it for later and the reminder comes due', async ({
  page,
  browser,
}) => {
  test.setTimeout(2 * 60_000)
  const reader = await (await browser.newContext()).newPage()
  const b = await member(reader, 'un-reader1')
  await member(page, 'un-owner1')
  const group = await call<{ id: string }>(page.request, 'post', '/api/groups', {
    name: '未读 e2e',
    kind: 'group',
    memberIds: [b.id],
  })

  await reader.goto('/threads')
  const row = reader.getByTestId(`group-item-${group.id}`)
  await expect(row).toBeVisible()

  // A plain message only makes the name bold; the owner's @所有人 adds a number.
  await page.goto(`/g/${group.id}`)
  await page.getByPlaceholder(composer).fill('周会改到下午')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(row.locator('.ui-badge')).toHaveCount(0)
  await page.getByPlaceholder(composer).fill('@所有人 记得填周报')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(row.locator('.ui-badge')).toHaveText('1')

  await row.click()
  const msg = reader.getByRole('main').locator('.pn-msg', { hasText: '记得填周报' })
  await msg.hover()
  await msg.getByRole('button', { name: '更多' }).click()
  await reader.getByRole('menuitem', { name: '稍后处理' }).hover()
  await reader.getByRole('menuitem', { name: '不提醒' }).click()
  await expect(row.locator('.ui-badge')).toHaveCount(0)

  const later = reader.getByTestId('later-item')
  await expect(later).toContainText('1 条进行中')
  const saved = await call<{ items: { message: { id: string } }[] }>(
    reader.request,
    'get',
    '/api/saved?state=open',
  )
  const id = saved.items[0]?.message.id
  await call(reader.request, 'put', `/api/messages/${id}/save`, {
    remindAt: new Date(Date.now() + 1000).toISOString(),
  })
  await expect(later).toContainText('1 条提醒到期', { timeout: 60_000 })

  await later.click()
  const item = reader.getByRole('main').getByText('@所有人 记得填周报')
  await expect(item).toBeVisible()
  await reader.getByRole('button', { name: '完成' }).click()
  await expect(reader.getByText('没有待处理的消息')).toBeVisible()
})
