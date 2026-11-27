import { describe, expect, it } from 'vitest'
import {
  AgentLoginCancelReq,
  AgentLoginStartedDto,
  AgentLoginStartReq,
  AgentState,
  createTranslator,
  DaemonFeature,
  DaemonToServer,
  protocolEn,
  RunDone,
  RunDto,
  ServerToDaemon,
  WebEvent,
} from '../src/index.js'

describe('agent state login fields', () => {
  const base = {
    kind: 'codebuddy' as const,
    available: true,
    version: '2.186.0',
    path: '/usr/local/bin/codebuddy',
  }

  it('keeps login fields optional for older daemons', () => {
    const parsed = AgentState.parse(base)
    expect(parsed.loginState).toBeUndefined()
    expect(parsed.loginLabel).toBeUndefined()
    expect(parsed.loginFlow).toBeUndefined()
  })

  it('parses loginState, loginLabel, and loginFlow', () => {
    const loggedOut = AgentState.parse({
      ...base,
      loginState: 'logged_out',
      loginLabel: null,
      loginFlow: 'acp',
    })
    expect([loggedOut.loginState, loggedOut.loginLabel, loggedOut.loginFlow]).toEqual([
      'logged_out',
      null,
      'acp',
    ])

    const loggedIn = AgentState.parse({
      ...base,
      loginState: 'logged_in',
      loginLabel: '账号登录',
      loginFlow: 'terminal',
    })
    expect([loggedIn.loginState, loggedIn.loginLabel, loggedIn.loginFlow]).toEqual([
      'logged_in',
      '账号登录',
      'terminal',
    ])

    expect(AgentState.safeParse({ ...base, loginState: 'expired' }).success).toBe(false)
    expect(AgentState.safeParse({ ...base, loginFlow: 'browser' }).success).toBe(false)
  })
})

describe('agent login wire protocol', () => {
  it('registers agent_login as a DaemonFeature', () => {
    expect(DaemonFeature.options).toContain('agent_login')
  })

  it('parses s2d agent.login start and cancel commands', () => {
    const start = ServerToDaemon.parse({
      t: 'agent.login',
      op: 'start',
      opId: 'op-1',
      kind: 'codebuddy',
      methodId: 'internal',
      openBrowser: false,
    })
    expect(start).toMatchObject({ t: 'agent.login', op: 'start', methodId: 'internal', openBrowser: false })

    const cancel = ServerToDaemon.parse({
      t: 'agent.login',
      op: 'cancel',
      opId: 'op-1',
      kind: 'codebuddy',
    })
    expect(cancel).toMatchObject({ t: 'agent.login', op: 'cancel', opId: 'op-1' })

    expect(
      ServerToDaemon.safeParse({ t: 'agent.login', op: 'invalid', opId: 'op-1', kind: 'codebuddy' }).success,
    ).toBe(false)
  })

  it('parses d2s agent.login.* events', () => {
    const methods = DaemonToServer.parse({
      t: 'agent.login.methods',
      opId: 'op-1',
      kind: 'codebuddy',
      methods: [
        { id: 'internal', name: 'Login with WeChat', description: '微信扫码' },
        { id: 'external', name: 'Login with Google/Github', description: null },
      ],
    })
    expect(methods.t).toBe('agent.login.methods')

    const auth = DaemonToServer.parse({
      t: 'agent.login.auth',
      opId: 'op-1',
      kind: 'codebuddy',
      url: 'https://copilot.tencent.com/oauth/authorize?state=xyz',
      methodId: 'internal',
    })
    expect(auth).toMatchObject({ t: 'agent.login.auth', methodId: 'internal' })

    const progress = DaemonToServer.parse({
      t: 'agent.login.progress',
      opId: 'op-1',
      kind: 'codebuddy',
      stage: 'initializing',
      line: 'Starting codebuddy --acp',
    })
    expect(progress).toMatchObject({ t: 'agent.login.progress', stage: 'initializing' })

    const ok = DaemonToServer.parse({
      t: 'agent.login.result',
      opId: 'op-1',
      kind: 'codebuddy',
      ok: true,
      user: 'alice',
    })
    expect(ok).toMatchObject({ t: 'agent.login.result', ok: true, user: 'alice' })

    const fail = DaemonToServer.parse({
      t: 'agent.login.result',
      opId: 'op-1',
      kind: 'codebuddy',
      ok: false,
      error: 'Authentication cancelled',
    })
    expect(fail).toMatchObject({ t: 'agent.login.result', ok: false, error: 'Authentication cancelled' })
  })
})

describe('web HTTP and realtime agent login schemas', () => {
  it('validates start/cancel requests and started response', () => {
    expect(AgentLoginStartReq.parse({})).toEqual({})
    expect(AgentLoginStartReq.parse({ methodId: 'internal', openBrowser: false })).toEqual({
      methodId: 'internal',
      openBrowser: false,
    })
    expect(AgentLoginStartReq.safeParse({ methodId: '' }).success).toBe(false)

    expect(AgentLoginStartedDto.parse({ opId: 'op-1', machineId: 'm-1', kind: 'codebuddy' })).toEqual({
      opId: 'op-1',
      machineId: 'm-1',
      kind: 'codebuddy',
    })

    expect(AgentLoginCancelReq.parse({ opId: 'op-1' })).toEqual({ opId: 'op-1' })
    expect(AgentLoginCancelReq.safeParse({ opId: '' }).success).toBe(false)
  })

  it('parses machine.agentLogin.* WebEvents', () => {
    const events = [
      {
        t: 'machine.agentLogin.methods',
        machineId: 'm-1',
        opId: 'op-1',
        kind: 'codebuddy',
        methods: [{ id: 'internal', name: 'Login with WeChat' }],
      },
      {
        t: 'machine.agentLogin.auth',
        machineId: 'm-1',
        opId: 'op-1',
        kind: 'codebuddy',
        url: 'https://copilot.tencent.com/oauth',
        methodId: 'internal',
      },
      {
        t: 'machine.agentLogin.progress',
        machineId: 'm-1',
        opId: 'op-1',
        kind: 'codebuddy',
        stage: 'waiting',
      },
      {
        t: 'machine.agentLogin.result',
        machineId: 'm-1',
        opId: 'op-1',
        kind: 'codebuddy',
        ok: true,
        user: 'alice',
      },
    ] as const

    for (const ev of events) {
      expect(WebEvent.parse(ev)).toEqual(ev)
    }
  })
})

describe('run errorKind and auth i18n', () => {
  const baseDone = {
    t: 'run.done' as const,
    runId: 'r1',
    outcome: 'failed' as const,
    reply: '',
    filesChanged: 0,
    usage: null,
    sessionId: null,
    newSessionReason: null,
    error: 'Authentication required',
    git: null,
    patch: null,
    appendsApplied: 0,
  }

  it('accepts optional errorKind on RunDone and RunDto', () => {
    expect(RunDone.parse(baseDone).errorKind).toBeUndefined()
    expect(RunDone.parse({ ...baseDone, errorKind: 'auth' }).errorKind).toBe('auth')
    expect(RunDone.safeParse({ ...baseDone, errorKind: 'other' }).success).toBe(false)

    const baseRun = {
      id: 'r1',
      groupId: 'g1',
      botId: 'b1',
      triggerMessageId: 'm1',
      triggerUserId: 'u1',
      hop: 1,
      status: 'interrupted' as const,
      step: '运行出错：CodeBuddy 尚未登录或登录已过期',
      filesChanged: 0,
      usage: null,
      newSessionReason: null,
      queuedAt: '2026-11-27T00:00:00.000Z',
      startedAt: '2026-11-27T00:00:01.000Z',
      endedAt: '2026-11-27T00:00:02.000Z',
      lastActivityAt: '2026-11-27T00:00:02.000Z',
      parentRunId: null,
      hopMax: 5,
      offlineWaitMin: 30,
      originUserId: 'u1',
      approvals: [],
      questions: [],
      interrupt: null,
      stoppedBy: null,
      delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
      model: null,
      effort: null,
    }
    expect(RunDto.parse(baseRun).errorKind).toBeUndefined()
    expect(RunDto.parse({ ...baseRun, errorKind: 'auth' }).errorKind).toBe('auth')
  })

  it('translates auth run error in protocolEn', () => {
    const en = createTranslator('en', protocolEn)
    expect(en('运行出错：{agent} 尚未登录或登录已过期', { agent: 'CodeBuddy' })).toBe(
      'Run error: CodeBuddy is not signed in or its session has expired',
    )
  })
})
