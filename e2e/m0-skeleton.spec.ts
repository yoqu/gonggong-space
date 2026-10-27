import { expect, type Page, test } from '@playwright/test'
import { adminSession, buildDaemon, call, gonggong } from './helpers'

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
  await page.getByRole('navigation', { name: '会话列表' }).getByRole('button', { name: '新建群' }).click()
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
  await page.getByRole('menuitem', { name: '设置…' }).click()
  await page.getByRole('dialog', { name: '外观' }).getByRole('radio', { name: '着色' }).click()
  await expect(html).toHaveAttribute('data-glass', 'tinted')
  await page.reload()
  await expect(page.getByRole('button', { name: '账户菜单' })).toBeVisible()
  await expect(html).toHaveAttribute('data-glass', 'tinted')
})

async function seedGroups(page: Page, prefix: string) {
  const groups = []
  for (let i = 0; i < 30; i++) {
    groups.push(
      await call<{ id: string }>(page.request, 'post', '/api/groups', {
        name: `${prefix} ${i}`,
        kind: 'group',
      }),
    )
  }
  return groups
}

async function scrollAndClickVisibleGroup(page: Page) {
  const list = page.locator('.sidebar__scroll')
  await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  const before = await list.evaluate((el) => el.scrollTop)
  expect(before).toBeGreaterThan(0)
  const target = await list.locator('[data-testid^="group-item-"]').evaluateAll((rows) => {
    const bounds = rows[0]!.closest('.sidebar__scroll')!.getBoundingClientRect()
    return rows
      .find((row) => {
        if (row.getAttribute('aria-current') === 'page') return false
        const box = row.getBoundingClientRect()
        return box.top >= bounds.top && box.bottom <= bounds.bottom
      })
      ?.getAttribute('data-testid')
  })
  expect(target).toBeTruthy()
  const groupId = target!.slice('group-item-'.length)
  await page.getByTestId(target!).click()
  await expect(page).toHaveURL(`/g/${groupId}`)
  return { list, before }
}

test('点击长会话列表下方的群后保持侧栏滚动位置', async ({ page }) => {
  await adminSession(page.request)
  const groups = await seedGroups(page, '会话')
  await page.goto(`/g/${groups[0]!.id}`)
  const { list, before } = await scrollAndClickVisibleGroup(page)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(before)
})

test('工作台随群切换展开后不重置侧栏滚动位置', async ({ page }) => {
  await page.addInitScript(() => {
    const path = location.pathname.split('/')
    const groupId = path[1] === 'g' ? path[2] : null
    if (!groupId || localStorage.getItem('gonggong.workbench')) return
    localStorage.setItem(
      'gonggong.workbench',
      JSON.stringify({
        mode: 'split',
        benches: {
          [groupId]: {
            tabs: [{ kind: 'run', runId: 'sidebar-test-run', view: 'process', file: null }],
            active: 'run:sidebar-test-run',
            used: {},
          },
        },
      }),
    )
  })
  await adminSession(page.request)
  const groups = await seedGroups(page, '工作台会话')
  await page.goto(`/g/${groups[0]!.id}`)
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(page.getByRole('region', { name: '工作台' })).toBeVisible()
  const original = await page.locator('.sidebar__scroll').elementHandle()
  const { list, before } = await scrollAndClickVisibleGroup(page)
  await expect(page.getByRole('region', { name: '工作台' })).toBeVisible()
  await expect.poll(() => original!.evaluate((el) => el.isConnected)).toBe(true)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(before)
})
