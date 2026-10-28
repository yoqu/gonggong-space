import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type HtmlRenderRef, type MessageDto, PROTOCOL_VERSION, type TimelineDto } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { attachments, messages, runs } from '../src/db/schema.js'
import { replyMarkdown } from '../src/modules/feishu/cards.js'
import { fillRunSearchText } from '../src/modules/runs/search-text.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const PAGE = '<!doctype html><html><head><title>CPU</title></head><body><h1>CPU 78%</h1></body></html>'

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '赵敏' })
  const { machine, token } = await t.seed.machine(wang.id)
  const other = await t.seed.machine(outsider.id)
  const claude = await t.seed.bot({
    ownerId: wang.id,
    name: '小王的 Claude',
    machineId: machine.id,
    binding: 'bound',
  })
  const g = await t.seed.group({ createdBy: wang.id, memberIds: [li.id], botIds: [claude.id] })
  const cookies = { li: await t.seed.cookie(li.id), outsider: await t.seed.cookie(outsider.id) }
  return { wang, li, claude, g, token, otherToken: other.token, cookies }
}

async function liveRun(w: Awaited<ReturnType<typeof world>>, status = 'running') {
  const [trigger] = await t.db
    .insert(messages)
    .values({ groupId: w.g.id, kind: 'user', authorUserId: w.wang.id, body: '@小王的 Claude 画个图' })
    .returning()
  return (
    await t.db
      .insert(runs)
      .values({
        groupId: w.g.id,
        botId: w.claude.id,
        triggerMessageId: trigger!.id,
        originUserId: w.wang.id,
        status,
        startedAt: new Date(),
      })
      .returning()
  )[0]!
}

async function publish(
  runId: string,
  token: string,
  fields: { title?: string; height?: string; heights?: string; html?: string },
) {
  const form = new FormData()
  for (const k of ['title', 'height', 'heights'] as const) if (fields[k] !== undefined) form.set(k, fields[k])
  if (fields.html !== undefined) form.set('html', new Blob([fields.html], { type: 'text/html' }), 'page.html')
  const res = await fetch(t.url(`/api/daemon/runs/${runId}/html-renders`), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  return { status: res.status, body: (await res.json()) as HtmlRenderRef & { message?: string } }
}

const botMessages = (groupId: string) =>
  t.db
    .select()
    .from(messages)
    .where(and(eq(messages.groupId, groupId), eq(messages.kind, 'bot')))

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
  return (runId: string, reply: string) =>
    ws.send(
      JSON.stringify({
        t: 'run.done',
        runId,
        outcome: 'completed',
        reply,
        filesChanged: 0,
        usage: null,
        sessionId: 'sess-1',
        newSessionReason: null,
        error: null,
        git: null,
        patch: null,
        appendsApplied: 0,
      }),
    )
}

const placed = (id: string) => `\`\`\`html-page\n{"id":"${id}"}\n\`\`\``

describe('html renders', () => {
  it('stores the page on its run, shown on the run card, without posting a message', async () => {
    const w = await world()
    const run = await liveRun(w)
    const seen = events(t, w.li.id)
    const res = await publish(run.id, w.token, {
      title: 'CPU 走势',
      height: '420',
      heights: JSON.stringify([
        [720, 400],
        [320, 610],
      ]),
      html: PAGE,
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      attachmentId: expect.any(String),
      title: 'CPU 走势',
      height: 420,
      heights: [
        [320, 610],
        [720, 400],
      ],
    })
    expect(seen).toEqual([{ t: 'run.updated', run: expect.objectContaining({ htmlRenders: [res.body] }) }])
    expect(await botMessages(w.g.id)).toEqual([])
    const timeline = await client(t, w.cookies.li).get<TimelineDto>(`/api/groups/${w.g.id}/timeline`)
    expect(timeline.body.runs.find((r) => r.id === run.id)?.htmlRenders).toEqual([res.body])
  })

  it('posts the pages with the final reply, which places them; an empty reply still carries them', async () => {
    const w = await world()
    const done = await daemon(w.token)
    const run = await liveRun(w)
    const a = (await publish(run.id, w.token, { title: '甲', height: '300', html: PAGE })).body
    const b = (await publish(run.id, w.token, { title: '乙', height: '300', html: PAGE })).body
    const seen = events(t, w.li.id)
    const reply = `先看乙\n\n${placed(b.attachmentId)}\n\n${placed(randomUUID())}\n\n结论`
    done(run.id, reply)
    await expect.poll(async () => (await botMessages(w.g.id)).length).toBe(1)
    const posted = seen.find((e) => e.t === 'message.new') as { message: MessageDto }
    expect(posted.message).toMatchObject({ body: reply, runId: run.id, htmlRenders: [a, b] })
    expect(posted.message.htmlRender).toBeUndefined()
    const bound = await t.db.select({ messageId: attachments.messageId }).from(attachments)
    expect(bound).toEqual([{ messageId: posted.message.id }, { messageId: posted.message.id }])
    await fillRunSearchText(t.ctx)
    const [searched] = await t.db.select({ s: runs.searchText }).from(runs).where(eq(runs.id, run.id))
    expect(searched?.s).toContain('乙')

    const empty = await liveRun(w)
    const c = (await publish(empty.id, w.token, { title: '丙', height: '300', html: PAGE })).body
    done(empty.id, '  ')
    await expect.poll(async () => (await botMessages(w.g.id)).length).toBe(2)
    const [last] = await t.db.select().from(messages).where(eq(messages.runId, empty.id))
    expect(last).toMatchObject({ body: '', meta: expect.objectContaining({ htmlRenders: [c] }) })
  })

  it('serves the page with its bootstrap as a sandboxed document to members only, during and after the run', async () => {
    const w = await world()
    const res = await publish((await liveRun(w)).id, w.token, { title: '图', height: '300', html: PAGE })
    const id = res.body.attachmentId
    const page = await fetch(t.url(`/api/attachments/${id}/render`), { headers: { cookie: w.cookies.li } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(page.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-forms allow-popups')
    const html = await page.text()
    expect(html).toMatch(/^<!doctype html><html><head><meta charset="utf-8">.*<style id="gg-theme">/s)
    expect(html).toContain('<h1>CPU 78%</h1>')

    const outsider = await fetch(t.url(`/api/attachments/${id}/render`), {
      headers: { cookie: w.cookies.outsider },
    })
    expect(outsider.status).toBe(404)
    const download = await fetch(t.url(`/api/attachments/${id}`), { headers: { cookie: w.cookies.li } })
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('still serves a page posted as its own message (before pages joined the reply)', async () => {
    const w = await world()
    const id = (await publish((await liveRun(w)).id, w.token, { title: '图', height: '300', html: PAGE }))
      .body.attachmentId
    await t.db.update(runs).set({ htmlRenders: [] })
    const [legacy] = await t.db
      .insert(messages)
      .values({
        groupId: w.g.id,
        kind: 'bot',
        authorBotId: w.claude.id,
        body: '图',
        meta: { htmlRender: { attachmentId: id, title: '图', height: 300 } },
      })
      .returning()
    const render = () => fetch(t.url(`/api/attachments/${id}/render`), { headers: { cookie: w.cookies.li } })
    expect((await render()).status).toBe(404)
    await t.db.update(attachments).set({ messageId: legacy!.id })
    expect((await render()).status).toBe(200)
  })

  it('renders only pages published with html_render', async () => {
    const w = await world()
    const form = new FormData()
    form.set('groupId', w.g.id)
    form.set('file', new Blob([PAGE], { type: 'text/html' }), 'x.html')
    const cookie = await t.seed.cookie(w.wang.id)
    const up = await fetch(t.url('/api/uploads'), { method: 'POST', headers: { cookie }, body: form })
    const { id } = (await up.json()) as { id: string }
    expect((await fetch(t.url(`/api/attachments/${id}/render`), { headers: { cookie } })).status).toBe(404)
  })

  it('refuses another machine, an ended run and invalid fields', async () => {
    const w = await world()
    const run = await liveRun(w)
    const ok = { title: '图', height: '300', html: PAGE }
    expect((await publish(run.id, w.otherToken, ok)).status).toBe(404)
    expect((await publish((await liveRun(w, 'completed')).id, w.token, ok)).status).toBe(404)
    expect((await publish(run.id, w.token, { ...ok, title: '' })).status).toBe(400)
    expect((await publish(run.id, w.token, { ...ok, height: '10' })).status).toBe(400)
    expect((await publish(run.id, w.token, { ...ok, heights: '[[720]]' })).status).toBe(400)
    expect((await publish(run.id, w.token, { ...ok, html: undefined })).status).toBe(400)
    expect(await t.db.select().from(attachments)).toHaveLength(0)
    expect((await t.db.select().from(runs).where(eq(runs.id, run.id)))[0]?.htmlRenders).toEqual([])
  })

  it('names placed and unplaced pages in Feishu, dropping blocks of other runs', () => {
    const pages = [
      { attachmentId: 'p1', title: '甲', height: 300 },
      { attachmentId: 'p2', title: '乙', height: 300 },
    ]
    expect(replyMarkdown(`看图\n\n${placed('p2')}\n\n${placed('x')}\n\n完`, 'https://gg/m', pages)).toBe(
      '看图\n\n📄 乙\n\n\n\n完\n\n📄 甲\n\n[在共工查看](https://gg/m)',
    )
    expect(replyMarkdown('', null, pages)).toBe('📄 甲\n📄 乙')
    expect(replyMarkdown('好了', 'https://gg/m')).toBe('好了')
  })
})
