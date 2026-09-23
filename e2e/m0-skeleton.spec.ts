import { expect, test } from '@playwright/test'
import { aiws, buildDaemon } from './helpers'

test.beforeAll(buildDaemon)

test('web, server and daemon are wired together', async ({ page, request }) => {
  expect(await (await request.get('/api/health')).json()).toEqual({ ok: true, protocol: 1 })
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  expect(aiws(['agents'])).toMatch(/Claude|Codex/)
})
