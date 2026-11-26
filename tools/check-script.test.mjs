import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options })

function writeExecutable(path, body) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function git(cwd, ...args) {
  const result = run('git', args, { cwd })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function checkFixture({ role = '', slots = '1', peerExit = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gonggong-check-script-'))
  const work = join(root, 'work')
  const bin = join(root, 'bin')
  const log = join(root, 'calls.log')
  const peerLog = join(root, 'peer.log')
  const peerEnv = join(root, 'peer.env')
  mkdirSync(join(work, 'scripts'), { recursive: true })
  mkdirSync(join(work, 'apps/web/src/ui'), { recursive: true })
  mkdirSync(join(work, 'apps/web/test'), { recursive: true })
  mkdirSync(join(work, 'apps/server/src/modules/chat'), { recursive: true })
  mkdirSync(join(work, 'apps/server/test'), { recursive: true })
  mkdirSync(join(work, 'apps/desktop/src'), { recursive: true })
  mkdirSync(join(work, 'packages/protocol/src/web'), { recursive: true })
  mkdirSync(join(work, 'packages/protocol/src/daemon'), { recursive: true })
  mkdirSync(join(work, 'packages/protocol/fixtures'), { recursive: true })
  mkdirSync(join(work, 'crates/gonggong/src'), { recursive: true })
  mkdirSync(join(work, 'tools'), { recursive: true })
  mkdirSync(bin, { recursive: true })

  cpSync(join(ROOT, 'scripts/check.sh'), join(work, 'scripts/check.sh'))
  writeFileSync(join(work, 'scripts/check-size.mjs'), '// stub\n')
  writeFileSync(join(work, 'apps/web/src/ui/Button.tsx'), 'export const Button = () => null\n')
  writeFileSync(join(work, 'apps/web/test/chat.test.tsx'), '// stub\n')
  writeFileSync(join(work, 'apps/server/src/modules/chat/routes.ts'), 'export {}\n')
  writeFileSync(join(work, 'apps/server/test/chat.test.ts'), '// stub\n')
  writeFileSync(join(work, 'apps/desktop/src/main.ts'), 'export {}\n')
  writeFileSync(join(work, 'packages/protocol/src/web/messages.ts'), 'export {}\n')
  writeFileSync(join(work, 'packages/protocol/src/daemon/d2s.ts'), 'export {}\n')
  writeFileSync(join(work, 'packages/protocol/fixtures/d2s.hello.json'), '{}\n')
  writeFileSync(join(work, 'packages/protocol/gonggong-daemon-tools.json'), '[]\n')
  writeFileSync(join(work, 'crates/gonggong/src/lib.rs'), 'pub fn ok() {}\n')

  writeExecutable(
    join(work, 'scripts/peer.sh'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${peerLog}"
exit ${peerExit}
`,
  )
  writeExecutable(
    join(bin, 'pnpm'),
    `#!/usr/bin/env bash
printf 'pnpm VITEST_MAX_WORKERS=%s %s\\n' "\${VITEST_MAX_WORKERS:-}" "$*" >> "${log}"
`,
  )
  writeExecutable(
    join(bin, 'cargo'),
    `#!/usr/bin/env bash
printf 'cargo %s\\n' "$*" >> "${log}"
`,
  )
  if (role) {
    writeFileSync(peerEnv, `GG_ROLE=${role}\nGG_CHECK_SLOTS=${slots}\n`)
  }

  git(work, 'init', '-q', '-b', 'main')
  git(work, 'config', 'user.email', 'check-test@example.com')
  git(work, 'config', 'user.name', 'Check Test')
  git(work, 'add', '.')
  git(work, 'commit', '-qm', 'init')
  git(work, 'update-ref', 'refs/remotes/origin/main', 'HEAD')

  const execCheck = (args = [], extraEnv = {}) =>
    run('bash', ['scripts/check.sh', ...args], {
      cwd: work,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GG_PEER_ENV: peerEnv,
        GG_CHECK_LOCK: join(root, 'check.lock'),
        VITEST_MAX_WORKERS: '',
        ...extraEnv,
      },
    })

  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
  const peerCalls = () =>
    existsSync(peerLog) ? readFileSync(peerLog, 'utf8').trim().split('\n').filter(Boolean) : []

  return { root, work, execCheck, calls, peerCalls }
}

test('light online offloads typecheck, web, server and cargo to heavy, keeping lint/desktop/protocol local', () => {
  const f = checkFixture({ role: 'light', slots: '1', peerExit: 0 })
  writeFileSync(join(f.work, 'apps/web/src/ui/Button.tsx'), 'export const Button = () => 1\n')
  const res = f.execCheck()
  assert.equal(res.status, 0, res.stderr + res.stdout)

  const peer = f.peerCalls()
  assert.equal(peer.length, 1)
  assert.match(peer[0], /--jobs typecheck,web\b/)

  const local = f.calls()
  assert.ok(
    local.some((c) => c.endsWith(' lint')),
    `expected local lint, got: ${local.join('; ')}`,
  )
  assert.ok(
    local.some((c) => c.includes('--filter @gonggong/desktop test') && c.includes('VITEST_MAX_WORKERS=3')),
    `expected local desktop with VITEST_MAX_WORKERS=3, got: ${local.join('; ')}`,
  )
  assert.ok(
    !local.some((c) => c.endsWith(' typecheck')),
    `typecheck should be offloaded: ${local.join('; ')}`,
  )
  assert.ok(!local.some((c) => c.includes('@gonggong/web')), `web should be offloaded: ${local.join('; ')}`)
})

test('light --all online offloads typecheck,web,server,cargo to heavy', () => {
  const f = checkFixture({ role: 'light', slots: '1', peerExit: 0 })
  const res = f.execCheck(['--all'])
  assert.equal(res.status, 0, res.stderr + res.stdout)

  const peer = f.peerCalls()
  assert.equal(peer.length, 1)
  assert.match(peer[0], /--all --jobs typecheck,web,server,cargo\b/)

  const local = f.calls()
  assert.ok(local.some((c) => c.includes('@gonggong/protocol test')))
  assert.ok(local.some((c) => c.includes('@gonggong/desktop test')))
  assert.ok(!local.some((c) => c.endsWith(' typecheck')))
  assert.ok(!local.some((c) => c.includes('@gonggong/web')))
  assert.ok(!local.some((c) => c.includes('@gonggong/server')))
  assert.ok(!local.some((c) => c.startsWith('cargo ')))
})

test('light falls back to running offloaded jobs locally with VITEST_MAX_WORKERS=3 when peer exits 75', () => {
  const f = checkFixture({ role: 'light', slots: '1', peerExit: 75 })
  writeFileSync(join(f.work, 'apps/web/src/ui/Button.tsx'), 'export const Button = () => 2\n')
  const res = f.execCheck()
  assert.equal(res.status, 0, res.stderr + res.stdout)
  assert.match(res.stdout, /gg-peer unavailable/)

  const local = f.calls()
  assert.ok(
    local.some((c) => c.endsWith(' typecheck')),
    `expected fallback typecheck: ${local.join('; ')}`,
  )
  assert.ok(
    local.some((c) => c.includes('@gonggong/web test') && c.includes('VITEST_MAX_WORKERS=3')),
    `expected fallback web with VITEST_MAX_WORKERS=3: ${local.join('; ')}`,
  )
})

test('light --local runs everything locally with VITEST_MAX_WORKERS=3 without calling peer', () => {
  const f = checkFixture({ role: 'light', slots: '1', peerExit: 0 })
  writeFileSync(join(f.work, 'apps/web/src/ui/Button.tsx'), 'export const Button = () => 3\n')
  const res = f.execCheck(['--local'])
  assert.equal(res.status, 0, res.stderr + res.stdout)
  assert.equal(f.peerCalls().length, 0)

  const local = f.calls()
  assert.ok(local.some((c) => c.endsWith(' typecheck')))
  assert.ok(local.some((c) => c.includes('@gonggong/web test') && c.includes('VITEST_MAX_WORKERS=3')))
})

test('heavy never offloads web, desktop or protocol to light and runs all locally without capping workers', () => {
  const f = checkFixture({ role: 'heavy', slots: '2', peerExit: 0 })
  const res = f.execCheck(['--all'])
  assert.equal(res.status, 0, res.stderr + res.stdout)
  assert.equal(f.peerCalls().length, 0)

  const local = f.calls()
  assert.ok(local.some((c) => c.endsWith(' typecheck')))
  assert.ok(local.some((c) => c.includes('@gonggong/web test') && c.includes('VITEST_MAX_WORKERS= ')))
  assert.ok(local.some((c) => c.includes('@gonggong/server test') && c.includes('VITEST_MAX_WORKERS= ')))
  assert.ok(local.some((c) => c.includes('@gonggong/protocol test')))
  assert.ok(local.some((c) => c.includes('@gonggong/desktop test')))
  assert.ok(local.some((c) => c.startsWith('cargo test')))
})

test('peer --jobs executes typecheck cleanly without running check-size or lint', () => {
  const f = checkFixture({ role: 'heavy', slots: '2', peerExit: 0 })
  const res = f.execCheck(['--jobs', 'typecheck,web'], {
    GG_CHECK_CHANGED: 'apps/web/src/ui/Button.tsx',
  })
  assert.equal(res.status, 0, res.stderr + res.stdout)
  const local = f.calls()
  assert.ok(local.some((c) => c.endsWith(' typecheck')))
  assert.ok(local.some((c) => c.includes('@gonggong/web test')))
  assert.ok(!local.some((c) => c.endsWith(' lint')))
})

test('packages/protocol/src/web/* runs full TS suites without cargo, even alongside a web feature edit', () => {
  const f = checkFixture({ role: 'heavy', slots: '2', peerExit: 0 })
  writeFileSync(join(f.work, 'packages/protocol/src/web/messages.ts'), 'export const v = 1\n')
  mkdirSync(join(f.work, 'apps/web/src/features/chat'), { recursive: true })
  writeFileSync(
    join(f.work, 'apps/web/src/features/chat/ChatView.tsx'),
    'export const ChatView = () => null\n',
  )
  const res = f.execCheck()
  assert.equal(res.status, 0, res.stderr + res.stdout)

  const local = f.calls()
  assert.ok(local.some((c) => c.includes('@gonggong/protocol test')))
  assert.ok(local.some((c) => c.includes('@gonggong/desktop test')))
  assert.ok(
    local.some((c) => c.includes('@gonggong/web test')),
    `expected full web test: ${local.join('; ')}`,
  )
  assert.ok(
    local.some((c) => c.includes('@gonggong/server test')),
    `expected full server test: ${local.join('; ')}`,
  )
  assert.ok(!local.some((c) => c.startsWith('cargo ')), `cargo should be skipped: ${local.join('; ')}`)
})

test('packages/protocol/src/web/* on light offloads typecheck,web,server without cargo', () => {
  const f = checkFixture({ role: 'light', slots: '1', peerExit: 0 })
  writeFileSync(join(f.work, 'packages/protocol/src/web/messages.ts'), 'export const v = 2\n')
  const res = f.execCheck()
  assert.equal(res.status, 0, res.stderr + res.stdout)

  const peer = f.peerCalls()
  assert.equal(peer.length, 1)
  assert.match(peer[0], /--jobs typecheck,web,server\b/)
  assert.doesNotMatch(peer[0], /--all/)
  assert.doesNotMatch(peer[0], /\bcargo\b/)
})

test('other packages/protocol/* paths (daemon, fixtures, daemon-tools, common) still trigger all including cargo', () => {
  for (const rel of [
    'packages/protocol/src/daemon/d2s.ts',
    'packages/protocol/fixtures/d2s.hello.json',
    'packages/protocol/gonggong-daemon-tools.json',
    'packages/protocol/src/common.ts',
  ]) {
    const f = checkFixture({ role: 'heavy', slots: '2', peerExit: 0 })
    writeFileSync(join(f.work, rel), '// changed\n')
    const res = f.execCheck()
    assert.equal(res.status, 0, `${rel}: ${res.stderr + res.stdout}`)
    const local = f.calls()
    assert.ok(
      local.some((c) => c.startsWith('cargo test --workspace')),
      `${rel} should trigger full cargo test: ${local.join('; ')}`,
    )
  }
})
