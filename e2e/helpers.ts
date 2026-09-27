import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

export const ROOT = join(import.meta.dirname, '..')
export const SERVER = 'http://127.0.0.1:8790'
export const GONGGONG_BIN = join(ROOT, 'target/debug/gg')

export function buildDaemon() {
  execFileSync('cargo', ['build', '-q', '-p', 'gonggong'], { cwd: ROOT, stdio: 'inherit' })
}

export function gonggong(args: string[], env: Record<string, string> = {}) {
  return execFileSync(GONGGONG_BIN, args, { encoding: 'utf8', env: { ...process.env, ...env } })
}

/** An isolated "member machine": its own GONGGONG_HOME, running `gg run` in the background. */
export function machine(server = SERVER, extraEnv: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'gonggong-e2e-'))
  const env = {
    GONGGONG_HOME: home,
    GONGGONG_MACHINE_ID: home,
    GONGGONG_LOG: 'info',
    CODEX_HOME: codexHome(),
    ...extraEnv,
  }
  let proc: ChildProcess | undefined
  let exited: Promise<number | null> = Promise.resolve(null)
  return {
    home,
    login: (code: string) => gonggong(['login', '--server', server, '--code', code], env),
    /** `gg login <接入链接>`, as copied from the web's bind dialog. */
    loginLink: (link: string) => gonggong(['login', link], env),
    start() {
      proc = spawn(GONGGONG_BIN, ['run'], { env: { ...process.env, ...env }, stdio: 'inherit' })
      const p = proc
      exited = new Promise((r) => p.on('exit', (code) => r(code)))
    },
    stop: () => proc?.kill(),
    /** Resolves with the exit code once `gg run` terminates (e.g. after being revoked). */
    exited: () => exited,
    /** Recursively finds a file by name under this machine's managed workspaces. */
    find(name: string): string | undefined {
      const walk = (dir: string): string | undefined => {
        for (const e of readdirSync(dir)) {
          const p = join(dir, e)
          if (e === name) return p
          if (statSync(p).isDirectory() && e !== 'node_modules') {
            const hit = walk(p)
            if (hit) return hit
          }
        }
      }
      try {
        return walk(join(home, 'workspaces'))
      } catch {
        return undefined
      }
    },
  }
}

/**
 * The developer's ~/.codex/config.toml may pin a model their account can't use; tests run Codex against a scratch
 * CODEX_HOME that reuses only the login (auth.json).
 */
function codexHome() {
  const dir = mkdtempSync(join(tmpdir(), 'gonggong-codex-'))
  const auth = join(homedir(), '.codex', 'auth.json')
  if (existsSync(auth)) copyFileSync(auth, join(dir, 'auth.json'))
  writeFileSync(join(dir, 'config.toml'), `model = "${process.env.GONGGONG_E2E_CODEX_MODEL ?? 'gpt-5.5'}"\n`)
  return dir
}

/** A bare git repo in a temp dir with one commit on `main`; `commit()` pushes another commit from a scratch clone. */
export function remoteRepo() {
  const root = mkdtempSync(join(tmpdir(), 'gonggong-repo-'))
  const bare = join(root, 'remote.git')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@gonggong', ...args], {
      cwd,
      encoding: 'utf8',
    })
  git(root, 'init', '-q', '--bare', '-b', 'main', bare)
  const seed = join(root, 'seed')
  git(root, 'clone', '-q', bare, seed)
  writeFileSync(join(seed, 'README.md'), '# demo\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'init')
  git(seed, 'push', '-q', 'origin', 'main')
  return {
    url: `file://${bare}`,
    commit(file: string, content: string) {
      git(seed, 'pull', '-q', '--ff-only', 'origin', 'main')
      writeFileSync(join(seed, file), content)
      git(seed, 'add', '.')
      git(seed, 'commit', '-qm', `add ${file}`)
      git(seed, 'push', '-q', 'origin', 'main')
    },
    /** A clone at a local path, e.g. for /cd. */
    cloneTo(name: string) {
      const dir = join(root, name)
      git(root, 'clone', '-q', bare, dir)
      return dir
    },
    git,
    root,
  }
}

export async function login(page: Page, account: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('账号').fill(account)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
}

export async function changePassword(page: Page, oldPassword: string, newPassword: string) {
  await page.getByLabel('初始密码').fill(oldPassword)
  await page.getByLabel('新密码', { exact: true }).fill(newPassword)
  await page.getByLabel('确认新密码').fill(newPassword)
  await page.getByRole('button', { name: '修改密码' }).click()
  await expect(page.getByLabel('初始密码')).toBeHidden()
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
}

type Api = import('@playwright/test').APIRequestContext

export async function call<T>(
  api: Api,
  method: 'get' | 'post' | 'patch',
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await api[method](path, data === undefined ? undefined : { data })
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} → ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Binds each bot to its managed workspace (bots join unbound, plan W5) once its machine is online; waits until ready. */
export async function bindManaged(api: Api, groupId: string, botIds: string[]) {
  const bind = (id: string) =>
    api.put(`/api/groups/${groupId}/bots/${id}/workspace`, { data: { path: null } })
  for (const id of botIds)
    await expect.poll(async () => (await bind(id)).status(), { timeout: 60_000 }).toBe(204)
  const ready = async () => {
    const states: { botId: string; state: string }[] = await (
      await api.get(`/api/groups/${groupId}/bot-states`)
    ).json()
    return botIds.every((id) => states.find((s) => s.botId === id)?.state === 'ready')
  }
  await expect.poll(ready, { timeout: 120_000 }).toBe(true)
}

/** Sets the bot's default workspace once its machine is online (the daemon validates the path). */
export async function setDefaultWorkspace(api: Api, botId: string, path: string) {
  const put = () => api.put(`/api/bots/${botId}/default-workspace`, { data: { path } })
  await expect.poll(async () => (await put()).status(), { timeout: 60_000 }).toBe(200)
}

/** Logs the bootstrap admin into `api`, completing the forced first password change if still pending. */
export async function adminSession(api: Api) {
  const res = await api.post('/api/auth/login', { data: { account: 'admin', password: 'admin-pass-2' } })
  if (res.ok()) return
  await call(api, 'post', '/api/auth/login', { account: 'admin', password: 'admin-init-pass' })
  await call(api, 'post', '/api/auth/password', {
    oldPassword: 'admin-init-pass',
    newPassword: 'admin-pass-2',
  })
}

/**
 * Fast API-level setup: a fresh member (created by the bootstrap admin) logged into `page`, with a bound machine.
 * `env` is added to the machine's daemon environment (e.g. git config).
 */
export async function memberWithMachine(
  page: Pick<Page, 'request'>,
  account: string,
  o: { bind?: 'code' | 'link'; env?: Record<string, string> } = {},
) {
  const admin = page.request
  await adminSession(admin)
  await call(admin, 'post', '/api/admin/users', {
    account,
    name: account,
    role: 'member',
    password: 'init-pass-1',
  })
  await call(admin, 'post', '/api/auth/logout')
  await page.request.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  await call(page.request, 'post', '/api/auth/password', {
    oldPassword: 'init-pass-1',
    newPassword: 'member-pass',
  })
  const { code, link } = await call<{ code: string; link: string }>(page.request, 'post', '/api/bind-codes')
  const m = machine(SERVER, o.env)
  if (o.bind === 'link') m.loginLink(link)
  else m.login(code)
  const api = {
    call: <T>(method: 'get' | 'post' | 'patch', path: string, data?: unknown) =>
      call<T>(page.request, method, path, data),
    async me() {
      return call<{ id: string }>(page.request, 'get', '/api/me')
    },
    async machineId() {
      return (await call<{ id: string }[]>(page.request, 'get', '/api/machines'))[0]!.id
    },
  }
  return { m, api }
}
