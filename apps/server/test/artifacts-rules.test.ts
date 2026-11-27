import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ArtifactDto,
  ArtifactFile,
  ArtifactLinkMetaRes,
  ArtifactSubmitRes,
  GgArtifactManifest,
  MessageDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifactVersions, messages } from '../src/db/schema.js'
import { artifactLinkMeta, isFeishuDoc } from '../src/modules/artifacts/link-meta.js'
import { lintVersion } from '../src/modules/artifacts/lint.js'
import type { MessageMeta } from '../src/modules/messages/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, L1 } from './support/artifacts.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const HOME = `<!doctype html>
<html><body>
  <h1 class="t">立即报名</h1>
  <button class="pay" data-gg-anchor="old">付款</button>
</body></html>
`
const id = (html: string, needle: string) => String(html.indexOf(needle))

async function setup(extra: Record<string, string> = {}) {
  const w = await artifactWorld(t)
  const a = await w.artifact()
  const prev = await w.run([a.id], { status: 'succeeded' })
  const v1 = (
    await w.submit(prev.id, a.id, { ...L1, 'screens/home.html': HOME, ...extra })
  ).json() as ArtifactSubmitRes
  const cookie = await t.seed.cookie(w.li.id)
  const req = (method: 'GET' | 'POST', url: string, payload?: object, c = cookie) =>
    t.app.inject({ method, url, headers: { cookie: c }, payload })
  const head = async () => (await req('GET', `/api/artifacts/${a.id}`)).json() as ArtifactDto
  const edit = async (ops: unknown[]) =>
    req('POST', `/api/artifacts/${a.id}/edits`, { baseVersionId: (await head()).headVersionId, ops })
  const file = async (path: string) => req('GET', `/api/artifacts/${a.id}/files/${path}`)
  const paths = async () => {
    const [v] = await t.db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.id, (await head()).headVersionId!))
    return v!.files.map((f) => f.path).sort()
  }
  const manifest = async () => JSON.parse((await file('gg-artifact.json')).body) as GgArtifactManifest
  const meta = async (mid: string) =>
    (await t.db.select().from(messages).where(eq(messages.id, mid)))[0]!.meta as MessageMeta
  return { ...w, a, v1, cookie, req, head, edit, file, paths, manifest, meta }
}

describe('page business rules', () => {
  it('anchors an element and writes its rule file in one version; empty values remove both', async () => {
    const s = await setup()
    const rules = '# 首页\n\n1. **付款按钮** `#pay-btn` [待确认]：余额不足时置灰\n'
    const res = await s.edit([
      {
        kind: 'attr',
        file: 'screens/home.html',
        ggId: id(HOME, '<h1'),
        name: 'data-gg-anchor',
        value: 'pay-btn',
      },
      { kind: 'file', path: 'rules/home.md', content: rules },
    ])
    expect(res.statusCode).toBe(200)
    expect((res.json() as ArtifactDto).head?.n).toBe(2)
    const html = (await s.file('screens/home.html')).body
    expect(html).toContain('<h1 class="t" data-gg-anchor="pay-btn">')
    expect((await s.file('rules/home.md')).body).toBe(rules)

    const cleared = await s.edit([
      {
        kind: 'attr',
        file: 'screens/home.html',
        ggId: id(html, '<button'),
        name: 'data-gg-anchor',
        value: '',
      },
      { kind: 'file', path: 'rules/home.md', content: '  \n' },
    ])
    expect(cleared.statusCode).toBe(200)
    expect((await s.file('screens/home.html')).body).toContain('<button class="pay">付款</button>')
    expect(await s.paths()).not.toContain('rules/home.md')
  })

  it('refuses bad anchors and rule paths', async () => {
    const s = await setup()
    const h1 = { file: 'screens/home.html', ggId: id(HOME, '<h1') }
    for (const op of [
      { kind: 'attr', ...h1, name: 'data-gg-anchor', value: 'Pay Btn' },
      { kind: 'file', path: 'rules/../x.md', content: 'x' },
      { kind: 'file', path: 'rules/home.txt', content: 'x' },
    ])
      expect((await s.edit([op])).statusCode).toBe(400)
  })

  it('copies a screen’s rules with it and drops them with it', async () => {
    const s = await setup({ 'rules/home.md': '1. 整页规则\n', 'rules/shared.md': '## S1 金额\n取整\n' })
    expect((await s.edit([{ kind: 'manifest', op: 'duplicate', screenId: 'home' }])).statusCode).toBe(200)
    expect((await s.file('rules/home-copy.md')).body).toBe('1. 整页规则\n')
    expect((await s.edit([{ kind: 'manifest', op: 'delete', screenId: 'home' }])).statusCode).toBe(200)
    expect(await s.paths()).toEqual(expect.arrayContaining(['rules/home-copy.md', 'rules/shared.md']))
    expect(await s.paths()).not.toContain('rules/home.md')
  })

  it('lints rules naming missing anchors or shared rules', async () => {
    const files: Record<string, string> = {
      ...L1,
      'screens/home.html': '<button data-gg-anchor="pay">付</button>',
      'rules/home.md': '1. **付款** `#pay`：见 S1\n2. **优惠** `#coupon`：见 S2、S1\n',
      'rules/shared.md': '# 共享\n\n## S1 金额取整\n四舍五入\n',
    }
    const list: ArtifactFile[] = Object.keys(files).map((path) => ({ path, hash: path, size: 1 }))
    const issues = await lintVersion(list, async (f) => Buffer.from(files[f.path]!), null)
    expect(issues.filter((i) => i.code.startsWith('rule-'))).toEqual([
      {
        code: 'rule-anchor-missing',
        file: 'rules/home.md',
        message: expect.stringContaining('#coupon'),
        severity: 'warn',
      },
      {
        code: 'rule-shared-missing',
        file: 'rules/home.md',
        message: expect.stringContaining('S2'),
        severity: 'warn',
      },
    ])
  })

  it('asks the agent to complete the rules, and hands it a screen’s rules with the canvas context', async () => {
    const s = await setup({
      'rules/home.md': '1. **付款** `#old`：金额按 S1\n2. **库存** [待确认]：售罄后建议隐藏\n',
      'rules/shared.md': '## S1 金额取整\n四舍五入到分\n\n## S2 无关\nx\n',
    })
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, {
      command: 'complete-rules',
      botId: s.bot.id,
      screenIds: ['home'],
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg.body).toBe('@小王的 Claude 补全业务规则\n「活动报名」 › 首页')
    const note = (await s.meta(msg.id)).artifactNote ?? ''
    expect(note).toContain('rules/<屏幕 id>.md')
    expect(note).toContain('data-gg-anchor')
    expect(note).toContain('[待确认]')
    expect(note).toContain('rules/shared.md')
    expect(note).toContain('1. **付款** `#old`：金额按 S1')
    expect(note).toMatch(/未定[^\n]*\n2\. \*\*库存\*\* \[待确认\]：售罄后建议隐藏/)
    expect(note).toContain('## S1 金额取整\n四舍五入到分')
    expect(note).not.toContain('S2 无关')
  })
})

describe('page documents (页面文档)', () => {
  it('saves a page’s document as docs/<id>.md, copies and drops it with the page, and an empty one goes', async () => {
    const s = await setup()
    expect(
      (await s.edit([{ kind: 'file', path: 'docs/home.md', content: '# 首页\n\n- 报名入口\n' }])).statusCode,
    ).toBe(200)
    expect((await s.file('docs/home.md')).body).toBe('# 首页\n\n- 报名入口\n')
    expect((await s.edit([{ kind: 'file', path: 'docs/../x.md', content: 'x' }])).statusCode).toBe(400)
    expect((await s.edit([{ kind: 'manifest', op: 'duplicate', screenId: 'home' }])).statusCode).toBe(200)
    expect((await s.file('docs/home-copy.md')).body).toBe('# 首页\n\n- 报名入口\n')
    expect((await s.edit([{ kind: 'file', path: 'docs/home-copy.md', content: '  ' }])).statusCode).toBe(200)
    expect(await s.paths()).not.toContain('docs/home-copy.md')
    expect((await s.edit([{ kind: 'manifest', op: 'delete', screenId: 'home' }])).statusCode).toBe(200)
    expect(await s.paths()).not.toContain('docs/home.md')
  })

  it('asks the agent to write the page documents, and hands a page’s document to every change of it', async () => {
    const s = await setup({ 'docs/home.md': '# 首页 PRD\n报名截止后按钮置灰\n' })
    const res = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, {
      command: 'write-doc',
      botId: s.bot.id,
      screenIds: ['home'],
    })
    expect(res.statusCode).toBe(200)
    const msg = res.json() as MessageDto
    expect(msg.body).toBe('@小王的 Claude 编写页面文档\n「活动报名」 › 首页')
    const note = (await s.meta(msg.id)).artifactNote ?? ''
    expect(note).toContain('docs/<屏幕 id>.md')
    expect(note).toContain('报名截止后按钮置灰')
    const edit = await s.req('POST', `/api/artifacts/${s.a.id}/commands`, {
      command: 'edit-with-ai',
      botId: s.bot.id,
      screenIds: ['home'],
      text: '换个配色',
    })
    const editNote = (await s.meta((edit.json() as MessageDto).id)).artifactNote ?? ''
    expect(editNote).toContain('屏幕 home 的页面文档（docs/home.md，')
    expect(editNote).toContain('报名截止后按钮置灰')
  })
})

describe('canvas links', () => {
  const add = (title: string, url = 'https://example.com/a') => ({
    kind: 'link',
    url,
    title,
    display: 'embed',
    ratio: '16:9',
  })

  it('adds links with unique ids from the title or host, updates, moves and deletes them', async () => {
    const s = await setup()
    expect(
      (
        await s.edit([
          add('Product Spec'),
          add('Product Spec'),
          { ...add('需求文档', 'https://www.feishu.cn/docx/abc'), x: 10, y: 20 },
        ])
      ).statusCode,
    ).toBe(200)
    expect((await s.manifest()).links).toEqual([
      {
        id: 'product-spec',
        url: 'https://example.com/a',
        title: 'Product Spec',
        display: 'embed',
        ratio: '16:9',
      },
      {
        id: 'product-spec-2',
        url: 'https://example.com/a',
        title: 'Product Spec',
        display: 'embed',
        ratio: '16:9',
      },
      {
        id: 'feishu-cn',
        url: 'https://www.feishu.cn/docx/abc',
        title: '需求文档',
        display: 'embed',
        ratio: '16:9',
        x: 10,
        y: 20,
      },
    ])

    const res = await s.edit([
      {
        kind: 'link-update',
        id: 'product-spec',
        title: '规格',
        ratio: 'free',
        w: 600,
        h: 400,
        display: 'card',
      },
      { kind: 'link-move', id: 'product-spec-2', x: -5, y: 7 },
      { kind: 'link-delete', id: 'feishu-cn' },
    ])
    expect(res.statusCode).toBe(200)
    expect((res.json() as ArtifactDto).head?.n).toBe(3)
    let links = (await s.manifest()).links
    expect(links).toEqual([
      expect.objectContaining({
        id: 'product-spec',
        title: '规格',
        ratio: 'free',
        w: 600,
        h: 400,
        display: 'card',
      }),
      expect.objectContaining({ id: 'product-spec-2', x: -5, y: 7 }),
    ])
    expect((await s.edit([{ kind: 'link-update', id: 'product-spec', h: null }])).statusCode).toBe(200)
    links = (await s.manifest()).links
    expect(links?.[0]).not.toHaveProperty('h')
    expect(links?.[0]?.w).toBe(600)

    expect((await s.edit([{ kind: 'link-move', id: 'nope', x: 0, y: 0 }])).statusCode).toBe(400)
  })

  it('refuses more links than the manifest holds', async () => {
    const s = await setup()
    const many = Array.from({ length: 51 }, () => add('x'))
    expect((await s.edit(many.slice(0, 50))).statusCode).toBe(200)
    expect((await s.edit([add('x')])).statusCode).toBe(400)
  })

  it('reads a link’s title for members of the artifact, never from the server’s own network', async () => {
    const s = await setup()
    let hit = 0
    const server = createServer((_, res) => {
      hit++
      res.end('<title>secret</title>')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    try {
      const url = `/api/artifacts/${s.a.id}/link-meta`
      const local = await s.req('POST', url, { url: `http://127.0.0.1:${port}/` })
      expect(local.json()).toEqual({ title: null, embeddable: true })
      expect(hit).toBe(0)
      expect((await s.req('POST', url, { url: 'https://x.feishu.cn/docx/abc' })).json()).toEqual({
        title: null,
        embeddable: true,
      })
      expect((await s.req('POST', url, { url: 'javascript:alert(1)' })).statusCode).toBe(400)
      const outsider = await t.seed.cookie(s.outsider.id)
      expect((await s.req('POST', url, { url: 'https://example.com' }, outsider)).statusCode).toBe(404)
    } finally {
      server.close()
    }
  })

  it('takes the title from the page, says whether it can be framed, and trusts Feishu docs', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/moved') {
        res.writeHead(302, { location: '/page' })
        return res.end()
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        ...(req.url === '/page' && { 'x-frame-options': 'SAMEORIGIN' }),
      })
      res.end(req.url === '/page' ? `<title>${'标题'.repeat(100)}</title>` : '<title> A &amp; B </title>')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const moved: ArtifactLinkMetaRes = await artifactLinkMeta(`${base}/moved`, { allowPrivate: true })
      expect(moved.embeddable).toBe(false)
      expect(moved.title).toBe('标题'.repeat(60))
      expect(await artifactLinkMeta(`${base}/open`, { allowPrivate: true })).toEqual({
        title: 'A & B',
        embeddable: true,
      })
    } finally {
      server.close()
    }
    for (const host of ['feishu.cn', 'a.feishu.cn', 'x.larksuite.com', 'y.larkoffice.com', 'z.feishu.net'])
      expect(isFeishuDoc(new URL(`https://${host}/docx/1`))).toBe(true)
    for (const host of ['feishu.cn.evil.com', 'notfeishu.cn', 'example.com'])
      expect(isFeishuDoc(new URL(`https://${host}/docx/1`))).toBe(false)
  })
})
