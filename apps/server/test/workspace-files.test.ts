import {
  decodeFrame,
  encodeFrame,
  FILE_TEXT_MAX_BYTES,
  type FilesTreeDto,
  type FileTextDto,
  PROTOCOL_VERSION,
  type ServerToDaemon,
  TUNNEL_FRAME,
  type TunnelHead,
  type TunnelOpen,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupBots } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function daemon(token: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  send({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    token,
    daemonVersion: '0.1.0',
    machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
    agents: [],
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  /** The next files request; hello may first trigger workspace messages. */
  const next = async () => {
    for (;;) {
      const m = await box.next<ServerToDaemon>()
      if (m.t === 'files.tree' || m.t === 'files.read') return m
    }
  }
  return { send, next }
}

/** A daemon's tunnel end answering every stream with `answer(open)`; the opens it got are kept. */
async function tunnel(machineId: string, token: string, answer: (o: TunnelOpen) => [TunnelHead, string]) {
  const ws = t.ws('/ws/daemon/tunnel', { authorization: `Bearer ${token}` })
  const opens: TunnelOpen[] = []
  ws.on('message', (raw: Buffer) => {
    const f = decodeFrame(new Uint8Array(raw))
    if (f.type !== TUNNEL_FRAME.open) return
    const open: TunnelOpen = JSON.parse(Buffer.from(f.payload).toString())
    opens.push(open)
    const [head, body] = answer(open)
    ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.head, Buffer.from(JSON.stringify(head))))
    if (body) ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.data, Buffer.from(body)))
    ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.end, new Uint8Array()))
  })
  await vi.waitFor(() => expect(t.ctx.tunnels.get(machineId)).toBeDefined())
  return opens
}

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '陈晨' })
  const outsider = await t.seed.user({ name: '路人' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'CC专家', machineId: machine.id })
  const stray = await t.seed.bot({ ownerId: owner.id, name: 'other', machineId: machine.id })
  const group = await t.seed.group({ createdBy: owner.id, memberIds: [member.id], botIds: [bot.id] })
  const cookie = await t.seed.cookie(member.id)
  const members = client(t, cookie)
  const outsiders = client(t, await t.seed.cookie(outsider.id))
  const url = (kind: string, q: string, botId = bot.id) =>
    `/api/groups/${group.id}/bots/${botId}/files/${kind}?${q}`
  return { machine, token, bot, stray, group, cookie, members, outsiders, url }
}

describe('files browser routes', () => {
  it('lists one directory level from the bot daemon', async () => {
    const w = await world()
    await t.db
      .update(groupBots)
      .set({ workspaceKind: 'cd', cdPath: '/Users/wl/pay' })
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    const d = await daemon(w.token)
    const pending = w.members.get<FilesTreeDto>(w.url('tree', 'path=%2Fsrc%2Fassets%2F&ignored=1'))
    const req = await d.next()
    expect(req).toMatchObject({
      t: 'files.tree',
      groupId: w.group.id,
      botId: w.bot.id,
      workspace: { repo: null, cdPath: '/Users/wl/pay' },
      path: 'src/assets',
      showIgnored: true,
    })
    if (req.t !== 'files.tree') throw new Error(req.t)
    const entries = [{ name: 'logo.svg', dir: false, size: 12, mtime: 1, uncommitted: true, ignored: false }]
    d.send({ t: 'files.tree.result', requestId: req.requestId, entries, truncated: true, error: null })
    expect(await pending).toEqual({ status: 200, body: { path: 'src/assets', entries, truncated: true } })

    const root = w.members.get<FilesTreeDto>(w.url('tree', ''))
    const again = await d.next()
    expect(again).toMatchObject({ t: 'files.tree', path: '', showIgnored: false })
    if (again.t !== 'files.tree') throw new Error(again.t)
    d.send({ t: 'files.tree.result', requestId: again.requestId, entries: [], truncated: false, error: null })
    expect((await root).body).toEqual({ path: '', entries: [], truncated: false })
  })

  it('reads a text file with the size cap', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const pending = w.members.get<FileTextDto>(w.url('text', 'path=src/main.ts'))
    const req = await d.next()
    expect(req).toMatchObject({ t: 'files.read', path: 'src/main.ts', maxBytes: FILE_TEXT_MAX_BYTES })
    if (req.t !== 'files.read') throw new Error(req.t)
    d.send({
      t: 'files.read.result',
      requestId: req.requestId,
      size: 3,
      binary: false,
      mime: 'text/plain; charset=utf-8',
      text: 'hi\n',
      error: null,
    })
    expect((await pending).body).toEqual({
      path: 'src/main.ts',
      size: 3,
      binary: false,
      mime: 'text/plain; charset=utf-8',
      text: 'hi\n',
    })
    expect((await w.members.get(w.url('text', 'path='))).status).toBe(400)
  })

  it('reports an offline bot and daemon errors, and refuses outsiders and bots outside the group', async () => {
    const w = await world()
    for (const kind of ['tree', 'text', 'raw'])
      expect((await w.members.get(w.url(kind, 'path=a.txt'))).body).toMatchObject({
        error: 'conflict',
        message: 'CC专家 离线，无法读取文件',
      })
    const d = await daemon(w.token)
    const pending = w.members.get(w.url('text', 'path=../x'))
    const req = await d.next()
    if (req.t !== 'files.read') throw new Error(req.t)
    d.send({
      t: 'files.read.result',
      requestId: req.requestId,
      size: 0,
      binary: false,
      mime: '',
      text: null,
      error: '路径超出工作区：../x',
    })
    expect((await pending).body).toMatchObject({ error: 'conflict', message: '路径超出工作区：../x' })

    expect((await w.outsiders.get(w.url('tree', ''))).status).toBe(404)
    expect((await w.outsiders.get(w.url('raw', 'path=a.png'))).status).toBe(404)
    expect((await w.members.get(w.url('tree', '', w.stray.id))).status).toBe(404)

    await t.db
      .update(groupBots)
      .set({ workspaceState: 'unbound' })
      .where(and(eq(groupBots.groupId, w.group.id), eq(groupBots.botId, w.bot.id)))
    expect((await w.members.get(w.url('tree', ''))).body).toMatchObject({
      error: 'conflict',
      message: 'CC专家 尚未设置工作区',
    })
  })

  it('streams raw bytes through the tunnel with ranges and sandboxing headers', async () => {
    const w = await world()
    const opens = await tunnel(w.machine.id, w.token, (o) => {
      if (o.path.endsWith('missing.mp4'))
        return [{ status: 404, headers: [['content-type', 'text/plain; charset=utf-8']] }, '文件不存在']
      const type = o.path.endsWith('.html') ? 'text/html; charset=utf-8' : 'video/mp4'
      const headers: [string, string][] = [
        ['content-type', type],
        ['content-length', '4'],
        ['accept-ranges', 'bytes'],
        ['etag', '"a-1"'],
        ['content-range', 'bytes 2-5/10'],
        ['x-internal', 'dropped'],
      ]
      return [{ status: 206, headers }, '2345']
    })
    const res = await fetch(t.url(w.url('raw', 'path=media/demo%20clip.mp4')), {
      headers: { cookie: w.cookie, range: 'bytes=2-5', 'if-none-match': '"old"' },
    })
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('2345')
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'video/mp4',
      'content-range': 'bytes 2-5/10',
      'accept-ranges': 'bytes',
      etag: '"a-1"',
      'content-security-policy': 'sandbox',
      'x-content-type-options': 'nosniff',
      'content-disposition': "inline; filename*=UTF-8''demo%20clip.mp4",
    })
    expect(res.headers.get('x-internal')).toBeNull()
    expect(opens[0]).toEqual({
      files: { groupId: w.group.id, botId: w.bot.id, workspace: { repo: null, cdPath: null } },
      method: 'GET',
      path: '/media/demo%20clip.mp4',
      headers: [
        ['range', 'bytes=2-5'],
        ['if-none-match', '"old"'],
      ],
      upgrade: false,
    })

    const html = await fetch(t.url(w.url('raw', 'path=site/index.html')), { headers: { cookie: w.cookie } })
    expect(html.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''index.html")
    expect(html.headers.get('content-security-policy')).toBe('sandbox')

    const missing = await fetch(t.url(w.url('raw', 'path=missing.mp4')), { headers: { cookie: w.cookie } })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: 'not_found', message: '文件不存在' })
    expect((await w.members.get(w.url('raw', ''))).status).toBe(400)
  })
})
