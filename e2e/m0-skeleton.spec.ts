import { expect, test } from '@playwright/test'
import { aiws, buildDaemon } from './helpers'

test.beforeAll(buildDaemon)

test('web, server and daemon are wired together', async ({ page, request }) => {
  expect(await (await request.get('/api/health')).json()).toEqual({ ok: true, protocol: 1 })
  await page.goto('/login')
  await expect(page.getByTestId('login-page')).toBeVisible()
  expect(aiws(['agents'])).toMatch(/Claude|Codex/)
})

// UI-driven switching (AccountMenu) needs a login, and bootstrap auth is currently broken by the
// in-flight workspace-binding work; AccountMenu switching itself is covered by auth.test.tsx.
// Here we persist via localStorage exactly like setTheme() does and verify it survives reload.
test('light theme by default; dark persists across reload', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.evaluate(() => localStorage.setItem('aiws.theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('login-page')).toBeVisible()
})
