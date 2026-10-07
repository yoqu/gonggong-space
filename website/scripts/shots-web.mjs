// Documentation screenshots for the Web client (website/public/screenshots/web). Run through shots-web.sh, which
// starts the isolated stack. Setup creates the demo team (accounts, machines, bots, groups) and drives real Claude
// Code / Codex runs plus the scriptable mock agent; scenes then capture. `node shots-web.mjs <shot> …` limits output.
import { execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, request } from '@playwright/test'

const ROOT = join(import.meta.dirname, '../..')
const DOCS = process.env.DOCS_DIR ?? '/tmp/gg-docs'
const WEB = 'http://127.0.0.1:5195'
const SERVER = 'http://127.0.0.1:8795'
const OUT = join(ROOT, 'website/public/screenshots/web')
const GG = join(ROOT, 'target/debug/gg')
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`
const REPO_URL = process.env.GG_DOCS_REPO_URL ?? 'https://git.xinghe.dev/xinghe/todo-app.git'
const ADMIN_INIT = process.env.GG_DOCS_ADMIN_PASSWORD
const PASS = 'Xinghe@2026'
const COMPOSER = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
const PUBLIC_SERVER = 'https://gg.xinghe.dev'
const isMain = process.argv[1] === import.meta.filename
const ONLY = new Set(isMain ? process.argv.slice(2) : (process.env.SHOTS_ONLY?.split(',') ?? []))

const USERS = [
  { key: 'wanglei', name: '王磊', role: 'sysadmin', machine: 'wanglei-mbp', home: '/Users/wanglei' },
  { key: 'lina', name: '李娜', role: 'member', machine: 'lina-thinkpad', home: '/home/lina' },
  { key: 'chenchen', name: '陈晨', role: 'member', machine: 'chenchen-mini', home: '/Users/chenchen' },
]
const BOTS = [
  {
    key: 'fe',
    name: '前端小助手',
    owner: 'wanglei',
    agentKind: 'claude',
    avatar: 'role-braces',
    model: 'sonnet',
    systemPrompt:
      '你是星河工作室的前端工程师，负责 todo-app 的页面与交互。改动保持小而清晰，用中文简要汇报。',
  },
  {
    key: 'be',
    name: '后端助手',
    owner: 'lina',
    agentKind: 'codex',
    avatar: 'role-abacus',
    systemPrompt: '你负责 todo-app 的服务端与接口，关注安全与性能。回答简洁。',
  },
  {
    key: 'qa',
    name: '测试助手',
    owner: 'chenchen',
    agentKind: 'claude',
    avatar: 'role-sentry',
    systemPrompt: '你负责测试与发版前检查，发现问题及时在群里提出。',
  },
]
const HOST = execFileSync('hostname', { encoding: 'utf8' }).trim().split('.')[0]
const USER = homedir().split('/').pop()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function until(what, fn, timeout = 120_000, every = 1000) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn().catch(() => undefined)
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await sleep(every)
  }
}

// ── API ─────────────────────────────────────────────────────────────────────
async function session(account, password) {
  const ctx = await request.newContext({ baseURL: WEB, extraHTTPHeaders: { origin: WEB } })
  const api = async (method, path, data) => {
    const res = await ctx.fetch(path, { method, data })
    const text = await res.text()
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  api.ctx = ctx
  await api('POST', '/api/auth/login', { account, password })
  return api
}

function psql(sql) {
  const args = ['-h', '/tmp', '-p', '54329', '-U', 'gonggong', '-d', 'gonggong_docs', '-tAc', sql]
  return execFileSync('psql', args, { encoding: 'utf8' }).trim()
}

let clientSeq = 0
const say = (api, groupId, body, extra = {}) =>
  api('POST', `/api/groups/${groupId}/messages`, {
    body,
    clientId: `docs-${Date.now()}-${clientSeq++}`,
    ...extra,
  })

const timeline = (api, groupId) => api('GET', `/api/groups/${groupId}/timeline`)
const TERMINAL = ['forbidden', 'completed', 'interrupted', 'expired']

/** The run a message triggered for `botId`, once it reaches one of `statuses` (default: finished). */
async function runOf(api, groupId, messageId, botId, statuses = TERMINAL, timeout = 300_000) {
  return until(
    `run ${botId} → ${statuses}`,
    async () => {
      const run = (await timeline(api, groupId)).runs.find(
        (r) => r.triggerMessageId === messageId && r.botId === botId,
      )
      return run && statuses.includes(run.status) ? run : null
    },
    timeout,
    700,
  )
}

// ── Daemons ─────────────────────────────────────────────────────────────────
const daemons = []
function startDaemon(name, code, extraEnv = {}) {
  const home = join(DOCS, 'machines', name)
  const codexHome = join(home, 'codex')
  mkdirSync(codexHome, { recursive: true })
  // Codex reuses only the login; the developer's config.toml may pin something else.
  const auth = join(homedir(), '.codex', 'auth.json')
  if (existsSync(auth)) copyFileSync(auth, join(codexHome, 'auth.json'))
  const env = {
    ...process.env,
    GONGGONG_HOME: home,
    GONGGONG_MACHINE_ID: `docs-${name}`,
    GONGGONG_NO_AUTO_UPGRADE: '1',
    GONGGONG_LOG: 'info',
    CODEX_HOME: codexHome,
    ...extraEnv,
  }
  execFileSync(GG, ['login', '--server', SERVER, '--code', code], { env, stdio: 'ignore' })
  const run = () => {
    const out = openSync(join(DOCS, 'logs', `gg-${name}.log`), 'a')
    const proc = spawn(GG, ['run'], { env, stdio: ['ignore', out, out] })
    daemons.push(proc)
    writeFileSync(join(DOCS, 'daemons.pid'), daemons.map((d) => d.pid).join('\n'))
    return proc
  }
  let proc = run()
  return {
    /** The daemon probes the model catalog once per process; a restart retries a failed probe. */
    restart() {
      proc.kill()
      proc = run()
    },
  }
}
process.on('exit', () => {
  for (const d of daemons) d.kill()
})
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

/** 陈晨's machine runs the mock agent, so it can browse a made-up home instead of this host's. */
function fakeHome(user) {
  const home = join(DOCS, 'home', user)
  for (const d of [
    'Desktop',
    'Documents',
    'Downloads',
    'code/todo-app',
    'code/xinghe-site',
    'code/playground',
  ])
    mkdirSync(join(home, d), { recursive: true })
  return home
}

// ── Setup ───────────────────────────────────────────────────────────────────
const statePath = join(DOCS, 'state.json')
const S = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
const save = () => writeFileSync(statePath, JSON.stringify(S, null, 2))

async function setupAccounts() {
  const admin = await session('admin', ADMIN_INIT)
  await admin('POST', '/api/auth/password', { oldPassword: ADMIN_INIT, newPassword: PASS })
  S.users = {}
  for (const u of USERS) {
    const init = `init-${u.key}-01`
    const dto = await admin('POST', '/api/admin/users', {
      account: u.key,
      name: u.name,
      role: u.role,
      password: init,
    })
    S.users[u.key] = { id: dto.id, init }
  }
  save()
}

/** Everyone but 王磊 changes the initial password via API; 王磊 does it in the browser for change-password.png. */
async function apis() {
  const out = {}
  for (const u of USERS) {
    const st = S.users[u.key]
    if (!st.changed) {
      const a = await session(u.key, st.init)
      await a('POST', '/api/auth/password', { oldPassword: st.init, newPassword: PASS })
      st.changed = true
      save()
    }
    out[u.key] = await session(u.key, PASS)
  }
  return out
}

async function setupMachines(A) {
  S.machines = {}
  for (const u of USERS) {
    const { code } = await A[u.key]('POST', '/api/bind-codes')
    const d = startDaemon(
      u.machine,
      code,
      u.key === 'chenchen' ? { GONGGONG_ADAPTER_CMD: MOCK, HOME: fakeHome('chenchen') } : {},
    )
    const m = await until(`${u.machine} online`, async () => {
      const [m] = await A[u.key]('GET', '/api/machines')
      return m?.online && m.agents?.length ? m : null
    })
    S.machines[u.key] = m.id
    // 前端小助手 picks a model, and the composer's model chip needs the catalog: retry a failed Claude probe.
    if (u.key === 'wanglei')
      for (let i = 0; i < 4; i++) {
        const ok = await until(
          'claude catalog',
          async () =>
            (await A.wanglei('GET', '/api/machines'))[0].agents.find((a) => a.kind === 'claude')?.catalog,
          45_000,
          2000,
        ).catch(() => null)
        if (ok) break
        log('claude catalog missing, restarting the daemon')
        d.restart()
      }
  }
  maskMachines()
  save()
}

/** The daemon reports this host's name and MAC on connect; the demo shows one name per member instead. */
function maskMachines() {
  USERS.forEach((u, i) => {
    const mac = `"a4:83:e7:2c:5${i}:1f"`
    psql(
      `update machines set name='${u.machine}', label=null, system = jsonb_set(coalesce(system,'{}'::jsonb), '{macAddress}', '${mac}') where id='${S.machines[u.key]}'`,
    )
  })
}

async function setupBots(A) {
  S.bots = {}
  for (const b of BOTS) {
    const create = (model) =>
      A[b.owner]('POST', '/api/bots', {
        name: b.name,
        ownerId: S.users[b.owner].id,
        agentKind: b.agentKind,
        machineId: S.machines[b.owner],
        systemPrompt: b.systemPrompt,
        avatar: b.avatar,
        model,
      })
    // A bot with a model needs the machine's model list, which a flaky probe may not deliver: then keep the default.
    const dto = b.model
      ? await until(`create ${b.name}`, () => create(b.model), 60_000, 2000).catch(() => create(null))
      : await create(null)
    await A[b.owner]('PATCH', `/api/bots/${dto.id}`, { triggerScope: 'all' })
    S.bots[b.key] = dto.id
  }
  save()
}

/** Repo groups clone on their own; repo-less ones need the managed workspace bound once the machine is online. */
async function bindAll(api, groupId, botIds) {
  await until(
    'bots ready',
    async () => {
      const states = await api('GET', `/api/groups/${groupId}/bot-states`)
      const pending = botIds.filter((id) => states.find((s) => s.botId === id)?.state !== 'ready')
      for (const id of pending)
        if (states.find((s) => s.botId === id)?.state === 'unbound')
          await api.ctx.put(`/api/groups/${groupId}/bots/${id}/workspace`, { data: { path: null } })
      return !pending.length
    },
    180_000,
    2000,
  )
}

async function setupGroups(A) {
  const w = A.wanglei
  const members = [S.users.lina.id, S.users.chenchen.id]
  const group = (name, botIds, repo = null, memberIds = members) =>
    w('POST', '/api/groups', { name, kind: 'group', memberIds, botIds, repo })
  const repo = { url: REPO_URL, branch: 'main' }
  S.groups = {
    weekly: (await group('周报与杂事', [])).id,
    site: (await group('官网改版', [S.bots.qa])).id,
    release: (await group('发版检查', [S.bots.qa], repo, [S.users.chenchen.id])).id,
    product: (await group('产品需求讨论', [S.bots.fe])).id,
    dev: (await group('todo-app 开发群', [S.bots.fe, S.bots.be, S.bots.qa], repo)).id,
  }
  S.dm = (await w('POST', '/api/groups', { name: '前端小助手', kind: 'dm', botIds: [S.bots.fe] })).id
  save()
  await w('PATCH', `/api/groups/${S.groups.dev}`, {
    notice: '本周目标：周五前完成待办筛选与 README 更新；合并前请 @测试助手 过一遍。',
  })
  await bindAll(w, S.groups.dev, [S.bots.fe, S.bots.be, S.bots.qa])
  await bindAll(w, S.groups.release, [S.bots.qa])
  await bindAll(w, S.groups.product, [S.bots.fe])
  await bindAll(w, S.dm, [S.bots.fe])
  await say(A.lina, S.groups.weekly, '本周周报请周五 18:00 前发到群里～')
  await say(A.wanglei, S.groups.weekly, '收到，我这边会附上 todo-app 的进展。')
  await say(A.lina, S.groups.site, '官网首页的新版设计稿已经上传到设计库了，下周开工。')
  await say(A.lina, S.groups.product, '下个版本想加「只看未完成」筛选，大家看看交互怎么做比较顺手？')
  await say(A.chenchen, S.groups.product, '建议放在列表上方，和计数放一起，切换后记住上次的选择。')
  await say(A.lina, S.groups.dev, '早～今天先把待办筛选做了吧，交互已经和产品确认：列表上方一个切换按钮。')
  await say(A.chenchen, S.groups.dev, '好的，做完我来补一轮回归测试。')
}

// ── Browser ─────────────────────────────────────────────────────────────────
let browser
const CSS = `*, *::before, *::after { caret-color: transparent !important; }
  ::-webkit-scrollbar { display: none !important; }`

async function newPage(api, { theme = 'light', viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({
    baseURL: WEB,
    viewport,
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    storageState: api ? await api.ctx.storageState() : undefined,
  })
  await ctx.addInitScript((t) => localStorage.setItem('gonggong.theme', t), theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => log('pageerror', e.message))
  return page
}

/** Replaces anything that identifies the machine this runs on (host name, user, scratch paths). */
async function scrub(page, extra = []) {
  const machines = USERS.flatMap((u) => {
    const dir = `${DOCS}/machines/${u.machine}`
    return [
      [`/private${dir}`, `${u.home}/.gonggong`],
      [dir, `${u.home}/.gonggong`],
    ]
  })
  const pairs = [
    ...extra,
    ...machines,
    [`/private${DOCS}/home/chenchen`, '/Users/chenchen'],
    [`${DOCS}/home/chenchen`, '/Users/chenchen'],
    [WEB, PUBLIC_SERVER],
    [encodeURIComponent(WEB), encodeURIComponent(PUBLIC_SERVER)],
    ['http://127.0.0.1:', `${PUBLIC_SERVER}:`],
    [`/private${DOCS}`, '/Users/wanglei/gonggong'],
    [DOCS, '/Users/wanglei/gonggong'],
    [HOST, 'wanglei-mbp'],
    [`/Users/${USER}`, '/Users/wanglei'],
    [USER, 'wanglei'],
  ]
  await page.evaluate((pairs) => {
    const fix = (s) => pairs.reduce((acc, [a, b]) => acc.split(a).join(b), s)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = fix(n.nodeValue)
      if (v !== n.nodeValue) n.nodeValue = v
    }
    for (const el of document.querySelectorAll('input, textarea, [title], [placeholder]')) {
      for (const a of ['title', 'placeholder'])
        if (el.hasAttribute(a)) el.setAttribute(a, fix(el.getAttribute(a)))
      if (typeof el.value === 'string' && el.value) el.value = fix(el.value)
    }
  }, pairs)
}

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await sleep(ms)
}

const want = (name) => !ONLY.size || ONLY.has(name)

/** Viewport shot, or a padded clip around `target` (a locator or a list of them). */
async function shot(page, name, target, { pad = 16, extra = [], wait = 700, blur = false } = {}) {
  if (!want(name)) return
  await page.mouse.move(page.viewportSize().width - 2, 2)
  if (blur) await page.evaluate(() => document.activeElement?.blur())
  await settle(page, wait)
  await page.addStyleTag({ content: CSS })
  await scrub(page, extra)
  let clip
  if (target) {
    const boxes = []
    for (const t of [target].flat()) {
      const b = await t.boundingBox()
      if (!b) throw new Error(`${name}: target not visible`)
      boxes.push(b)
    }
    const vp = page.viewportSize()
    const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
    const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
    const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
    const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
    clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
  await page.screenshot({ path: join(OUT, `${name}.png`), clip, animations: 'disabled' })
  log('shot', name)
}

const composer = (page) => page.getByPlaceholder(COMPOSER)
const composerBox = (page) => page.locator('.composer').last()
const runCard = (page) => page.getByTestId('run-card').last()

async function openGroup(page, groupId) {
  await page.goto(`/g/${groupId}`)
  await composer(page).waitFor()
  await settle(page, 1200)
}

async function close(page) {
  await page.keyboard.press('Escape')
  await sleep(400)
}

// ── Scenes: authentication ──────────────────────────────────────────────────
async function sceneFirstLogin() {
  const page = await newPage(null)
  await page.goto('/login')
  await page.getByLabel('账号').fill('wanglei')
  await page.getByLabel('密码').fill('••••••••••')
  await page.getByLabel('密码').blur()
  await shot(page, 'login')
  await page.getByLabel('密码').fill(S.users.wanglei.init)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByLabel('初始密码').fill(S.users.wanglei.init)
  await page.getByLabel('新密码', { exact: true }).fill(PASS)
  await page.getByLabel('确认新密码').fill(PASS)
  await page.getByLabel('确认新密码').blur()
  await shot(page, 'change-password')
  await page.getByRole('button', { name: '修改密码' }).click()
  await page.getByLabel('初始密码').waitFor({ state: 'hidden' })
  S.users.wanglei.changed = true
  save()
  await settle(page, 1500)
  await shot(page, 'welcome')
  await page.context().close()
}

async function sceneRegister(A) {
  await A.wanglei('PUT', '/api/admin/params', { registrationOpen: true })
  const page = await newPage(null)
  await page.goto('/register')
  await settle(page, 1000)
  await shot(page, 'register')
  await page.context().close()
  await A.wanglei('PUT', '/api/admin/params', { registrationOpen: false })
}

// ── Scenes: real runs in todo-app 开发群 ────────────────────────────────────
/** Clicks 批准 on every permission request the card shows until the run ends. */
async function approveUntilDone(page, api, groupId, messageId, botId) {
  for (;;) {
    const run = (await timeline(api, groupId)).runs.find(
      (r) => r.triggerMessageId === messageId && r.botId === botId,
    )
    if (run && TERMINAL.includes(run.status)) return run
    const ok = page.getByRole('main').getByRole('button', { name: '批准', exact: true }).last()
    if (await ok.isVisible().catch(() => false)) await ok.click().catch(() => {})
    await sleep(1500)
  }
}

async function sceneRealRuns(A) {
  const w = A.wanglei
  const G = S.groups.dev
  const page = await newPage(w)
  await openGroup(page, G)

  // @ candidates and the per-message model chip, before the first real request.
  await composer(page).fill('@')
  await page.getByText('成员 / Bot').waitFor()
  await shot(page, 'composer-mention', [page.getByRole('listbox'), composerBox(page)], { pad: 12 })
  await composer(page).fill('/')
  await page.getByText('系统命令').waitFor()
  await shot(page, 'composer-commands', [page.getByRole('listbox'), composerBox(page)], { pad: 12 })
  await step('run-config-chips', async () => {
    await composer(page).fill('@前端小助手 ')
    await close(page)
    const chip = page.getByRole('button', { name: '前端小助手 的模型与推理强度' })
    await chip.click({ timeout: 5000 })
    await page
      .getByRole('menuitemcheckbox', { name: /Opus/ })
      .or(page.getByRole('menuitem', { name: /Opus/ }))
      .first()
      .click()
    await chip.click()
    await page.getByText('设为本群默认').waitFor()
    await shot(page, 'run-config-chips', [page.getByRole('menu').last(), chip], { pad: 12 })
  })
  await close(page)
  await openGroup(page, G)

  // R1: a real feature request; full access so no approvals interrupt it.
  await w('PATCH', `/api/bots/${S.bots.fe}`, { tier: 'full' })
  const m1 = await say(
    w,
    G,
    '@前端小助手 给待办列表加一个「只看未完成」的筛选按钮（放在列表上方，选择记在 localStorage），并在 README 里补一句说明。改完简要汇报。',
  )
  await runOf(w, G, m1.id, S.bots.fe, ['running'])
  await page.getByTestId('run-card').last().getByText('运行中').waitFor()
  // Until the card shows what the agent is doing rather than the generic first step.
  await until(
    'a step',
    async () => !(await runCard(page).innerText()).includes('正在工作'),
    15_000,
    300,
  ).catch(() => {})
  await sleep(1500)
  await shot(page, 'run-card', runCard(page), { wait: 100 })
  const card = runCard(page)
  if (await card.getByRole('button', { name: '打断并追加' }).isVisible()) {
    await card.getByRole('button', { name: '打断并追加' }).click()
    await page.getByText('打断并追加到 前端小助手').waitFor()
    await composer(page).fill('另外按钮文案用「只看未完成 / 显示全部」来回切换')
    await shot(page, 'append', [runCard(page), composerBox(page)], { wait: 100 })
    await page.getByRole('button', { name: '发送' }).click()
  }
  S.r1 = (await runOf(w, G, m1.id, S.bots.fe)).id
  save()
  await say(A.chenchen, G, '收到，我先在本地看看效果，一会儿把截图发群里。')

  // R2 (preview) and a Codex review from 李娜 in parallel.
  const m2 = await say(
    w,
    G,
    '@前端小助手 用 PORT=4380 npm run dev 把 todo-app 跑起来，然后发布一个预览给大家看看效果。',
  )
  const m3 = await say(
    A.lina,
    G,
    '@后端助手 看一下 server.js 有没有路径穿越之类的安全问题？先别改代码，简单说结论。',
  )
  await runOf(w, G, m2.id, S.bots.fe)
  await runOf(w, G, m3.id, S.bots.be).catch((e) => log('codex review:', e.message))

  // R3: back to 工作区写入, so committing needs the owner's approval.
  await w('PATCH', `/api/bots/${S.bots.fe}`, { tier: 'workspace' })
  const m4 = await say(w, G, '@前端小助手 把筛选按钮这次的改动提交一下，提交信息用中文。')
  await runOf(w, G, m4.id, S.bots.fe, ['awaiting_approval', ...TERMINAL])
  await openGroup(page, G)
  const approval = page.getByRole('main').getByRole('button', { name: '批准', exact: true }).last()
  if (await approval.isVisible().catch(() => false)) {
    await shot(page, 'approval', runCard(page), { blur: true })
  }
  await approveUntilDone(page, w, G, m4.id, S.bots.fe)
  await page.context().close()
}

/** 陈晨 shares a screenshot and a checklist; everyone reacts to the feature reply. */
async function sceneAttachmentsAndReactions(A) {
  const G = S.groups.dev
  const states = await A.wanglei('GET', `/api/groups/${G}/bot-states`)
  const fe = states.find((s) => s.botId === S.bots.fe)
  const page = await browser.newPage({ viewport: { width: 760, height: 520 }, deviceScaleFactor: 2 })
  await page.goto(`file://${fe.path}/public/index.html`)
  await sleep(600)
  const png = await page.screenshot()
  await page.setContent(
    `<meta charset="utf-8"><style>body{font:15px -apple-system,"PingFang SC",sans-serif;padding:40px;color:#1f2430}h1{font-size:22px}li{margin:8px 0}</style>
     <h1>todo-app 回归测试清单</h1><ol><li>勾选 / 取消勾选待办</li><li>删除待办</li><li>「只看未完成」切换后刷新，选择仍保留</li>
     <li>筛选状态下新增待办</li><li>Chrome / Safari / Firefox 各过一遍</li></ol>`,
  )
  const pdf = await page.pdf({ format: 'A5' })
  await page.close()
  const upload = async (name, mimeType, buffer) =>
    (
      await (
        await A.chenchen.ctx.post('/api/uploads', {
          multipart: { groupId: G, file: { name, mimeType, buffer } },
        })
      ).json()
    ).id
  const ids = [
    await upload('筛选按钮-Safari.png', 'image/png', png),
    await upload('回归测试清单.pdf', 'application/pdf', pdf),
  ]
  await say(A.chenchen, G, '筛选按钮在 Safari 下看着没问题 👍 截图和回归清单附上，明天按清单再过一遍。', {
    attachmentIds: ids,
  })
  const reply = (await timeline(A.wanglei, G)).messages.find((m) => m.runId === S.r1)
  if (reply) {
    await A.lina('PUT', `/api/messages/${reply.id}/reactions/${encodeURIComponent('👍')}`)
    await A.chenchen('PUT', `/api/messages/${reply.id}/reactions/${encodeURIComponent('👍')}`)
    await A.chenchen('PUT', `/api/messages/${reply.id}/reactions/${encodeURIComponent('🎉')}`)
    await A.wanglei('PUT', `/api/messages/${reply.id}/reactions/${encodeURIComponent('✅')}`)
    S.r1Reply = reply.id
    save()
  }
  await say(A.lina, G, '太快了！预览我也点开看了，交互没问题。')
}

/** A real question in the 私聊 with 前端小助手 (bot-page.png). */
async function sceneDm(A) {
  const m = await say(
    A.wanglei,
    S.dm,
    '帮我写一个 JS 小函数：把待办数组按「未完成在前、再按创建时间倒序」排序，附一句用法说明。',
  )
  await runOf(A.wanglei, S.dm, m.id, S.bots.fe).catch((e) => log('dm run:', e.message))
}

// ── Scenes: mock agent (发版检查) for cards a real agent can't be scripted into ─
async function sceneMock(A) {
  const w = A.wanglei
  const G = S.groups.release
  const page = await newPage(w)
  await openGroup(page, G)
  const qa = (await w('GET', `/api/groups/${G}/bot-states`)).find((s) => s.botId === S.bots.qa)

  // Stop a run after files changed in its workspace: the keep / discard choice.
  const ticks = page.getByText(/^tick 0 tick 1 tick 2 tick 3/)
  const before = await ticks.count()
  const m1 = await say(w, G, '@测试助手 mock:slow')
  // Only once the agent streams has the daemon taken its pre-turn snapshot; files changed after it count.
  await until('mock streaming', async () => (await ticks.count()) > before, 60_000, 100)
  appendFileSync(`${qa.path}/public/app.js`, '\n// 回归测试：筛选状态切换\n')
  appendFileSync(`${qa.path}/README.md`, '\n- 回归测试记录见 docs/qa.md\n')
  const run = await runOf(w, G, m1.id, S.bots.qa, ['running'])
  await w('POST', `/api/runs/${run.id}/stop`)
  await page.getByText('保留改动').last().waitFor()
  await page.getByText(/^tick 0 tick 1/).evaluateAll((els) => {
    for (const el of els)
      el.closest('.pn-msg__row, [data-testid="bot-reply"]')?.style.setProperty('display', 'none')
  })
  await shot(page, 'interrupt-choice', page.getByTestId('run-card').filter({ hasText: '保留改动' }).last())

  const questions = [
    {
      type: 'multi',
      title: '这轮回归要覆盖哪些浏览器？',
      options: ['Chrome', 'Safari', 'Firefox', 'Edge'],
      recommended: 0,
    },
    { type: 'yesno', title: '发现问题后直接在群里 @前端小助手 修复吗？' },
  ]
  const m2 = await say(w, G, `@测试助手 mock:ask ${JSON.stringify({ questions })}`)
  await runOf(w, G, m2.id, S.bots.qa, ['awaiting_answer'])
  const card = runCard(page)
  await card.getByRole('button', { name: '提交回答' }).waitFor()
  await card.getByRole('button', { name: /^Chrome/ }).click()
  await card.getByRole('button', { name: 'Safari' }).click()
  await card.getByRole('button', { name: '是', exact: true }).click()
  await shot(page, 'question', card, { blur: true })
  await card.getByRole('button', { name: '提交回答' }).click()
  await runOf(w, G, m2.id, S.bots.qa)
  await say(A.chenchen, G, '回归清单我整理好了，发版前按清单过一遍，有问题直接在这里说。')
  await page.context().close()
}

// ── Scenes: capture ─────────────────────────────────────────────────────────
async function sceneChat(A) {
  const w = A.wanglei
  const G = S.groups.dev
  for (const g of Object.values(S.groups))
    if (g !== S.groups.product) await w('POST', `/api/groups/${g}/read`, {})
  let page = await newPage(w)
  await openGroup(page, G)
  // A fresh page per part: an open workbench narrows the chat and hides the Git bar.
  const reopen = async () => {
    await page.context().close()
    page = await newPage(w)
    await openGroup(page, G)
  }
  await page.getByRole('main').getByText('太快了').last().waitFor()
  await shot(page, 'chat')

  const header = page.getByTestId('git-bar')
  await shot(page, 'gitbar', header, { pad: 8 })

  const meter = page.getByRole('button', { name: /前端小助手 上下文/ })
  if (await meter.isVisible()) {
    await meter.click()
    const pop = page.getByRole('dialog', { name: '前端小助手 的上下文' }).or(page.locator('.ctx-pop'))
    await pop.first().waitFor()
    await shot(page, 'context-meter', [pop.first(), header], { pad: 12 })
    await close(page)
  }

  const reactionBar = page.getByRole('button', { name: /👍 2/ }).first()
  if (await reactionBar.isVisible().catch(() => false)) {
    await reactionBar.scrollIntoViewIfNeeded()
    const bubble = page.getByTestId('bot-reply').filter({ has: reactionBar })
    await shot(page, 'reactions', [bubble.first(), reactionBar], { pad: 12 })
  }

  const att = page.getByRole('main').getByText('筛选按钮在 Safari 下看着没问题')
  await att.scrollIntoViewIfNeeded()
  const attMsg = att.locator('xpath=ancestor::*[contains(concat(" ",@class," ")," pn-msg ")][1]')
  await shot(
    page,
    'attachments',
    [attMsg, page.getByRole('main').getByRole('img', { name: '筛选按钮-Safari.png' })],
    {
      pad: 12,
    },
  )

  const card = page.getByRole('main').locator('.pv-card').first()
  if (await card.isVisible().catch(() => false)) {
    await card.scrollIntoViewIfNeeded()
    await shot(
      page,
      'preview-card',
      card.locator('xpath=ancestor::*[contains(concat(" ",@class," ")," pn-msg ")][1]'),
      { pad: 12 },
    )
  }

  // Interface overview: group info side panel next to the conversation.
  await reopen()
  await page.getByRole('button', { name: '群设置' }).click()
  await sleep(1000)
  await shot(page, 'interface')
  await shot(page, 'group-info', page.getByRole('complementary', { name: '侧栏' }), { pad: 0 })
  await page.getByRole('complementary').getByRole('button', { name: '设置', exact: true }).click()
  await sleep(800)
  await shot(page, 'group-settings')
  await close(page)

  // Process, diff, files.
  await reopen()
  const r1 = page.getByTestId('bot-reply').filter({ hasText: '只看未完成' }).first()
  await r1.scrollIntoViewIfNeeded()
  await r1
    .getByRole('button', { name: '查看过程' })
    .click()
    .catch(async () => {
      await page.getByRole('main').getByRole('button', { name: '查看过程' }).first().click()
    })
  await sleep(1500)
  const bench = page.locator('section[aria-label="工作台"]')
  const fold = bench.locator('.act-row--head[aria-expanded="false"]').first()
  if (await fold.isVisible().catch(() => false)) await fold.click()
  await sleep(1000)
  await shot(page, 'process-panel')
  await bench.getByText('改动', { exact: true }).first().click()
  await sleep(1500)
  const pick = bench.locator('.diff-pane__pick')
  if (await pick.isVisible().catch(() => false)) {
    await pick.click()
    await sleep(300)
  }
  await bench
    .getByTestId('diff-pane')
    .getByText(/app\.js$/)
    .first()
    .click()
    .catch(() => {})
  await sleep(1500)
  await shot(page, 'diff-pane')

  await reopen()
  await page.getByRole('button', { name: '浏览 前端小助手 的文件' }).click()
  await sleep(1500)
  const aside = page.locator('section[aria-label="工作台"]')
  await aside.getByText('public', { exact: true }).first().click()
  await sleep(600)
  await aside.getByText('app.js', { exact: true }).first().click()
  await sleep(1800)
  await shot(page, 'file-viewer')

  // Preview workbench and share dialog.
  await reopen()
  const pv = page.getByRole('main').locator('.pv-card').first()
  if (await pv.isVisible().catch(() => false)) {
    await pv.getByRole('button', { name: '在工作台打开' }).click()
    await sleep(3000)
    await shot(page, 'preview-workbench', undefined, { wait: 1500 })
    await pv.getByRole('button', { name: '公开链接' }).click()
    await page.getByRole('button', { name: '生成链接' }).click()
    await sleep(1200)
    await shot(page, 'preview-share')
    await close(page)
  }

  // Notifications.
  await reopen()
  await page.getByRole('button', { name: /^通知/ }).first().click()
  await sleep(1000)
  await shot(page, 'notifications')
  await page.context().close()

  const dark = await newPage(w, { theme: 'dark' })
  await openGroup(dark, G)
  await shot(dark, 'theme-dark')
  await dark.context().close()
}

async function sceneAccount(A) {
  const w = A.wanglei
  const page = await newPage(w)
  await openGroup(page, S.groups.dev)
  await page.getByRole('button', { name: '账户菜单' }).click()
  const menu = page.getByRole('menu')
  await menu.waitFor()
  await shot(page, 'account-menu', [menu, page.getByRole('button', { name: '账户菜单' })], { pad: 8 })
  await page.getByRole('menuitem', { name: '绑定新机器' }).click()
  const bind = page.getByRole('dialog')
  await bind.getByText('使用命令行').click()
  await sleep(600)
  await shot(page, 'bind-machine')
  await close(page)

  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: '我的用量' }).click()
  await sleep(1500)
  await shot(page, 'my-bots')
  await close(page)

  for (const [tab, name] of [
    ['外观', 'settings-appearance'],
    ['Git 与仓库', 'settings-git'],
    ['账户', 'settings-account'],
  ]) {
    await page.getByRole('button', { name: '账户菜单' }).click()
    await page.getByRole('menuitem', { name: '设置…' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByText(tab, { exact: true }).first().click()
    await sleep(800)
    await shot(page, name, dlg, { pad: 0 })
    await close(page)
  }

  // Machine details.
  await page.locator('section[aria-label="我的机器"]').getByText('wanglei-mbp').click()
  const md = page.getByRole('dialog')
  await md.waitFor()
  await sleep(800)
  await md
    .getByRole('textbox')
    .first()
    .evaluate((el) => el.blur())
  await shot(page, 'machine-dialog')
  await md.getByText('Agent 工具', { exact: true }).click()
  await sleep(2500)
  await shot(page, 'machine-tools')
  await md.getByText('供应商', { exact: true }).click()
  await sleep(1500)
  await shot(page, 'machine-providers')
  await md.getByRole('button', { name: '新增…' }).first().click()
  const editor = page.getByRole('dialog').last()
  await editor.getByText('自定义', { exact: true }).click()
  await editor.getByLabel('名称').fill('星河内网网关')
  await editor.getByLabel('Base URL').fill('https://llm.xinghe.dev/anthropic')
  await editor.getByLabel('API Key').fill('sk-xinghe-demo-7f3a9c')
  await editor.getByLabel('API Key').evaluate((el) => el.blur())
  await shot(page, 'provider-editor')
  await close(page)
  await close(page)
  await page.context().close()
}

async function sceneBots(A) {
  const w = A.wanglei
  const page = await newPage(w)
  await w('POST', `/api/groups/${S.dm}/read`, {})
  await openGroup(page, S.dm)
  await shot(page, 'bot-page')

  await page.goto(`/bot/${S.bots.fe}`)
  await settle(page, 1500)
  await shot(page, 'bot-overview')
  await page.getByRole('button', { name: '编辑 Bot' }).click()
  const dlg = page.getByRole('dialog', { name: 'Bot 详情' }).or(page.getByRole('dialog')).first()
  await dlg.waitFor()
  await sleep(800)
  await page.evaluate(() => document.activeElement?.blur())
  const label = (text) => dlg.locator('.ui-form__label', { hasText: `${text}：` }).first()
  const row = (text) => [label(text), label(text).locator('xpath=following-sibling::*[1]')]
  await step('bot-agent-config', async () => {
    await label('推理强度').scrollIntoViewIfNeeded({ timeout: 5000 })
    await shot(page, 'bot-agent-config', [...row('供应商'), ...row('推理强度')], { pad: 8 })
  })
  await label('命令审批').scrollIntoViewIfNeeded()
  await shot(page, 'bot-settings', [...row('触发范围'), ...row('命令审批')], { pad: 8 })
  await close(page)

  await openGroup(page, S.groups.dev)
  await page.getByRole('button', { name: '新建 Bot' }).first().click()
  const nb = page.getByRole('dialog')
  await nb.waitFor()
  await nb
    .getByLabel('名称')
    .fill('文档小助手')
    .catch(() => {})
  await nb
    .getByRole('radio', { name: /留白/ })
    .click()
    .catch(() => {})
  await sleep(600)
  await shot(page, 'new-bot')
  await close(page)

  // New group: bots, then the repo address with each bot's access check.
  await page.getByRole('button', { name: '新建群' }).click()
  const ng = page.getByRole('dialog').first()
  await ng.getByLabel('名称').fill('todo-app 性能优化')
  for (const who of ['Claude Code · 王磊', 'Codex · 李娜']) {
    await ng
      .getByText(/添加 Bot/)
      .first()
      .click()
    await page.getByText(who, { exact: true }).last().click()
    await ng.getByText('新建群', { exact: true }).first().click()
    await sleep(300)
  }
  await ng.getByRole('button', { name: '仓库' }).click()
  await page.getByPlaceholder('搜索仓库，或粘贴地址').fill(REPO_URL)
  await sleep(800)
  await page.getByPlaceholder('搜索仓库，或粘贴地址').press('Enter')
  await ng
    .getByText(/可访问|无权限|检查/)
    .first()
    .waitFor()
    .catch(() => {})
  await sleep(4000)
  await shot(page, 'new-group')
  await ng.getByRole('button', { name: '仓库' }).click()
  await sleep(2500)
  await shot(page, 'repo-picker', [ng, page.getByPlaceholder('搜索仓库，或粘贴地址')], { pad: 0 })
  await close(page)
  await close(page)

  await page.context().close()

  // Workspace picker: 陈晨 binds 测试助手 in 官网改版.
  const cc = await newPage(A.chenchen)
  await openGroup(cc, S.groups.site)
  await cc.getByRole('button', { name: '绑定工作区' }).first().click()
  await sleep(1500)
  await shot(cc, 'workspace-picker')
  await cc.context().close()
}

async function uploadRelease(api) {
  const res = await api.ctx.post('/api/admin/daemon-release/files', {
    multipart: {
      file: {
        name: 'gonggong-0.1.0-macos-aarch64',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(4096),
      },
    },
  })
  if (!res.ok()) log('release upload:', res.status(), await res.text())
}

async function sceneAdmin(A) {
  await uploadRelease(A.wanglei)
  const page = await newPage(A.wanglei)
  for (const [path, name] of [
    ['users', 'admin-users'],
    ['bots', 'admin-bots'],
    ['groups', 'admin-groups'],
    ['config', 'admin-config'],
    ['params', 'admin-params'],
    ['feishu', 'admin-feishu'],
    ['releases', 'admin-releases'],
    ['machines', 'admin-machines'],
    ['usage', 'admin-usage'],
    ['previews', 'admin-shares'],
    ['audit', 'admin-audit'],
  ]) {
    await page.goto(`/admin/${path}`)
    await settle(page, 1500)
    if (path === 'bots')
      await page
        .getByText('前端小助手')
        .first()
        .click()
        .catch(() => {})
    await shot(page, name, undefined, { wait: 800 })
  }

  await page.goto('/admin/users')
  await page.getByRole('button', { name: '新建账号…' }).first().click()
  const nu = page.getByRole('dialog')
  await nu.getByLabel('账号').fill('zhaoyu')
  await nu.getByLabel('姓名').fill('赵雨')
  await sleep(500)
  await shot(page, 'admin-user-new')
  await close(page)

  await page.goto('/admin/config')
  await page.getByRole('button', { name: '添加 MCP…' }).click()
  const mcp = page.getByRole('dialog')
  await mcp.getByLabel('名称').fill('figma')
  await mcp.getByLabel('命令').fill('npx')
  await mcp.getByLabel('参数').fill('-y\nfigma-developer-mcp\n--stdio')
  await mcp.getByText('环境变量').click()
  await mcp.getByLabel('环境变量').fill('FIGMA_API_KEY=figd_xxxxxxxx')
  await mcp.getByLabel('环境变量').evaluate((el) => el.blur())
  await shot(page, 'admin-config-mcp')
  await close(page)

  // Several artifacts dropped at once, uploads slowed down so the progress shows; one name is rejected.
  await page.goto('/admin/releases')
  await settle(page, 1000)
  const dir = join(DOCS, 'release')
  mkdirSync(dir, { recursive: true })
  // Checked one by one in order: the rejected name first so its error is already showing.
  const files = [
    ['todo-app-v0.1.zip', 1],
    ['gonggong-0.1.0-linux-x86_64', 12],
    ['gonggong-0.1.0-windows-x86_64.exe', 9],
    ['gg-cast-0.1.0-macos-aarch64', 6],
  ].map(([name, mb]) => {
    writeFileSync(join(dir, name), Buffer.alloc(mb * 1024 * 1024))
    return join(dir, name)
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 2 * 1024 * 1024,
  })
  await page.locator('input[type=file]').setInputFiles(files)
  await sleep(3500)
  await page.addStyleTag({ content: CSS })
  await shot(page, 'admin-releases-upload', undefined, { wait: 0 })
  await page.context().close()
}

// ── Main ────────────────────────────────────────────────────────────────────
async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    log(`scene ${name} failed:`, e.message.split('\n')[0])
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  browser = await chromium.launch()
  if (!S.users) {
    await setupAccounts()
    await sceneFirstLogin()
  }
  const A = await apis()
  if (!S.machines) await setupMachines(A)
  if (!S.bots) await setupBots(A)
  if (!S.groups) await setupGroups(A)
  log('setup done')
  if (!S.runsDone) {
    await step('real runs', () => sceneRealRuns(A))
    await step('attachments', () => sceneAttachmentsAndReactions(A))
    await step('dm', () => sceneDm(A))
    await step('mock', () => sceneMock(A))
    S.runsDone = true
    save()
  }
  maskMachines()
  await step('register', () => sceneRegister(A))
  await step('chat', () => sceneChat(A))
  await step('account', () => sceneAccount(A))
  await step('bots', () => sceneBots(A))
  await step('admin', () => sceneAdmin(A))
  log('done')
  if (process.env.SHOTS_KEEP === '1') return
  await browser.close()
  process.exit(0)
}

if (isMain)
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })

// For iterating on single scenes against a stack kept by SHOTS_KEEP=1.
export const lab = {
  S,
  apis,
  newPage,
  shot,
  settle,
  sleep,
  say,
  timeline,
  bindAll,
  scenes: {
    sceneRealRuns,
    sceneAttachmentsAndReactions,
    sceneDm,
    sceneMock,
    sceneChat,
    sceneAccount,
    sceneBots,
    sceneAdmin,
    sceneRegister,
  },
  setBrowser: (b) => {
    browser = b
  },
  ONLY,
}
