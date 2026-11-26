import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GroupTabsDto, LinkMetaDto, TimelineDto, ToolCallRes } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupKnowledge, messages, runs } from '../src/db/schema.js'
import { embeddable, isPublicAddress, linkMeta, parseMeta } from '../src/modules/group-tabs/link-meta.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client, events } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '赵敏' })
  const { machine, token } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const g = await t.seed.group({ createdBy: wang.id, name: '支付', memberIds: [li.id], botIds: [claude.id] })
  const asWang = client(t, await t.seed.cookie(wang.id))
  const asLi = client(t, await t.seed.cookie(li.id))
  const asOutsider = client(t, await t.seed.cookie(outsider.id))
  const url = `/api/groups/${g.id}/tabs`
  const tabs = async (as = asWang) => (await as.get<GroupTabsDto>(url)).body.tabs
  const add = (as: typeof asWang, body: unknown) => as.post<GroupTabsDto & { error?: string }>(url, body)
  const timeline = async () =>
    (await asWang.get<TimelineDto>(`/api/groups/${g.id}/timeline`)).body.messages.map((m) => m.body)
  const kb = async (title: string) => {
    const [e] = await t.db.insert(groupKnowledge).values({ groupId: g.id, title, body: '正文' }).returning()
    return e!
  }
  const runOf = async () => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: g.id, kind: 'user', authorUserId: li.id, body: '@Claude 钉一下', meta: {} })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: claude.id,
        triggerMessageId: m!.id,
        originUserId: li.id,
        status: 'running',
      })
      .returning()
    return r!
  }
  const call = async (runId: string, name: string, args: unknown = {}) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${runId}/tools/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
    return res.json<ToolCallRes>()
  }
  return { wang, li, claude, g, asWang, asLi, asOutsider, url, tabs, add, timeline, kb, runOf, call }
}

describe('群标签栏', () => {
  it('any member adds, renames, reorders and deletes tabs; everyone sees them live with an event each add/delete', async () => {
    const w = await world()
    const e = await w.kb('发布流程')
    const seen = events(t, w.wang.id)

    const a = await w.add(w.asLi, { target: { kind: 'knowledge', knowledgeId: e.id } })
    expect(a.status).toBe(200)
    expect(a.body.tabs).toMatchObject([
      {
        title: '发布流程',
        target: { kind: 'knowledge', knowledgeId: e.id },
        stale: false,
        createdBy: { name: '李建国', bot: false },
      },
    ])
    await w.add(w.asWang, {
      title: '需求文档',
      target: { kind: 'file', botId: w.claude.id, path: 'docs/需求.md' },
    })
    await w.add(w.asWang, { target: { kind: 'entry', entry: 'schedules' } })
    const list = await w.tabs(w.asLi)
    expect(list.map((x) => x.title)).toEqual(['发布流程', '需求文档', '定时任务'])
    const enTabs = await t.app.inject({
      method: 'GET',
      url: w.url,
      headers: { cookie: await t.seed.cookie(w.li.id), 'accept-language': 'en' },
    })
    expect((enTabs.json() as GroupTabsDto).tabs.map((x) => x.title)).toEqual([
      '发布流程',
      '需求文档',
      'Schedules',
    ])
    expect(seen.filter((x) => x.t === 'group.tabs').at(-1)).toMatchObject({ groupId: w.g.id, tabs: list })

    const ids = list.map((x) => x.id)
    const reordered = await w.asLi.put<GroupTabsDto>(`${w.url}/order`, { ids: [ids[2], ids[0], ids[1]] })
    expect(reordered.body.tabs.map((x) => x.title)).toEqual(['定时任务', '发布流程', '需求文档'])
    const renamed = await w.asLi.patch<GroupTabsDto>(`${w.url}/${ids[1]}`, { title: '需求' })
    expect(renamed.body.tabs.map((x) => x.title)).toEqual(['定时任务', '发布流程', '需求'])
    expect((await w.asWang.del(`${w.url}/${ids[0]}`)).status).toBe(200)
    expect((await w.tabs()).map((x) => x.title)).toEqual(['定时任务', '需求'])

    const tl = await w.timeline()
    expect(tl).toContain('李建国 添加了标签：发布流程')
    expect(tl).toContain('王磊 删除了标签：发布流程')
  })

  it('outsiders get nothing; targets must belong to the group', async () => {
    const w = await world()
    expect((await w.asOutsider.get(w.url)).status).toBe(404)
    expect((await w.add(w.asOutsider, { target: { kind: 'entry', entry: 'notice' } })).status).toBe(404)
    const other = await t.seed.group({ createdBy: w.wang.id })
    const [foreign] = await t.db
      .insert(groupKnowledge)
      .values({ groupId: other.id, title: '别处', body: 'x' })
      .returning()
    expect((await w.add(w.asWang, { target: { kind: 'knowledge', knowledgeId: foreign!.id } })).status).toBe(
      404,
    )
    const stranger = await t.seed.bot({ ownerId: w.wang.id, name: 'Codex' })
    expect(
      (await w.add(w.asWang, { target: { kind: 'file', botId: stranger.id, path: 'a.md' } })).status,
    ).toBe(404)
    expect((await w.add(w.asWang, { target: { kind: 'entry', entry: 'git-log' } })).status).toBe(400)
    expect((await w.add(w.asWang, { target: { kind: 'link', url: 'javascript:alert(1)' } })).status).toBe(400)
    expect(await w.tabs()).toEqual([])
  })

  it('a deleted knowledge entry leaves its tab stale', async () => {
    const w = await world()
    const e = await w.kb('环境')
    await w.add(w.asWang, { target: { kind: 'knowledge', knowledgeId: e.id } })
    await t.db.update(groupKnowledge).set({ archivedAt: new Date() })
    expect((await w.tabs())[0]!.stale).toBe(true)
  })

  it('a reorder racing another change fails instead of dropping a tab', async () => {
    const w = await world()
    await w.add(w.asWang, { target: { kind: 'entry', entry: 'notice' } })
    await w.add(w.asWang, { target: { kind: 'entry', entry: 'pins' } })
    const [first] = await w.tabs()
    expect((await w.asWang.put(`${w.url}/order`, { ids: [first!.id] })).status).toBe(409)
  })

  it('links to the server’s own network are never fetched: the tab is named after the host', async () => {
    const w = await world()
    const hits: string[] = []
    const local = await serve(hits, '<title>内网</title>')
    const res = await w.add(w.asWang, { target: { kind: 'link', url: `http://127.0.0.1:${port(local)}/` } })
    expect(res.body.tabs[0]).toMatchObject({ title: '127.0.0.1', target: { icon: null, embeddable: true } })
    const meta = await w.asWang.post<LinkMetaDto>('/api/link-meta', {
      url: `http://localhost:${port(local)}/`,
    })
    expect(meta.body).toEqual({ title: null, icon: null, embeddable: true })
    expect(hits).toEqual([])
    local.close()
  })

  it('bots pin links, knowledge entries and their own files, and list the bar', async () => {
    const w = await world()
    const run = await w.runOf()
    expect((await w.call(run.id, 'tab_list')).text).toBe('本群还没有标签')
    const e = await w.kb('周报')
    expect((await w.call(run.id, 'tab_create', { kind: 'knowledge', knowledge_id: e.id })).text).toBe(
      '已添加群标签「周报」',
    )
    await w.call(run.id, 'tab_create', { kind: 'file', path: './out/report.html', title: '测试报告' })
    expect((await w.call(run.id, 'tab_create', { kind: 'link' })).isError).toBe(true)
    const list = await w.tabs()
    expect(list[1]).toMatchObject({
      title: '测试报告',
      target: { kind: 'file', botId: w.claude.id, path: 'out/report.html' },
      createdBy: { name: 'Claude', bot: true },
    })
    expect((await w.call(run.id, 'tab_list')).text).toBe(
      `本群标签 2 个：\n- 周报：知识库条目 id ${e.id}\n- 测试报告：文件 out/report.html`,
    )
  })
})

const port = (s: Server) => (s.address() as AddressInfo).port
function serve(hits: string[], html: string, headers: Record<string, string> = {}) {
  const s = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/moved') {
      res.writeHead(302, { location: '/page' })
      return res.end()
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers })
    res.end(html)
  })
  return new Promise<Server>((r) => s.listen(0, '127.0.0.1', () => r(s)))
}

describe('link meta', () => {
  it('reads title and favicon, follows redirects and tells whether the page may be framed', async () => {
    const hits: string[] = []
    const s = await serve(
      hits,
      '<html><head><title> 共工 &amp; 文档 </title><link rel="shortcut icon" href="/i.png"></head>',
      {
        'x-frame-options': 'SAMEORIGIN',
      },
    )
    const base = `http://127.0.0.1:${port(s)}`
    expect(await linkMeta(`${base}/moved`, { allowPrivate: true })).toEqual({
      title: '共工 & 文档',
      icon: `${base}/i.png`,
      embeddable: false,
    })
    expect(hits).toEqual(['/moved', '/page'])
    s.close()
  })

  it('parses og:title and defaults the icon to /favicon.ico', () => {
    const meta = parseMeta('<meta property="og:title" content="看板">', new URL('https://a.example/x/y'))
    expect(meta).toEqual({ title: '看板', icon: 'https://a.example/favicon.ico' })
  })

  it('frame-ancestors other than * forbid framing', () => {
    expect(embeddable({})).toBe(true)
    expect(embeddable({ 'content-security-policy': "default-src 'self'; frame-ancestors *" })).toBe(true)
    expect(embeddable({ 'content-security-policy': "frame-ancestors 'self' https://a.com" })).toBe(false)
  })

  it('only public addresses are fetched', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '0.0.0.0',
    ])
      expect(isPublicAddress(a), a).toBe(false)
    for (const a of ['93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8'])
      expect(isPublicAddress(a), a).toBe(true)
  })
})
