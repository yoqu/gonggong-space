import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Attachment,
  MAX_ATTACHMENT_BYTES,
  type MessageDto,
  PROTOCOL_VERSION,
  type RunStart,
} from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { attachments, messages, runs } from '../src/db/schema.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

type Upload = Omit<Attachment, 'messageId'>

let t: TestApp
beforeAll(() => {
  process.env.AIWS_DATA_DIR = mkdtempSync(join(tmpdir(), 'aiws-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

async function upload(cookie: string, groupId: string | null, name: string, data: Buffer, type = 'image/png') {
  const form = new FormData()
  if (groupId) form.set('groupId', groupId)
  form.set('file', new Blob([new Uint8Array(data)], { type }), name)
  const res = await fetch(t.url('/api/uploads'), { method: 'POST', headers: { cookie }, body: form })
  return { status: res.status, body: (await res.json()) as Upload & { error?: string } }
}

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '赵敏' })
  const { machine, token } = await t.seed.machine(wang.id)
  const other = await t.seed.machine(outsider.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const codex = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex' })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id, codex.id] })
  const g2 = await t.seed.group({ createdBy: outsider.id })
  const cookies = {
    wang: await t.seed.cookie(wang.id),
    li: await t.seed.cookie(li.id),
    outsider: await t.seed.cookie(outsider.id),
  }
  return { wang, li, outsider, claude, codex, g, g2, token, otherToken: other.token, cookies }
}

let n = 0
const send = (cookie: string, groupId: string, body: Record<string, unknown>) =>
  client(t, cookie).post<MessageDto & { error?: string }>(`/api/groups/${groupId}/messages`, {
    clientId: `client-${++n}-x`,
    ...body,
  })

describe('uploads', () => {
  it('stores a member upload unbound and serves it inline to members only', async () => {
    const w = await world()
    const res = await upload(w.cookies.li, w.g.id, 'shot.png', PNG)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: expect.any(String), name: 'shot.png', size: PNG.length, mime: 'image/png' })
    const [row] = await t.db.select().from(attachments).where(eq(attachments.id, res.body.id))
    expect(row).toMatchObject({ messageId: null, groupId: w.g.id, uploaderId: w.li.id })

    const got = await fetch(t.url(`/api/attachments/${res.body.id}`), { headers: { cookie: w.cookies.wang } })
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(got.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''shot.png`)
    expect(Buffer.from(await got.arrayBuffer())).toEqual(PNG)
    const denied = await fetch(t.url(`/api/attachments/${res.body.id}`), {
      headers: { cookie: w.cookies.outsider },
    })
    expect(denied.status).toBe(404)
  })

  it('downloads anything that could run as a page, and strips paths from names', async () => {
    const w = await world()
    const html = await upload(w.cookies.wang, w.g.id, '../../etc/报告.html', Buffer.from('<script>'), 'text/html')
    expect(html.body.name).toBe('报告.html')
    const got = await fetch(t.url(`/api/attachments/${html.body.id}`), { headers: { cookie: w.cookies.wang } })
    expect(got.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('报告.html')}`,
    )
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    await got.arrayBuffer()
    const log = await upload(w.cookies.wang, w.g.id, 'ci.log', Buffer.from('ERROR x'), 'text/plain')
    const text = await fetch(t.url(`/api/attachments/${log.body.id}`), { headers: { cookie: w.cookies.wang } })
    expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(text.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(await text.text()).toBe('ERROR x')
  })

  it('rejects non-members, a missing group and files over the size limit', async () => {
    const w = await world()
    expect((await upload(w.cookies.outsider, w.g.id, 'a.png', PNG)).status).toBe(404)
    expect((await upload(w.cookies.wang, null, 'a.png', PNG)).status).toBe(400)
    const big = await upload(w.cookies.wang, w.g.id, 'big.bin', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), 'x/y')
    expect(big).toMatchObject({ status: 400, body: { error: 'invalid', message: '单个附件不能超过 50 MB' } })
    expect(await t.db.select().from(attachments)).toHaveLength(0)
  })

  it('serves daemons only for machines hosting a bot of that group', async () => {
    const w = await world()
    const { body } = await upload(w.cookies.li, w.g.id, 'shot.png', PNG)
    const get = (token?: string) =>
      fetch(t.url(`/api/daemon/attachments/${body.id}`), {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      })
    const ok = await get(w.token)
    expect(ok.status).toBe(200)
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG)
    expect((await get(w.otherToken)).status).toBe(403)
    expect((await get()).status).toBe(401)
  })
})

describe('sending attachments', () => {
  it('binds my unbound uploads to the message, once', async () => {
    const w = await world()
    const a = (await upload(w.cookies.wang, w.g.id, 'shot.png', PNG)).body
    const b = (await upload(w.cookies.wang, w.g.id, 'spec.md', Buffer.from('# hi'), 'text/markdown')).body
    const res = await send(w.cookies.wang, w.g.id, { body: '', attachmentIds: [a.id, b.id] })
    expect(res.status).toBe(200)
    expect(res.body.attachments).toEqual([
      { ...a, messageId: res.body.id },
      { ...b, messageId: res.body.id },
    ])
    const [row] = await t.db.select().from(attachments).where(eq(attachments.id, a.id))
    expect(row?.messageId).toBe(res.body.id)
    const timeline = await client(t, w.cookies.li).get<{ messages: MessageDto[] }>(
      `/api/groups/${w.g.id}/timeline`,
    )
    expect(timeline.body.messages.at(-1)?.attachments).toHaveLength(2)

    expect((await send(w.cookies.wang, w.g.id, { body: 'again', attachmentIds: [a.id] })).status).toBe(400)
  })

  it('rejects uploads of someone else, of another group, unknown ids and more than 10', async () => {
    const w = await world()
    const lis = (await upload(w.cookies.li, w.g.id, 'a.png', PNG)).body
    expect((await send(w.cookies.wang, w.g.id, { body: 'x', attachmentIds: [lis.id] })).status).toBe(400)
    const mine = await t.seed.group({ createdBy: w.wang.id })
    const other = (await upload(w.cookies.wang, mine.id, 'b.png', PNG)).body
    expect((await send(w.cookies.wang, w.g.id, { body: 'x', attachmentIds: [other.id] })).status).toBe(400)
    expect((await send(w.cookies.wang, w.g.id, { body: 'x', attachmentIds: ['nope'] })).status).toBe(400)
    const ids = Array.from({ length: 11 }, () => lis.id)
    expect((await send(w.cookies.li, w.g.id, { body: 'x', attachmentIds: ids })).status).toBe(400)
    expect((await send(w.cookies.wang, w.g.id, { body: ' ' })).status).toBe(400)
    expect(await t.db.select().from(messages)).toHaveLength(0)
  })
})

async function botReply(w: Awaited<ReturnType<typeof world>>, botId: string, body: string) {
  const [m] = await t.db
    .insert(messages)
    .values({ groupId: w.g.id, kind: 'bot', authorBotId: botId, body, meta: {} })
    .returning()
  return m!
}

describe('quotes', () => {

  it('quoting a bot reply triggers that bot and snapshots the quote', async () => {
    const w = await world()
    const reply = await botReply(w, w.codex.id, '接口已改好\n细节见 diff')
    const res = await send(w.cookies.li, w.g.id, {
      body: '@小王的 Claude 帮看下',
      quote: { kind: 'message', id: reply.id },
    })
    expect(res.body.mentions).toEqual([w.claude.id, w.codex.id])
    expect(res.body.quote).toEqual({
      kind: 'message',
      id: reply.id,
      who: '老李的 Codex',
      text: '接口已改好\n细节见 diff',
    })
    expect(await t.db.select().from(runs).where(eq(runs.triggerMessageId, res.body.id))).toHaveLength(2)
  })

  it('quoting a run card triggers its bot once; quoting a human only adds context', async () => {
    const w = await world()
    const trigger = (await send(w.cookies.li, w.g.id, { body: '@老李的 Codex 改接口' })).body
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, trigger.id))
    const res = await send(w.cookies.li, w.g.id, {
      body: '@老李的 Codex 继续',
      quote: { kind: 'run', id: run!.id },
    })
    expect(res.body.mentions).toEqual([w.codex.id])
    expect(res.body.quote).toMatchObject({ kind: 'run', who: '老李的 Codex 的运行卡片' })

    const human = await send(w.cookies.wang, w.g.id, { body: '好的', quote: { kind: 'message', id: trigger.id } })
    expect(human.body.mentions).toEqual([])
    expect(human.body.quote).toMatchObject({ who: '李建国', text: '@老李的 Codex 改接口' })
    expect(await t.db.select().from(runs).where(eq(runs.triggerMessageId, human.body.id))).toHaveLength(0)
  })

  it('refuses quotes from another group', async () => {
    const w = await world()
    const [foreign] = await t.db
      .insert(messages)
      .values({ groupId: w.g2.id, kind: 'user', authorUserId: w.outsider.id, body: '秘密', meta: {} })
      .returning()
    const res = await send(w.cookies.wang, w.g.id, { body: 'x', quote: { kind: 'message', id: foreign!.id } })
    expect(res.status).toBe(404)
  })
})

describe('run.start', () => {
  async function daemon(token: string) {
    const ws = t.ws('/ws/daemon')
    const box = inbox(ws)
    await box.opened
    ws.send(
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        token,
        daemonVersion: '0.1.0',
        machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
        agents: [],
      }),
    )
    expect(await box.next()).toMatchObject({ t: 'welcome' })
    return { next: () => box.next<RunStart>(), ws }
  }

  it('carries the trigger attachments, the quote and the attachments of unmentioned context', async () => {
    const w = await world()
    const d = await daemon(w.token)
    const log = (await upload(w.cookies.li, w.g.id, 'ci.log', Buffer.from('ERROR'), 'text/plain')).body
    const ctx = (await send(w.cookies.li, w.g.id, { body: 'CI 挂了', attachmentIds: [log.id] })).body
    const reply = await botReply(w, w.codex.id, '已定位')
    const shot = (await upload(w.cookies.wang, w.g.id, 'shot.png', PNG)).body
    const trigger = (
      await send(w.cookies.wang, w.g.id, {
        body: '@小王的 Claude 看图',
        attachmentIds: [shot.id],
        quote: { kind: 'message', id: reply.id },
      })
    ).body
    const start = await d.next()
    expect(start.prompt.attachments).toEqual([{ ...shot, messageId: trigger.id }])
    expect(start.prompt.quote).toEqual({ author: '老李的 Codex', body: '已定位' })
    expect(start.prompt.context.find((c) => c.body === 'CI 挂了')?.attachments).toEqual([
      { ...log, messageId: ctx.id },
    ])
    d.ws.close()
  })
})
