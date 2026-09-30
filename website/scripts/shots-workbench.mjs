// Usage: node website/scripts/shots-workbench.mjs [shot …]   then: bash website/scripts/to-webp.sh
// Documentation screenshots of the chat page's 工作台 (website/public/screenshots/web/workbench-*.png). No server,
// database or daemon: the web dev server runs on its own port and cache, every /api call and the realtime socket are
// answered inside the page from shots-workbench.data.json (the demo team, recorded from the shots-web.sh stack), and
// the preview pages, simulator and desktop window are constructed screens. livekit-client is swapped for a stand-in
// that "receives" a canvas stream of those screens, so the live views render their playing state.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
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

const FONT = `-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`
const check = (on, color) =>
  on
    ? `<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="10" fill="${color}"/><path d="M6.5 11.2l3 3 6-6.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9.5" fill="none" stroke="#c4c8d0" stroke-width="1.5"/></svg>`

/** A WeChat mini program in the devtools simulator (iPhone frame, 375×812). */
const MINI_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
body { width: 375px; height: 812px; font-family: ${FONT}; background: #f5f6f7; color: #1a1a1a; position: relative; overflow: hidden; }
.status { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 22px 0 28px; font-weight: 600; font-size: 15px; background: #fff; }
.status i { display: inline-block; margin-left: 5px; vertical-align: middle; }
.nav { height: 44px; background: #fff; display: flex; align-items: center; justify-content: center; position: relative; font-size: 17px; font-weight: 600; }
.capsule { position: absolute; right: 7px; top: 6px; width: 87px; height: 32px; border-radius: 16px; border: 0.5px solid rgba(0,0,0,.12); background: rgba(255,255,255,.6); display: flex; align-items: center; }
.capsule span { flex: 1; text-align: center; font-size: 14px; letter-spacing: 1px; }
.capsule b { width: 0.5px; height: 18px; background: rgba(0,0,0,.15); }
.hero { margin: 12px 16px 0; padding: 16px; border-radius: 12px; background: linear-gradient(135deg, #07c160, #10ae6a); color: #fff; }
.hero h2 { font-size: 20px; } .hero p { margin-top: 6px; font-size: 13px; opacity: .9; }
.seg { margin: 14px 16px 8px; display: flex; background: #e9ebee; border-radius: 8px; padding: 2px; font-size: 14px; }
.seg span { flex: 1; text-align: center; padding: 6px 0; border-radius: 6px; color: #555; }
.seg .on { background: #fff; color: #07c160; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.list { margin: 0 16px; background: #fff; border-radius: 12px; overflow: hidden; }
.item { display: flex; align-items: center; gap: 12px; padding: 14px 14px; border-bottom: 0.5px solid #eee; font-size: 15px; }
.item:last-child { border-bottom: 0; }
.item .t { flex: 1; } .item.done .t { color: #aaa; text-decoration: line-through; }
.item em { font-style: normal; font-size: 12px; color: #999; }
.add { position: absolute; right: 22px; bottom: 112px; width: 52px; height: 52px; border-radius: 26px; background: #07c160; color: #fff; font-size: 30px; line-height: 50px; text-align: center; box-shadow: 0 6px 16px rgba(7,193,96,.35); }
.tabbar { position: absolute; left: 0; right: 0; bottom: 0; height: 84px; background: #fff; border-top: 0.5px solid #e5e5e5; display: flex; padding-top: 6px; }
.tabbar div { flex: 1; text-align: center; font-size: 10px; color: #7a7e83; }
.tabbar .on { color: #07c160; }
.tabbar svg { display: block; margin: 0 auto 2px; }
.home { position: absolute; bottom: 8px; left: 50%; width: 134px; height: 5px; margin-left: -67px; border-radius: 3px; background: #111; }
</style></head><body>
<div class="status"><span>9:41</span><span>
<i><svg width="18" height="11"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="6" rx="1"/><rect x="10" y="2.5" width="3" height="8.5" rx="1"/><rect x="15" y="0" width="3" height="11" rx="1"/></svg></i>
<i><svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 11 5.6 8.3a3.4 3.4 0 0 1 4.8 0zM3.3 6a6.6 6.6 0 0 1 9.4 0l1.5-1.6a8.8 8.8 0 0 0-12.4 0zM.4 3.1a10.9 10.9 0 0 1 15.2 0L16 2.6" fill="#000"/></svg></i>
<i><svg width="26" height="12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="#000" opacity=".4"/><rect x="2" y="2" width="17" height="8" rx="2"/><rect x="24" y="4" width="1.6" height="4" rx=".8" opacity=".4"/></svg></i></span></div>
<div class="nav">待办清单<div class="capsule"><span>•••</span><b></b><span>◎</span></div></div>
<div class="hero"><h2>今天 · 9月30日</h2><p>还有 3 项未完成，加油！</p></div>
<div class="seg"><span class="on">全部</span><span>只看未完成</span></div>
<div class="list">${TODOS.map(
  ([t, done], i) =>
    `<div class="item${done ? ' done' : ''}">${check(done, '#07c160')}<span class="t">${t}</span><em>${['今天', '周四', '周五', '已完成', '今天'][i]}</em></div>`,
).join('')}</div>
<div class="add">+</div>
<div class="tabbar">
<div class="on"><svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="18" height="18" rx="4"/><path d="M8.5 13l3 3 6-6"/></svg>待办</div>
<div><svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="6" width="18" height="16" rx="3"/><path d="M4 11h18M9 3.5v5M17 3.5v5"/></svg>日历</div>
<div><svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="13" cy="9.5" r="4.5"/><path d="M4.5 22c1.2-4.2 4.4-6.5 8.5-6.5s7.3 2.3 8.5 6.5" stroke-linecap="round"/></svg>我的</div>
</div><div class="home"></div></body></html>`

/** A desktop build of the same app (an Electron window, 1200×760). */
const DESKTOP_ITEMS = [
  ['给登录页加表单校验', '工作', '#3b6cf6', '今天 18:00', false, true],
  ['周五发版前回归测试', '发版', '#22a06b', '周五', false, false],
  ['评审「只看未完成」交互', '工作', '#3b6cf6', '今天', false, false],
  ['整理本周需求', '工作', '#3b6cf6', '周一', true, false],
  ['README 补充筛选说明', '工作', '#3b6cf6', '昨天', true, false],
  ['预约体检', '个人', '#e8833a', '10月8日', false, false],
]
const DESKTOP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 760px; font-family: ${FONT}; color: #1f2430; background: #fff; display: grid; grid-template-rows: 38px 1fr; overflow: hidden; }
.title { background: #ececef; border-bottom: 1px solid #d9d9de; display: flex; align-items: center; position: relative; font-size: 13px; font-weight: 600; color: #4a4f5a; justify-content: center; }
.lights { position: absolute; left: 14px; top: 12px; display: flex; gap: 8px; }
.lights i { width: 12px; height: 12px; border-radius: 6px; display: block; }
.main { display: grid; grid-template-columns: 232px 1fr; min-height: 0; }
aside { background: #f6f7f9; border-right: 1px solid #e6e8ec; padding: 14px 12px; font-size: 13px; }
.search { background: #e9ebef; border-radius: 7px; padding: 7px 10px; color: #8a909c; margin-bottom: 16px; }
aside h4 { font-size: 11px; color: #8a909c; font-weight: 600; margin: 14px 8px 6px; }
.nav { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 7px; color: #343a46; }
.nav.on { background: #dfe7fd; color: #2a5bd7; font-weight: 600; }
.nav b { margin-left: auto; font-weight: 500; color: #8a909c; font-size: 12px; }
.nav.on b { color: #2a5bd7; }
.dot { width: 9px; height: 9px; border-radius: 5px; }
section { padding: 26px 34px; min-width: 0; }
header { display: flex; align-items: flex-end; gap: 14px; }
header h1 { font-size: 26px; } header span { color: #8a909c; font-size: 14px; margin-bottom: 4px; }
.pills { margin-left: auto; display: flex; background: #f0f2f5; border-radius: 8px; padding: 3px; font-size: 13px; }
.pills span { padding: 5px 14px; border-radius: 6px; color: #5b616e; }
.pills .on { background: #fff; color: #1f2430; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.new { margin: 22px 0 8px; border: 1px dashed #cfd5e0; border-radius: 9px; padding: 11px 14px; color: #9aa1af; font-size: 14px; }
.row { display: flex; align-items: center; gap: 14px; padding: 13px 6px; border-bottom: 1px solid #eef0f4; font-size: 15px; }
.row .t { flex: 1; } .row.done .t { color: #9aa1af; text-decoration: line-through; }
.tag { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
.due { width: 86px; text-align: right; color: #8a909c; font-size: 13px; }
.due.hot { color: #d9480f; }
.star { width: 18px; color: #f5b301; text-align: center; }
footer { margin-top: 16px; color: #8a909c; font-size: 13px; }
</style></head><body>
<div class="title"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>Todo Desktop</div>
<div class="main"><aside>
<div class="search">搜索任务</div>
<div class="nav">📥 收件箱<b>8</b></div><div class="nav on">☀️ 今天<b>3</b></div><div class="nav">🗓 计划<b>4</b></div><div class="nav">✅ 已完成<b>12</b></div>
<h4>我的列表</h4>
<div class="nav"><i class="dot" style="background:#3b6cf6"></i>工作<b>5</b></div>
<div class="nav"><i class="dot" style="background:#e8833a"></i>个人<b>2</b></div>
<div class="nav"><i class="dot" style="background:#22a06b"></i>发版<b>1</b></div>
</aside><section>
<header><h1>今天</h1><span>9月30日 星期三</span><div class="pills"><span class="on">全部</span><span>只看未完成</span></div></header>
<div class="new">＋ 添加任务，回车保存</div>
${DESKTOP_ITEMS.map(
  ([t, tag, color, due, done, hot]) =>
    `<div class="row${done ? ' done' : ''}">${check(done, '#3b6cf6')}<span class="t">${t}</span><span class="tag" style="background:${color}1a;color:${color}">${tag}</span><span class="due${hot ? ' hot' : ''}">${due}</span><span class="star">${hot ? '★' : ''}</span></div>`,
).join('')}
<footer>共 ${DESKTOP_ITEMS.length} 项 · 未完成 ${DESKTOP_ITEMS.filter((i) => !i[4]).length} 项</footer>
</section></div></body></html>`

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
    mp: await one(MINI_PAGE, 375, 812, 2),
    gui: await one(DESKTOP_PAGE, 1200, 760, 2),
  }
}

// ── Stand-in for livekit-client ─────────────────────────────────────────────
/** Joins no room: "subscribes" a canvas stream of `window.__ggLive` and reports steady receiver stats. */
const LIVEKIT = `
export const RoomEvent = { TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed', ConnectionQualityChanged: 'connectionQualityChanged' }
export const Track = { Kind: { Video: 'video', Audio: 'audio' } }
export const ConnectionQuality = { Excellent: 'excellent', Good: 'good', Poor: 'poor', Lost: 'lost', Unknown: 'unknown' }
export const VideoQuality = { LOW: 0, MEDIUM: 1, HIGH: 2, OFF: 3 }
async function stream() {
  const img = new Image()
  img.src = window.__ggLive
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d')
  const draw = () => g.drawImage(img, 0, 0)
  draw()
  setInterval(draw, 33)
  return { stream: c.captureStream(30), width: c.width, height: c.height }
}
class FakeTrack {
  kind = 'video'
  n = 0
  constructor(s) { this.s = s }
  attach(el) { el.srcObject = this.s.stream; el.play?.().catch(() => {}); return el }
  detach(el) { el.srcObject = null; return el }
  async getRTCStatsReport() {
    const n = ++this.n
    return new Map([
      ['in', { type: 'inbound-rtp', kind: 'video', packetsLost: 0, packetsReceived: n * 410, bytesReceived: n * 431000,
        freezeCount: 0, framesPerSecond: 60, jitter: 0.002, frameWidth: this.s.width, frameHeight: this.s.height }],
      ['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.018 }],
    ])
  }
}
export class Room {
  h = {}
  localParticipant = { identity: 'viewer', publishData: async () => {} }
  on(e, f) { (this.h[e] ||= []).push(f); return this }
  async connect() {
    const s = await stream()
    const layers = [1, 2, 4].map((d, i) => ({ quality: 2 - i, width: Math.round(s.width / d), height: Math.round(s.height / d), bitrate: [6e6, 2.5e6, 8e5][i] }))
    const pub = { trackInfo: { codecs: [{ layers }], layers }, setVideoQuality() {} }
    for (const f of this.h[RoomEvent.TrackSubscribed] || []) f(new FakeTrack(s), pub)
  }
  async disconnect() {}
}
`

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
const MIME = { md: 'text/markdown', json: 'application/json', js: 'text/javascript', html: 'text/html', css: 'text/css' }

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
    [`GET ${g}/bots/${FE}/diff`]: { scope: q.get('scope'), patch: D.patch, base: 'origin/main', branch: 'main' },
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
    return { json: { path: p, size: Buffer.byteLength(text), binary: false, mime: MIME[ext] ?? 'text/plain', text } }
  }
  m = path.match(/^\/previews\/([^/]+)\/(snapshot|open|live|watch)$/)
  if (m) {
    const which = Object.keys(PV).find((k) => PV[k] === m[1])
    if (m[2] === 'snapshot') return { body: screens[which], type: 'image/png' }
    if (m[2] === 'open') return { body: TODO_PAGE, type: 'text/html; charset=utf-8' }
    if (m[2] === 'live') return { json: { url: 'wss://livekit.invalid', token: 'shots', identity: D.me.id } }
    return { status: 204 }
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
  mp: `mp:${PV.mp}`,
  live: `live:${PV.gui}`,
}
// The active tab scrolls into view: the previews come first so the bar shows them all.
const TABS = [
  { kind: 'web', previewId: PV.web, path: '/' },
  { kind: 'miniprogram', previewId: PV.mp },
  { kind: 'live', previewId: PV.gui },
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
    ({ bench, live }) => {
      if (window.top !== window) return
      localStorage.setItem('gonggong.theme', 'light')
      localStorage.setItem('gonggong.workbench', JSON.stringify(bench))
      window.__ggLive = live
    },
    { bench, live: active === 'mp' ? '/__shots/mp.png' : '/__shots/gui.png' },
  )
  await ctx.routeWebSocket('**/ws/web', () => {})
  await ctx.route('**/deps/livekit-client.js*', (r) =>
    r.fulfill({ body: LIVEKIT, contentType: 'text/javascript' }),
  )
  await ctx.route('**/__shots/*.png', (r) =>
    r.fulfill({ body: screens[r.request().url().split('/').pop().replace('.png', '')], contentType: 'image/png' }),
  )
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
  await page.getByRole('button', { name: /^工作台/ }).first().click()
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
  'workbench-miniprogram': { active: 'mp', mode: 'split', wait: 3500 },
  'workbench-live': { active: 'live', mode: 'focus', wait: 3500 },
  'workbench-focus': { active: 'run', mode: 'focus' },
  'workbench-fullscreen': { active: 'diff', mode: 'full' },
  'workbench-mobile': {
    active: 'web',
    viewport: { width: 390, height: 844 },
    scale: 3,
    mobile: true,
    then: async (page) => {
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
    await s.then?.(page)
    await shot(page, name, { wait: s.wait })
    await page.context().close()
  }
} finally {
  await browser.close()
  await vite.close()
}
