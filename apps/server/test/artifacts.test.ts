import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ARTIFACT_MAX_FILES,
  type ArtifactCard,
  type ArtifactDto,
  type ArtifactSubmitRes,
  type ArtifactVersionDetail,
  type ArtifactVersionSummary,
  type MessageDto,
  type WebEvent,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, artifactVersions, messages, runs } from '../src/db/schema.js'
import { lintVersion } from '../src/modules/artifacts/lint.js'
import { createTestApp, type TestApp } from './support/app.js'
import { artifactWorld, fileList, L1, MANIFEST } from './support/artifacts.js'
import { sha } from './support/sync.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const json = <T>(res: { json: () => unknown }) => res.json() as T
const head = async (id: string) => (await t.db.select().from(artifacts).where(eq(artifacts.id, id)))[0]!

describe('version submit', () => {
  it('makes the first version the head, then advances it from the head', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const run = await w.run([a.id])

    const first = await w.submit(run.id, a.id, L1)
    expect(first.statusCode).toBe(200)
    const v1 = json<ArtifactSubmitRes>(first)
    expect(v1).toMatchObject({ n: 1, head: true, stale: false })
    expect((await head(a.id)).headVersionId).toBe(v1.versionId)

    const second = await w.submit(
      run.id,
      a.id,
      { ...L1, 'tokens.css': ':root { --color-primary: #000; }' },
      {
        parent: v1.versionId,
      },
    )
    const v2 = json<ArtifactSubmitRes>(second)
    expect(v2).toMatchObject({ n: 2, head: true, stale: false })
    const [row] = await t.db.select().from(artifactVersions).where(eq(artifactVersions.id, v2.versionId))
    expect(row).toMatchObject({ parentVersionId: v1.versionId, source: 'run', runId: run.id, issues: [] })
    expect(row!.files.map((f) => f.path)).toEqual([
      'gg-artifact.json',
      'screens/done.html',
      'screens/home.html',
      'tokens.css',
    ])
    expect(row!.digest).toMatch(/^[0-9a-f]{64}$/)
    expect((await head(a.id)).headVersionId).toBe(v2.versionId)
  })

  it('keeps a version based on an older head as a stale candidate', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const run = await w.run([a.id])
    const v1 = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1))
    const v2 = json<ArtifactSubmitRes>(
      await w.submit(run.id, a.id, { ...L1, 'a.txt': '2' }, { parent: v1.versionId }),
    )
    const v3 = json<ArtifactSubmitRes>(
      await w.submit(run.id, a.id, { ...L1, 'a.txt': '3' }, { parent: v1.versionId, source: 'local' }),
    )
    expect(v3).toMatchObject({ n: 3, head: false, stale: true })
    expect((await head(a.id)).headVersionId).toBe(v2.versionId)
    const [row] = await t.db.select().from(artifactVersions).where(eq(artifactVersions.id, v3.versionId))
    expect(row!.source).toBe('local')
  })

  it('answers a retried submit key with the version it made', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const run = await w.run([a.id])
    const key = crypto.randomUUID()
    const first = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1, { key }))
    const again = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1, { key }))
    expect(again).toEqual(first)
    expect(await t.db.select().from(artifactVersions)).toHaveLength(1)
  })

  it('lets only one of two concurrent submits on the same parent advance the head', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const run = await w.run([a.id])
    const v1 = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1))
    const both = (
      await Promise.all([
        w.submit(run.id, a.id, { ...L1, 'x.txt': 'x' }, { parent: v1.versionId }),
        w.submit(run.id, a.id, { ...L1, 'y.txt': 'y' }, { parent: v1.versionId }),
      ])
    ).map((r) => json<ArtifactSubmitRes>(r))
    expect(both.map((r) => r.head).sort()).toEqual([false, true])
    expect(both.map((r) => r.n).sort()).toEqual([2, 3])
    expect((await head(a.id)).headVersionId).toBe(both.find((r) => r.head)!.versionId)
  })

  it('refuses a parent of another artifact, unsafe paths, missing blobs and versions over the limits', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const b = await w.artifact()
    const run = await w.run([a.id, b.id])
    const vb = json<ArtifactSubmitRes>(await w.submit(run.id, b.id, L1))
    expect((await w.submit(run.id, a.id, L1, { parent: vb.versionId })).statusCode).toBe(400)

    const raw = (files: unknown) =>
      t.app.inject({
        method: 'POST',
        url: `${w.base(run.id, a.id)}/versions`,
        headers: w.auth(),
        payload: { parentVersionId: null, submitKey: crypto.randomUUID(), files },
      })
    const one = (path: string) => [{ path, hash: sha('x'), size: 1 }]
    await w.put(run.id, a.id, 'x')
    for (const path of [
      '../evil.html',
      '/etc/passwd',
      'screens\\home.html',
      'a/../../b',
      'screens/./x',
      '.env',
      'assets/.DS_Store',
      'node_modules/x/index.js',
    ])
      expect((await raw(one(path))).statusCode, path).toBe(400)
    expect((await raw([{ path: 'big.bin', hash: sha('x'), size: 11 * 1024 * 1024 }])).statusCode).toBe(400)
    const many = Array.from({ length: ARTIFACT_MAX_FILES + 1 }, (_, i) => ({
      path: `f${i}`,
      hash: sha('x'),
      size: 1,
    }))
    expect((await raw(many)).statusCode).toBe(400)
    const heavy = Array.from({ length: 6 }, (_, i) => ({
      path: `f${i}`,
      hash: sha('x'),
      size: 9 * 1024 * 1024,
    }))
    expect((await raw(heavy)).statusCode).toBe(400)
    // Declared but never uploaded, or uploaded with another size.
    expect((await raw([{ path: 'a.txt', hash: sha('never'), size: 5 }])).statusCode).toBe(400)
    expect((await raw([{ path: 'a.txt', hash: sha('x'), size: 2 }])).statusCode).toBe(400)
    expect(await t.db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, a.id))).toEqual(
      [],
    )
  })

  it('records design-rule issues without refusing the version', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const run = await w.run([a.id])
    const res = await w.submit(run.id, a.id, {
      ...L1,
      'screens/home.html':
        '<a data-gg-link="nowhere" style="color:#ff0000">x</a><style>.a{background:rgb(0,0,0)}</style><script src="https://cdn.example.com/x.js"></script>',
    })
    expect(res.statusCode).toBe(200)
    const [row] = await t.db.select().from(artifactVersions)
    expect(row!.issues.map((i) => [i.code, i.file])).toEqual([
      ['link-missing', 'screens/home.html'],
      ['hardcoded-color', 'screens/home.html'],
      ['external-resource', 'screens/home.html'],
    ])
  })
})

describe('lint', () => {
  const read = (files: Record<string, string>) => async (f: { path: string }) =>
    Buffer.from(files[f.path] ?? '')
  const lint = (files: Record<string, string>, kit: Map<string, Buffer> | null = null) =>
    lintVersion(fileList(files), read(files), kit)
  const codes = async (files: Record<string, string>, kit?: Map<string, Buffer>) =>
    (await lint(files, kit)).map((i) => i.code)

  it('passes a clean L1 artifact and a single-page L0 one', async () => {
    expect(await lint(L1)).toEqual([])
    expect(await lint({ 'index.html': '<h1>hi</h1>' })).toEqual([])
  })

  it('checks the manifest, its screens and the entry of an L0 artifact', async () => {
    expect(await codes({ ...L1, 'gg-artifact.json': '{' })).toEqual(['manifest-invalid'])
    const dup = JSON.parse(MANIFEST)
    dup.screens.push({ id: 'home', title: '又一个', file: 'screens/home.html' })
    expect(await codes({ ...L1, 'gg-artifact.json': JSON.stringify(dup) })).toEqual(['manifest-invalid'])
    const { 'screens/done.html': _, ...noDone } = L1
    expect(await codes(noDone)).toEqual(['screen-missing'])
    expect(await codes({ 'a.html': '<p>x</p>' })).toEqual(['entry-missing'])
  })

  it('flags hard-coded colours and external resources only in styles and tags', async () => {
    const page = (body: string) => ({ ...L1, 'screens/home.html': body })
    expect(await codes(page('<p>#ff0000 is red</p>'))).toEqual([])
    expect(await codes(page('<p style="color: var(--color-x)">x</p>'))).toEqual([])
    expect(await codes(page('<p style="color: #abc">x</p>'))).toEqual(['hardcoded-color'])
    expect(await codes(page('<style>p { color: hsl(0 0% 0%) }</style>'))).toEqual(['hardcoded-color'])
    expect(await codes(page('<link rel="stylesheet" href="//fonts.example.com/a.css">'))).toEqual([
      'external-resource',
    ])
    expect(await codes(page('<style>@import url("https://x.example/a.css");</style>'))).toEqual([
      'external-resource',
    ])
    expect(await codes(page('<script src="../_gg/gg-kit.js"></script>'))).toEqual([])
  })

  it('flags a shell file that differs from the plugin kit', async () => {
    const kit = new Map([
      ['index.html', Buffer.from('<shell>')],
      ['gg-kit.css', Buffer.from('.gg{}')],
    ])
    expect(await codes({ ...L1, 'index.html': '<shell>', '_gg/gg-kit.css': '.gg{}' }, kit)).toEqual([])
    expect(await codes({ ...L1, 'index.html': '<mine>', '_gg/x.js': '' }, kit)).toEqual([
      'kit-modified',
      'kit-modified',
    ])
    // L0 artifacts own their index.html.
    expect(await codes({ 'index.html': '<mine>' }, kit)).toEqual([])
  })
})

describe('daemon access', () => {
  it('serves blobs only to the run that was sent the artifact, and only what its versions list', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const b = await w.artifact()
    const run = await w.run([a.id])
    const runB = await w.run([b.id])
    await w.submit(run.id, a.id, { 'index.html': 'mine' })
    await w.submit(runB.id, b.id, { 'index.html': 'theirs' })
    const get = (runId: string, artifactId: string, content: string, token?: string) =>
      t.app.inject({ url: `${w.base(runId, artifactId)}/blobs/${sha(content)}`, headers: w.auth(token) })

    const ok = await get(run.id, a.id, 'mine')
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toBe('mine')
    // Another artifact's content, an artifact the run was not sent, and another machine.
    expect((await get(run.id, a.id, 'theirs')).statusCode).toBe(404)
    expect((await get(run.id, b.id, 'theirs')).statusCode).toBe(403)
    expect((await get(run.id, a.id, 'mine', w.B.token)).statusCode).toBe(404)
    // Uploaded but in no version yet.
    await w.put(run.id, a.id, 'pending')
    expect((await get(run.id, a.id, 'pending')).statusCode).toBe(404)
    // A run of another group cannot reach this group's artifact even if it claims it.
    const foreign = await w.run([a.id], { botId: w.other.id, groupId: w.g2.id })
    expect((await get(foreign.id, a.id, 'mine', w.B.token)).statusCode).toBe(403)
    expect((await w.put(foreign.id, a.id, 'x', w.B.token)).statusCode).toBe(403)
  })

  it('reports missing blobs and returns a version manifest to machines that were sent the artifact', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const run = await w.run([a.id])
    const v1 = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1))
    const missing = await t.app.inject({
      method: 'POST',
      url: `${w.base(run.id, a.id)}/blobs/missing`,
      headers: w.auth(),
      payload: { hashes: [sha(L1['tokens.css']), sha('new')] },
    })
    expect(missing.json()).toEqual({ missing: [sha('new')] })

    const manifest = (token?: string) =>
      t.app.inject({ url: `/api/daemon/artifacts/${a.id}/versions/${v1.versionId}`, headers: w.auth(token) })
    const res = await manifest()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      versionId: v1.versionId,
      files: fileList(L1).sort((x, y) => (x.path < y.path ? -1 : 1)),
    })
    expect((await manifest(w.B.token)).statusCode).toBe(403)
  })

  it('stores a thumbnail and shows it on the card', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const [card] = await t.db
      .insert(messages)
      .values({ groupId: w.g.id, kind: 'event', body: '产物', meta: {} })
      .returning()
    await t.db.update(artifacts).set({ messageId: card!.id }).where(eq(artifacts.id, a.id))
    const run = await w.run([a.id])
    const v1 = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1))
    const png = Buffer.from('fake-png')
    const res = await t.app.inject({
      method: 'PUT',
      url: `${w.base(run.id, a.id)}/versions/${v1.versionId}/thumbnail`,
      headers: { ...w.auth(), 'content-type': 'image/png' },
      payload: png,
    })
    expect(res.statusCode).toBe(204)
    const [m] = await t.db.select().from(messages).where(eq(messages.id, card!.id))
    const url = (m!.meta as { card: ArtifactCard }).card.thumbnailUrl!
    expect(url).toBe(`/api/artifacts/${a.id}/versions/${v1.versionId}/thumbnail`)
    const img = await t.app.inject({ url, headers: { cookie: await t.seed.cookie(w.li.id) } })
    expect(img.statusCode).toBe(200)
    expect(img.rawPayload.equals(png)).toBe(true)
  })
})

describe('members', () => {
  it('lists, details, versions, files and restores', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const [card] = await t.db
      .insert(messages)
      .values({ groupId: w.g.id, kind: 'event', body: '产物', meta: {} })
      .returning()
    await t.db.update(artifacts).set({ messageId: card!.id }).where(eq(artifacts.id, a.id))
    const run = await w.run([a.id], { status: 'succeeded' })
    const v1 = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1))
    const v2 = json<ArtifactSubmitRes>(
      await w.submit(
        run.id,
        a.id,
        { ...L1, 'screens/home.html': '<p style="color:#f00">v2</p>' },
        {
          parent: v1.versionId,
        },
      ),
    )
    const cookie = await t.seed.cookie(w.li.id)
    const get = (url: string) => t.app.inject({ url, headers: { cookie } })

    const list = json<ArtifactDto[]>(await get(`/api/groups/${w.g.id}/artifacts`))
    expect(list).toMatchObject([{ id: a.id, headVersionId: v2.versionId, head: { n: 2 }, running: false }])
    const detail = json<ArtifactDto>(await get(`/api/artifacts/${a.id}`))
    expect(detail.manifest).toEqual(JSON.parse(MANIFEST))
    expect(detail.head).toMatchObject({
      n: 2,
      authorName: '小王的 Claude',
      issues: [{ code: 'hardcoded-color' }],
    })
    const versions = json<ArtifactVersionSummary[]>(await get(`/api/artifacts/${a.id}/versions`))
    expect(versions.map((v) => v.n)).toEqual([2, 1])

    const file = await get(`/api/artifacts/${a.id}/files/screens/home.html?version=${v1.versionId}`)
    expect(file.statusCode).toBe(200)
    expect(file.body).toBe(L1['screens/home.html'])
    expect(file.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(file.headers['x-content-type-options']).toBe('nosniff')
    expect((await get(`/api/artifacts/${a.id}/files/screens/home.html`)).body).toContain('v2')
    expect((await get(`/api/artifacts/${a.id}/files/nope.html`)).statusCode).toBe(404)

    const pinned = json<ArtifactVersionDetail>(await get(`/api/artifacts/${a.id}/versions/${v1.versionId}`))
    expect(pinned).toMatchObject({ n: 1, manifest: JSON.parse(MANIFEST) })
    expect(pinned.files.map((f) => f.path)).toContain('screens/home.html')
    expect(detail).toMatchObject({ undoVersionId: v1.versionId, redoVersionId: null })

    // Undo: only the head moves; versions stay as they were.
    const seen: WebEvent[] = []
    t.ctx.bus.attach(w.wang.id, (e) => seen.push(e))
    const restore = (vid: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/artifacts/${a.id}/versions/${vid}/restore`,
        headers: { cookie },
      })
    const undo = await restore(v1.versionId)
    expect(undo.statusCode).toBe(200)
    expect(json<ArtifactDto>(undo)).toMatchObject({
      headVersionId: v1.versionId,
      head: { n: 1 },
      undoVersionId: null,
      redoVersionId: v2.versionId,
    })
    expect(await t.db.select().from(artifactVersions)).toHaveLength(2)
    const edited = seen.find((e) => e.t === 'message.edited') as { message: MessageDto } | undefined
    expect(edited?.message.card).toMatchObject({
      type: 'artifact',
      versionN: 1,
      status: 'ready',
      issueCount: 0,
    })
    expect((await get(`/api/artifacts/${a.id}/files/screens/home.html`)).body).toBe(L1['screens/home.html'])
    expect((await restore(v1.versionId)).statusCode).toBe(409)
    // Redo, and the next run builds on whatever the head is.
    expect(json<ArtifactDto>(await restore(v2.versionId))).toMatchObject({ head: { n: 2 } })

    const outsider = await t.seed.cookie(w.outsider.id)
    for (const url of [
      `/api/groups/${w.g.id}/artifacts`,
      `/api/artifacts/${a.id}`,
      `/api/artifacts/${a.id}/files/tokens.css`,
    ])
      expect((await t.app.inject({ url, headers: { cookie: outsider } })).statusCode, url).toBe(404)
  })

  it('refuses to restore while a run has the artifact checked out', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const run = await w.run([a.id])
    const v1 = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1))
    await w.submit(run.id, a.id, { 'index.html': 'x' }, { parent: v1.versionId })
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${a.id}/versions/${v1.versionId}/restore`,
      headers: { cookie: await t.seed.cookie(w.wang.id) },
    })
    expect(res.statusCode).toBe(409)
    expect(
      (
        await t.app.inject({
          url: `/api/artifacts/${a.id}`,
          headers: { cookie: await t.seed.cookie(w.wang.id) },
        })
      ).json(),
    ).toMatchObject({ running: true })
  })

  it('shows a stale candidate on the card', async () => {
    const w = await artifactWorld(t)
    const a = await w.artifact()
    const [card] = await t.db
      .insert(messages)
      .values({ groupId: w.g.id, kind: 'event', body: '产物', meta: {} })
      .returning()
    await t.db.update(artifacts).set({ messageId: card!.id }).where(eq(artifacts.id, a.id))
    const run = await w.run([a.id])
    const v1 = json<ArtifactSubmitRes>(await w.submit(run.id, a.id, L1))
    await w.submit(run.id, a.id, { ...L1, 'a.txt': '2' }, { parent: v1.versionId })
    const v3 = json<ArtifactSubmitRes>(
      await w.submit(run.id, a.id, { ...L1, 'a.txt': '3' }, { parent: v1.versionId }),
    )
    const cardNow = async () =>
      (
        (await t.db.select().from(messages).where(eq(messages.id, card!.id)))[0]!.meta as {
          card: ArtifactCard
        }
      ).card
    expect(await cardNow()).toMatchObject({ versionN: 2, status: 'stale-candidate' })

    // 采用此版本: the candidate becomes the head and stops being stale.
    await t.db.update(runs).set({ status: 'succeeded' }).where(eq(runs.id, run.id))
    const adopt = await t.app.inject({
      method: 'POST',
      url: `/api/artifacts/${a.id}/versions/${v3.versionId}/restore`,
      headers: { cookie: await t.seed.cookie(w.wang.id) },
    })
    expect(json<ArtifactDto>(adopt)).toMatchObject({
      head: { n: 3, stale: false },
      undoVersionId: v1.versionId,
    })
    expect(await cardNow()).toMatchObject({ versionN: 3, status: 'ready' })
  })
})
