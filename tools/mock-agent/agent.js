#!/usr/bin/env node
// Scriptable ACP agent for daemon tests. The prompt text picks the behaviour:
//   "mock:echo"  reply with a JSON summary of what the agent received (pid, cwd, mode, system prompt, settings meta,
//                provider env, GG_SECRET_* env, MCP servers, prompt, blocks)
//   "mock:slow"  stream text until cancelled
//   "mock:hang"  stream one chunk, then hang, ignoring session/cancel
//   "mock:crash" stream one chunk, then exit with code 3
//   "mock:commands" report available commands (compact, new), then reply "ok"
//   "mock:sh <command>" run the rest of the prompt (from its last "mock:sh") with sh in the session cwd (like Codex
//                editing via shell)
//   "mock:delay <ms>" wait that long first (the last one in the prompt), then behave as the rest of the prompt says
//   "mock:say <text>" reply with the rest of the prompt (from its last "mock:say") verbatim
//   "mock:exec <command>" ask permission for an execute tool call running <command>, reply "ran" or "denied"
//   "mock:exec-twice <command>" the same, asking twice (one turn, two tool calls) unless the first is denied
//   "mock:read <path>" ask permission for a read tool call at <path>, reply "read" or "denied"
//   "mock:search <path>" the same for a search tool call
//   "mock:ask <json>" call the injected gonggong MCP ask tool with <json> as arguments (after a permission request)
//                     and reply with the tool's text result
//   "mock:tool <name> <json>" the same for any gonggong tool
//   "mock:later[-exec|-open]" start a background task and end the turn; once it finishes, go on by itself between
//                prompts (-exec: asking permission; -open: never reporting the cycle's end)
//   "Permission review…" (the daemon's AI pre-review, review::HEADING) answer by a word in the prompt: mock-review-allow
//                allows at low risk, mock-review-garbage gives no verdict, mock-review-echo allows with what the review
//                session was set up with (model, effort, system prompt, tools, setting sources, cwd) as the rationale,
//                anything else is denied as high risk
//   otherwise    text + thought + edit tool call (with permission request) + usage, then end_turn
// Ids it hands out ("mock-*") resume in any process (like agents that persist sessions); others fail to resume.
// Started with GEMINI_CLI_HOME (as the daemon starts Gemini CLI), it acts like Gemini CLI: models through `models` and
// session/set_model instead of config options, session/load instead of resume, no raw input on tool calls, MCP calls
// titled by the tool alone with the server in `_meta`, and the gonggong server read from the home's settings.json.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const sessions = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const GEMINI = process.env.GEMINI_CLI_HOME
const geminiFile = (name) => {
  try {
    return readFileSync(`${GEMINI}/.gemini/${name}`, 'utf8')
  } catch {
    return null
  }
}
const GEMINI_MODELS = ['gemini-2.5-pro', 'gemini-3.8-flash'].map((modelId) => ({ modelId, name: modelId }))
const MODES = (
  GEMINI ? ['default', 'autoEdit', 'yolo', 'plan'] : ['default', 'acceptEdits', 'bypassPermissions']
).map((id) => ({ id, name: id }))
const MODELS = [
  { value: 'default', name: 'Default' },
  { value: 'haiku', name: 'Haiku', description: 'Fastest' },
  { value: 'opus', name: 'Opus' },
]
// Like both real adapters, thought levels depend on the model; one model has none.
const EFFORTS = { default: ['low', 'medium', 'high'], haiku: [], opus: ['low', 'medium', 'high', 'max'] }
const efforts = (model) =>
  EFFORTS[model].map((value) => ({ value, name: value[0].toUpperCase() + value.slice(1) }))

const configOptions = (s) => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: s.model, options: MODELS },
  ...(EFFORTS[s.model].length
    ? [
        {
          id: 'effort',
          name: 'Effort',
          category: 'thought_level',
          type: 'select',
          currentValue: s.effort,
          options: efforts(s.model),
        },
      ]
    : []),
]

async function mcp(url, method, params, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
    signal,
  })
  const body = await res.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}

function open(sessionId, params) {
  sessions.set(sessionId, {
    cwd: params.cwd,
    additionalDirectories: params.additionalDirectories ?? [],
    systemPrompt: params._meta?.systemPrompt?.append ?? null,
    settings: params._meta?.claudeCode?.options?.settings ?? null,
    plugins: params._meta?.claudeCode?.options?.plugins ?? null,
    meta: params._meta ?? null,
    mcpServers: params.mcpServers,
    mode: 'default',
    model: GEMINI ? (process.env.GEMINI_MODEL ?? 'gemini-2.5-pro') : 'default',
    effort: 'medium',
    configSets: [],
    abort: null,
  })
  const modes = { currentModeId: 'default', availableModes: MODES }
  if (GEMINI)
    return {
      sessionId,
      modes,
      models: { availableModels: GEMINI_MODELS, currentModelId: sessions.get(sessionId).model },
    }
  return { sessionId, modes, configOptions: configOptions(sessions.get(sessionId)) }
}

let clientCaps
/** Background tasks still running, by id: how to report on their session. */
const tasks = new Map()

async function prompt({ sessionId, prompt: blocks }, client) {
  const s = sessions.get(sessionId)
  if (!s) throw new Error(`unknown session ${sessionId}`)
  const text = blocks.map((b) => b.text ?? '').join('')
  const abort = new AbortController()
  s.abort = abort
  const update = (u) => client.notify(acp.methods.client.session.update, { sessionId, update: u })
  const say = (t) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } })

  if (text.startsWith('Permission review for a coding agent')) {
    if (text.includes('mock-review-echo')) {
      const o = s.meta?.claudeCode?.options ?? {}
      const setup = {
        model: s.model,
        effort: s.effort,
        system: s.meta?.systemPrompt ?? null,
        tools: o.tools ?? null,
      }
      Object.assign(setup, { sources: o.settingSources ?? null, cwd: s.cwd.split(/[\\/]/).at(-1) })
      const verdict = {
        risk: 'low',
        user_authorization: 'high',
        outcome: 'allow',
        rationale: JSON.stringify(setup),
      }
      await say(JSON.stringify(verdict))
      return { stopReason: 'end_turn' }
    }
    const verdict = text.includes('mock-review-allow')
      ? { risk: 'low', user_authorization: 'high', outcome: 'allow', rationale: '用户要求的只读命令' }
      : { risk: 'high', user_authorization: 'none', outcome: 'deny', rationale: '用户没有要求改动文件' }
    await say(text.includes('mock-review-garbage') ? '说不好' : `结论：${JSON.stringify(verdict)}`)
    return { stopReason: 'end_turn' }
  }
  const delays = [...text.matchAll(/mock:delay (\d+)/g)]
  if (delays.length) await sleep(Number(delays.at(-1)[1]))
  if (text.includes('mock:echo')) {
    await say(
      JSON.stringify({
        pid: process.pid,
        cwd: s.cwd,
        additionalDirectories: s.additionalDirectories,
        mode: s.mode,
        model: s.model,
        effort: s.effort,
        configSets: s.configSets,
        systemPrompt: s.systemPrompt,
        settings: s.settings,
        plugins: s.plugins,
        claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null,
        claudeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? null,
        claudeAmbientCleared: [
          'ANTHROPIC_API_KEY',
          'ANTHROPIC_AUTH_TOKEN',
          'ANTHROPIC_BASE_URL',
          'CLAUDE_CODE_OAUTH_TOKEN',
        ].every((key) => !process.env[key]),
        env: {
          MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? null,
          GG_PROVIDER_KEY: process.env.GG_PROVIDER_KEY ?? null,
          CODEX_CONFIG: process.env.CODEX_CONFIG ? JSON.parse(process.env.CODEX_CONFIG) : null,
        },
        gitEnv: Object.fromEntries(
          ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].map((k) => [
            k,
            process.env[k] ?? null,
          ]),
        ),
        settingsEnv: {
          HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
          NO_PROXY: process.env.NO_PROXY ?? null,
          GG_EXTRA: process.env.GG_EXTRA ?? null,
        },
        secretEnv: Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k.startsWith('GG_SECRET_')),
        ),
        gemini: GEMINI
          ? {
              home: GEMINI,
              trust: process.env.GEMINI_CLI_TRUST_WORKSPACE ?? null,
              apiKey: process.env.GEMINI_API_KEY ?? null,
              baseUrl: process.env.GOOGLE_GEMINI_BASE_URL ?? null,
              model: process.env.GEMINI_MODEL ?? null,
              memory: geminiFile('GEMINI.md'),
              settings: JSON.parse(geminiFile('settings.json') ?? 'null'),
            }
          : null,
        mcpServers: s.mcpServers,
        prompt: text,
        blocks: blocks.map((b) =>
          b.type === 'image'
            ? { type: b.type, mimeType: b.mimeType, bytes: Buffer.from(b.data, 'base64').length }
            : { type: b.type },
        ),
      }),
    )
    return { stopReason: 'end_turn' }
  }
  if (text.includes('mock:auto-review')) {
    const review = {
      sessionUpdate: 'tool_call',
      toolCallId: 'guardian_assessment:r1',
      kind: 'think',
      title: 'Guardian Review',
      status: 'in_progress',
    }
    await update(review)
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId: review.toolCallId,
      status: 'failed',
      content: [
        { type: 'content', content: { type: 'text', text: 'Status: Denied\nRationale: 403 Forbidden' } },
      ],
    })
    await say('blocked')
    return { stopReason: 'end_turn' }
  }
  if (text.includes('mock:commands')) {
    await update({
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'compact', description: 'Compact the conversation' },
        { name: 'new', description: 'Start a new conversation' },
      ],
    })
    await say('ok')
    return { stopReason: 'end_turn' }
  }
  // The trigger comes last: earlier group messages in the context may hold other bots' commands.
  const verbatim = text.lastIndexOf('mock:say ')
  if (verbatim >= 0) {
    await say(text.slice(verbatim + 9))
    return { stopReason: 'end_turn' }
  }
  const sh = text.lastIndexOf('mock:sh ')
  if (sh >= 0) {
    await say(execSync(text.slice(sh + 8), { cwd: s.cwd, encoding: 'utf8' }))
    return { stopReason: 'end_turn' }
  }
  const twice = text.indexOf('mock:exec-twice ')
  const exec = twice >= 0 ? twice : text.indexOf('mock:exec ')
  if (exec >= 0) {
    const command = text.slice(exec + (twice >= 0 ? 16 : 10))
    let ran = true
    for (let i = 1; ran && i <= (twice >= 0 ? 2 : 1); i++) {
      const toolCall = {
        toolCallId: `exec-${i}`,
        title: command,
        kind: 'execute',
        status: 'pending',
        ...(GEMINI ? {} : { rawInput: { command } }),
      }
      await update({ sessionUpdate: 'tool_call', ...toolCall })
      const res = await client.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall,
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'always', name: 'Always', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      })
      ran = res.outcome.outcome === 'selected' && res.outcome.optionId !== 'reject'
    }
    await say(ran ? 'ran' : 'denied')
    return { stopReason: 'end_turn' }
  }
  const read = text.indexOf('mock:read ')
  const search = text.indexOf('mock:search ')
  if (read >= 0 || search >= 0) {
    const path = text.slice(read >= 0 ? read + 10 : search + 12).trim()
    const kind = read >= 0 ? 'read' : 'search'
    const toolCall = {
      toolCallId: 'read-1',
      title: `${kind === 'read' ? 'Read' : 'Search'} ${path}`,
      kind,
      status: 'pending',
      rawInput: { file_path: path },
      locations: [{ path }],
    }
    await update({ sessionUpdate: 'tool_call', ...toolCall })
    const res = await client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall,
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    })
    const allowed = res.outcome.outcome === 'selected' && res.outcome.optionId !== 'reject'
    await say(allowed ? 'read' : 'denied')
    return { stopReason: 'end_turn' }
  }
  const ask = text.indexOf('mock:ask ')
  const anyTool = text.indexOf('mock:tool ')
  if (ask >= 0 || anyTool >= 0) {
    const [name, raw] =
      ask >= 0
        ? ['ask_group_members', text.slice(ask + 9)]
        : text
            .slice(anyTool + 10)
            .split(/ (.*)/s)
            .slice(0, 2)
    const toolCall = GEMINI
      ? {
          toolCallId: `${name}-1`,
          title: name,
          kind: 'other',
          status: 'pending',
          _meta: { 'gemini-cli': { mcp: { server_name: 'gonggong', tool_name: name } } },
        }
      : { toolCallId: `${name}-1`, title: `mcp__gonggong__${name}`, kind: 'other', status: 'pending' }
    await update({ sessionUpdate: 'tool_call', ...toolCall })
    const res = await client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall,
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    })
    if (res.outcome.outcome !== 'selected' || res.outcome.optionId !== 'allow') {
      await say('ask denied')
      return { stopReason: 'end_turn' }
    }
    const server = GEMINI
      ? { url: JSON.parse(geminiFile('settings.json')).mcpServers.gonggong.httpUrl }
      : s.mcpServers.find((m) => m.type === 'http' && m.name === 'gonggong')
    try {
      const args = JSON.parse(raw)
      await mcp(server.url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} }, abort.signal)
      const result = await mcp(server.url, 'tools/call', { name, arguments: args }, abort.signal)
      await say(result.content[0].text)
    } catch (e) {
      if (abort.signal.aborted) return { stopReason: 'cancelled' }
      throw e
    }
    return { stopReason: 'end_turn' }
  }
  if (text.includes('mock:subagent')) {
    const air = clientCaps?._meta?.jetbrains?.air?.capabilities ?? []
    if (!air.includes('nativeSubagentSessions') || !air.includes('asyncTasks')) {
      await say('client did not opt in')
      return { stopReason: 'end_turn' }
    }
    const child = `${sessionId}:sub`
    const inChild = (u) => client.notify(acp.methods.client.session.update, { sessionId: child, update: u })
    await update({
      sessionUpdate: 'subagent_spawned',
      subagentSessionId: child,
      name: 'Explore',
      task: '找调用方',
      capabilities: {},
    })
    await inChild({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '子 agent 报告' } })
    await inChild({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read a.rs',
      kind: 'read',
      status: 'completed',
    })
    await inChild({
      sessionUpdate: 'async_task_spawned',
      asyncTaskId: 'bg1',
      name: 'pnpm dev',
      taskType: 'shell',
      showInTranscript: false,
      canStop: true,
    })
    await update({ sessionUpdate: 'subagent_state_update', subagentSessionId: child, state: 'completed' })
    await say('完成')
    setTimeout(
      () =>
        update({
          sessionUpdate: 'async_task_state_update',
          asyncTaskId: 'bg1',
          state: 'completed',
          summary: 'exit 0',
        }),
      200,
    )
    return { stopReason: 'end_turn' }
  }
  if (text.includes('mock:bgtask')) {
    await update({
      sessionUpdate: 'async_task_spawned',
      asyncTaskId: 'bg2',
      name: 'pnpm dev',
      taskType: 'shell',
      showInTranscript: false,
      canStop: true,
    })
    tasks.set('bg2', update)
    await say('已在后台启动')
    return { stopReason: 'end_turn' }
  }
  if (text.includes('mock:later')) {
    // Like Claude Code after a background shell finishes: an autonomous cycle (task-notification) streams between
    // prompts and ends with a usage_update carrying `_claude/origin`.
    const exec = text.includes('mock:later-exec')
    const open = text.includes('mock:later-open')
    const origin = { _meta: { '_claude/origin': { kind: 'task-notification' } } }
    await update({
      sessionUpdate: 'async_task_spawned',
      asyncTaskId: 'bg3',
      name: 'sleep 1',
      taskType: 'shell',
      showInTranscript: false,
      canStop: true,
    })
    await say('等它跑完我再继续')
    setTimeout(async () => {
      await update({ sessionUpdate: 'async_task_state_update', asyncTaskId: 'bg3', state: 'completed' })
      // A placeholder result (num_turns 0) comes first and alone.
      await update({ sessionUpdate: 'usage_update', used: 900, size: 200000, ...origin })
      await say('后台任务跑完了，')
      await update({
        sessionUpdate: 'tool_call',
        toolCallId: 'read-9',
        title: 'Read log.txt',
        kind: 'read',
        status: 'completed',
      })
      if (exec) {
        const toolCall = {
          toolCallId: 'exec-9',
          title: 'rm -rf dist',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'rm -rf dist' },
        }
        await update({ sessionUpdate: 'tool_call', ...toolCall })
        const res = await client.request(acp.methods.client.session.requestPermission, {
          sessionId,
          toolCall,
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        })
        const ran = res.outcome.outcome === 'selected' && res.outcome.optionId !== 'reject'
        await say(ran ? 'ran' : 'denied')
      } else await say('继续收尾。')
      if (!open)
        await update({
          sessionUpdate: 'usage_update',
          used: 1300,
          size: 200000,
          cost: { amount: 0.02, currency: 'USD' },
          ...origin,
        })
    }, 300)
    return { stopReason: 'end_turn' }
  }
  if (text.includes('mock:crash')) {
    await say('about to crash')
    await sleep(50)
    process.exit(3)
  }
  // A hung agent: streams once, then never answers, not even session/cancel.
  if (text.includes('mock:hang')) {
    await say('working ')
    await new Promise(() => {})
  }
  if (text.includes('mock:slow')) {
    for (let i = 0; i < 300 && !abort.signal.aborted; i++) {
      await say(`tick ${i} `)
      await sleep(20)
    }
    return { stopReason: abort.signal.aborted ? 'cancelled' : 'end_turn' }
  }

  const file = `${s.cwd}/hello.txt`
  await say('好的，')
  await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '需要写一个文件' } })
  await update({
    sessionUpdate: 'tool_call',
    toolCallId: 'read-1',
    title: 'Read README',
    kind: 'read',
    status: 'completed',
    locations: [{ path: `${s.cwd}/README.md` }],
  })
  const toolCall = {
    toolCallId: 'edit-1',
    title: 'Write hello.txt',
    kind: 'edit',
    status: 'pending',
    locations: [{ path: file }],
  }
  await update({ sessionUpdate: 'tool_call', ...toolCall })
  const res = await client.request(acp.methods.client.session.requestPermission, {
    sessionId,
    toolCall,
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  })
  const allowed = res.outcome.outcome === 'selected' && res.outcome.optionId === 'allow'
  await update({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'edit-1',
    status: allowed ? 'completed' : 'failed',
  })
  await update({
    sessionUpdate: 'usage_update',
    used: 1200,
    size: 200000,
    cost: { amount: 0.01, currency: 'USD' },
  })
  await say(allowed ? '已写入 hello.txt。' : '权限被拒绝，未写入。')
  return { stopReason: 'end_turn' }
}

acp
  .agent({ name: 'gonggong-mock-agent' })
  .onRequest('initialize', (ctx) => {
    clientCaps = ctx.params.clientCapabilities
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: GEMINI
        ? { loadSession: true, promptCapabilities: { image: true } }
        : {
            loadSession: false,
            sessionCapabilities: { resume: {}, fork: {} },
            promptCapabilities: { image: true },
          },
    }
  })
  .onRequest('session/new', (ctx) => open(`mock-${crypto.randomUUID()}`, ctx.params))
  .onRequest('session/resume', (ctx) => {
    if (!ctx.params.sessionId.startsWith('mock-'))
      throw acp.RequestError.resourceNotFound(ctx.params.sessionId)
    return open(ctx.params.sessionId, ctx.params)
  })
  .onRequest('session/load', (ctx) => {
    if (!ctx.params.sessionId.startsWith('mock-'))
      throw acp.RequestError.resourceNotFound(ctx.params.sessionId)
    const { sessionId, ...rest } = open(ctx.params.sessionId, ctx.params)
    return rest
  })
  .onRequest('session/set_model', { parse: (v) => v }, (ctx) => {
    const s = sessions.get(ctx.params.sessionId)
    s.model = ctx.params.modelId
    s.configSets.push(`model=${ctx.params.modelId}`)
    return {}
  })
  .onRequest('session/fork', (ctx) => {
    if (!ctx.params.sessionId.startsWith('mock-'))
      throw acp.RequestError.resourceNotFound(ctx.params.sessionId)
    return open(`mock-${crypto.randomUUID()}`, ctx.params)
  })
  .onRequest('session/set_mode', (ctx) => {
    sessions.get(ctx.params.sessionId).mode = ctx.params.modeId
    return {}
  })
  .onRequest('session/set_config_option', (ctx) => {
    const s = sessions.get(ctx.params.sessionId)
    const { configId, value } = ctx.params
    const option = configOptions(s).find((o) => o.id === configId)
    if (!option?.options.some((o) => o.value === value))
      throw acp.RequestError.invalidParams(undefined, `Invalid value for config option ${configId}: ${value}`)
    s[configId] = value
    s.configSets.push(`${configId}=${value}`)
    if (configId === 'model' && !EFFORTS[value].includes(s.effort))
      s.effort = EFFORTS[value].includes('medium') ? 'medium' : null
    return { configOptions: configOptions(s) }
  })
  .onRequest('session/prompt', (ctx) => prompt(ctx.params, ctx.client))
  .onRequest('_session/async_task/stop', { parse: (v) => v }, async (ctx) => {
    const report = tasks.get(ctx.params.asyncTaskId)
    if (!report) return { stopped: false }
    tasks.delete(ctx.params.asyncTaskId)
    await report({
      sessionUpdate: 'async_task_state_update',
      asyncTaskId: ctx.params.asyncTaskId,
      state: 'stopped',
    })
    return { stopped: true }
  })
  .onNotification('session/cancel', (ctx) => sessions.get(ctx.params.sessionId)?.abort?.abort())
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
