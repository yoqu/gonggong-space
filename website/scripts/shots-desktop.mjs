// Regenerates website/public/screenshots/desktop/*.png from the desktop React UI (apps/desktop) rendered in headless
// Chromium against its Vite dev server, with the Tauri IPC faked in the page (demo data below). No Tauri, no daemon,
// no ~/.gonggong: nothing outside this repo is read or written.
// Usage: node website/scripts/shots-desktop.mjs [shot-name ...] && bash website/scripts/to-webp.sh   (DESKTOP_PORT=5296 by default)
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'website/public/screenshots/desktop')
const PORT = Number(process.env.DESKTOP_PORT ?? 5296)
const URL = `http://127.0.0.1:${PORT}/`

/** name → sidebar label to click (null = start page); `unbound` shows the first-run flow. */
const SHOTS = [
  { name: 'onboarding', unbound: true },
  { name: 'overview', nav: null },
  { name: 'agents', nav: 'Agent' },
  { name: 'bots', nav: 'Bot' },
  { name: 'workspaces', nav: '工作区' },
  { name: 'tunnels', nav: '穿透与服务' },
  { name: 'live', nav: '实时画面' },
  { name: 'logs', nav: '日志与诊断' },
  { name: 'settings', nav: '设置' },
]

/** Runs in the page before the app: a fake `window.__TAURI_INTERNALS__` answering every command of src/ipc.ts. */
function fakeTauri({ unbound }) {
  localStorage.setItem('gonggong.theme', 'light')
  localStorage.setItem('gg.permissionsGuide', 'seen')
  const now = Date.now()
  const HOME = '/Users/wanglei'
  const WS = `${HOME}/.gonggong/workspaces`
  const catalog = (models) => ({
    models: models.map(([value, name]) => ({ value, name, efforts: [], effort: null })),
    current: null,
    efforts: [],
    effort: null,
  })
  const agents = [
    {
      kind: 'claude',
      available: true,
      version: '2.1.12',
      path: `${HOME}/.gonggong/runtime/bin/claude`,
      minVersion: '2.0.0',
      catalog: catalog([
        ['default', 'Sonnet 4.5'],
        ['opus', 'Opus 4.1'],
        ['haiku', 'Haiku 4.5'],
      ]),
      latest: '2.1.12',
      managed: true,
      customPath: false,
      login: '已登录 · Claude Max',
    },
    {
      kind: 'codex',
      available: true,
      version: '0.46.0',
      path: '/opt/homebrew/bin/codex',
      minVersion: '0.40.0',
      catalog: catalog([
        ['gpt-5-codex', 'gpt-5-codex'],
        ['gpt-5', 'gpt-5'],
      ]),
      latest: '0.46.0',
      managed: false,
      customPath: false,
      login: '已登录 · ChatGPT Plus',
    },
  ]
  const run = (over) => ({
    runId: 'run-7f3a',
    groupId: 'g-todo',
    groupName: 'todo-app 开发群',
    botId: 'b-fe',
    botName: '前端小助手',
    triggeredBy: '王磊',
    status: 'running',
    step: 'pnpm vitest run src/components/TodoList.test.tsx',
    queued: false,
    startedMs: now - 94_000,
    ...over,
  })
  const bot = (over) => ({
    binding: 'bound',
    presence: 'online',
    systemPrompt: '',
    approval: 'ask',
    allowlist: [],
    ...over,
  })
  const bots = [
    bot({
      id: 'b-fe',
      name: '前端小助手',
      agentKind: 'claude',
      presence: 'running',
      concurrency: 2,
      avatar: 'role-braces',
    }),
    bot({
      id: 'b-qa',
      name: '测试助手',
      agentKind: 'codex',
      concurrency: 1,
      approval: 'allowlist',
      allowlist: ['pnpm test', 'pnpm lint', 'git status'],
      avatar: 'role-sentry',
    }),
  ]
  const info = {
    version: '0.9.3',
    protocol: 1,
    machine: { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' },
    ownerName: unbound ? null : '王磊',
    server: unbound ? null : 'https://gg.example.com',
    certPinned: false,
    workspacesDir: WS,
    backupsDir: `${HOME}/.gonggong/backups`,
    adapters: [
      { kind: 'claude', package: '@agentclientprotocol/claude-agent-acp', version: '0.81.0' },
      { kind: 'codex', package: '@agentclientprotocol/codex-acp', version: '1.13.0' },
    ],
  }
  const snapshot = unbound
    ? { phase: 'unbound' }
    : {
        phase: 'running',
        status: {
          conn: { state: 'online', sinceMs: now - 3 * 3600_000 },
          heartbeatSec: 15,
          lastHeartbeatMs: now - 4000,
          latencyMs: 32,
          agents: agents.map(({ customPath, login, ...a }) => a),
          runs: [
            run({}),
            run({
              runId: 'run-7f41',
              botId: 'b-qa',
              botName: '测试助手',
              triggeredBy: '李娜',
              status: 'awaiting_approval',
              step: 'pnpm playwright test e2e/todo.spec.ts',
              startedMs: now - 41_000,
            }),
            run({ runId: 'run-7f44', triggeredBy: '陈晨', queued: true, status: 'queued', step: '' }),
          ],
        },
      }
  const logTimes = (start) => (i) => new Date(start + i * 7000).toTimeString().slice(0, 8)
  const t = logTimes(now - 40 * 7000)
  const L = (level, target, msg) => ({ level, target, msg })
  const logs = [
    L('info', 'service', 'connected machine_id=m-2c81e0'),
    L('info', 'daemon', 'agents detected: claude 2.1.12, codex 0.46.0'),
    L('info', 'engine', 'run.start run-7e90 group=todo-app 开发群 bot=前端小助手'),
    L('info', 'git', 'fetch origin repo=todo-app'),
    L('info', 'git', 'checkout -B gg/前端小助手 origin/main repo=todo-app'),
    L('info', 'engine', 'session/new claude cwd=~/.gonggong/workspaces/todo-app/前端小助手'),
    L('debug', 'engine', 'session/update tool_call Read src/components/TodoList.tsx'),
    L('debug', 'engine', 'session/update tool_call Edit src/components/TodoList.tsx'),
    L('info', 'engine', 'run.end run-7e90 completed in 2m14s'),
    L('info', 'git', 'commit 3f9c2ad "feat: 待办支持拖拽排序" repo=todo-app'),
    L('info', 'git', 'push origin gg/前端小助手 repo=todo-app'),
    L('info', 'tunnel', 'preview opened port=5173 path=/ group=todo-app 开发群'),
    L('info', 'service', 'hosted service started name=todo-app dev pid=48213'),
    L('warn', 'git', 'core.autocrlf was true in todo-app, turned off'),
    L('info', 'engine', 'run.start run-7f12 group=todo-app 开发群 bot=测试助手'),
    L('info', 'engine', 'session/new codex cwd=~/.gonggong/workspaces/todo-app/测试助手'),
    L('info', 'engine', 'run.end run-7f12 completed in 48s'),
    L('info', 'net', 'net latency=32ms bandwidth=86Mbps'),
    L('info', 'engine', 'run.start run-7f3a group=todo-app 开发群 bot=前端小助手'),
    L('info', 'git', 'fetch origin repo=todo-app'),
    L('debug', 'engine', 'session/update tool_call Bash pnpm vitest run src/components/TodoList.test.tsx'),
    L('info', 'engine', 'run.start run-7f41 group=todo-app 开发群 bot=测试助手'),
    L('info', 'engine', 'permission requested run-7f41: pnpm playwright test e2e/todo.spec.ts'),
    L('info', 'engine', 'run-7f44 queued: 前端小助手 is at its concurrency limit (2)'),
  ].map((l, i) => ({
    level: l.level,
    text: `${t(i)} ${l.level.toUpperCase().padEnd(5)} ${l.target.padEnd(7)} ${l.msg}`,
  }))
  const rank = { error: 0, warn: 1, info: 2, debug: 3 }

  const commands = {
    app_info: () => info,
    snapshot: () => snapshot,
    parse_link: ({ input }) => {
      if (!input.includes('gonggong://bind')) throw '不是接入链接或 gg login 命令'
      return { server: 'https://gg.example.com', code: 'K7QM-4X2P' }
    },
    'plugin:clipboard-manager|read_text': () =>
      "gg login 'gonggong://bind?server=https%3A%2F%2Fgg.example.com&code=K7QM-4X2P'",
    'plugin:deep-link|get_current': () => null,
    overview: () => ({ workspaces: { count: 4, detail: '托管 3 · 本机目录 1 · 1.6 GB' } }),
    get_settings: () => ({ autoUpgrade: true, launchAtLogin: true, mirror: { kind: 'npmmirror' } }),
    workspaces: () => ({
      offline: false,
      rows: [
        {
          groupId: 'g-todo',
          botId: 'b-fe',
          group: 'todo-app 开发群',
          bot: '前端小助手',
          kind: 'managed',
          kindLabel: '托管',
          path: `${WS}/todo-app/前端小助手`,
          state: 'running',
          stateLabel: '运行中',
          deletable: false,
        },
        {
          groupId: 'g-todo',
          botId: 'b-qa',
          group: 'todo-app 开发群',
          bot: '测试助手',
          kind: 'managed',
          kindLabel: '托管',
          path: `${WS}/todo-app/测试助手`,
          state: 'running',
          stateLabel: '运行中',
          deletable: false,
        },
        {
          groupId: 'g-design',
          botId: 'b-fe',
          group: '官网改版讨论',
          bot: '前端小助手',
          kind: 'cd',
          kindLabel: '本机目录',
          path: `${HOME}/Projects/xinghe-site`,
          state: 'idle',
          stateLabel: '空闲',
          deletable: false,
        },
        {
          groupId: 'g-old',
          botId: 'b-fe',
          group: '活动页临时群',
          bot: '前端小助手',
          kind: 'managed',
          kindLabel: '托管',
          path: `${WS}/campaign-page/前端小助手`,
          state: 'removed',
          stateLabel: '已移出 · 412 MB',
          deletable: true,
        },
      ],
      backups: [
        {
          name: '0930-1042',
          path: `${HOME}/.gonggong/backups/todo-app/0930-1042`,
          size: '28 KB',
          modifiedMs: now - 2 * 3600_000,
        },
        {
          name: '0926-1715.patch',
          path: `${HOME}/.gonggong/backups/todo-app/0926-1715.patch`,
          size: '6 KB',
          modifiedMs: now - 4 * 86400_000,
        },
      ],
    }),
    diagnostics: () => [
      { kind: 'server', label: '服务器连接', status: 'ok', detail: 'WSS 正常 · 证书固定通过' },
      { kind: 'agent', label: 'Agent', status: 'ok', detail: 'Claude Code 2.1.12 · Codex 0.46.0 可用' },
      {
        kind: 'git',
        label: 'git 凭据',
        status: 'ok',
        detail: 'HTTPS · 可访问 · todo-app 开发群 × 前端小助手',
      },
      { kind: 'disk', label: '磁盘', status: 'ok', detail: '工作区 1.6 GB · 剩余 212 GB' },
      { kind: 'eol', label: '换行符', status: 'ok', detail: 'core.autocrlf 已关闭' },
      { kind: 'screen_recording', label: '屏幕录制', status: 'ok', detail: '已授权' },
      { kind: 'accessibility', label: '辅助功能', status: 'ok', detail: '已授权' },
    ],
    measure_net: () => ({ latencyMs: 32, bandwidthMbps: 86 }),
    recent_logs: ({ level }) => logs.filter((l) => rank[l.level] <= rank[level]),
    agents: () => agents,
    tools: () => [
      {
        kind: 'node',
        installed: true,
        version: '22.20.0',
        latest: '22.20.0',
        managed: true,
        path: `${HOME}/.gonggong/runtime/node/bin/node`,
      },
      {
        kind: 'claude',
        installed: true,
        version: '2.1.12',
        latest: '2.1.12',
        managed: true,
        path: agents[0].path,
      },
      {
        kind: 'codex',
        installed: true,
        version: '0.46.0',
        latest: '0.46.0',
        managed: false,
        path: agents[1].path,
      },
    ],
    providers: () => ({
      machine: { claude: 'official', codex: 'official' },
      bots: { 'b-qa': 'official' },
      providers: [
        {
          id: 'kimi-coding-a1b2',
          agent: 'claude',
          name: 'Kimi For Coding',
          presetId: 'kimi-coding',
          revision: 1,
          baseUrl: 'https://api.kimi.com/coding/',
          apiKey: '****7c2e',
          apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
          model: 'kimi-for-coding',
          models: null,
          env: {},
          wireApi: null,
          effort: null,
          source: null,
        },
      ],
      ccSwitch: false,
    }),
    provider_presets: () => [],
    provider_impact: () => [],
    bots: () => bots,
    tunnels: () => ({
      previews: [
        {
          id: 'pv-1',
          kind: 'http',
          title: 'todo-app 开发预览',
          groupName: 'todo-app 开发群',
          botName: '前端小助手',
          port: 5173,
          path: '/',
          serviceId: 'svc-1',
          serviceName: 'todo-app dev',
          status: 'online',
          live: null,
          control: null,
        },
        {
          id: 'pv-2',
          kind: 'static',
          title: '测试报告',
          groupName: 'todo-app 开发群',
          botName: '测试助手',
          port: null,
          path: '/playwright-report/index.html',
          serviceId: null,
          serviceName: null,
          status: 'online',
          live: null,
          control: null,
        },
        {
          id: 'pv-3',
          kind: 'gui',
          title: 'todo-app 桌面版',
          groupName: 'todo-app 开发群',
          botName: '前端小助手',
          port: null,
          path: '',
          serviceId: 'svc-2',
          serviceName: 'todo-app electron',
          status: 'online',
          live: { state: 'live', error: null, missing: [] },
          control: { controller: { name: '李娜' } },
        },
        {
          id: 'pv-4',
          kind: 'miniprogram',
          title: 'todo 小程序',
          groupName: 'todo-app 开发群',
          botName: '前端小助手',
          port: null,
          path: '',
          serviceId: null,
          serviceName: null,
          status: 'online',
          live: null,
          control: null,
        },
      ],
      services: [
        {
          id: 'svc-1',
          name: 'todo-app dev',
          groupName: 'todo-app 开发群',
          botName: '前端小助手',
          command: 'pnpm dev --host 127.0.0.1 --port 5173',
          cwd: `${WS}/todo-app/前端小助手`,
          port: 5173,
          status: 'running',
        },
        {
          id: 'svc-2',
          name: 'todo-app electron',
          groupName: 'todo-app 开发群',
          botName: '前端小助手',
          command: 'pnpm electron:dev',
          cwd: `${WS}/todo-app/前端小助手`,
          port: null,
          status: 'running',
        },
      ],
    }),
    cast_component: () => ({ source: 'bundled', path: '/Applications/共工空间.app/Contents/MacOS/gg-cast' }),
    permissions: () => [
      { kind: 'screen_recording', granted: true },
      { kind: 'accessibility', granted: true },
    ],
    run_process: () => null,
  }

  const callbacks = new Map()
  let nextId = 1
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    plugins: {},
    transformCallback(cb, once = false) {
      const id = nextId++
      callbacks.set(id, (data) => {
        if (once) callbacks.delete(id)
        return cb?.(data)
      })
      return id
    },
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback: (id, data) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      if (cmd === 'plugin:event|listen') return args.handler
      if (cmd.startsWith('plugin:event|')) return null
      const answer = commands[cmd]
      if (!answer) {
        console.warn(`[fake-tauri] unhandled ${cmd}`)
        return null
      }
      return answer(args)
    },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
}

async function waitForServer(ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(URL)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`vite did not come up on ${URL}`)
}

const wanted = process.argv.slice(2)
const shots = wanted.length ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS
mkdirSync(OUT, { recursive: true })

const vite = spawn('pnpm', ['--filter', '@gonggong/desktop', 'dev'], {
  cwd: ROOT,
  env: { ...process.env, DESKTOP_PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'inherit'],
  detached: true,
})
const stop = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM')
  } catch {}
}
process.on('exit', stop)

try {
  await waitForServer()
  const browser = await chromium.launch()
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 720 },
      deviceScaleFactor: 2,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      locale: 'zh-CN',
    })
    const page = await context.newPage()
    page.on(
      'console',
      (m) => m.type() === 'warning' && m.text().includes('fake-tauri') && console.warn(m.text()),
    )
    page.on('pageerror', (e) => console.error(`[${shot.name}] ${e.message}`))
    await page.addInitScript(fakeTauri, { unbound: !!shot.unbound })
    await page.goto(URL)
    if (shot.unbound) {
      await page.getByText('请确认这是你们团队的服务器').waitFor()
    } else {
      await page.locator('.dk-sidebar').waitFor()
      if (shot.nav) await page.locator('.dk-sidebar').getByText(shot.nav, { exact: true }).click()
      await page.waitForLoadState('networkidle')
    }
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(OUT, `${shot.name}.png`), animations: 'disabled' })
    console.log(`desktop/${shot.name}.png`)
    await context.close()
  }
  await browser.close()
} finally {
  stop()
}
