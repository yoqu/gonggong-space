import { expect, test } from '@playwright/test'
import { buildDaemon, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test('on a phone the composer draws its @ highlight with the same font as the text being typed', async ({
  page,
}) => {
  const { api } = await memberWithMachine(page, 'mobile1')
  const name = 'mobile1 Claude'
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name,
    ownerId: (await api.me()).id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: 'mobile1',
    kind: 'group',
    botIds: [bot.id],
    repo: null,
  })
  await page.goto(`/g/${group.id}`)
  const input = page.getByPlaceholder('发消息，@ 触发 Bot')
  await input.fill(`@${name} 帮我看看这个问题`)
  const mirror = page.locator('.pn-composer__mirror')
  await expect(mirror).toContainText(name)
  await input.press('End')
  await page
    .locator('.pn-composer')
    .screenshot({ path: test.info().outputPath('composer.png'), caret: 'initial' })
  const font = (el: Element) => getComputedStyle(el).fontSize
  expect(await input.evaluate(font)).toBe('16px')
  expect(await mirror.evaluate(font)).toBe('16px')
  // Same font: the transparent text the caret follows lies right on the drawn one.
  expect(await mirror.evaluate((el) => el.scrollHeight)).toBe(await input.evaluate((el) => el.scrollHeight))
})

test('on a phone the send button stays inside the composer after @-ing two bots with long names', async ({
  page,
}) => {
  const { api } = await memberWithMachine(page, 'mobile2')
  const ownerId = (await api.me()).id
  const machineId = await api.machineId()
  const names = ['mobile2 闵盛冰的 Codex 长长长名字', 'mobile2 姜维川的 Claude 长长长名字']
  const botIds: string[] = []
  for (const name of names) {
    const bot = await api.call<{ id: string }>('post', '/api/bots', {
      name,
      ownerId,
      agentKind: 'claude',
      avatar: 'role-no',
      machineId,
      systemPrompt: '',
    })
    botIds.push(bot.id)
  }
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: 'mobile2',
    kind: 'group',
    botIds,
    repo: null,
  })
  await page.goto(`/g/${group.id}`)
  const input = page.getByPlaceholder('发消息，@ 触发 Bot')
  await input.fill(`@${names[0]} @${names[1]} 看看`)
  await expect(page.locator('.run-config__chip')).toHaveCount(2)
  await page.locator('.pn-composer').screenshot({ path: test.info().outputPath('composer.png') })
  const composer = (await page.locator('.pn-composer').boundingBox())!
  const send = page.getByRole('button', { name: '发送', exact: true })
  const box = (await send.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(composer.x)
  expect(box.x + box.width).toBeLessThanOrEqual(composer.x + composer.width)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await send.click()
  await expect(input).toHaveValue('')
})

test('on a phone dialogs rise as bottom sheets with 16px fields and side panels fill the screen', async ({
  page,
}) => {
  const { api } = await memberWithMachine(page, 'mobile3')
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: 'mobile3',
    kind: 'group',
    botIds: [],
    repo: null,
  })
  await page.goto(`/g/${group.id}`)
  await page.getByRole('button', { name: '群设置' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!
      return [Math.round(box.x), Math.round(box.width), Math.round(box.y + box.height)]
    })
    .toEqual([0, 390, 844])
  const name = dialog.getByRole('textbox').first()
  expect(await name.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: /^群成员/ }).click()
  const rail = page.locator('.chat__rail--overlay')
  await expect
    .poll(async () => {
      const box = (await rail.boundingBox())!
      return [Math.round(box.x), Math.round(box.width)]
    })
    .toEqual([0, 390])
  await rail.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(rail).toHaveCount(0)
})

test('on a phone a file opened from a thread shows over it, and back returns to the thread, then the chat', async ({
  page,
}) => {
  const { api } = await memberWithMachine(page, 'mobile4')
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: 'mobile4',
    kind: 'group',
    botIds: [],
    repo: null,
  })
  const res = await page.request.post('/api/uploads', {
    multipart: {
      groupId: group.id,
      file: { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# 拆分说明\n') },
    },
  })
  expect(res.ok()).toBe(true)
  const upload = (await res.json()) as { id: string }
  const root = await api.call<{ id: string }>('post', `/api/groups/${group.id}/messages`, {
    body: '退款要不要拆',
    clientId: 'mobile4-root',
  })
  await api.call('post', `/api/groups/${group.id}/messages`, {
    body: '附上说明',
    clientId: 'mobile4-reply',
    threadRootId: root.id,
    attachmentIds: [upload.id],
  })
  await page.goto(`/g/${group.id}`)
  await page.getByRole('button', { name: /1 条回复/ }).click()
  const thread = page.locator('.chat__rail--overlay')
  await expect(thread.getByText('附上说明')).toBeVisible()

  await thread.getByText('notes.md').click()
  const bench = page.getByRole('region', { name: '工作台' })
  await expect(bench).toBeVisible()
  await expect(thread).toHaveCount(0)

  await page.goBack()
  await expect(bench).toHaveCount(0)
  await expect(thread.getByText('附上说明')).toBeVisible()
  await page.goBack()
  await expect(thread).toHaveCount(0)
  await expect(page.getByRole('main').getByText('退款要不要拆', { exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(`/g/${group.id}`)
})
