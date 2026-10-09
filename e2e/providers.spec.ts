import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { MessageDto, RunDto, TimelineDto } from '@gonggong/protocol'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, SERVER_LOG } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:echo` replies with the settings meta and provider env it was started with.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`
const DEEPSEEK = 'https://api.deepseek.com/anthropic'

/** A daemon environment that never reads or writes the developer's own ~/.claude, ~/.codex or ~/.cc-switch. */
function isolated() {
  const home = mkdtempSync(join(tmpdir(), 'gonggong-e2e-home-'))
  mkdirSync(join(home, 'codex'))
  return { HOME: home, CODEX_HOME: join(home, 'codex'), GONGGONG_ADAPTER_CMD: MOCK }
}

async function openMachine(page: Page, tab: '供应商' | 'Agent 工具') {
  await page.getByRole('region', { name: '我的机器' }).locator('.sidebar__open').click()
  const dialog = page.getByRole('region', { name: '机器详情' })
  await expect(dialog.getByRole('tab', { name: tab })).toBeEnabled({ timeout: 30_000 })
  await dialog.getByRole('tab', { name: tab }).click()
  return dialog
}

interface Echo {
  settings: string | null
  env: { MODEL_PROVIDER: string | null; GG_PROVIDER_KEY: string | null }
}

test('provider switches reach new sessions only, a bot override wins, a deleted one restarts; the key stays on the machine', async ({
  page,
}) => {
  test.setTimeout(8 * 60_000)
  const KEY = `sk-e2e-${randomBytes(12).toString('hex')}-Q7x9`
  const received: Promise<string | undefined>[] = []
  page.on('response', (r) => {
    if (r.url().includes('/api/')) received.push(r.text().catch(() => undefined))
  })
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => received.push(Promise.resolve(String(f.payload)))),
  )

  const { m, api } = await memberWithMachine(page, 'pr1', { env: isolated() })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'pr1 Bot',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '供应商切换',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    const main = page.getByRole('main')
    const timeline = () => api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)
    let turns = 0
    /** Sends `@pr1 Bot mock:echo` and returns the run with what the agent reported. */
    const turn = async (): Promise<{ run: RunDto; echo: Echo }> => {
      turns++
      await page.getByPlaceholder(composer).fill('@pr1 Bot mock:echo')
      await page.getByRole('button', { name: '发送' }).click()
      let reply: MessageDto | undefined
      let run: RunDto | undefined
      await expect
        .poll(
          async () => {
            const t = await timeline()
            run = t.runs.filter((r) => r.endedAt).at(turns - 1)
            reply = run && t.messages.find((x) => x.kind === 'bot' && x.runId === run?.id)
            return reply ? run?.status : undefined
          },
          { timeout: 60_000 },
        )
        .toBe('completed')
      return { run: run!, echo: JSON.parse(reply!.body) as Echo }
    }
    const renew = async (session: string, effective: string) => {
      const banner = page
        .getByRole('note')
        .filter({ hasText: `pr1 Bot 本会话使用 ${session}；已切换为 ${effective}，开启新会话后生效` })
      await expect(banner).toBeVisible()
      await banner.getByRole('button', { name: '开启新会话' }).click()
      await expect(main.getByText('pr1 Bot 下一轮将开新会话').last()).toBeVisible()
      return banner
    }
    const botProvider = async (option: string, from: string, to: string) => {
      await page.goto(`/bot/${bot.id}`)
      await page.getByRole('button', { name: '编辑 Bot' }).click()
      const dialog = page.getByRole('dialog', { name: 'Bot 详情' })
      await dialog.getByRole('tab', { name: '运行配置' }).click()
      const select = dialog.getByRole('button', { name: '供应商' })
      await expect(select).toBeEnabled()
      await select.click()
      await page.getByRole('menuitemcheckbox', { name: option }).click()
      await dialog.getByRole('button', { name: '保存' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toContainText(`1 个群的会话仍在使用 ${from}，开启新会话后才会切换到 ${to}`)
      await confirm.getByRole('button', { name: '切换' }).click()
      await expect(select).toContainText(option)
      await page.keyboard.press('Escape')
      await page.goto(`/g/${group.id}`)
    }

    await page.goto(`/g/${group.id}`)
    const first = await turn()
    expect(first.echo.settings).toBeNull()

    await test.step('a new machine default from a preset: the running session keeps the official login', async () => {
      const dialog = await openMachine(page, '供应商')
      const claude = dialog.getByRole('region', { name: 'Claude Code 供应商' })
      await claude.getByRole('button', { name: '新增…' }).click()
      const editor = page.getByRole('dialog', { name: '新增 Claude Code 供应商' })
      await editor.getByRole('searchbox', { name: '搜索厂商' }).fill('DeepSeek')
      await editor.getByRole('button', { name: /^DeepSeek/ }).click()
      await editor.getByLabel('API Key').fill(KEY)
      await editor.getByText('设为本机默认').click()
      await editor.getByRole('button', { name: '保存' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toContainText('1 个群的会话仍在使用 官方登录，开启新会话后才会切换到 DeepSeek')
      await expect(confirm).toContainText('供应商切换（pr1 Bot）')
      await confirm.getByRole('button', { name: '切换' }).click()
      await expect(claude.getByRole('radio', { name: /DeepSeek/ })).toBeChecked()
      await expect(claude).toContainText(`Key ****${KEY.slice(-4)}`)
      await page.goBack()

      const kept = await turn()
      expect(kept.run.newSessionReason).toBeNull()
      expect(kept.echo.settings).toBeNull()
    })

    let settings = ''
    await test.step('开启新会话 switches to it through a 0600 settings file in the isolated home', async () => {
      const banner = await renew('官方登录', 'DeepSeek')
      const next = await turn()
      expect(next.run.newSessionReason).toBe('requested')
      settings = next.echo.settings ?? ''
      expect(realpathSync(dirname(settings))).toBe(realpathSync(join(m.home, 'run')))
      expect(statSync(settings).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(settings, 'utf8')).env).toMatchObject({
        ANTHROPIC_BASE_URL: DEEPSEEK,
        ANTHROPIC_AUTH_TOKEN: KEY,
        ANTHROPIC_API_KEY: '',
      })
      await expect(banner).toBeHidden()
    })

    await test.step("the bot's own 官方登录 overrides the third-party machine default", async () => {
      await botProvider('官方登录', 'DeepSeek', '官方登录')
      await renew('DeepSeek', '官方登录')
      const official = await turn()
      expect(official.run.newSessionReason).toBe('requested')
      expect(official.echo.settings).toBeNull()
      expect(official.echo.env.MODEL_PROVIDER).toBeNull()
    })

    await test.step('deleting the provider a session is pinned to opens a new session', async () => {
      await botProvider('继承机器（当前：DeepSeek）', '官方登录', 'DeepSeek')
      await renew('官方登录', 'DeepSeek')
      expect((await turn()).echo.settings).toBe(settings)

      const dialog = await openMachine(page, '供应商')
      const claude = dialog.getByRole('region', { name: 'Claude Code 供应商' })
      await claude.getByRole('button', { name: '删除' }).click()
      const confirm = page.getByRole('alertdialog', { name: '要删除供应商 DeepSeek 吗？' })
      await expect(confirm).toContainText('它是本机默认，删除后本机默认改为官方登录。')
      await expect(confirm).toContainText('1 个群的会话正在使用 DeepSeek，删除后它们下一轮会自动开启新会话')
      await confirm.getByRole('button', { name: '删除' }).click()
      await expect(claude.getByRole('radio', { name: /官方登录/ })).toBeChecked()
      await page.goBack()
      expect(existsSync(settings)).toBe(false)

      const restarted = await turn()
      expect(restarted.run.newSessionReason).toBe('provider_removed')
      expect(restarted.echo.settings).toBeNull()
      await expect(main.getByText('原供应商已删除，已开启新会话')).toBeVisible()
    })

    await test.step('the key never reached the server log, the database or the browser (masked only)', async () => {
      const bodies = (await Promise.all(received)).filter((b): b is string => b !== undefined)
      expect(bodies.some((b) => b.includes(`****${KEY.slice(-4)}`))).toBe(true)
      for (const b of bodies) expect(b).not.toContain(KEY)

      const log = readFileSync(SERVER_LOG, 'utf8')
      expect(log).toContain(`/api/machines/`)
      expect(log).not.toContain(KEY)
      const logs = join(m.home, 'logs')
      for (const f of existsSync(logs) ? readdirSync(logs) : [])
        expect(readFileSync(join(logs, f), 'utf8')).not.toContain(KEY)

      const port = process.env.GONGGONG_PG_PORT ?? '54329'
      const dump = execFileSync(
        'pg_dump',
        ['-h', '/tmp', '-p', port, '-U', 'gonggong', '--data-only', 'gonggong_e2e'],
        { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
      )
      expect(dump).toContain('供应商切换')
      expect(dump).not.toContain(KEY)
      expect(dump).not.toContain(DEEPSEEK)
    })
  } finally {
    m.stop()
  }
})

const NODE = '24.99.0'

/**
 * A mirror of both kinds: a Node dist (index.json, SHASUMS256.txt, a tiny archive whose `node` doubles as npm) and an
 * npm registry at /npm and /npm-next answering `latest` of Claude Code. The fake npm installs a `claude` printing the
 * version it resolved against the registry it was given.
 */
async function fakeMirror() {
  const platform = `${process.platform}-${process.arch}`
  const root = `node-v${NODE}-${platform}`
  const dir = mkdtempSync(join(tmpdir(), 'gonggong-e2e-mirror-'))
  mkdirSync(join(dir, root, 'bin'), { recursive: true })
  const node = `#!/bin/sh
case "$1" in
  --version) echo v${NODE} ;;
  *npm-cli.js)
    shift
    while [ $# -gt 0 ]; do
      case "$1" in
        --prefix) prefix="$2"; shift ;;
        --registry) registry="$2"; shift ;;
        -*|i) ;;
        *) spec="$1" ;;
      esac
      shift
    done
    pkg="\${spec%@*}"; version="\${spec##*@}"
    echo "npm http fetch GET 200 $registry/$pkg"
    if [ "$version" = latest ]; then
      version=$(curl -fsS "$registry/$pkg/latest" | sed -E 's/.*"version":"([^"]+)".*/\\1/')
    fi
    mkdir -p "$prefix/bin"
    printf '#!/bin/sh\\necho "%s (Claude Code)"\\n' "$version" > "$prefix/bin/claude"
    chmod +x "$prefix/bin/claude"
    echo "added 1 package in 0.1s"
    ;;
  *) exit 1 ;;
esac
`
  writeFileSync(join(dir, root, 'bin/node'), node, { mode: 0o755 })
  const archive = join(dir, `${root}.tar.gz`)
  execFileSync('tar', ['--no-xattrs', '-czf', archive, '-C', dir, root], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const tarball = readFileSync(archive)
  const sha = createHash('sha256').update(tarball).digest('hex')
  const state = { claude: '2.1.300', hits: [] as string[] }
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    state.hits.push(url)
    const send = (body: string | Buffer) => res.writeHead(200).end(body)
    if (url === '/node/index.json')
      return send(
        JSON.stringify([
          { version: 'v25.1.0', lts: false },
          { version: `v${NODE}`, lts: 'Krypton' },
          { version: 'v20.19.0', lts: 'Iron' },
        ]),
      )
    if (url === `/node/v${NODE}/SHASUMS256.txt`) return send(`${sha}  ${root}.tar.gz\n`)
    if (url === `/node/v${NODE}/${root}.tar.gz`) return send(tarball)
    if (/^\/npm(-next)?\/@anthropic-ai\/claude-code\/latest$/.test(url))
      return send(JSON.stringify({ name: '@anthropic-ai/claude-code', version: state.claude }))
    res.writeHead(404).end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, state, close: () => server.close() }
}

test('Agent 工具 installs Node.js and Claude Code from a custom mirror, streaming progress, then upgrades', async ({
  page,
}) => {
  test.setTimeout(5 * 60_000)
  const mirror = await fakeMirror()
  const { m } = await memberWithMachine(page, 'tl1', { env: isolated() })
  m.start()
  try {
    await page.goto('/')
    const dialog = await openMachine(page, 'Agent 工具')
    const saveMirror = async (registry: string) => {
      await dialog.getByRole('textbox', { name: 'npm registry' }).fill(registry)
      await dialog.getByRole('textbox', { name: 'Node.js 下载地址' }).fill(`${mirror.url}/node`)
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByText('镜像源已保存').last()).toBeVisible()
    }
    await dialog.getByRole('button', { name: '镜像源' }).click()
    await page.getByRole('menuitemcheckbox', { name: '自定义' }).click()
    await saveMirror(`${mirror.url}/npm`)

    const node = dialog.getByRole('region', { name: 'Node.js' })
    await node.getByRole('button', { name: /^安装/ }).click()
    const nodeLog = node.getByRole('log', { name: '安装日志' })
    await expect(nodeLog).toContainText('查询 Node.js 最新 LTS 版本')
    await expect(nodeLog).toContainText(`下载 node-v${NODE}-`)
    await expect(nodeLog).toContainText(`已切换到 Node.js ${NODE}`, { timeout: 60_000 })
    await expect(node).toContainText('安装完成')
    await expect(node).toContainText(`已安装 ${NODE}`)
    await expect(node).toContainText('共工空间托管')
    expect(existsSync(join(m.home, `runtime/node-v${NODE}/bin/node`))).toBe(true)

    const claude = dialog.getByRole('region', { name: 'Claude Code', exact: true })
    await claude.getByRole('button', { name: /^安装/ }).click()
    const claudeLog = claude.getByRole('log', { name: '安装日志' })
    await expect(claudeLog).toContainText(`安装 @anthropic-ai/claude-code@latest（${mirror.url}/npm）`)
    await expect(claudeLog).toContainText('added 1 package', { timeout: 60_000 })
    await expect(claude).toContainText('安装完成')
    await expect(claude).toContainText('已安装 2.1.300')
    await expect(claude).toContainText('共工空间托管')

    // A newer release on the mirror switched to: the upgrade installs exactly it from there.
    mirror.state.claude = '2.1.301'
    await saveMirror(`${mirror.url}/npm-next`)
    await claude.getByRole('button', { name: '升级到 2.1.301' }).click()
    await expect(claudeLog).toContainText(`安装 @anthropic-ai/claude-code@2.1.301（${mirror.url}/npm-next）`)
    await expect(claudeLog).toContainText('added 1 package', { timeout: 60_000 })
    await expect(claude).toContainText('已安装 2.1.301')
    await expect(claude.getByRole('button', { name: /升级到/ })).toHaveCount(0)
    expect(mirror.state.hits).toEqual(
      expect.arrayContaining([
        `/node/v${NODE}/SHASUMS256.txt`,
        `/node/v${NODE}/node-v${NODE}-${process.platform}-${process.arch}.tar.gz`,
        '/npm/@anthropic-ai/claude-code/latest',
        '/npm-next/@anthropic-ai/claude-code/latest',
      ]),
    )
  } finally {
    m.stop()
    mirror.close()
  }
})
