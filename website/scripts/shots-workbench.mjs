// Usage: node website/scripts/shots-workbench.mjs [shot …]   then: bash website/scripts/to-webp.sh
// Documentation screenshots of the chat page's 工作台 (website/public/screenshots/web/workbench-*.png). No server,
// database or daemon: the web dev server runs on its own port and cache, every /api call and the realtime socket are
// answered inside the page from shots-workbench.data.json (the demo team, recorded from the shots-web.sh stack), and
// the preview page is a constructed screen.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(import.meta.dirname, '../..')
const OUT = join(ROOT, 'website/public/screenshots/web')
const PORT = Number(process.env.WEB_PORT ?? 5397)
const WEB = `http://127.0.0.1:${PORT}`
const PUBLIC_SERVER = 'https://gg.xinghe.dev'
const ONLY = new Set(process.argv.slice(2))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// Recorded on 2026-09-30; moved by whole days to today so dates read 今天 and the clock times stay put.
const DAY = 86_400_000
const shift = Math.floor(Date.now() / DAY) * DAY - Date.parse('2026-09-30T00:00:00Z')
const D = JSON.parse(
  readFileSync(join(import.meta.dirname, 'shots-workbench.data.json'), 'utf8').replace(
    /"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g,
    (_, t) => JSON.stringify(new Date(Date.parse(t) + shift).toISOString()),
  ),
)
const G = D.groupId
const FE = D.feBotId
const PV = D.previews

// ── Constructed screens ─────────────────────────────────────────────────────
const TODOS = [
  ['整理本周需求', true],
  ['给登录页加表单校验', false],
  ['周五发版前回归测试', false],
  ['README 补充筛选说明', true],
  ['评审「只看未完成」交互', false],
]

/** The todo-app page as the bot's service renders it (its real markup and style, list pre-rendered). */
const TODO_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>待办清单</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${D.files['public/style.css']}</style></head>
<body><main class="card"><h1>待办清单</h1>
<form id="new-todo"><input id="title" placeholder="要做点什么？" autocomplete="off"><button type="submit">添加</button></form>
<button id="filter" type="button" class="filter">只看未完成</button>
<ul id="list">${TODOS.map(
  ([t, done]) =>
    `<li class="${done ? 'done' : ''}"><label><input type="checkbox" ${done ? 'checked' : ''}> <span>${t}</span></label><button class="remove" title="删除">×</button></li>`,
).join('')}</ul>
<footer id="summary">共 ${TODOS.length} 项，未完成 ${TODOS.filter((t) => !t[1]).length} 项</footer></main></body></html>`

async function renderScreens(browser) {
  const one = async (html, width, height, scale) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale })
    await page.setContent(html)
    await page.evaluate(() => document.fonts.ready)
    const png = await page.screenshot()
    await page.close()
    return png
  }
  return {
    web: await one(TODO_PAGE, 1280, 800, 1),
  }
}

// ── Mocked API ──────────────────────────────────────────────────────────────
const TREE = (() => {
  const dirs = {}
  for (const path of Object.keys(D.files)) {
    const parts = path.split('/')
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const name = parts[i]
      const isDir = i < parts.length - 1
      dirs[dir] ??= []
      if (!dirs[dir].some((e) => e.name === name))
        dirs[dir].push({
          name,
          dir: isDir,
          size: isDir ? 0 : Buffer.byteLength(D.files[path]),
          mtime: Date.parse('2026-09-30T08:22:40Z') + shift,
          uncommitted: false,
        })
    }
  }
  return dirs
})()
const MIME = {
  md: 'text/markdown',
  json: 'application/json',
  js: 'text/javascript',
  html: 'text/html',
  css: 'text/css',
}

function answer(method, path, q, screens) {
  const g = `/groups/${G}`
  const table = {
    'GET /me': D.me,
    'GET /groups': D.groups,
    'GET /bots': D.bots,
    'GET /machines': D.machines,
    'GET /notifications': D.notifications,
    [`GET ${g}/timeline`]: q.get('before') ? { messages: [], runs: [] } : D.timeline,
    [`GET ${g}/bot-states`]: D.botStates,
    [`GET ${g}/previews`]: D.groupPreviews,
    [`GET ${g}/provider-state`]: { items: [] },
    [`GET ${g}/notices`]: D.notices,
    [`GET ${g}/params`]: D.params,
    [`GET ${g}/local-paths`]: [],
    [`GET ${g}/bots/${FE}/diff`]: {
      scope: q.get('scope'),
      patch: D.patch,
      base: 'origin/main',
      branch: 'main',
    },
  }
  const key = `${method} ${path}`
  if (key in table) return { json: table[key] }
  let m = path.match(/^\/runs\/([^/]+)(\/session)?$/)
  if (m && method === 'GET') return { json: (m[2] ? D.sessions : D.runs)[m[1]] }
  if (path === `${g}/bots/${FE}/files/tree`) {
    const dir = q.get('path') ?? ''
    return { json: { path: dir, entries: TREE[dir] ?? [], truncated: false } }
  }
  if (path === `${g}/bots/${FE}/files/text`) {
    const p = q.get('path')
    const text = D.files[p]
    const ext = p.split('.').pop()
    return {
      json: { path: p, size: Buffer.byteLength(text), binary: false, mime: MIME[ext] ?? 'text/plain', text },
    }
  }
  m = path.match(/^\/previews\/([^/]+)\/(snapshot|open)$/)
  if (m) {
    const which = Object.keys(PV).find((k) => PV[k] === m[1])
    if (m[2] === 'snapshot') return { body: screens[which], type: 'image/png' }
    return { body: TODO_PAGE, type: 'text/html; charset=utf-8' }
  }
  if (path.startsWith('/attachments/')) return { body: screens.web, type: 'image/png' }
  if (method !== 'GET') return { status: 204 }
  return null
}

// ── Browser ─────────────────────────────────────────────────────────────────
const CSS = `*, *::before, *::after { caret-color: transparent !important; }
  ::-webkit-scrollbar { display: none !important; }`

const KEYS = {
  run: `run:${D.runId}`,
  diff: `diff:${FE}`,
  files: `files:${FE}`,
  web: `web:${PV.web}`,
}
// The active tab scrolls into view: the previews come first so the bar shows them all.
const TABS = [
  { kind: 'web', previewId: PV.web, path: '/' },
  { kind: 'run', runId: D.runId, view: 'process', file: null },
  { kind: 'diff', botId: FE, scope: 'base', file: 'public/app.js' },
  { kind: 'files', botId: FE, dir: 'public', selected: 'public/app.js' },
]

async function newPage(browser, screens, { active, mode = 'split', viewport, scale = 2, mobile = false }) {
  const ctx = await browser.newContext({
    baseURL: WEB,
    viewport,
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  })
  const bench = {
    mode,
    benches: { [G]: { tabs: TABS, active: KEYS[active], used: { [KEYS[active]]: Date.now() } } },
  }
  await ctx.addInitScript(
    ({ bench }) => {
      if (window.top !== window) return
      localStorage.setItem('gonggong.theme', 'light')
      localStorage.setItem('gonggong.workbench', JSON.stringify(bench))
    },
    { bench },
  )
  await ctx.routeWebSocket('**/ws/web', () => {})
  await ctx.route(`${WEB}/api/**`, (r) => {
    const url = new URL(r.request().url())
    const path = url.pathname.slice(4)
    const res = answer(r.request().method(), path, url.searchParams, screens)
    if (!res) {
      log('unmocked', r.request().method(), path)
      return r.fulfill({ status: 404, json: { error: 'not_found', message: 'not found' } })
    }
    if (res.json !== undefined) return r.fulfill({ json: res.json })
    if (res.body !== undefined) return r.fulfill({ body: res.body, contentType: res.type })
    return r.fulfill({ status: res.status })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => log('pageerror', e.message))
  await page.goto(`/g/${G}`)
  await page
    .getByRole('button', { name: /^工作台/ })
    .first()
    .click()
  await page.locator('section[aria-label="工作台"]').waitFor()
  if (mode === 'full') await page.getByRole('button', { name: '全屏', exact: true }).click()
  return page
}

/** Replaces this dev server's origin with the demo team's public address. */
async function scrub(page) {
  const pairs = [
    [WEB, PUBLIC_SERVER],
    [encodeURIComponent(WEB), encodeURIComponent(PUBLIC_SERVER)],
  ]
  await page.evaluate((pairs) => {
    const fix = (s) => pairs.reduce((acc, [a, b]) => acc.split(a).join(b), s)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = fix(n.nodeValue)
      if (v !== n.nodeValue) n.nodeValue = v
    }
  }, pairs)
}

async function shot(page, name, { wait = 1500 } = {}) {
  await page.mouse.move(page.viewportSize().width - 2, page.viewportSize().height - 2)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await sleep(wait)
  await page.addStyleTag({ content: CSS })
  await scrub(page)
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' })
  log('shot', name)
}

const DESKTOP = { width: 1440, height: 900 }
const SCENES = {
  'workbench-split': { active: 'web', mode: 'split' },
  'workbench-web': { active: 'web', mode: 'focus' },
  'workbench-focus': { active: 'run', mode: 'focus' },
  'workbench-fullscreen': { active: 'diff', mode: 'full' },
  'workbench-mobile': {
    active: 'web',
    viewport: { width: 390, height: 844 },
    scale: 3,
    mobile: true,
    act: async (page) => {
      // A phone mounts only the shown tab: visit the run once so the list knows its round.
      const pick = async (name) => {
        await page.getByRole('button', { name: '全部标签页' }).click()
        await page.locator('.bench-switch__pick', { hasText: name }).click()
        await sleep(1500)
      }
      await pick('运行')
      await pick('todo-app')
    },
  },
}

// ── Main ────────────────────────────────────────────────────────────────────
process.env.GONGGONG_SERVER = 'http://127.0.0.1:9' // nothing may reach a real server
const req = createRequire(join(ROOT, 'apps/web/package.json'))
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href)
const vite = await createServer({
  root: join(ROOT, 'apps/web'),
  configFile: join(ROOT, 'apps/web/vite.config.ts'),
  cacheDir: join(ROOT, 'node_modules/.cache/shots-workbench-vite'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false },
})
await vite.listen()
const browser = await chromium.launch()
try {
  const screens = await renderScreens(browser)
  // The first load lets Vite optimise dependencies (it reloads the page when it finds new ones).
  const warm = await newPage(browser, screens, { viewport: DESKTOP, active: 'web' })
  await sleep(3000)
  await warm.context().close()
  for (const [name, s] of Object.entries(SCENES)) {
    if (ONLY.size && !ONLY.has(name)) continue
    const page = await newPage(browser, screens, { viewport: DESKTOP, ...s })
    await s.act?.(page)
    await shot(page, name, { wait: s.wait })
    await page.context().close()
  }
} finally {
  await browser.close()
  await vite.close()
}
