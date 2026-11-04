import { expect, test } from '@playwright/test'
import { adminSession, call } from './helpers'

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

test('market smoke: an author publishes past the preflight; a member finds it, installs it to My Skills, sees it in /, removes it', async ({
  page,
  browser,
}) => {
  test.setTimeout(3 * 60_000)
  const tag = Date.now().toString(36)
  const name = `smoke-${tag}`
  const admin = (await browser.newContext({ baseURL: 'http://127.0.0.1:5190' })).request
  await adminSession(admin)
  await call(admin, 'post', '/api/admin/users', {
    account: `mk${tag}`,
    name: `mk${tag}`,
    role: 'member',
    password: 'init-pass-1',
  })
  await call(page.request, 'post', '/api/auth/login', { account: `mk${tag}`, password: 'init-pass-1' })
  await call(page.request, 'post', '/api/auth/password', {
    oldPassword: 'init-pass-1',
    newPassword: 'member-pass',
  })
  const group = await call<{ id: string }>(page.request, 'post', '/api/groups', {
    name: '市场冒烟',
    kind: 'group',
    botIds: [],
    repo: null,
  })

  await test.step('我的发布: the preflight says what saving does, then the draft goes to review', async () => {
    await page.goto('/market?tab=mine')
    await page.getByRole('button', { name: '发布…' }).first().click()
    const dialog = page.getByRole('dialog', { name: '发布到市场' })
    await dialog.getByRole('radio', { name: '公开' }).locator('xpath=..').click()
    await dialog.getByRole('radio', { name: '粘贴 SKILL.md' }).click()
    const box = dialog.getByRole('textbox', { name: 'SKILL.md' })
    await box.fill(`---\nname: ${name}\n---\n先跑测试。\n`)
    await expect(dialog.getByText('SKILL.md 缺少 description（最长 1024 个字符）')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '保存草稿' })).toBeDisabled()
    await box.fill(`---\nname: ${name}\ndescription: 冒烟用的 Skill\n---\n先跑测试。\n`)
    await expect(dialog.getByText(`将新建 Skill「${name}」，保存为草稿 r1`)).toBeVisible()
    await dialog.getByRole('button', { name: '保存草稿' }).click()
    await expect(dialog.getByText(`已保存「${name}」草稿 r1`)).toBeVisible()
    await dialog.getByRole('textbox', { name: '更新说明' }).fill('首版')
    await dialog.getByRole('button', { name: '提交审核' }).click()
    await expect(dialog).toBeHidden()
  })

  await test.step('a sysadmin approves it', async () => {
    const [item] = (
      await call<{ listing: { id: string; name: string }; version: { id: string } }[]>(
        admin,
        'get',
        '/api/market/reviews',
      )
    ).filter((x) => x.listing.name === name)
    await call(admin, 'post', `/api/market/${item!.listing.id}/versions/${item!.version.id}/review`, {
      approve: true,
    })
  })

  await test.step('全部条目: search, open the detail, 引入到… 我的 Skill', async () => {
    await page.goto('/market')
    await page.getByRole('searchbox', { name: '搜索市场' }).fill(name)
    await page.getByRole('button', { name: `查看 ${name}` }).click()
    const drawer = page.getByRole('dialog', { name })
    await expect(drawer.getByText('冒烟用的 Skill').first()).toBeVisible()
    await drawer.getByRole('button', { name: '引入到…' }).click()
    const install = page.getByRole('dialog', { name: `引入「${name}」` })
    await install.getByRole('radio', { name: '我的 Skill' }).click()
    await install.getByRole('button', { name: '引入', exact: true }).click()
    await expect(install).toBeHidden()
    await expect(drawer.getByText('已引入到：我的 Skill')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: `查看 ${name}` }).getByText('已引入')).toBeVisible()
  })

  const listed = async () => {
    await page.goto(`/g/${group.id}`)
    await page.getByPlaceholder(composer).fill(`/${name}`)
    return page
      .getByRole('listbox', { name: '/ 命令' })
      .getByRole('group', { name: '我的 Skill' })
      .getByRole('option', { name: new RegExp(`/${name}`) })
  }

  await test.step('/ lists it under 我的 Skill', async () => {
    await expect(await listed()).toBeVisible()
  })

  await test.step('设置 · 我的 Skill removes it, and / no longer lists it', async () => {
    await page.getByPlaceholder(composer).fill('')
    await page.getByRole('button', { name: '账户菜单' }).click()
    await page.getByRole('menuitem', { name: '设置…' }).click()
    const settings = page.getByRole('dialog', { name: '外观' })
    await settings.getByRole('button', { name: '我的 Skill' }).click()
    const mine = page.getByRole('dialog', { name: '我的 Skill' })
    await mine.getByRole('button', { name: `移除 ${name}` }).click()
    await page
      .getByRole('alertdialog', { name: `移除 ${name}？` })
      .getByRole('button', { name: '移除' })
      .click()
    await expect(mine.getByRole('button', { name: `移除 ${name}` })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(await listed()).toHaveCount(0)
  })
})
