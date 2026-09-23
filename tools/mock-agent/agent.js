#!/usr/bin/env node
// Scriptable ACP agent for daemon tests. The prompt text picks the behaviour:
//   "mock:echo"  reply with a JSON summary of what the agent received (pid, cwd, mode, system prompt, prompt)
//   "mock:slow"  stream text until cancelled
//   "mock:crash" stream one chunk, then exit with code 3
//   "mock:sh <command>" run the rest of the prompt with sh in the session cwd (like Codex editing via shell)
//   "mock:ask <json>" call the injected aiws MCP ask tool with <json> as arguments (after a permission request)
//                     and reply with the tool's text result
//   otherwise    text + thought + edit tool call (with permission request) + usage, then end_turn
// Ids it hands out ("mock-*") resume in any process (like agents that persist sessions); others fail to resume.
import { execSync } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const sessions = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MODES = ['default', 'acceptEdits', 'bypassPermissions'].map((id) => ({ id, name: id }))

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
    mode: 'default',
    abort: null,
    mcpServers: params.mcpServers ?? [],
  })
  return { sessionId, modes: { currentModeId: 'default', availableModes: MODES } }
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
        systemPrompt: s.systemPrompt,
        prompt: text,
      }),
    )
    return { stopReason: 'end_turn' }
  }
  const sh = text.indexOf('mock:sh ')
  if (sh >= 0) {
    await say(execSync(text.slice(sh + 8), { cwd: s.cwd, encoding: 'utf8' }))
    return { stopReason: 'end_turn' }
  }
  const ask = text.indexOf('mock:ask ')
  if (ask >= 0) {
    const toolCall = {
      toolCallId: 'ask-1',
      title: 'mcp__aiws__ask_group_members',
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
    const server = s.mcpServers.find((m) => m.type === 'http' && m.name === 'aiws')
    try {
      const args = JSON.parse(text.slice(ask + 9))
      await mcp(server.url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} }, abort.signal)
      const result = await mcp(
        server.url,
        'tools/call',
        { name: 'ask_group_members', arguments: args },
        abort.signal,
      )
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
  .agent({ name: 'aiws-mock-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } },
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
  .onRequest('session/prompt', (ctx) => prompt(ctx.params, ctx.client))
  .onNotification('session/cancel', (ctx) => sessions.get(ctx.params.sessionId)?.abort?.abort())
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
