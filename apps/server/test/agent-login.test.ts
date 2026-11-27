import {
  type AgentLoginCmd,
  type AgentLoginStartedDto,
  PROTOCOL_VERSION,
  type RunStart,
  type WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { messages, runs } from '../src/db/schema.js'
import { listRuns, runDtoLoader } from '../src/modules/runs/dto.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'

let t: TestApp
let clock: number
beforeEach(async () => {
  clock = Date.parse('2026-11-27T04:00:00Z')
  t = await createTestApp({ now: () => new Date(clock) })
})
afterEach(() => t.close())

async function connectDaemon(token: string, features: string[] = ['agent_login']) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token,
      daemonVersion: '0.2.0',
      machine: { name: 'win-dev', os: 'windows', arch: 'x86_64' },
      agents: [],
      features,
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return {
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: <T = Record<string, unknown>>() => box.next<T>(),
    ws,
  }
}

function watch(userId: string) {
  const seen: WebEvent[] = []
  const waiters: { pred: (e: WebEvent) => boolean; resolve: (e: WebEvent) => void }[] = []
  t.ctx.bus.attach(userId, (e) => {
    seen.push(e)
    for (const w of [...waiters])
      if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(e)
      }
  })
  return {
    seen,
    until: <E extends WebEvent>(pred: (e: WebEvent) => boolean) =>
      new Promise<E>((resolve) => {
        const hit = seen.find(pred)
        if (hit) return resolve(hit as E)
        waiters.push({ pred, resolve: resolve as (e: WebEvent) => void })
      }),
  }
}

describe('agent login routes & relay', () => {
  it('enforces authentication, strict owner-only access, online status, and agent_login feature', async () => {
    const owner = await t.seed.user({ name: '王磊' })
    const peer = await t.seed.user({ name: '陈晨' })
    const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
    const ownerCookie = await t.seed.cookie(owner.id)
    const peerCookie = await t.seed.cookie(peer.id)
    const adminCookie = await t.seed.cookie(admin.id)
    const { machine, token } = await t.seed.machine(owner.id, { os: 'windows' })

    // Unauthenticated -> 401
    const unauth = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      payload: {},
    })
    expect(unauth.statusCode).toBe(401)

    // Non-owner (peer and even sysadmin) -> 403
    for (const cookie of [peerCookie, adminCookie]) {
      const denied = await t.app.inject({
        method: 'POST',
        url: `/api/machines/${machine.id}/agents/codebuddy/login`,
        headers: { cookie },
        payload: {},
      })
      expect(denied.statusCode).toBe(403)
      const cancelDenied = await t.app.inject({
        method: 'POST',
        url: `/api/machines/${machine.id}/agents/codebuddy/login/cancel`,
        headers: { cookie },
        payload: { opId: 'op-1' },
      })
      expect(cancelDenied.statusCode).toBe(403)
    }

    // Revoked / missing machine -> 404
    const revoked = await t.seed.machine(owner.id, { revokedAt: new Date(clock) })
    const missing = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${revoked.machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    expect(missing.statusCode).toBe(404)

    // Invalid agent kind -> 400
    const badKind = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/not-an-agent/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    expect(badKind.statusCode).toBe(400)

    // Machine offline -> 400 invalid with clear message
    const offline = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    expect(offline.statusCode).toBe(400)
    expect(offline.json()).toMatchObject({
      error: 'invalid',
      message: '电脑当前离线，请先保持共工客户端在线',
    })

    // Online without `agent_login` feature -> 400 invalid with upgrade message
    const oldDaemon = await connectDaemon(token, ['tools'])
    const noFeature = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    expect(noFeature.statusCode).toBe(400)
    expect(noFeature.json()).toMatchObject({
      error: 'invalid',
      message: '当前电脑的共工客户端版本较旧，请升级客户端后重试，或在电脑终端手动登录',
    })
    oldDaemon.ws.close()
  })

  it('starts login, streams methods/auth/progress/result ONLY to owner, and cancels superseded ops', async () => {
    const owner = await t.seed.user({ name: '王磊' })
    const teammate = await t.seed.user({ name: '陈晨' })
    const ownerCookie = await t.seed.cookie(owner.id)
    const { machine, token } = await t.seed.machine(owner.id, { os: 'windows' })
    const otherMachine = await t.seed.machine(teammate.id, { os: 'macos' })
    const d = await connectDaemon(token, ['agent_login'])
    const dOther = await connectDaemon(otherMachine.token, ['agent_login'])

    const ownerBus = watch(owner.id)
    const peerBus = watch(teammate.id)

    // Start without openBrowser -> defaults to false
    const start1 = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    expect(start1.statusCode).toBe(200)
    const body1 = start1.json<AgentLoginStartedDto>()
    expect(body1).toEqual({
      opId: expect.any(String),
      machineId: machine.id,
      kind: 'codebuddy',
    })
    const cmd1 = await d.next<AgentLoginCmd>()
    expect(cmd1).toEqual({
      t: 'agent.login',
      op: 'start',
      opId: body1.opId,
      kind: 'codebuddy',
      openBrowser: false,
    })

    // Starting again for same (machineId, kind) cancels first op first
    const start2 = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: { methodId: 'internal', openBrowser: true },
    })
    expect(start2.statusCode).toBe(200)
    const body2 = start2.json<AgentLoginStartedDto>()
    expect(body2.opId).not.toBe(body1.opId)

    expect(await d.next<AgentLoginCmd>()).toEqual({
      t: 'agent.login',
      op: 'cancel',
      opId: body1.opId,
      kind: 'codebuddy',
    })
    expect(await d.next<AgentLoginCmd>()).toEqual({
      t: 'agent.login',
      op: 'start',
      opId: body2.opId,
      kind: 'codebuddy',
      methodId: 'internal',
      openBrowser: true,
    })

    // Stale opId or spoofed machineId messages are ignored
    d.send({ t: 'agent.login.progress', opId: body1.opId, kind: 'codebuddy', stage: 'stale' })
    dOther.send({
      t: 'agent.login.auth',
      opId: body2.opId,
      kind: 'codebuddy',
      url: 'https://evil.example/oauth',
    })

    // Stream methods -> auth -> progress -> result for active op2
    d.send({
      t: 'agent.login.methods',
      opId: body2.opId,
      kind: 'codebuddy',
      methods: [{ id: 'internal', name: '微信登录', description: '使用微信扫码' }],
    })
    d.send({
      t: 'agent.login.auth',
      opId: body2.opId,
      kind: 'codebuddy',
      url: 'https://copilot.tencent.com/login?token=secret',
      methodId: 'internal',
    })
    d.send({
      t: 'agent.login.progress',
      opId: body2.opId,
      kind: 'codebuddy',
      stage: 'waiting',
      line: '等待扫码确认…',
    })
    d.send({
      t: 'agent.login.result',
      opId: body2.opId,
      kind: 'codebuddy',
      ok: true,
      user: 'wanglei@example.com',
    })
    // Follow-up after result must be ignored because op was cleaned up
    d.send({ t: 'agent.login.progress', opId: body2.opId, kind: 'codebuddy', stage: 'after-done' })

    await ownerBus.until((e) => e.t === 'machine.agentLogin.result')
    await new Promise((r) => setTimeout(r, 30))

    const loginEvents = ownerBus.seen.filter((e) => e.t.startsWith('machine.agentLogin.'))
    expect(loginEvents).toEqual([
      {
        t: 'machine.agentLogin.methods',
        machineId: machine.id,
        opId: body2.opId,
        kind: 'codebuddy',
        methods: [{ id: 'internal', name: '微信登录', description: '使用微信扫码' }],
      },
      {
        t: 'machine.agentLogin.auth',
        machineId: machine.id,
        opId: body2.opId,
        kind: 'codebuddy',
        url: 'https://copilot.tencent.com/login?token=secret',
        methodId: 'internal',
      },
      {
        t: 'machine.agentLogin.progress',
        machineId: machine.id,
        opId: body2.opId,
        kind: 'codebuddy',
        stage: 'waiting',
        line: '等待扫码确认…',
      },
      {
        t: 'machine.agentLogin.result',
        machineId: machine.id,
        opId: body2.opId,
        kind: 'codebuddy',
        ok: true,
        user: 'wanglei@example.com',
      },
    ])
    expect(peerBus.seen.filter((e) => e.t.startsWith('machine.agentLogin.'))).toEqual([])

    d.ws.close()
    dOther.ws.close()
  })

  it('cancels an active login and stops forwarding subsequent messages', async () => {
    const owner = await t.seed.user({ name: '王磊' })
    const ownerCookie = await t.seed.cookie(owner.id)
    const { machine, token } = await t.seed.machine(owner.id, { os: 'windows' })
    const d = await connectDaemon(token, ['agent_login'])
    const ownerBus = watch(owner.id)

    const start = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    const { opId } = start.json<AgentLoginStartedDto>()
    await d.next<AgentLoginCmd>()

    const cancel = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login/cancel`,
      headers: { cookie: ownerCookie },
      payload: { opId },
    })
    expect(cancel.statusCode).toBe(204)
    expect(await d.next<AgentLoginCmd>()).toEqual({
      t: 'agent.login',
      op: 'cancel',
      opId,
      kind: 'codebuddy',
    })

    // Daemon messages arriving after cancel are dropped
    d.send({ t: 'agent.login.auth', opId, kind: 'codebuddy', url: 'https://copilot.tencent.com/late' })
    d.send({ t: 'agent.login.result', opId, kind: 'codebuddy', ok: false, error: 'cancelled' })
    await new Promise((r) => setTimeout(r, 30))
    expect(ownerBus.seen.filter((e) => e.t.startsWith('machine.agentLogin.'))).toEqual([])

    // Cancelling an unknown opId is a safe no-op returning 204
    const noopCancel = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login/cancel`,
      headers: { cookie: ownerCookie },
      payload: { opId: 'nonexistent-op' },
    })
    expect(noopCancel.statusCode).toBe(204)

    d.ws.close()
  })

  it('emits failure machine.agentLogin.result to owner when machine goes offline mid-login', async () => {
    const owner = await t.seed.user({ name: '王磊' })
    const teammate = await t.seed.user({ name: '陈晨' })
    const ownerCookie = await t.seed.cookie(owner.id)
    const { machine, token } = await t.seed.machine(owner.id, { os: 'windows' })
    const d = await connectDaemon(token, ['agent_login'])
    const ownerBus = watch(owner.id)
    const peerBus = watch(teammate.id)

    const start = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    const { opId } = start.json<AgentLoginStartedDto>()
    await d.next<AgentLoginCmd>()

    d.ws.close()
    const result = await ownerBus.until((e) => e.t === 'machine.agentLogin.result')
    expect(result).toEqual({
      t: 'machine.agentLogin.result',
      machineId: machine.id,
      opId,
      kind: 'codebuddy',
      ok: false,
      error: '电脑已离线，登录已中断',
    })
    expect(peerBus.seen.filter((e) => e.t.startsWith('machine.agentLogin.'))).toEqual([])
  })

  it('drops messages after the active login op expires', async () => {
    const owner = await t.seed.user({ name: '王磊' })
    const ownerCookie = await t.seed.cookie(owner.id)
    const { machine, token } = await t.seed.machine(owner.id, { os: 'windows' })
    const d = await connectDaemon(token, ['agent_login'])
    const ownerBus = watch(owner.id)

    const start = await t.app.inject({
      method: 'POST',
      url: `/api/machines/${machine.id}/agents/codebuddy/login`,
      headers: { cookie: ownerCookie },
      payload: {},
    })
    const { opId } = start.json<AgentLoginStartedDto>()
    await d.next<AgentLoginCmd>()

    clock += 10 * 60_000 + 1
    d.send({ t: 'agent.login.auth', opId, kind: 'codebuddy', url: 'https://copilot.tencent.com/expired' })
    await new Promise((r) => setTimeout(r, 30))
    expect(ownerBus.seen.filter((e) => e.t.startsWith('machine.agentLogin.'))).toEqual([])

    d.ws.close()
  })
})

describe('run auth error handling', () => {
  async function setupCodebuddyRun() {
    const owner = await t.seed.user({ name: '王磊' })
    const { machine, token } = await t.seed.machine(owner.id, { os: 'windows' })
    const bot = await t.seed.bot({
      ownerId: owner.id,
      name: '小王的 CodeBuddy',
      agentKind: 'codebuddy',
      machineId: machine.id,
      binding: 'bound',
    })
    const group = await t.seed.group({ createdBy: owner.id, botIds: [bot.id] })
    const d = await connectDaemon(token, ['codebuddy', 'agent_login'])
    const ownerBus = watch(owner.id)

    const trigger = async (body: string) => {
      const [m] = await t.db
        .insert(messages)
        .values({
          groupId: group.id,
          kind: 'user',
          authorUserId: owner.id,
          body,
          meta: { mentions: [bot.id] },
        })
        .returning()
      await triggerRuns(t.ctx, m!)
      return d.next<RunStart>()
    }
    return { owner, machine, bot, group, d, ownerBus, trigger }
  }

  it('marks RunDone with errorKind="auth" using friendly stepI18n and exposes RunDto.errorKind="auth"', async () => {
    const w = await setupCodebuddyRun()
    const { runId } = await w.trigger('@小王的 CodeBuddy 帮我看看')

    w.d.send({
      t: 'run.done',
      runId,
      outcome: 'failed',
      errorKind: 'auth',
      reply: '',
      filesChanged: 0,
      usage: null,
      sessionId: null,
      newSessionReason: null,
      error: 'CodeBuddy 尚未登录或登录已过期',
      git: null,
      patch: null,
      appendsApplied: 0,
    })

    const updated = await w.ownerBus.until<Extract<WebEvent, { t: 'run.updated' }>>(
      (e) => e.t === 'run.updated' && e.run.id === runId && e.run.status === 'interrupted',
    )
    expect(updated.run).toMatchObject({
      id: runId,
      status: 'interrupted',
      errorKind: 'auth',
      step: '运行出错：CodeBuddy（WorkBuddy） 尚未登录或登录已过期',
      stepI18n: {
        key: '运行出错：{agent} 尚未登录或登录已过期',
        params: { agent: 'CodeBuddy（WorkBuddy）' },
      },
    })

    const listed = await listRuns(t.ctx, w.group.id)
    expect(listed.find((r) => r.id === runId)).toMatchObject({
      errorKind: 'auth',
      stepI18n: {
        key: '运行出错：{agent} 尚未登录或登录已过期',
        params: { agent: 'CodeBuddy（WorkBuddy）' },
      },
    })
    w.d.ws.close()
  })

  it('detects legacy daemon Authentication required errors without errorKind and exposes RunDto.errorKind="auth"', async () => {
    const w = await setupCodebuddyRun()
    const { runId } = await w.trigger('@小王的 CodeBuddy 跑一下')

    w.d.send({
      t: 'run.done',
      runId,
      outcome: 'failed',
      reply: '',
      filesChanged: 0,
      usage: null,
      sessionId: null,
      newSessionReason: null,
      error: '无法建立 agent 会话：Authentication required: {"category":"auth"}',
      git: null,
      patch: null,
      appendsApplied: 0,
    })

    const updated = await w.ownerBus.until<Extract<WebEvent, { t: 'run.updated' }>>(
      (e) => e.t === 'run.updated' && e.run.id === runId && e.run.status === 'interrupted',
    )
    expect(updated.run).toMatchObject({
      id: runId,
      status: 'interrupted',
      errorKind: 'auth',
      step: '运行出错：CodeBuddy（WorkBuddy） 尚未登录或登录已过期',
      stepI18n: {
        key: '运行出错：{agent} 尚未登录或登录已过期',
        params: { agent: 'CodeBuddy（WorkBuddy）' },
      },
    })

    // Also verify a legacy persisted row whose raw step was already written before upgrade
    const [row] = await t.db.select().from(runs).where(eq(runs.id, runId))
    const legacyRow = {
      ...row!,
      step: '运行出错：无法建立 agent 会话：Authentication required: {"category":"auth"}',
      stepI18n: null,
    }
    const toDto = await runDtoLoader(t.ctx, [legacyRow])
    expect(toDto(legacyRow).errorKind).toBe('auth')

    // Non-auth failure does not set errorKind
    const { runId: otherId } = await w.trigger('@小王的 CodeBuddy 再次尝试')
    w.d.send({
      t: 'run.done',
      runId: otherId,
      outcome: 'failed',
      reply: '',
      filesChanged: 0,
      usage: null,
      sessionId: null,
      newSessionReason: null,
      error: 'request timed out',
      git: null,
      patch: null,
      appendsApplied: 0,
    })
    const normalFail = await w.ownerBus.until<Extract<WebEvent, { t: 'run.updated' }>>(
      (e) => e.t === 'run.updated' && e.run.id === otherId && e.run.status === 'interrupted',
    )
    expect(normalFail.run.errorKind).toBeUndefined()
    expect(normalFail.run.step).toBe('运行出错：request timed out')

    w.d.ws.close()
  })
})
