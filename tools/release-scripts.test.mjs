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
const artifact = (version, platform) =>
  `gonggong-${version}-${platform}${platform.startsWith('windows') ? '.exe' : ''}`
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

test('daemon verification downloads every artifact and checks its SHA-256', async (t) => {
  const root = releaseFixture()
  const out = join(root, 'dist/0.4.3')
  mkdirSync(out, { recursive: true })
  const remote = new Map()
  const sums = []
  const requested = []
  for (const platform of platforms) {
    const name = artifact('0.4.3', platform)
    const data = `bytes of ${name}`
    writeFileSync(join(out, name), data)
    sums.push(`${sha256(data)}  ${name}`)
    remote.set(`/downloads/${name}`, data)
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
  assert.equal(requested.length, 5)
  assert.equal(new Set(requested).size, 5)
  assert.match(ok.stdout, /gg windows-x86_64/)

  const damaged = artifact('0.4.3', 'linux-x86_64')
  remote.set(`/downloads/${damaged}`, 'corrupted')
  const failed = await runAsync('bash', args, { cwd: root, encoding: 'utf8' }).then(
    () => assert.fail('corrupted download unexpectedly passed'),
    (error) => error,
  )
  assert.equal(failed.code, 1)
  assert.match(failed.stdout, new RegExp(`FAIL gg ${damaged}: SHA-256 mismatch`))
})

test('macOS release uses rustup proxy dir (rust-toolchain.toml) and unified MACOSX_DEPLOYMENT_TARGET for gg, desktop and peer', () => {
  const root = releaseFixture()
  const bin = join(root, 'bin')
  const rustupDir = join(root, 'rustup-proxy')
  const innerBin = join(root, 'toolchains/1.98.0/bin')
  const log = join(root, 'calls.log')
  const peerLog = join(root, 'peer.log')
  mkdirSync(bin, { recursive: true })
  mkdirSync(rustupDir, { recursive: true })
  mkdirSync(innerBin, { recursive: true })
  mkdirSync(join(root, 'apps/desktop/src-tauri'), { recursive: true })
  writeFileSync(
    join(root, 'apps/desktop/src-tauri/tauri.conf.json'),
    '{"version": "0.4.3", "plugins": {"updater": {"pubkey": "test-key"}}}\n',
  )
  writeExecutable(join(bin, 'uname'), '#!/usr/bin/env bash\necho Darwin\n')
  writeExecutable(join(bin, 'security'), '#!/usr/bin/env bash\nexit 0\n')
  writeExecutable(
    join(rustupDir, 'rustup'),
    `#!/usr/bin/env bash
printf 'rustup %s\\n' "$*" >> "${log}"
if [ "$1" = which ]; then
  echo "${innerBin}/$2"
  exit 0
fi
exit 99
`,
  )
  writeExecutable(
    join(rustupDir, 'cargo'),
    `#!/usr/bin/env bash
printf 'cargo PATH0=%s RUSTC=%s DEPLOY=%s %s\\n' "\${PATH%%:*}" "\${RUSTC:-}" "\${MACOSX_DEPLOYMENT_TARGET:-}" "$*" >> "${log}"
mkdir -p "${root}/target/aarch64-apple-darwin/release"
: > "${root}/target/aarch64-apple-darwin/release/gg"
`,
  )
  writeExecutable(
    join(bin, 'pnpm'),
    `#!/usr/bin/env bash
printf 'pnpm PATH0=%s RUSTC=%s DEPLOY=%s %s\\n' "\${PATH%%:*}" "\${RUSTC:-}" "\${MACOSX_DEPLOYMENT_TARGET:-}" "$*" >> "${log}"
if [[ "$*" == *"tauri build"* ]] || [[ "$*" == *"tauri bundle"* ]]; then
  for arg in "$@"; do
    case "$arg" in
      aarch64-apple-darwin | x86_64-apple-darwin) arch="\${arg%%-*}" ;;
    esac
  done
  b="${root}/target/\${arch}-apple-darwin/release/bundle"
  mkdir -p "$b/dmg" "$b/macos"
  : > "$b/dmg/Gonggong.dmg"
  : > "$b/macos/Gonggong.app.tar.gz"
  : > "$b/macos/Gonggong.app.tar.gz.sig"
fi
`,
  )
  writeExecutable(
    join(root, 'scripts/peer.sh'),
    `#!/usr/bin/env bash
if [ "$1" = --ping ]; then exit 0; fi
if [ "$1" = --dir ]; then echo "gg-peer/test"; exit 0; fi
printf '%s\\n' "$*" >> "${peerLog}"
mkdir -p "${root}/target/x86_64-apple-darwin/release"
: > "${root}/target/x86_64-apple-darwin/release/gg"
`,
  )
  writeExecutable(
    join(bin, 'ssh'),
    `#!/usr/bin/env bash
tar -cf - -C "${root}/target/x86_64-apple-darwin/release" gg
`,
  )

  const res = run(
    'bash',
    ['scripts/release.sh', '--only', 'macos-aarch64,macos-x86_64,desktop', '--build-only', '--allow-dirty'],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${rustupDir}:${bin}:${process.env.PATH}`,
        RUSTC: '/some/stale/rustc',
        TAURI_SIGNING_PRIVATE_KEY: 'dummy-key',
        MACOSX_DEPLOYMENT_TARGET: '',
      },
    },
  )
  assert.equal(res.status, 0, res.stderr + res.stdout)

  const calls = readFileSync(log, 'utf8').trim().split('\n')
  assert.ok(
    !calls.some((c) => c.includes('rustup run stable')),
    `should not pin stable toolchain: ${calls.join('\n')}`,
  )
  const cargoCall = calls.find((c) => c.startsWith('cargo '))
  assert.ok(cargoCall, `expected cargo call: ${calls.join('\n')}`)
  assert.match(cargoCall, new RegExp(`PATH0=${rustupDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(cargoCall, /RUSTC= /)
  assert.match(cargoCall, /DEPLOY=10\.13 /)

  const tauriBuild = calls.find((c) => c.includes('tauri build'))
  assert.ok(tauriBuild, `expected tauri build call: ${calls.join('\n')}`)
  assert.match(tauriBuild, new RegExp(`PATH0=${rustupDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.doesNotMatch(tauriBuild, new RegExp(innerBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(tauriBuild, /RUSTC= /)
  assert.match(tauriBuild, /DEPLOY=10\.13 /)

  const peer = readFileSync(peerLog, 'utf8').trim()
  assert.match(peer, /MACOSX_DEPLOYMENT_TARGET=10\.13/)
  assert.match(peer, /cargo build .* -p gonggong --target x86_64-apple-darwin/)
})

test('--assemble writes checksums and manifests with empty build target arrays (Bash 3.2 safe)', () => {
  const root = releaseFixture()
  const out = join(root, 'dist/0.4.3')
  mkdirSync(out, { recursive: true })
  mkdirSync(join(root, 'docs/release-notes'), { recursive: true })
  writeFileSync(join(root, 'docs/release-notes/v0.4.3.md'), '# v0.4.3\n\nNotes.\n')
  for (const platform of platforms) {
    writeFileSync(join(out, artifact('0.4.3', platform)), `bin-${platform}`)
  }
  for (const arch of ['aarch64', 'x86_64']) {
    writeFileSync(join(out, `Gonggong_0.4.3_${arch}.app.tar.gz`), `tar-${arch}`)
    writeFileSync(join(out, `Gonggong_0.4.3_${arch}.app.tar.gz.sig`), `sig-${arch}\n`)
  }
  writeFileSync(join(out, 'Gonggong_0.4.3_x64-setup.exe'), 'win-exe')
  writeFileSync(join(out, 'Gonggong_0.4.3_x64-setup.exe.sig'), 'sig-win\n')

  const bash = existsSync('/bin/bash') ? '/bin/bash' : 'bash'
  const res = run(bash, ['scripts/release.sh', '--assemble', '--allow-dirty'], { cwd: root })

  assert.equal(res.status, 0, res.stderr + res.stdout)
  const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8')
  for (const platform of platforms) {
    const file = artifact('0.4.3', platform)
    assert.match(sums, new RegExp(`${sha256(`bin-${platform}`)}  ${file.replace('.', '\\.')}`))
  }
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, '0.4.3')
  assert.equal(manifest.releaseNotes, '# v0.4.3\n\nNotes.')
  assert.equal(Object.keys(manifest.builds).length, 5)
  const latest = JSON.parse(readFileSync(join(out, 'github/latest.json'), 'utf8'))
  assert.equal(latest.version, '0.4.3')
  assert.equal(latest.platforms['darwin-aarch64'].signature, 'sig-aarch64')
  assert.equal(latest.platforms['darwin-x86_64'].signature, 'sig-x86_64')
  assert.equal(latest.platforms['windows-x86_64'].signature, 'sig-win')
})
