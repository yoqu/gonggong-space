/**
 * Opt-in: force sync between this machine and a second one over the LAN (docs/plan/强制同步-开发计划.md).
 * This machine runs the HTTPS server, an HTTP server serving the group repo and bot 甲's daemon; the remote runs bot 乙's
 * daemon from its own GONGGONG_HOME, so a desktop app already running there is left alone. SSH must work
 * non-interactively (e.g. a ControlMaster socket passed in GONGGONG_E2E_SSH_OPTS).
 * Run: GONGGONG_E2E_REMOTE=user@host GONGGONG_E2E_LAN=<this machine's LAN IP> GONGGONG_E2E_REMOTE_NODE=<node path>
 *      [GONGGONG_E2E_SSH_OPTS='-o ControlPath=…'] [GONGGONG_E2E_BIG=20000] pnpm exec playwright test -c e2e/remote.config.ts
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, request, test } from '@playwright/test'
import { bindManaged, buildDaemon, call, GONGGONG_BIN, machine, ROOT } from './helpers'

const REMOTE = process.env.GONGGONG_E2E_REMOTE ?? ''
const LAN = process.env.GONGGONG_E2E_LAN ?? ''
const NODE = process.env.GONGGONG_E2E_REMOTE_NODE ?? 'node'
const SSH_OPTS = (process.env.GONGGONG_E2E_SSH_OPTS ?? '').split(' ').filter(Boolean)
const BIG = Number(process.env.GONGGONG_E2E_BIG ?? 0)
const PORT = 8793
const GIT_PORT = 9419
const RDIR = 'gonggong-e2e-remote'

test.skip(!REMOTE || !LAN, 'set GONGGONG_E2E_REMOTE and GONGGONG_E2E_LAN to run the two-machine path')
test.beforeAll(buildDaemon)

const ssh = (cmd: string) => execFileSync('ssh', [...SSH_OPTS, REMOTE, cmd], { encoding: 'utf8' })
const scp = (from: string, to: string) =>
  execFileSync('rsync', ['-aL', '-e', `ssh ${SSH_OPTS.join(' ')}`, from, `${REMOTE}:${to}`])
const sh = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Status = {
  headVersion: number
  consistent: number
  total: number
  replicas: { botId: string; state: string; version: number | null; reason: string | null }[]
}

test('two machines: switch, distribute both ways, merge, conflict, hand edit, offline catch-up, secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gonggong-e2e-remote-'))
  execFileSync('bash', ['scripts/dev-cert.sh', dir], { cwd: ROOT })
  execFileSync('bash', ['scripts/pg.sh', 'reset', 'gonggong_e2e_remote'], { cwd: ROOT })
  const base = `https://${LAN}:${PORT}`
  const procs: ChildProcess[] = []
  procs.push(
    spawn('pnpm', ['--filter', '@gonggong/server', 'start'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '0.0.0.0',
        GONGGONG_DB: 'gonggong_e2e_remote',
        // A big tree's blobs must not pile up in the dev data dir, which server tests sweep.
        GONGGONG_DATA_DIR: join(dir, 'data'),
        GONGGONG_ADMIN_PASSWORD: 'admin-init-pass',
        GONGGONG_TLS_CERT: join(dir, 'cert.pem'),
        GONGGONG_TLS_KEY: join(dir, 'key.pem'),
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    }),
  )
  // The group repo, reachable from both machines.
  const repos = join(dir, 'repos')
  const bare = join(repos, 'app.git')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@gonggong', ...args], {
      cwd,
      encoding: 'utf8',
    })
  execFileSync('mkdir', ['-p', repos])
  git(repos, 'init', '-q', '--bare', '-b', 'main', bare)
  const seed = join(dir, 'seed')
  git(dir, 'clone', '-q', bare, seed)
  writeFileSync(join(seed, 'README.md'), '# demo\n')
  writeFileSync(join(seed, 'shared.txt'), 'line1\nline2\nline3\nline4\nline5\n')
  writeFileSync(join(seed, '.gitignore'), 'node_modules/\n')
  for (let i = 0; i < BIG; i++) {
    const d = join(seed, 'big', String(Math.floor(i / 500)))
    if (i % 500 === 0) execFileSync('mkdir', ['-p', d])
    writeFileSync(join(d, `f${i}.txt`), `file ${i}\n`)
  }
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'init')
  git(seed, 'push', '-q', 'origin', 'main')
  // Read-only "dumb" HTTP is enough: bots never push.
  git(bare, 'repack', '-adq')
  git(bare, 'update-server-info')
  procs.push(
    spawn('python3', ['-m', 'http.server', String(GIT_PORT), '--bind', LAN, '--directory', repos], {
      stdio: 'ignore',
    }),
  )
  const repoUrl = `http://${LAN}:${GIT_PORT}/app.git`

  // The remote machine: daemon binary + the scripted agent with its dependencies.
  ssh(`[ -f ~/${RDIR}/pid ] && kill $(cat ~/${RDIR}/pid); rm -rf ~/${RDIR} && mkdir -p ~/${RDIR}/agent`)
  scp(GONGGONG_BIN, `${RDIR}/gg`)
  // pnpm's layout doesn't survive a copy: ship the scripted agent as one bundle.
  const esbuild = execFileSync(
    'bash',
    ['-c', 'ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | tail -1'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  ).trim()
  execFileSync(join(ROOT, esbuild), [
    join(ROOT, 'tools/mock-agent/agent.js'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${join(dir, 'agent.mjs')}`,
  ])
  scp(join(dir, 'agent.mjs'), `${RDIR}/agent/agent.mjs`)
  const rhome = ssh('echo $HOME').trim()
  const renv = `GONGGONG_HOME=${rhome}/${RDIR}/home GONGGONG_LOG=info GG_LANG=zh GONGGONG_ADAPTER_CMD=${sh(`${NODE} ${rhome}/${RDIR}/agent/agent.mjs`)}`
  const remoteStart = () =>
    ssh(`cd ~/${RDIR} && ${renv} nohup ./gg run > run.log 2>&1 < /dev/null & echo $! > ~/${RDIR}/pid`)
  const remoteStop = () => ssh(`[ -f ~/${RDIR}/pid ] && kill $(cat ~/${RDIR}/pid); true`)

  const api = await request.newContext({ baseURL: base, ignoreHTTPSErrors: true })
  const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`
  const local = machine(base, { GONGGONG_ADAPTER_CMD: MOCK })
  const timings: Record<string, number> = {}
  try {
    await expect
      .poll(async () => (await api.get('/api/health').catch(() => null))?.ok(), { timeout: 60_000 })
      .toBe(true)
    await call(api, 'post', '/api/auth/login', { account: 'admin', password: 'admin-init-pass' })
    await call(api, 'post', '/api/auth/password', {
      oldPassword: 'admin-init-pass',
      newPassword: 'admin-pass-2',
    })
    const me = await call<{ id: string }>(api, 'get', '/api/me')
    const code = async () => (await call<{ code: string }>(api, 'post', '/api/bind-codes')).code
    local.login(await code())
    local.start()
    ssh(`cd ~/${RDIR} && ${renv} ./gg login --server ${base} --code ${await code()}`)
    remoteStart()
    const machines = async () =>
      call<{ id: string; online: boolean; name: string }[]>(api, 'get', '/api/machines')
    await expect
      .poll(async () => (await machines()).filter((m) => m.online).length, { timeout: 60_000 })
      .toBe(2)
    const localId = readFileSync(join(local.home, 'config.json'), 'utf8').match(
      /"machineId":\s*"([^"]+)"/,
    )![1]!
    const remoteId = ssh(`cat ~/${RDIR}/home/config.json`).match(/"machineId":\s*"([^"]+)"/)![1]!
    const bot = (name: string, machineId: string) =>
      call<{ id: string }>(api, 'post', '/api/bots', {
        name,
        ownerId: me.id,
        agentKind: 'claude',
        machineId,
        systemPrompt: '',
      })
    const [A, B] = ['甲', '乙']
    const a = await bot(A, localId)
    const b = await bot(B, remoteId)
    const group = await call<{ id: string }>(api, 'post', '/api/groups', {
      name: '跨机强制同步',
      kind: 'group',
      botIds: [a.id, b.id],
      repo: { url: repoUrl, branch: 'main' },
    })
    await bindManaged(api, group.id, [a.id, b.id])

    const localFile = (name: string) => {
      const d = join(local.home, 'workspaces', group.id, a.id)
      return join(d, readdirSync(d)[0] ?? '', name)
    }
    const remoteDir = `$HOME/${RDIR}/home/workspaces/${group.id}/${b.id}/*`
    const readLocal = (name: string) => {
      try {
        return readFileSync(localFile(name), 'utf8')
      } catch {
        return null
      }
    }
    const readRemote = (name: string) => {
      const out = ssh(`f=$(echo ${remoteDir}/${name}); [ -f "$f" ] && cat "$f" || echo __none__`)
      return out === '__none__\n' ? null : out
    }
    const status = () => call<Status>(api, 'get', `/api/groups/${group.id}/sync`)
    const consistentAt = async (v: number, timeout = 90_000) =>
      expect
        .poll(
          async () => {
            const s = await status()
            return `${s.headVersion} ${s.consistent}/${s.total}`
          },
          { timeout },
        )
        .toBe(`${v} 2/2`)
    const say = (body: string) =>
      call(api, 'post', `/api/groups/${group.id}/messages`, { body, clientId: crypto.randomUUID() })
    const runs = async () =>
      (
        await call<{
          runs: { id: string; botId: string; status: string; sync: { outcome: string } | null }[]
        }>(api, 'get', `/api/groups/${group.id}/timeline`)
      ).runs
    const settled = async (n: number) =>
      expect
        .poll(
          async () =>
            (await runs()).filter((r) => !['queued', 'running', 'pending'].includes(r.status)).length,
          {
            timeout: 120_000,
          },
        )
        .toBeGreaterThanOrEqual(n)

    await test.step('switch with the local bot as base; the remote replica aligns', async () => {
      const t0 = Date.now()
      await call(api, 'post', `/api/groups/${group.id}/sync/enable`, { baseBotId: a.id })
      await consistentAt(1, 10 * 60_000)
      timings.switch = Date.now() - t0
    })

    await test.step('a local edit reaches the remote machine', async () => {
      const t0 = Date.now()
      await say(`@${A} mock:sh printf 'from local\\n' > local.txt`)
      await consistentAt(2)
      timings.roundLocalToRemote = Date.now() - t0
      expect(readRemote('local.txt')).toBe('from local\n')
    })

    await test.step('a remote edit reaches this machine, with the exec bit', async () => {
      const t0 = Date.now()
      await say(`@${B} mock:sh printf '#!/bin/sh\\necho hi\\n' > run.sh && chmod +x run.sh`)
      await consistentAt(3)
      timings.roundRemoteToLocal = Date.now() - t0
      expect(readLocal('run.sh')).toBe('#!/bin/sh\necho hi\n')
      expect(execFileSync('stat', ['-f', '%Lp', localFile('run.sh')], { encoding: 'utf8' }).trim()).toMatch(
        /7\d\d/,
      )
    })

    await test.step('concurrent edits of different lines of one file merge automatically', async () => {
      await say(`@${A} mock:sh sleep 2 && sed -i '' 's/line1/LOCAL1/' shared.txt`)
      await say(`@${B} mock:sh sleep 2 && sed -i '' 's/line5/REMOTE5/' shared.txt`)
      await consistentAt(5)
      const want = 'LOCAL1\nline2\nline3\nline4\nREMOTE5\n'
      expect([readLocal('shared.txt'), readRemote('shared.txt')]).toEqual([want, want])
      const versions = await call<{ tags: string[] }[]>(api, 'get', `/api/groups/${group.id}/sync/versions`)
      expect(versions.some((v) => v.tags.includes('auto_merge'))).toBe(true)
    })

    await test.step('an overlapping edit is held and settled with 采用最新', async () => {
      await say(`@${A} mock:sh sleep 2 && sed -i '' 's/line3/A3/' shared.txt`)
      await say(`@${B} mock:sh sleep 2 && sed -i '' 's/line3/B3/' shared.txt`)
      type Conflict = { id: string; files: { path: string }[] }
      await expect
        .poll(
          async () => (await call<Conflict[]>(api, 'get', `/api/groups/${group.id}/sync/conflicts`)).length,
          {
            timeout: 90_000,
          },
        )
        .toBe(1)
      const [c] = await call<Conflict[]>(api, 'get', `/api/groups/${group.id}/sync/conflicts`)
      await call(api, 'post', `/api/groups/${group.id}/sync/conflicts/${c!.id}/resolve`, {
        decisions: c!.files.map((f) => ({ path: f.path, choice: 'theirs' })),
      })
      await consistentAt((await status()).headVersion, 90_000)
      expect(readLocal('shared.txt')).toBe(readRemote('shared.txt'))
    })

    await test.step('a hand edit on the remote pauses it until submitted', async () => {
      const head = (await status()).headVersion
      ssh(`printf 'hand\\n' > $(echo ${remoteDir})/hand.txt`)
      await say(`@${A} mock:sh printf 'z\\n' > z.txt`)
      await expect
        .poll(async () => (await status()).replicas.find((r) => r.botId === b.id)?.state, { timeout: 90_000 })
        .toBe('drift')
      await call(api, 'post', `/api/groups/${group.id}/sync/replicas/${b.id}/drift`, { choice: 'submit' })
      await consistentAt(head + 2)
      expect([readLocal('hand.txt'), readRemote('z.txt')]).toEqual(['hand\n', 'z\n'])
    })

    await test.step('the remote catches up after being offline for two versions', async () => {
      remoteStop()
      await expect
        .poll(async () => (await machines()).find((m) => m.id === remoteId)?.online, { timeout: 90_000 })
        .toBe(false)
      const head = (await status()).headVersion
      await say(`@${A} mock:sh printf '1\\n' > off1.txt`)
      await expect.poll(async () => (await status()).headVersion, { timeout: 90_000 }).toBe(head + 1)
      await say(`@${A} mock:sh printf '2\\n' > off2.txt`)
      await expect.poll(async () => (await status()).headVersion, { timeout: 90_000 }).toBe(head + 2)
      const t0 = Date.now()
      remoteStart()
      await consistentAt(head + 2)
      timings.catchUp = Date.now() - t0
      expect([readRemote('off1.txt'), readRemote('off2.txt')]).toEqual(['1\n', '2\n'])
    })

    await test.step('an untracked secret file is refused, then the next clean turn goes in', async () => {
      const head = (await status()).headVersion
      const before = (await runs()).length
      await say(`@${B} mock:sh printf 'TOKEN=x\\n' > .env`)
      await settled(before + 1)
      const last = (await runs()).find((r) => r.botId === b.id && r.sync?.outcome === 'error')
      expect(last).toBeTruthy()
      expect((await status()).headVersion).toBe(head)
      expect(readLocal('.env')).toBeNull()
      await say(`@${B} mock:sh rm .env && printf 'ok\\n' > clean.txt`)
      await consistentAt(head + 1)
      expect(readLocal('clean.txt')).toBe('ok\n')
    })

    await test.step('switch back to partition mode', async () => {
      await call(api, 'post', `/api/groups/${group.id}/sync/disable`)
      await sleep(3_000)
      expect(ssh(`ls ~/${RDIR}/home/sync/${group.id} 2>/dev/null | wc -l`).trim()).toBe('0')
    })
    console.log(`[two-machines] files=${BIG + 3} timings(ms)=${JSON.stringify(timings)}`)
  } finally {
    local.stop()
    try {
      remoteStop()
    } catch {}
    await api.dispose()
    for (const p of procs) p.kill()
  }
})
