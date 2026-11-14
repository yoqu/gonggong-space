import { expect, test } from '@playwright/test'
import { adminSession, call } from './helpers'

test('管理后台 · 飞书: setup progress first, the public URL gates scanning, and the overview tables', async ({
  page,
  browser,
}) => {
  await adminSession(page.request)
  await call(page.request, 'put', '/api/admin/params', { publicUrl: '' })
  await page.goto('/admin/feishu')

  const steps = page.getByRole('list', { name: '飞书接入进度' })
  await expect(steps.getByRole('listitem')).toHaveCount(4)
  await expect(steps).toContainText('对外地址')
  await expect(steps).toContainText('成员可用')

  const url = page.getByRole('textbox', { name: '对外地址' })
  await expect(url).toHaveValue(new URL(page.url()).origin)
  const scan = page.getByRole('button', { name: '扫码创建或接入' })
  await expect(scan).toBeDisabled()
  await expect(page.getByText('先保存对外地址')).toBeVisible()
  await page.getByRole('button', { name: '保存对外地址' }).click()
  await expect(scan).toBeEnabled()
  await expect(steps.getByRole('listitem').first()).toHaveClass(/done/)

  await expect(page.getByRole('grid', { name: 'Bot 的飞书应用' })).toBeVisible()
  await expect(page.getByRole('grid', { name: '已关联的飞书群' })).toContainText('还没有群关联飞书群')

  // Members cannot read the overview.
  const account = `fsov${Date.now().toString(36)}`
  await call(page.request, 'post', '/api/admin/users', {
    account,
    name: account,
    role: 'member',
    password: 'init-pass-1',
  })
  const member = await browser.newContext({ baseURL: new URL(page.url()).origin })
  await member.request.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  expect((await member.request.get('/api/admin/feishu/overview')).status()).toBe(403)
  await member.close()
})
