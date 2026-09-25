// Throwaway: V2b screenshots. node e2e/v2b-shots.mjs [only]
import { chromium } from '@playwright/test'

const W = 'http://127.0.0.1:5212'
const only = process.argv[2]
const browser = await chromium.launch()

async function page(scheme, width = 1440, contrast = 'no-preference') {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    contrast,
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('pageerror', e.message))
  await p.goto(`${W}/login`)
  await p.getByLabel('账号').fill('admin')
  await p.getByLabel('密码').fill('Design-Pass-2026!')
  await p.keyboard.press('Enter')
  await p.waitForURL(/\/g\//)
  await p.getByText('退款 v2 迁移').first().waitFor()
  await p.waitForTimeout(1200)
  return p
}
const shot = (p, name) => p.screenshot({ path: `/tmp/v2b-${name}.png` })
const scroller = (p) => p.locator('.chat-scroll')
const toTop = (p, px = 0) => scroller(p).evaluate((el, px) => (el.scrollTop = px), px)

const scenes = {
  async chat(p, s) {
    await shot(p, `chat-${s}`)
  },
  async top(p, s) {
    await toTop(p)
    await p.waitForTimeout(400)
    await shot(p, `top-${s}`)
  },
  async code(p, s) {
    await p.locator('.pn-code').first().scrollIntoViewIfNeeded()
    await p.waitForTimeout(300)
    await shot(p, `code-${s}`)
  },
  async ctx(p, s) {
    const b = p.locator('.pn-bubble').filter({ hasText: '收到，前端' }).first()
    await b.scrollIntoViewIfNeeded()
    await b.click({ button: 'right' })
    await p.waitForTimeout(300)
    await shot(p, `context-${s}`)
    await p.keyboard.press('Escape')
  },
  async mention(p, s) {
    await p.locator('.pn-composer textarea').click()
    await p.keyboard.type('@')
    await p.waitForTimeout(700)
    await shot(p, `mention-${s}`)
    await p.keyboard.press('Escape')
  },
  async emoji(p, s) {
    const b = p.locator('.pn-msg').filter({ hasText: '收到，前端' }).first()
    await b.scrollIntoViewIfNeeded()
    await b.hover()
    await p.getByRole('button', { name: '添加表情回应' }).first().click()
    await p.waitForTimeout(300)
    await shot(p, `emoji-${s}`)
    await p.keyboard.press('Escape')
  },
  async info(p, s) {
    await p.getByRole('button', { name: '群设置' }).click()
    await p.waitForTimeout(500)
    await shot(p, `info-${s}`)
  },
  async profile(p, s) {
    const t = p.locator('.pn-msg__meta .user-card-trigger').filter({ hasText: '赵敏' }).last()
    await t.scrollIntoViewIfNeeded()
    await t.click()
    await p.waitForTimeout(600)
    await shot(p, `profile-${s}`)
  },
  async rail(p, s) {
    await p.getByRole('button', { name: '查看过程' }).first().click({ force: true })
    await p.waitForTimeout(800)
    await shot(p, `rail-${s}`)
  },
}

for (const [s, scheme, contrast] of [
  ['light', 'light', 'no-preference'],
  ['dark', 'dark', 'no-preference'],
]) {
  for (const [name, fn] of Object.entries(scenes)) {
    if (only && !only.split(',').includes(name)) continue
    const p = await page(scheme, 1440, contrast)
    try {
      await fn(p, s)
    } catch (e) {
      console.log(name, s, e.message.split('\n')[0])
    }
    await p.context().close()
  }
}
if (!only || only.includes('mobile')) {
  for (const s of ['light', 'dark']) {
    const p = await page(s, 390)
    await shot(p, `mobile-${s}`)
    await p.context().close()
  }
}
if (!only || only.includes('hc')) {
  const p = await page('light', 1440, 'more')
  await shot(p, 'chat-hc')
  await p.context().close()
}
await browser.close()
