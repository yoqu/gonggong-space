import { expect, type Page, test } from '@playwright/test'
import { adminSession, call } from './helpers'

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
}

test('a group filed under a team section is seen by the team; a teammate asks to join and its admin lets them in', async ({
  page,
  browser,
}) => {
  const admin = await (await browser.newContext()).newPage()
  await adminSession(admin.request)
  const section = await call<{ id: string }>(admin.request, 'post', '/api/team-sections', {
    name: '支付线 e2e',
  })

  await member(page, 'tsowner1')
  const group = await call<{ id: string }>(page.request, 'post', '/api/groups', {
    name: '结算 e2e',
    kind: 'group',
  })
  await call(page.request, 'put', `/api/groups/${group.id}/team-section`, { teamSectionId: section.id })

  const other = await (await browser.newContext()).newPage()
  await member(other, 'tsasker1')
  await other.goto('/')
  const sec = other.getByRole('group', { name: '支付线 e2e' })
  const row = sec.getByTestId(`directory-item-${group.id}`)
  await expect(row).toContainText('未加入')
  await row.click()
  const preview = other.getByRole('region', { name: '入群预览' })
  await expect(preview).toContainText('群管理员：tsowner1')
  await preview.getByRole('textbox', { name: '申请说明' }).fill('跟进对账')
  await preview.getByRole('button', { name: '申请加入' }).click()
  await expect(preview).toContainText('已申请，等待群管理员处理')

  await page.goto(`/g/${group.id}`)
  await page.getByRole('button', { name: /^通知/ }).first().click()
  await page.getByRole('button', { name: '同意' }).first().click()

  await expect(other.getByRole('heading', { name: '结算 e2e' })).toBeVisible()
  await expect(sec.getByTestId(`group-item-${group.id}`)).toBeVisible()
  await expect(other.getByRole('main').getByText('tsowner1 同意 tsasker1 加入群')).toBeVisible()
})
