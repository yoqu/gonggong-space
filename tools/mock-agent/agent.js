#!/usr/bin/env node
// Scriptable ACP agent for daemon tests. The prompt text picks the behaviour:
//   "mock:echo"  reply with a JSON summary of what the agent received (pid, cwd, mode, system prompt, MCP servers, prompt, blocks)
//   "mock:slow"  stream text until cancelled
//   "mock:crash" stream one chunk, then exit with code 3
//   "mock:commands" report available commands (compact, new), then reply "ok"
//   "mock:sh <command>" run the rest of the prompt with sh in the session cwd (like Codex editing via shell)
//   "mock:exec <command>" ask permission for an execute tool call running <command>, reply "ran" or "denied"
//   "mock:ask <json>" call the injected gonggong MCP ask tool with <json> as arguments (after a permission request)
//                     and reply with the tool's text result
//   "mock:tool <name> <json>" the same for any gonggong tool
//   otherwise    text + thought + edit tool call (with permission request) + usage, then end_turn
// Ids it hands out ("mock-*") resume in any process (like agents that persist sessions); others fail to resume.
import { execSync } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const sessions = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MODES = ['default', 'acceptEdits', 'bypassPermissions'].map((id) => ({ id, name: id }))
const MODELS = [
  { value: 'default', name: 'Default' },
  { value: 'haiku', name: 'Haiku', description: 'Fastest' },
  { value: 'opus', name: 'Opus' },
]
const EFFORTS = ['low', 'medium', 'high'].map((value) => ({ value, name: value }))

const configOptions = (s) => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: s.model, options: MODELS },
  {
    id: 'effort',
    name: 'Effort',
    category: 'thought_level',
    type: 'select',
    currentValue: s.effort,
    options: EFFORTS,
  },
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
    systemPrompt: params._meta?.systemPrompt?.append ?? null,
    mcpServers: params.mcpServers,
    mode: 'default',
    model: 'default',
    effort: 'medium',
    configSets: [],
    abort: null,
  })
  return {
    sessionId,
    modes: { currentModeId: 'default', availableModes: MODES },
    configOptions: configOptions(sessions.get(sessionId)),
  }
}

async function prompt({ sessionId, prompt: blocks }, client) {
  const s = sessions.get(sessionId)
  if (!s) throw new Error(`unknown session ${sessionId}`)
  const text = blocks.map((b) => b.text ?? '').join('')
  const abort = new AbortController()
  s.abort = abort
  const update = (u) => client.notify(acp.methods.client.session.update, { sessionId, update: u })
  const say = (t) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } })

  if (text.includes('mock:echo')) {
    await say(
      JSON.stringify({
        pid: process.pid,
        cwd: s.cwd,
        mode: s.mode,
        model: s.model,
        effort: s.effort,
        configSets: s.configSets,
        systemPrompt: s.systemPrompt,
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
  const sh = text.indexOf('mock:sh ')
  if (sh >= 0) {
    await say(execSync(text.slice(sh + 8), { cwd: s.cwd, encoding: 'utf8' }))
    return { stopReason: 'end_turn' }
  }
  const exec = text.indexOf('mock:exec ')
  if (exec >= 0) {
    const command = text.slice(exec + 10)
    const toolCall = {
      toolCallId: 'exec-1',
      title: command,
      kind: 'execute',
      status: 'pending',
      rawInput: { command },
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
    const ran = res.outcome.outcome === 'selected' && res.outcome.optionId !== 'reject'
    await say(ran ? 'ran' : 'denied')
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
    const toolCall = {
      toolCallId: `${name}-1`,
      title: `mcp__gonggong__${name}`,
      kind: 'other',
      status: 'pending',
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
    if (res.outcome.outcome !== 'selected' || res.outcome.optionId !== 'allow') {
      await say('ask denied')
      return { stopReason: 'end_turn' }
    }
    const server = s.mcpServers.find((m) => m.type === 'http' && m.name === 'gonggong')
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
  if (text.includes('mock:crash')) {
    await say('about to crash')
    await sleep(50)
    process.exit(3)
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
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      sessionCapabilities: { resume: {} },
      promptCapabilities: { image: true },
    },
  }))
  .onRequest('session/new', (ctx) => open(`mock-${crypto.randomUUID()}`, ctx.params))
  .onRequest('session/resume', (ctx) => {
    if (!ctx.params.sessionId.startsWith('mock-'))
      throw acp.RequestError.resourceNotFound(ctx.params.sessionId)
    return open(ctx.params.sessionId, ctx.params)
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
    return { configOptions: configOptions(s) }
  })
  .onRequest('session/prompt', (ctx) => prompt(ctx.params, ctx.client))
  .onNotification('session/cancel', (ctx) => sessions.get(ctx.params.sessionId)?.abort?.abort())
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
