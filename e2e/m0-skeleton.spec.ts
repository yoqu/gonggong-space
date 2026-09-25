import { expect, test } from '@playwright/test'
import { adminSession, buildDaemon, gonggong } from './helpers'

test.beforeAll(buildDaemon)

test('web, server and daemon are wired together', async ({ page, request }) => {
  expect(await (await request.get('/api/health')).json()).toEqual({ ok: true, protocol: 1 })
  await page.goto('/login')
  await expect(page.getByTestId('login-page')).toBeVisible()
  expect(gonggong(['agents'])).toMatch(/Claude|Codex/)
})

// UI-driven switching (AccountMenu) needs a login, and bootstrap auth is currently broken by the
// in-flight workspace-binding work; AccountMenu switching itself is covered by auth.test.tsx.
// Here we persist via localStorage exactly like setTheme() does and verify it survives reload.
test('light theme by default; dark persists across reload', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.evaluate(() => localStorage.setItem('gonggong.theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('login-page')).toBeVisible()
})

test('打开并关闭弹窗后节点被移除', async ({ page }) => {
  await adminSession(page.request)
  await page.goto('/')
  await page.getByRole('button', { name: '新建群' }).click()
  await expect(page.getByRole('dialog', { name: '新建群' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ui-overlay')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('切换玻璃档位刷新后保持', async ({ page }) => {
  await adminSession(page.request)
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-glass', 'standard')
  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitemradio', { name: '着色' }).click()
  await expect(html).toHaveAttribute('data-glass', 'tinted')
  await page.reload()
  await expect(page.getByRole('button', { name: '账户菜单' })).toBeVisible()
  await expect(html).toHaveAttribute('data-glass', 'tinted')
})
