import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const platforms = ['macos-aarch64', 'macos-x86_64', 'linux-x86_64', 'linux-aarch64', 'windows-x86_64']
const artifact = (prefix, version, platform) =>
  `${prefix}-${version}-${platform}${platform.startsWith('windows') ? '.exe' : ''}`
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options })
const runAsync = promisify(execFile)

function writeExecutable(path, body) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function git(cwd, ...args) {
  const result = run('git', args, { cwd })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function releaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gonggong-release-scripts-'))
  mkdirSync(join(root, 'scripts/release'), { recursive: true })
  for (const file of ['lib.sh', 'manifest.mjs'])
    cpSync(join(ROOT, 'scripts/release', file), join(root, 'scripts/release', file))
  cpSync(join(ROOT, 'scripts/release.sh'), join(root, 'scripts/release.sh'))
  cpSync(join(ROOT, 'scripts/release/ship.sh'), join(root, 'scripts/release/ship.sh'))
  mkdirSync(join(root, 'crates/gonggong'), { recursive: true })
  writeFileSync(join(root, 'crates/gonggong/Cargo.toml'), 'version = "0.4.3"\n')
  return root
}

test('daemon-only ship builds and pushes without GitHub or Windows steps', () => {
  const root = releaseFixture()
  const remote = join(root, 'remote.git')
  const work = join(root, 'work')
  git(root, 'init', '--bare', remote)
  git(root, 'clone', remote, work)
  git(work, 'config', 'user.email', 'release-test@example.com')
  git(work, 'config', 'user.name', 'Release Test')
  git(work, 'checkout', '-b', 'main')
  for (const file of ['scripts/release.sh', 'scripts/release/lib.sh', 'scripts/release/ship.sh']) {
    mkdirSync(dirname(join(work, file)), { recursive: true })
    cpSync(join(root, file), join(work, file))
  }
  for (const file of ['crates/gonggong/Cargo.toml', 'apps/desktop/src-tauri/Cargo.toml']) {
    mkdirSync(dirname(join(work, file)), { recursive: true })
    writeFileSync(join(work, file), 'version = "0.4.3"\n')
  }
  mkdirSync(join(work, 'apps/desktop/src-tauri'), { recursive: true })
  writeFileSync(join(work, 'apps/desktop/src-tauri/tauri.conf.json'), '{\n  "version": "0.4.3",\n}\n')
  writeFileSync(join(work, 'Cargo.lock'), '# test fixture\n')
  writeFileSync(join(work, 'CHANGELOG.md'), '## v0.4.3 — 2026-10-26\n')
  mkdirSync(join(work, 'docs/release-notes'), { recursive: true })
  writeFileSync(join(work, 'docs/release-notes/v0.4.3.md'), '## v0.4.3\n')
  writeExecutable(
    join(work, 'scripts/release.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "$*" > release-args\nmkdir -p dist/0.4.3\n',
  )
  git(work, 'add', '.')
  git(work, 'commit', '-m', 'test fixture')
  git(work, 'push', '-u', 'origin', 'main')
  git(work, 'remote', 'add', 'gitlab', remote)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeExecutable(join(bin, 'gh'), '#!/usr/bin/env bash\necho "$*" >> gh-calls\nexit 97\n')

  const result = run('bash', ['scripts/release/ship.sh', '0.4.3', '--daemon-only'], {
    cwd: work,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(work, 'release-args'), 'utf8').trim(), '--daemon-only --allow-dirty')
  assert.equal(existsSync(join(work, 'gh-calls')), false)
  assert.match(result.stdout, /kind: "daemon"/)
  assert.match(result.stdout, /--daemon-only/)
  const head = git(work, 'rev-parse', 'HEAD')
  assert.equal(git(work, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], head)
  assert.equal(git(work, 'ls-remote', 'origin', 'refs/tags/v0.4.3').split(/\s/)[0], head)
})

test('daemon-only release refuses a missing cast cache before compiling', () => {
  const root = releaseFixture()
  git(root, 'init')
  git(root, 'config', 'user.email', 'release-test@example.com')
  git(root, 'config', 'user.name', 'Release Test')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'test fixture')
  const cache = join(root, 'empty-cache')

  const result = run('bash', ['scripts/release.sh', '--daemon-only', '--allow-dirty'], {
    cwd: root,
    env: { ...process.env, GONGGONG_CAST_CACHE: cache },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /完整发布/)
  assert.equal(existsSync(join(root, 'target')), false)
})

test('daemon verification downloads every artifact and checks its SHA-256', async (t) => {
  const root = releaseFixture()
  const out = join(root, 'dist/0.4.3')
  mkdirSync(out, { recursive: true })
  const remote = new Map()
  const sums = []
  const requested = []
  for (const prefix of ['gonggong', 'gg-cast']) {
    for (const platform of platforms) {
      const name = artifact(prefix, '0.4.3', platform)
      const data = `bytes of ${name}`
      writeFileSync(join(out, name), data)
      sums.push(`${sha256(data)}  ${name}`)
      remote.set(`/downloads/${name}`, data)
    }
  }
  writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`)
  const server = createServer((req, res) => {
    requested.push(req.url)
    if (!remote.has(req.url)) {
      res.writeHead(404).end()
      return
    }
    res.end(remote.get(req.url))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  const args = ['scripts/release/ship.sh', 'verify', '0.4.3', url, '--daemon-only']

  const ok = await runAsync('bash', args, { cwd: root, encoding: 'utf8' })
  assert.equal(requested.length, 10)
  assert.equal(new Set(requested).size, 10)
  assert.match(ok.stdout, /gg-cast windows-x86_64/)

  const damaged = artifact('gonggong', '0.4.3', 'linux-x86_64')
  remote.set(`/downloads/${damaged}`, 'corrupted')
  const failed = await runAsync('bash', args, { cwd: root, encoding: 'utf8' }).then(
    () => assert.fail('corrupted download unexpectedly passed'),
    (error) => error,
  )
  assert.equal(failed.code, 1)
  assert.match(failed.stdout, new RegExp(`FAIL gg ${damaged}: SHA-256 mismatch`))
})
