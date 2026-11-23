import { describe, expect, it } from 'vitest'
import {
  ArtifactAgentSendReq,
  ArtifactAssetRes,
  ArtifactHistoryDiffRes,
  ArtifactHistoryListRes,
  ArtifactPublishReq,
  ArtifactPublishRes,
  ArtifactRestoreFilesReq,
  WebEvent,
} from '../src/index.js'

describe('artifact broker HTTP & WS contracts', () => {
  it('parses publish batches with utf8, base64, ifMatch and null deletions', () => {
    const req = ArtifactPublishReq.parse({
      clientId: 'tab-1',
      batch: {
        'project/deck.json': { content: '{"slides":[]}', ifMatch: 'a'.repeat(64) },
        'project/new.html': { content: '<h1>hi</h1>', ifMatch: null },
        'project/old.html': null,
        'project/img.bin': { content: 'AQID', encoding: 'base64' },
      },
    })
    expect(req.batch['project/deck.json']?.encoding).toBe('utf8')
    expect(req.batch['project/old.html']).toBeNull()
    expect(
      ArtifactPublishRes.parse({
        versionId: 'v1',
        n: 2,
        hashes: { 'project/deck.json': 'b'.repeat(64), 'project/old.html': null },
        coalesced: true,
      }).coalesced,
    ).toBe(true)
  })

  it('validates 32-hex asset records and history / restore / agent-send payloads', () => {
    const id = '0123456789abcdef0123456789abcdef'
    expect(
      ArtifactAssetRes.parse({ id, url: `/_blob/${id}`, sizeBytes: 128, contentType: 'video/mp4' }).url,
    ).toBe(`/_blob/${id}`)
    expect(
      ArtifactAssetRes.safeParse({ id: 'short', url: '/_blob/short', sizeBytes: 1, contentType: 'image/png' })
        .success,
    ).toBe(false)
    expect(
      ArtifactHistoryListRes.parse({
        versions: [
          {
            id: 'v1',
            n: 1,
            first: '2026-11-23T00:00:00.000Z',
            at: '2026-11-23T00:00:00.000Z',
            author: { kind: 'person', id: 'u1', name: '李建国' },
            files: [{ path: 'project/deck.json', op: 'added' }],
            current: true,
          },
        ],
        notices: [],
        canRestore: true,
      }).canRestore,
    ).toBe(true)
    expect(
      ArtifactHistoryDiffRes.parse({
        path: 'project/deck.json',
        n: 2,
        op: 'edited',
        before: '{}',
        after: '{"a":1}',
      }).op,
    ).toBe('edited')
    expect(ArtifactRestoreFilesReq.parse({ paths: ['project/a.html'] }).paths).toEqual(['project/a.html'])
    expect(ArtifactAgentSendReq.parse({ text: '帮我改一下标题', context: { slide: 's1' } }).text).toBe(
      '帮我改一下标题',
    )
  })

  it('parses artifact.files and artifact.threads realtime WebEvents', () => {
    const filesEv = WebEvent.parse({
      t: 'artifact.files',
      artifactId: 'a1',
      versionId: 'v2',
      n: 2,
      changes: { 'project/slides/s1.html': 'c'.repeat(64), 'project/old.html': null },
      author: '李建国',
      clientId: 'tab-1',
    })
    expect(filesEv.t).toBe('artifact.files')
    const threadsEv = WebEvent.parse({
      t: 'artifact.threads',
      artifactId: 'a1',
      threads: [],
    })
    expect(threadsEv.t).toBe('artifact.threads')
  })
})
