import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BindCodeDto, DaemonLoginRes, InstallBuildDto, WebEvent } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bots, groupBots, groups, systemParams, teamMembers } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'

// Agent 自助接入: a local agent reads install.md, runs install.sh, and `gg login --create-bot` leaves a bot and a DM.

let t: TestApp
let clock: number
let owner: { id: string; name: string }
let cookie: string
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  clock = Date.parse('2026-11-12T10:00:00Z')
  t = await createTestApp({ now: () => new Date(clock) })
  owner = await t.seed.user({ account: 'wanglei', name: '王磊' })
  cookie = await t.seed.cookie(owner.id)
})
afterEach(() => t.close())

const ORIGIN = 'https://gg.example.com'
const newCode = async () =>
  (
    await t.app.inject({
      method: 'POST',
      url: '/api/bind-codes',
      headers: { cookie, origin: ORIGIN, host: 'gg.example.com' },
    })
  ).json() as BindCodeDto
const login = (code: string, createBot?: { agent: string }, hardwareId = 'hw-1') =>
  t.app.inject({
    method: 'POST',
    url: '/api/daemon/login',
    payload: { code, machine: { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64', hardwareId }, createBot },
  })
const events = (userId: string) => {
  const got: WebEvent[] = []
  t.ctx.bus.attach(userId, (e) => got.push(e))
  return got
}

describe('bind code for an agent', () => {
  it('lasts 30 minutes and comes with the sentence to paste to a local agent', async () => {
    const c = await newCode()
    expect(Date.parse(c.expiresAt) - clock).toBe(30 * 60_000)
    expect(c.agentPrompt).toBe(
      `帮我接入共工空间：读取 ${ORIGIN}/api/install.md 并按步骤执行，接入码 ${c.code}。`,
    )
    clock += 29 * 60_000
    expect((await login(c.code)).statusCode).toBe(200)
  })
})

describe('gg login --create-bot', () => {
  it('makes a bot of that agent on the machine and a DM with it, once per machine and agent', async () => {
    const got = events(owner.id)
    const res = await login((await newCode()).code, { agent: 'claude' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as DaemonLoginRes
    expect(body.bot).toMatchObject({ name: '王磊的 Claude Code' })
    const [bot] = await t.db.select().from(bots).where(eq(bots.id, body.bot!.id))
    expect(bot).toMatchObject({
      ownerId: owner.id,
      machineId: body.machineId,
      agentKind: 'claude',
      binding: 'bound',
    })
    const [dm] = await t.db.select().from(groups).where(eq(groups.id, body.bot!.groupId))
    expect(dm).toMatchObject({ kind: 'dm', createdBy: owner.id })
    expect(
      await t.db
        .select()
        .from(groupBots)
        .where(and(eq(groupBots.groupId, dm!.id), eq(groupBots.botId, bot!.id))),
    ).toHaveLength(1)
    expect(got).toContainEqual({
      t: 'machine.onboarded',
      machineId: body.machineId,
      botId: bot!.id,
      groupId: dm!.id,
    })

    // Pasting again (a retry, a new code) reuses the bot and its DM; another agent gets its own.
    const again = (await login((await newCode()).code, { agent: 'claude' })).json() as DaemonLoginRes
    expect(again.bot).toEqual(body.bot)
    const codex = (await login((await newCode()).code, { agent: 'codex' })).json() as DaemonLoginRes
    expect(codex.bot?.name).toBe('王磊的 Codex')
    expect(codex.bot?.id).not.toBe(bot!.id)
    expect(await t.db.select().from(bots)).toHaveLength(2)
  })

  it('still logs the machine in when its bot cannot be made: the token must reach gg', async () => {
    await t.db.delete(teamMembers).where(eq(teamMembers.userId, owner.id))
    const res = await login((await newCode()).code, { agent: 'claude' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as DaemonLoginRes
    expect(body.token).toBeTruthy()
    expect(body.bot).toBeUndefined()
    expect(await t.db.select().from(bots)).toEqual([])
  })

  it('leaves a plain login as it was', async () => {
    const body = (await login((await newCode()).code)).json() as DaemonLoginRes
    expect(body.bot).toBeUndefined()
    expect(await t.db.select().from(bots)).toEqual([])
  })
})

const fakeGg = (log: string) =>
  `#!/bin/sh\necho "$@" >> ${log}\n[ "$1" = status ] && echo "service: running"\nexit 0\n`

describe('install.md and install.sh', () => {
  const publish = async (body: string) => {
    const file = 'gonggong-9.9.9-macos-aarch64'
    mkdirSync(join(process.env.GONGGONG_DATA_DIR!, 'downloads'), { recursive: true })
    writeFileSync(join(process.env.GONGGONG_DATA_DIR!, 'downloads', file), body)
    const sha256 = createHash('sha256').update(body).digest('hex')
    await t.db.insert(systemParams).values({
      key: 'daemonRelease',
      value: { version: '9.9.9', builds: { 'macos-aarch64': { url: `/downloads/${file}`, sha256 } } },
    })
    return sha256
  }

  it('are public text naming this server and no secret; the build list says where gg is', async () => {
    const md = await t.app.inject({ url: '/api/install.md', headers: { host: 'gg.example.com' } })
    expect(md.statusCode).toBe(200)
    expect(md.headers['content-type']).toMatch(/^text\/markdown/)
    expect(md.body).toContain('/api/install.sh')
    expect(md.body).toContain('gg status')
    expect(md.body).not.toMatch(/^\s*sudo /m)
    const sh = await t.app.inject({ url: '/api/install.sh', headers: { host: 'gg.example.com' } })
    expect(sh.headers['content-type']).toMatch(/^text\/x-shellscript|^text\/plain/)
    expect(sh.body.startsWith('#!/bin/sh')).toBe(true)

    expect((await t.app.inject({ url: '/api/install/gg?platform=macos-aarch64' })).statusCode).toBe(404)
    const sha256 = await publish('binary')
    const build = (
      await t.app.inject({
        url: '/api/install/gg?platform=macos-aarch64',
        headers: { host: 'gg.example.com' },
      })
    ).json() as InstallBuildDto
    expect(build).toEqual({
      version: '9.9.9',
      url: 'http://gg.example.com/downloads/gonggong-9.9.9-macos-aarch64',
      sha256,
    })
    // Behind the TLS-terminating proxy the request is plain http: the scheme comes from the proxy.
    const proxied = await t.app.inject({
      url: '/api/install.sh',
      headers: { host: 'gg.example.com', 'x-forwarded-proto': 'https' },
    })
    expect(proxied.body).toContain('https://gg.example.com')
    expect(proxied.body).not.toContain('http://gg.example.com')
  })

  it('install.sh downloads gg, checks it, logs in with the code and the agent, and starts the service', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gg-install-'))
    const log = join(dir, 'calls.log')
    await publish(fakeGg(log))
    const server = t.url('')
    const script = join(dir, 'install.sh')
    writeFileSync(script, (await t.app.inject({ url: '/api/install.sh' })).body)
    chmodSync(script, 0o755)
    // Async: the test server answers the script from this same process.
    const run = (home: string) =>
      promisify(execFile)(
        'sh',
        [
          script,
          '--server',
          server,
          '--code',
          'ABCD-EFGH',
          '--agent',
          'claude',
          '--platform',
          'macos-aarch64',
        ],
        { env: { PATH: process.env.PATH, HOME: home } },
      )
    const { stdout: out } = await run(dir)
    const gg = join(dir, '.local/bin/gg')
    expect(readFileSync(gg, 'utf8')).toBe(fakeGg(log))
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      `login --server ${server} --code ABCD-EFGH --create-bot claude`,
      'service install',
      'status',
    ])
    expect(out).toContain('service: running')
    expect(out).toContain('Downloading')

    // Run again (an agent whose command was cut off while gg waited): the same gg is not downloaded again.
    const { stdout: again } = await run(dir)
    expect(again).not.toContain('Downloading')
    expect(again).toContain('already installed')
    expect(readFileSync(log, 'utf8').trim().split('\n').at(-3)).toBe(
      `login --server ${server} --code ABCD-EFGH --create-bot claude`,
    )

    // A build that does not match its sha256 is never run.
    await t.db.delete(systemParams)
    const good = await publish(fakeGg(log))
    writeFileSync(
      join(process.env.GONGGONG_DATA_DIR!, 'downloads', 'gonggong-9.9.9-macos-aarch64'),
      'tampered',
    )
    expect(good).toMatch(/^[0-9a-f]{64}$/)
    await expect(run(mkdtempSync(join(tmpdir(), 'gg-install-')))).rejects.toThrow(/sha256/)

    // A machine already bound elsewhere (the desktop app, another server) is left alone.
    const bound = mkdtempSync(join(tmpdir(), 'gg-install-'))
    mkdirSync(join(bound, '.gonggong'))
    writeFileSync(
      join(bound, '.gonggong/config.json'),
      '{\n  "server": "https://other.example.com",\n  "token": "x"\n}',
    )
    await expect(run(bound)).rejects.toThrow(/already bound to https:\/\/other\.example\.com/)
    expect(readFileSync(join(bound, '.gonggong/config.json'), 'utf8')).toContain('other.example.com')
  })
})
