import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessageDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { attachments, messages, runs } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
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
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
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
  return { status: res.status, body: (await res.json()) as MessageDto & { message?: string } }
}

describe('html renders', () => {
  it('posts the page as its own bot message and broadcasts it', async () => {
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
    expect(res.body).toMatchObject({
      kind: 'bot',
      authorId: w.claude.id,
      body: 'CPU 走势',
      runId: run.id,
      attachments: [],
      htmlRender: {
        attachmentId: expect.any(String),
        title: 'CPU 走势',
        height: 420,
        heights: [
          [320, 610],
          [720, 400],
        ],
      },
    })
    expect(seen).toEqual([{ t: 'message.new', message: res.body }])
    const timeline = await client(t, w.cookies.li).get<{ messages: MessageDto[] }>(
      `/api/groups/${w.g.id}/timeline`,
    )
    expect(timeline.body.messages.at(-1)?.htmlRender).toEqual(res.body.htmlRender)
  })

  it('serves the page with its bootstrap as a sandboxed document to members only', async () => {
    const w = await world()
    const res = await publish((await liveRun(w)).id, w.token, { title: '图', height: '300', html: PAGE })
    const id = res.body.htmlRender!.attachmentId
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
    expect(await t.db.select().from(messages).where(eq(messages.kind, 'bot'))).toHaveLength(0)
  })
})
