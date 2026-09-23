import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

export const ROOT = join(import.meta.dirname, '..')
export const SERVER = 'http://127.0.0.1:8790'
export const AIWS_BIN = join(ROOT, 'target/debug/aiws')

export function buildDaemon() {
  execFileSync('cargo', ['build', '-q', '-p', 'aiws'], { cwd: ROOT, stdio: 'inherit' })
}

export function aiws(args: string[], env: Record<string, string> = {}) {
  return execFileSync(AIWS_BIN, args, { encoding: 'utf8', env: { ...process.env, ...env } })
}

/** An isolated "member machine": its own AIWS_HOME, running `aiws run` in the background. */
export function machine() {
  const home = mkdtempSync(join(tmpdir(), 'aiws-e2e-'))
  const env = { AIWS_HOME: home, AIWS_LOG: 'info', CODEX_HOME: codexHome() }
  let proc: ChildProcess | undefined
  return {
    home,
    login: (code: string) => aiws(['login', '--server', SERVER, '--code', code], env),
    start() {
      proc = spawn(AIWS_BIN, ['run'], { env: { ...process.env, ...env }, stdio: 'inherit' })
    },
    stop: () => proc?.kill(),
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
  const dir = mkdtempSync(join(tmpdir(), 'aiws-codex-'))
  const auth = join(homedir(), '.codex', 'auth.json')
  if (existsSync(auth)) copyFileSync(auth, join(dir, 'auth.json'))
  writeFileSync(join(dir, 'config.toml'), `model = "${process.env.AIWS_E2E_CODEX_MODEL ?? 'gpt-5.5'}"\n`)
  return dir
}

/** A bare git repo in a temp dir with one commit on `main`; `commit()` pushes another commit from a scratch clone. */
export function remoteRepo() {
  const root = mkdtempSync(join(tmpdir(), 'aiws-repo-'))
  const bare = join(root, 'remote.git')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@aiws', ...args], {
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
  await page.getByLabel('当前密码').fill(oldPassword)
  await page.getByLabel('新密码', { exact: true }).fill(newPassword)
  await page.getByLabel('确认新密码').fill(newPassword)
  await page.getByRole('button', { name: '修改密码' }).click()
  await expect(page.getByLabel('当前密码')).toBeHidden()
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
}

type Api = import('@playwright/test').APIRequestContext

async function call<T>(api: Api, method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
  const res = await api[method](path, data === undefined ? undefined : { data })
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} → ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Fast API-level setup: a fresh member (created by the bootstrap admin) logged into `page`, with a bound machine. */
export async function memberWithMachine(page: Page, account: string) {
  const admin = page.request
  let res = await admin.post('/api/auth/login', { data: { account: 'admin', password: 'admin-pass-2' } })
  if (!res.ok()) {
    await call(admin, 'post', '/api/auth/login', { account: 'admin', password: 'admin-init-pass' })
    await call(admin, 'post', '/api/auth/password', {
      oldPassword: 'admin-init-pass',
      newPassword: 'admin-pass-2',
    })
  }
  await call(admin, 'post', '/api/admin/users', {
    account,
    name: account,
    role: 'member',
    password: 'init-pass-1',
  })
  await call(admin, 'post', '/api/auth/logout')
  res = await page.request.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  await call(page.request, 'post', '/api/auth/password', {
    oldPassword: 'init-pass-1',
    newPassword: 'member-pass',
  })
  const { code } = await call<{ code: string }>(page.request, 'post', '/api/bind-codes')
  const m = machine()
  m.login(code)
  const api = {
    call: <T>(method: 'get' | 'post', path: string, data?: unknown) =>
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
