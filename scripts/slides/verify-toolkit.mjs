// Drives every slides template example in Chromium and checks the deck toolkit keys.
// Usage: node scripts/slides/verify-toolkit.mjs [template-id-substring] [--shots <dir>]
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join } from 'node:path'
import { chromium } from '@playwright/test'

const SKILL = join(import.meta.dirname, '../../apps/server/plugins/official/slides/skills/slides')
const TPL = join(SKILL, 'templates')
const args = process.argv.slice(2)
const shotsAt = args.indexOf('--shots')
const shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : null
const only = args[0]

export function entries() {
  const out = []
  for (const id of readdirSync(TPL).sort()) {
    const dir = join(TPL, id)
    if (existsSync(join(dir, 'example.html'))) out.push({ id, path: `templates/${id}/example.html` })
  }
  for (const d of readdirSync(join(TPL, 'html-ppt/templates/full-decks')).sort())
    out.push({ id: `html-ppt/${d}`, path: `templates/html-ppt/templates/full-decks/${d}/index.html` })
  out.push({ id: 'html-ppt/deck', path: 'templates/html-ppt/templates/deck.html' })
  out.push({ id: 'stage-seed', path: 'toolkit/stage-seed.html' })
  out.push({ id: 'guizang-ppt', path: 'templates/guizang-ppt/assets/template.html?splice=1' })
  for (const id of ['simple-deck', 'ib-pitch-book'])
    out.push({ id: `${id}/seed`, path: `templates/${id}/assets/template.html` })
  return out
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}
function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const file = join(SKILL, decodeURIComponent(url.pathname))
    if (!file.startsWith(SKILL) || !existsSync(file)) return res.writeHead(404).end()
    let body = readFileSync(file)
    if (file.endsWith('guizang-ppt/assets/template.html')) {
      const slides = readFileSync(join(dirname(file), 'example-slides.html'), 'utf8')
      body = body.toString().replace('<!-- SLIDES_HERE -->', slides)
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body)
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 4000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => false)
    if (v) return v
    if (Date.now() > end) return false
    await sleep(60)
  }
}

async function check(page, base, e) {
  const fails = []
  const ok = (cond, what) => cond || fails.push(what)
  await page.goto(`${base}/${e.path}`, { waitUntil: 'load' })
  if (!(await page.evaluate(() => !!window.deckToolkit)))
    await page.addScriptTag({ url: `${base}/toolkit/deck-toolkit.js` })
  await sleep(1200)
  const idx = () => page.evaluate(() => window.deckToolkit.index())
  const total = await page.evaluate(() => window.deckToolkit.slides().length)
  if (total < 2) return [`only ${total} slide(s) found`]
  ok((await idx()) === 0, `starts at ${await idx()}`)
  const layer = (k) => page.evaluate((k) => !!document.querySelector(`[data-ggt="${k}"]`), k)

  await page.keyboard.press('ArrowRight')
  ok(await until(async () => (await idx()) === 1), 'ArrowRight still pages (kernel)')
  const to = Math.min(3, total)
  await page.keyboard.type(String(to))
  ok(await layer('jump'), 'digit shows jump badge')
  await page.keyboard.press('Enter')
  ok(await until(async () => (await idx()) === to - 1, 8000), `${to}+Enter jumps (at ${await idx()})`)
  ok(await until(async () => /#\/?\d+$/.test(await page.evaluate(() => location.hash))), 'hash follows page')

  await page.keyboard.press('Shift+Slash')
  ok(await layer('help'), '? opens help')
  await page.keyboard.press('Escape')
  ok(!(await layer('help')), 'Esc closes help')

  await page.keyboard.press('o')
  ok(await layer('overview'), 'O opens overview')
  const tiles = await page.locator('[data-ggt="overview"] .ggt-tile').count()
  ok(tiles === total, `overview tiles ${tiles}/${total}`)
  const last = page.locator('[data-ggt="overview"] iframe').nth(total - 1)
  await last.scrollIntoViewIfNeeded()
  const thumbOk = await until(async () => {
    const f = await (await last.elementHandle()).contentFrame()
    return f && (await f.evaluate(() => window.deckToolkit?.index())) === total - 1
  }, 15000)
  ok(thumbOk, 'last overview thumbnail shows the last slide')
  if (shots) await page.screenshot({ path: join(shots, `${e.id.replace(/\//g, '__')}-overview.png`) })
  await page.locator('[data-ggt="overview"] .ggt-tile').nth(1).click()
  ok(await until(async () => (await idx()) === 1, 8000), 'clicking a tile jumps')
  await sleep(1200)
  ok((await idx()) === 1, 'the click does not reach the template')
  await page.keyboard.press('o')
  await page.locator('[data-ggt="overview"] .ggt-tile').nth(0).click()
  ok(await until(async () => (await idx()) === 0, 8000), 'clicking tile 1 returns to the start')
  ok(!(await layer('overview')), 'overview closes after jump')

  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 3000 }).catch(() => null),
    page.keyboard.press('s'),
  ])
  ok(popup, 'S opens presenter window')
  if (popup) {
    ok(await until(async () => (await popup.textContent('#page')) === `1 / ${total}`), 'presenter shows page')
    await popup.keyboard.press('ArrowRight')
    ok(await until(async () => (await idx()) === 1, 4000), 'presenter → pages the deck')
    ok(await until(async () => (await popup.textContent('#page')) === `2 / ${total}`), 'presenter follows')
    if (shots) {
      await sleep(1500)
      await popup.screenshot({ path: join(shots, `${e.id.replace(/\//g, '__')}-presenter.png`) })
    }
    await popup.close()
  }

  await page.keyboard.press('l')
  ok(await layer('laser'), 'L shows laser')
  await page.keyboard.press('l')
  ok(!(await layer('laser')), 'L again hides laser')

  await page.keyboard.press('d')
  ok(
    await page.evaluate(() => document.querySelector('[data-ggt="ink"]')?.classList.contains('on')),
    'D turns pen on',
  )
  await page.mouse.move(300, 300)
  await page.mouse.down()
  await page.mouse.move(500, 360, { steps: 5 })
  await page.mouse.up()
  const inked = () =>
    page.evaluate(() => {
      const c = document.querySelector('[data-ggt="ink"]')
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < d.length; i += 4) if (d[i]) return true
      return false
    })
  ok(await inked(), 'pen draws')
  await page.keyboard.press('c')
  ok(!(await inked()), 'C clears')
  await page.keyboard.press('Escape')
  ok(
    !(await page.evaluate(() => document.querySelector('[data-ggt="ink"]').classList.contains('on'))),
    'Esc leaves pen',
  )

  for (const [k, kind] of [
    ['b', 'black'],
    ['w', 'white'],
  ]) {
    await page.keyboard.press(k)
    ok(await layer(kind), `${k.toUpperCase()} shows ${kind} screen`)
    const before = await idx()
    await page.keyboard.press('ArrowRight')
    ok(!(await layer(kind)) && (await idx()) === before, `any key leaves ${kind} without paging`)
  }

  await page.evaluate(() => window.deckToolkit.go(0))
  await until(async () => (await idx()) === 0)
  await sleep(600)
  await page.keyboard.press('e')
  ok(await layer('edit'), 'E opens the edit bar')
  const spot = await page.evaluate(async () => {
    const source = await fetch(location.href.split('#')[0]).then((r) => r.text())
    const sl = window.deckToolkit.slides()[window.deckToolkit.index()]
    const order = ['h1', 'h2', 'h3', 'p', 'li', 'td', 'span', 'div'].flatMap((t) => [
      ...sl.querySelectorAll(t),
    ])
    for (const el of order) {
      const tag = el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1)
      if (!source.includes(tag)) continue
      const own = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.nodeValue.trim().length > 1 && source.includes(n.nodeValue.trim()),
      )
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (!own || r.width < 20 || r.height < 8 || cs.visibility === 'hidden' || +cs.opacity < 0.5) continue
      const x = r.left + Math.min(10, r.width / 2)
      const y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      if (hit === el) return { x, y, html: el.outerHTML.slice(0, 120) }
    }
    return null
  })
  ok(spot, 'finds editable text on the slide')
  if (spot) {
    await page.mouse.click(spot.x, spot.y)
    ok(await page.evaluate(() => !!document.querySelector('[data-ggt-edit]')), 'clicking text starts editing')
    await page.keyboard.press('End')
    await page.keyboard.type('【改过】')
    await page.keyboard.press('Escape')
    ok(await page.evaluate(() => !document.querySelector('[contenteditable]')), 'Esc ends the text edit')
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      page.click('[data-ggt="edit"] .save'),
    ])
    const saved = dl ? readFileSync(await dl.path(), 'utf8') : ''
    ok(
      saved.includes('【改过】'),
      `saved copy carries the edit (${spot.html} · ${await page.textContent('[data-ggt="edit"] .msg')})`,
    )
    ok(
      saved.includes('deck-toolkit.js') && !saved.includes('data-ggt-edit'),
      'saved copy is the clean source',
    )
  }
  await page.keyboard.press('Escape')
  ok(!(await layer('edit')), 'Esc leaves edit mode')

  const beforePrint = await idx()
  const pdf = await page.pdf({
    width: '1920px',
    height: '1080px',
    printBackground: true,
    preferCSSPageSize: true,
  })
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
  ok(pages === total, `prints one page per slide (${pages}/${total})`)
  ok(
    await until(async () => (await idx()) === beforePrint),
    `printing keeps the current slide (${beforePrint} → ${await idx()})`,
  )

  await page.evaluate(() => {
    const i = document.createElement('input')
    i.id = 'ggt-probe'
    i.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647'
    document.body.appendChild(i)
    i.focus()
  })
  await page.keyboard.type('o5')
  ok(!(await layer('overview')) && !(await layer('jump')), 'keys pause while typing')
  return fails
}

const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
if (shots) mkdirSync(shots, { recursive: true })
const browser = await chromium.launch()
const list = entries().filter((e) => !only || e.id.includes(only))
let bad = 0
await Promise.all(
  Array.from({ length: 4 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    for (let e = list.shift(); e; e = list.shift()) {
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', (er) => errs.push(String(er.message).slice(0, 120)))
      const fails = await check(page, base, e).catch((er) => [String(er.message).split('\n')[0]])
      if (fails.length) bad++
      console.log(
        `${fails.length ? '✗' : '✓'} ${e.id}${fails.length ? ` — ${fails.join('; ')}` : ''}${errs.length ? ` [pageerror: ${errs[0]}]` : ''}`,
      )
      await page.close()
    }
    await ctx.close()
  }),
)
await browser.close()
server.close()
process.exit(bad ? 1 : 0)
