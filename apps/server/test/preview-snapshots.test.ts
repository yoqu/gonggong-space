import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeFrame,
  encodeFrame,
  type GroupPreviewsDto,
  TUNNEL_FRAME,
  type TunnelHead,
  type TunnelOpen,
} from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages, previews, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
  t = await createTestApp()
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: 'https://gg.example.com' }
})
afterEach(() => t.close())

/** The machine's tunnel end: snapshot streams get `answer`; the opens it got are kept. */
async function tunnel(machineId: string, token: string, answer: () => [TunnelHead, string]) {
  const ws = t.ws('/ws/daemon/tunnel', { authorization: `Bearer ${token}` })
  const opens: TunnelOpen[] = []
  ws.on('message', (raw: Buffer) => {
    const f = decodeFrame(new Uint8Array(raw))
    if (f.type !== TUNNEL_FRAME.open) return
    opens.push(JSON.parse(Buffer.from(f.payload).toString()))
    const [head, body] = answer()
    ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.head, Buffer.from(JSON.stringify(head))))
    if (body) ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.data, Buffer.from(body)))
    ws.send(encodeFrame(f.streamId, TUNNEL_FRAME.end, new Uint8Array()))
  })
  await vi.waitFor(() => expect(t.ctx.tunnels.get(machineId)).toBeDefined())
  return opens
}

const png: [TunnelHead, string] = [{ status: 200, headers: [['content-type', 'image/png']] }, 'PNG']

async function world(answer: () => [TunnelHead, string] = () => png) {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [bot.id] })
  const [trigger] = await t.db
    .insert(messages)
    .values({ groupId: group.id, kind: 'user', authorUserId: wang.id, body: '起个 dev server' })
    .returning()
  const [run] = await t.db
    .insert(runs)
    .values({
      groupId: group.id,
      botId: bot.id,
      triggerMessageId: trigger!.id,
      originUserId: wang.id,
      status: 'running',
    })
    .returning()
  t.ctx.hub.register(machine.id, { send: () => {}, close: () => {} })
  const opens = await tunnel(machine.id, token, answer)
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/daemon/runs/${run!.id}/tools/preview_expose`,
    headers: { authorization: `Bearer ${token}` },
    payload: { arguments: { port: 5173, title: '登录页', path: '/login' } },
  })
  expect(res.json().isError).toBe(false)
  const [p] = await t.db.select().from(previews)
  const as = async (id: string) => client(t, await t.seed.cookie(id))
  return { wang: await as(wang.id), li: await as(li.id), liId: li.id, group, preview: p!, opens }
}

describe('preview snapshots', () => {
  it('captures the first screen through the tunnel once published and serves it to members', async () => {
    const w = await world()
    expect(w.opens).toContainEqual(
      expect.objectContaining({ snapshot: { previewId: w.preview.id, port: 5173 }, path: '/login' }),
    )
    await vi.waitFor(async () => {
      const { body } = await w.li.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)
      expect(body.previews[0]?.snapshotAt).toBeTruthy()
    })
    const fetch = async (userId: string) =>
      t.app.inject({
        url: `/api/previews/${w.preview.id}/snapshot`,
        headers: { cookie: await t.seed.cookie(userId) },
      })
    expect((await fetch((await t.seed.user()).id)).statusCode).toBe(404)
    const got = await fetch(w.liId)
    expect([got.statusCode, got.headers['content-type'], got.body]).toEqual([200, 'image/png', 'PNG'])
  })

  it('lets the bot owner or a group admin retake it, and says why when the machine cannot', async () => {
    let answer = png
    const w = await world(() => answer)
    expect((await w.li.post(`/api/previews/${w.preview.id}/snapshot`)).status).toBe(403)
    expect((await w.wang.post(`/api/previews/${w.preview.id}/snapshot`)).status).toBe(204)
    answer = [{ status: 404, headers: [] }, '本机没有可用于截图的 Chrome / Edge']
    const res = await w.wang.post(`/api/previews/${w.preview.id}/snapshot`)
    expect(res).toMatchObject({ status: 409, body: { message: '本机没有可用于截图的 Chrome / Edge' } })
  })
})
