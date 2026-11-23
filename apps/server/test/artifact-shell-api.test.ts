import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ArtifactAssetRes,
  ArtifactHistoryDiffRes,
  ArtifactHistoryListRes,
  ArtifactPublishRes,
  ArtifactRestoreFilesRes,
  ArtifactThreadDto,
  WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, messages } from '../src/db/schema.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld } from './support/artifacts.js'

let t: TestApp
let editorsDir: string

// Minimal valid 1x1 PNG (real IHDR+IDAT+IEND with valid CRCs)
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082',
  'hex',
)
// Minimal MP4 ISO BMFF header (`ftypisom`)
const MP4_MIN = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isommp41', 'ascii'),
])
// Minimal WebM EBML header
const WEBM_MIN = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01])

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
  editorsDir = mkdtempSync(join(tmpdir(), 'gonggong-editors-'))
  mkdirSync(join(editorsDir, 'slides/assets'), { recursive: true })
  writeFileSync(
    join(editorsDir, 'slides/index.html'),
    '<!doctype html><script type="module" src="./assets/index.js"></script>',
  )
  writeFileSync(join(editorsDir, 'slides/assets/index.js'), 'console.log("slides-editor")')
  process.env.GONGGONG_EDITORS_DIR = editorsDir
})

beforeEach(async () => {
  t = await createTestApp()
  t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: 'http://app.test' }
})

afterEach(() => t.close())

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }
function previewGet(host: string, path: string, headers: Record<string, string> = {}) {
  const port = Number(new URL(t.url('/')).port)
  return new Promise<Res>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { host, ...headers } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (d) => chunks.push(d as Buffer))
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}
const cookieOf = (r: Res) => (r.headers['set-cookie'] as string[])[0]!.split(';')[0]!

async function setup() {
  const w = await artifactWorld(t)
  const a = await w.artifact({ kind: 'slides', editorVersion: 'current', title: 'S0 演示文稿' })
  const li = await t.seed.cookie(w.li.id)
  const wang = await t.seed.cookie(w.wang.id)
  const outsider = await t.seed.cookie(w.outsider.id)
  const req = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie = li,
    payload?: object | Buffer,
    headers: Record<string, string> = {},
  ) => t.app.inject({ method, url, headers: { cookie, ...headers }, payload })
  return { ...w, a, liCookie: li, wangCookie: wang, outsiderCookie: outsider, req }
}

describe('artifact.publish (per-file ifMatch, burst coalescing, WS push)', () => {
  it('checks ifMatch per file, rejects conflicts with paths, coalesces consecutive edits by same member, and broadcasts artifact.files', async () => {
    const s = await setup()
    const events: { users: string[]; ev: WebEvent }[] = []
    const origPublish = t.ctx.bus.publish.bind(t.ctx.bus)
    t.ctx.bus.publish = (users, ev) => {
      events.push({ users: [...users], ev })
      return origPublish(users, ev)
    }

    // Initial publish (v1)
    const deck1 = '{"slides":["s1","s2"]}'
    const s1v1 = '<section>Slide 1</section>'
    const s2v1 = '<section>Slide 2</section>'
    const p1 = await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
      clientId: 'tab-li',
      batch: {
        'project/deck.json': { content: deck1, ifMatch: null },
        'project/slides/s1.html': { content: s1v1, ifMatch: null },
        'project/slides/s2.html': { content: s2v1, ifMatch: null },
      },
    })
    expect(p1.statusCode).toBe(200)
    const r1 = p1.json() as ArtifactPublishRes
    expect(r1.n).toBe(1)
    expect(r1.hashes['project/slides/s1.html']).toBe(sha(s1v1))

    // Second edit by same user within 30s coalesces into v1!
    const s1v2 = '<section>Slide 1 edited</section>'
    const p2 = await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
      clientId: 'tab-li',
      batch: { 'project/slides/s1.html': { content: s1v2, ifMatch: sha(s1v1) } },
    })
    expect(p2.statusCode).toBe(200)
    const r2 = p2.json() as ArtifactPublishRes
    expect(r2.n).toBe(1)
    expect(r2.coalesced).toBe(true)
    expect(r2.versionId).toBe(r1.versionId)

    // Another user edits s2.html while head has li's s1v2 -> per-file ifMatch succeeds AND starts a new version v2!
    const s2v2 = '<section>Slide 2 by Wang</section>'
    const p3 = await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.wangCookie, {
      clientId: 'tab-wang',
      batch: { 'project/slides/s2.html': { content: s2v2, ifMatch: sha(s2v1) } },
    })
    expect(p3.statusCode).toBe(200)
    const r3 = p3.json() as ArtifactPublishRes
    expect(r3.n).toBe(2)
    expect(r3.coalesced).toBeFalsy()

    // Stale ifMatch on s2.html returns 409 with conflict paths and writes nothing!
    const bad = await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
      batch: { 'project/slides/s2.html': { content: 'conflict', ifMatch: sha(s2v1) } },
    })
    expect(bad.statusCode).toBe(409)
    expect(bad.json()).toMatchObject({
      error: 'conflict',
      paths: [{ path: 'project/slides/s2.html', expected: sha(s2v1), actual: sha(s2v2) }],
    })

    // Deleting a file with null works and broadcasts change as null hash
    const del = await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
      clientId: 'tab-li',
      batch: { 'project/slides/s2.html': null },
    })
    expect(del.statusCode).toBe(200)
    expect((del.json() as ArtifactPublishRes).hashes['project/slides/s2.html']).toBeNull()

    // Check artifact.files WS events
    const fileEvents = events.filter((e) => e.ev.t === 'artifact.files')
    expect(fileEvents.length).toBeGreaterThanOrEqual(4)
    expect(fileEvents.at(-1)?.ev).toMatchObject({
      t: 'artifact.files',
      artifactId: s.a.id,
      changes: { 'project/slides/s2.html': null },
      clientId: 'tab-li',
    })

    // Team read-only viewer gets 403 on publish
    await t.db.update(artifacts).set({ visibility: 'team' }).where(eq(artifacts.id, s.a.id))
    expect(
      (
        await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.outsiderCookie, {
          batch: { 'project/deck.json': { content: '{}' } },
        })
      ).statusCode,
    ).toBe(403)
  })

  it('starts a new version after a 30s pause for the same member', async () => {
    const s = await setup()
    let now = new Date('2026-11-23T02:00:00.000Z')
    t.ctx.now = () => now
    const p1 = (
      await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
        batch: { 'project/a.txt': { content: 'v1', ifMatch: null } },
      })
    ).json() as ArtifactPublishRes
    expect(p1.n).toBe(1)

    now = new Date('2026-11-23T02:00:35.000Z')
    const p2 = (
      await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
        batch: { 'project/a.txt': { content: 'v2', ifMatch: sha('v1') } },
      })
    ).json() as ArtifactPublishRes
    expect(p2.n).toBe(2)
    expect(p2.coalesced).toBeFalsy()
  })
})

describe('assets.upload (images + videos, 32-hex id, /_blob/ serving & version promotion)', () => {
  it('accepts PNG and MP4/WebM, rejects SVG, serves /_blob/<32hex> immediately and promotes into published version', async () => {
    const s = await setup()
    // Initial empty version so preview can open
    await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
      batch: { 'project/deck.json': { content: '{}', ifMatch: null } },
    })

    // Upload PNG
    const upPng = await s.req('POST', `/api/artifacts/${s.a.id}/assets`, s.liCookie, PNG_1X1, {
      'content-type': 'image/png',
    })
    expect(upPng.statusCode).toBe(200)
    const pngAsset = upPng.json() as ArtifactAssetRes
    expect(pngAsset.id).toBe(sha(PNG_1X1).slice(0, 32))
    expect(pngAsset.url).toBe(`/_blob/${pngAsset.id}`)
    expect(pngAsset.contentType).toBe('image/png')

    // Upload MP4 & WebM
    const upMp4 = await s.req('POST', `/api/artifacts/${s.a.id}/assets`, s.liCookie, MP4_MIN, {
      'content-type': 'video/mp4',
    })
    expect(upMp4.statusCode).toBe(200)
    const mp4Asset = upMp4.json() as ArtifactAssetRes
    expect(mp4Asset.id).toBe(sha(MP4_MIN).slice(0, 32))
    expect(mp4Asset.contentType).toBe('video/mp4')

    const upWebm = await s.req('POST', `/api/artifacts/${s.a.id}/assets`, s.liCookie, WEBM_MIN, {
      'content-type': 'video/webm',
    })
    expect(upWebm.statusCode).toBe(200)

    // Reject SVG & spoofed video
    expect(
      (
        await s.req('POST', `/api/artifacts/${s.a.id}/assets`, s.liCookie, Buffer.from('<svg></svg>'), {
          'content-type': 'image/svg+xml',
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await s.req('POST', `/api/artifacts/${s.a.id}/assets`, s.liCookie, Buffer.from('not a video'), {
          'content-type': 'video/mp4',
        })
      ).statusCode,
    ).toBe(400)

    // Open preview and fetch staged /_blob/<id> BEFORE publish
    const opened = (await s.req('POST', `/api/artifacts/${s.a.id}/preview`, s.liCookie, {})).json() as {
      origin: string
      url: string
    }
    const host = new URL(opened.origin).host
    const hop = await s.req('GET', opened.url, s.liCookie)
    const authRes = await previewGet(
      host,
      new URL(hop.headers.location as string).pathname + new URL(hop.headers.location as string).search,
    )
    const pvCookie = cookieOf(authRes)

    const blobBefore = await previewGet(host, pngAsset.url, { cookie: pvCookie })
    expect(blobBefore.status).toBe(200)
    expect(blobBefore.headers['content-type']).toBe('image/png')
    expect(blobBefore.headers['x-content-type-options']).toBe('nosniff')
    expect(blobBefore.body.equals(PNG_1X1)).toBe(true)

    // Publish slide referencing both /_blob/<png> and /_blob/<mp4>: both are promoted into version files!
    const html = `<img src="${pngAsset.url}"><video src="${mp4Asset.url}"></video>`
    const pub = (
      await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.wangCookie, {
        batch: { 'project/slides/s1.html': { content: html, ifMatch: null } },
      })
    ).json() as ArtifactPublishRes
    const detail = (
      await s.req('GET', `/api/artifacts/${s.a.id}/versions/${pub.versionId}`, s.liCookie)
    ).json() as {
      files: { path: string; hash: string }[]
    }
    expect(detail.files.map((f) => f.path)).toContain(`_blob/${pngAsset.id}`)
    expect(detail.files.map((f) => f.path)).toContain(`_blob/${mp4Asset.id}`)

    // Video served with sniffed video/mp4 MIME
    const vidRes = await previewGet(host, mp4Asset.url, { cookie: pvCookie })
    expect(vidRes.status).toBe(200)
    expect(vidRes.headers['content-type']).toBe('video/mp4')
  })
})

describe('history APIs (list, files, diff, partial restore) & read-only file reads', () => {
  it('lists versions with file ops, diffs a path, and partially restores selected paths as a new version', async () => {
    const s = await setup()
    let now = new Date('2026-11-23T03:00:00.000Z')
    t.ctx.now = () => now

    const v1 = (
      await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
        batch: {
          'project/a.txt': { content: 'a-v1', ifMatch: null },
          'project/b.txt': { content: 'b-v1', ifMatch: null },
        },
      })
    ).json() as ArtifactPublishRes

    now = new Date('2026-11-23T03:02:00.000Z')
    const v2 = (
      await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.wangCookie, {
        batch: {
          'project/a.txt': { content: 'a-v2', ifMatch: sha('a-v1') },
          'project/b.txt': { content: 'b-v2', ifMatch: sha('b-v1') },
        },
      })
    ).json() as ArtifactPublishRes

    const hist = (
      await s.req('GET', `/api/artifacts/${s.a.id}/versions/history`, s.liCookie)
    ).json() as ArtifactHistoryListRes
    expect(hist.canRestore).toBe(true)
    expect(hist.versions.map((v) => v.n)).toEqual([2, 1])
    expect(hist.versions[0]).toMatchObject({
      n: 2,
      current: true,
      author: { kind: 'person', name: '王磊' },
      files: [
        { path: 'project/a.txt', op: 'edited' },
        { path: 'project/b.txt', op: 'edited' },
      ],
    })

    const listing = (
      await s.req('GET', `/api/artifacts/${s.a.id}/versions/by-number/1/files`, s.liCookie)
    ).json() as Record<string, { sha256: string; size: number }>
    expect(listing['project/a.txt']?.sha256).toBe(sha('a-v1'))

    const diff = (
      await s.req(
        'GET',
        `/api/artifacts/${s.a.id}/versions/${v2.versionId}/diff?path=project/a.txt`,
        s.liCookie,
      )
    ).json() as ArtifactHistoryDiffRes
    expect(diff).toEqual({
      path: 'project/a.txt',
      n: 2,
      op: 'edited',
      before: 'a-v1',
      after: 'a-v2',
    })

    // Partial restore: only restore project/a.txt from v1, keep project/b.txt at v2!
    const restored = (
      await s.req('POST', `/api/artifacts/${s.a.id}/versions/${v1.versionId}/restore-files`, s.liCookie, {
        paths: ['project/a.txt'],
      })
    ).json() as ArtifactRestoreFilesRes
    expect(restored).toEqual({ version: 3, changed: ['project/a.txt'] })
    expect((await s.req('GET', `/api/artifacts/${s.a.id}/files/project/a.txt`, s.liCookie)).body).toBe('a-v1')
    expect((await s.req('GET', `/api/artifacts/${s.a.id}/files/project/b.txt`, s.liCookie)).body).toBe('b-v2')

    // Read-only team viewer can read files & history (canRestore: false), cannot restore-files
    await t.db.update(artifacts).set({ visibility: 'team' }).where(eq(artifacts.id, s.a.id))
    const teamFile = await s.req('GET', `/api/artifacts/${s.a.id}/files/project/a.txt`, s.outsiderCookie)
    expect(teamFile.statusCode).toBe(200)
    expect(teamFile.body).toBe('a-v1')
    const teamHist = (
      await s.req('GET', `/api/artifacts/${s.a.id}/versions/history`, s.outsiderCookie)
    ).json() as ArtifactHistoryListRes
    expect(teamHist.canRestore).toBe(false)
    expect(
      (
        await s.req(
          'POST',
          `/api/artifacts/${s.a.id}/versions/${v1.versionId}/restore-files`,
          s.outsiderCookie,
          {
            paths: ['project/a.txt'],
          },
        )
      ).statusCode,
    ).toBe(403)
  })
})

describe('preview origin /__oa/<type>@<ver>/ serving, project/* passthrough & CSP', () => {
  it('serves platform editor assets with CSP and nosniff, and maps project/* to artifact version files', async () => {
    const s = await setup()
    await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
      batch: {
        'project/ds/theme/tokens.json': { content: '{"primary":"#0055ff"}', ifMatch: null },
      },
    })
    const opened = (await s.req('POST', `/api/artifacts/${s.a.id}/preview`, s.liCookie, {})).json() as {
      origin: string
      url: string
    }
    const host = new URL(opened.origin).host
    const hop = await s.req('GET', opened.url, s.liCookie)
    const authRes = await previewGet(
      host,
      new URL(hop.headers.location as string).pathname + new URL(hop.headers.location as string).search,
    )
    const pvCookie = cookieOf(authRes)

    const editorHtml = await previewGet(host, '/__oa/slides@current/index.html', { cookie: pvCookie })
    expect(editorHtml.status).toBe(200)
    expect(editorHtml.headers['content-type']).toContain('text/html')
    expect(editorHtml.headers['x-content-type-options']).toBe('nosniff')
    expect(editorHtml.headers['content-security-policy']).toContain("'wasm-unsafe-eval'")
    expect(editorHtml.headers['content-security-policy']).toContain('frame-ancestors http://app.test')
    expect(editorHtml.body.toString('utf8')).toContain('assets/index.js')

    const editorJs = await previewGet(host, '/__oa/slides@current/assets/index.js', { cookie: pvCookie })
    expect(editorJs.status).toBe(200)
    expect(editorJs.headers['cache-control']).toContain('immutable')

    // project/* inside editor path maps to the artifact version's files!
    const tokens = await previewGet(host, '/__oa/slides@current/project/ds/theme/tokens.json', {
      cookie: pvCookie,
    })
    expect(tokens.status).toBe(200)
    expect(tokens.body.toString('utf8')).toBe('{"primary":"#0055ff"}')

    // Traversal and unknown editor types are rejected
    expect(
      (await previewGet(host, '/__oa/slides@current/../../etc/passwd', { cookie: pvCookie })).status,
    ).toBe(404)
    expect((await previewGet(host, '/__oa/unknown@current/index.html', { cookie: pvCookie })).status).toBe(
      404,
    )
  })
})

describe('thread WS push & agent-send', () => {
  it('broadcasts artifact.threads on mutations and posts fenced agent-send to artifact AI chat', async () => {
    const s = await setup()
    await s.req('POST', `/api/artifacts/${s.a.id}/publish`, s.liCookie, {
      batch: { 'project/deck.json': { content: '{}', ifMatch: null } },
    })
    const events: WebEvent[] = []
    const origPublish = t.ctx.bus.publish.bind(t.ctx.bus)
    t.ctx.bus.publish = (users, ev) => {
      events.push(ev)
      return origPublish(users, ev)
    }

    const made = (
      await s.req('POST', `/api/artifacts/${s.a.id}/threads`, s.liCookie, {
        anchor: '{"slide":"s1"}',
        label: 'Slide 1',
        text: '改标题',
      })
    ).json() as ArtifactThreadDto
    expect(events.filter((e) => e.t === 'artifact.threads')).toHaveLength(1)

    await s.req('PATCH', `/api/artifact-threads/${made.id}`, s.wangCookie, { status: 'resolved' })
    expect(events.filter((e) => e.t === 'artifact.threads')).toHaveLength(2)

    const sent = await s.req('POST', `/api/artifacts/${s.a.id}/agent-send`, s.liCookie, {
      text: '把第一页标题放大',
      title: 'Ask agent',
      context: { view: { slideId: 's1' } },
    })
    expect(sent.statusCode).toBe(200)
    const sentBody = sent.json() as { status: string; messageId?: string }
    expect(['delivered', 'queued']).toContain(sentBody.status)
    expect(sentBody.messageId).toBeTruthy()
    const [row] = await t.db.select().from(messages).where(eq(messages.id, sentBody.messageId!))
    expect((row!.meta as { artifactNote?: string }).artifactNote).toContain('slideId')
    expect((row!.meta as { artifactNote?: string }).artifactNote).toContain('UNTRUSTED')
  })
})
