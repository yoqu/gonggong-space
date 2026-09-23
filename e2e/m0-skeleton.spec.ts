import { expect, test } from '@playwright/test'
import { aiws, buildDaemon } from './helpers'

test.beforeAll(buildDaemon)

test('web, server and daemon are wired together', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('已连接 · 协议 v1')).toBeVisible()
  expect(aiws(['agents'])).toMatch(/Claude|Codex/)
})
