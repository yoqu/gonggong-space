import { createServer } from 'node:http'
import type { GroupPreviewsDto, LiveTokenDto } from '@gonggong/protocol'
import { TokenVerifier } from 'livekit-server-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { previews } from '../src/db/schema.js'
import type { LiveKit } from '../src/modules/live/livekit.js'
import { reapWatches } from '../src/modules/live/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

const KEY = 'test'
const SECRET = 'test-secret-'.repeat(3)

/** LiveKit's RoomService (Twirp, JSON): lists `participants` for any room and records permission updates. */
async function fakeRoomService(participants: () => string[]) {
  const updates: { identity: string; canPublishData: boolean }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      const json = JSON.parse(body || '{}')
      res.setHeader('content-type', 'application/json')
      if (req.url?.endsWith('/ListParticipants')) {
        res.end(JSON.stringify({ participants: participants().map((identity) => ({ identity })) }))
        return
      }
      updates.push({ identity: json.identity, canPublishData: !!json.permission?.canPublishData })
      res.end(JSON.stringify({ identity: json.identity }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const api = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { api, updates, close: () => new Promise((r) => server.close(r)) }
}

let t: TestApp
let clock = Date.parse('2026-09-29T10:00:00Z')
let rooms: Awaited<ReturnType<typeof fakeRoomService>>
let connected: string[] = []
beforeEach(async () => {
  clock = Date.parse('2026-09-29T10:00:00Z')
  connected = []
  rooms = await fakeRoomService(() => connected)
  const livekit: LiveKit = {
    endpoint: async () => ({ url: null, api: rooms.api, key: KEY, secret: SECRET }),
    signalPort: null,
    close: async () => {},
  }
  t = await createTestApp({ now: () => new Date(clock), livekit })
})
afterEach(async () => {
  await t.close()
  await rooms.close()
})

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵六' })
  const { machine } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, memberIds: [li.id, zhao.id], botIds: [bot.id] })
  const [p] = await t.db
    .insert(previews)
    .values({
      slug: 'gui1',
      kind: 'gui',
      machineId: machine.id,
      groupId: group.id,
      botId: bot.id,
      title: '计算器',
    })
    .returning()
  const as = async (id: string) => client(t, await t.seed.cookie(id))
  return {
    wang,
    li,
    zhao,
    group,
    preview: p!,
    w: await as(wang.id),
    l: await as(li.id),
    z: await as(zhao.id),
  }
}

type World = Awaited<ReturnType<typeof world>>
const control = async (c: World['w'], w: World, body: object) =>
  (await c.post(`/api/previews/${w.preview.id}/control`, body)).status
const state = async (c: World['w'], w: World) =>
  (await c.get<GroupPreviewsDto>(`/api/groups/${w.group.id}/previews`)).body.previews[0]?.control

async function canSend(c: World['w'], w: World) {
  const { body } = await c.post<LiveTokenDto>(`/api/previews/${w.preview.id}/live`)
  return (await new TokenVerifier(KEY, SECRET).verify(body.token)).video?.canPublishData
}

describe('control of a live preview (plan P14)', () => {
  it('a member asks, the bot owner approves, and only then may they send input', async () => {
    const w = await world()
    expect(await state(w.l, w)).toEqual({ controller: null, requests: [] })
    connected = [`u:${w.li.id}:aa`, `u:${w.li.id}:bb`, `u:${w.wang.id}:cc`, 'cast']

    expect(await control(w.l, w, { action: 'request' })).toBe(204)
    expect(await control(w.l, w, { action: 'request' })).toBe(204)
    expect(await state(w.w, w)).toEqual({ controller: null, requests: [{ id: w.li.id, name: '李建国' }] })
    expect(rooms.updates).toEqual([])
    expect(await control(w.z, w, { action: 'grant', userId: w.li.id })).toBe(403)

    expect(await control(w.w, w, { action: 'grant', userId: w.li.id })).toBe(204)
    expect(await state(w.z, w)).toEqual({ controller: { id: w.li.id, name: '李建国' }, requests: [] })
    // Both of 李建国's connections may now send input; nobody else's.
    expect(rooms.updates).toEqual([
      { identity: `u:${w.li.id}:aa`, canPublishData: true },
      { identity: `u:${w.li.id}:bb`, canPublishData: true },
    ])
    expect(await canSend(w.l, w)).toBe(true)
    expect(await canSend(w.w, w)).toBe(false)

    expect(await control(w.l, w, { action: 'release' })).toBe(204)
    expect(await state(w.l, w)).toEqual({ controller: null, requests: [] })
    expect(rooms.updates.slice(2)).toEqual([
      { identity: `u:${w.li.id}:aa`, canPublishData: false },
      { identity: `u:${w.li.id}:bb`, canPublishData: false },
    ])
    expect(await canSend(w.l, w)).toBe(false)
  })

  it('one controller at a time: the owner takes over directly, revokes, and turns requests down', async () => {
    const w = await world()
    connected = [`u:${w.li.id}:aa`, `u:${w.wang.id}:cc`]
    await control(w.l, w, { action: 'request' })
    await control(w.w, w, { action: 'grant', userId: w.li.id })

    expect(await control(w.w, w, { action: 'request' })).toBe(204)
    expect((await state(w.l, w))?.controller).toEqual({ id: w.wang.id, name: '王磊' })
    expect(rooms.updates.slice(1)).toEqual([
      { identity: `u:${w.li.id}:aa`, canPublishData: false },
      { identity: `u:${w.wang.id}:cc`, canPublishData: true },
    ])

    await control(w.z, w, { action: 'request' })
    expect(await control(w.w, w, { action: 'deny', userId: w.zhao.id })).toBe(204)
    expect(await control(w.w, w, { action: 'grant', userId: w.zhao.id })).toBe(404)
    expect(await control(w.w, w, { action: 'revoke' })).toBe(204)
    expect(await state(w.l, w)).toEqual({ controller: null, requests: [] })
    expect(await control(w.l, w, { action: 'revoke' })).toBe(403)
  })

  it('control lapses with the controller watch lease', async () => {
    const w = await world()
    connected = [`u:${w.li.id}:aa`]
    await w.l.post(`/api/previews/${w.preview.id}/watch`)
    await control(w.l, w, { action: 'request' })
    await control(w.w, w, { action: 'grant', userId: w.li.id })
    await control(w.z, w, { action: 'request' })

    clock += 30_000
    await w.l.post(`/api/previews/${w.preview.id}/watch`)
    await reapWatches(t.ctx)
    expect(await state(w.l, w)).toEqual({ controller: { id: w.li.id, name: '李建国' }, requests: [] })

    clock += 61_000
    await reapWatches(t.ctx)
    expect(await state(w.l, w)).toEqual({ controller: null, requests: [] })
    expect(rooms.updates.at(-1)).toEqual({ identity: `u:${w.li.id}:aa`, canPublishData: false })
  })

  it('is for group members only', async () => {
    const w = await world()
    const outsider = await t.seed.user()
    const o = client(t, await t.seed.cookie(outsider.id))
    expect(await control(o, w, { action: 'request' })).toBe(404)
  })
})
