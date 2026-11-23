import { describe, expect, it } from 'vitest'
import {
  ArtifactDto,
  ArtifactKind,
  ArtifactThreadAnchor,
  ArtifactThreadDto,
  CapToPage,
  CapToShell,
  CreateArtifactThreadReq,
  DaemonArtifactRef,
  PluginManifest,
} from '../src/index.js'

const manifest = {
  name: 'whiteboard',
  version: '1.0.0',
  title: '白板',
  description: '白板',
  category: 'other',
  agents: ['claude'],
  minDaemon: '0.5.0',
  license: 'Apache-2.0',
}

describe('artifact kinds', () => {
  it('lists the five kinds', () => {
    expect(ArtifactKind.options).toEqual(['prototype', 'site', 'slides', 'whiteboard', 'motion'])
  })

  it('come from the plugin manifest, whose new artifact fields are all optional', () => {
    const m = PluginManifest.parse({
      ...manifest,
      artifact: { kind: 'whiteboard', editor: 'editor', exports: ['png', 'pdf'], store: 'db' },
    })
    expect(m.artifact).toMatchObject({ kind: 'whiteboard', editor: 'editor', store: 'db' })
    expect(PluginManifest.parse({ ...manifest, artifact: { editable: true } }).artifact).toEqual({
      editable: true,
    })
    expect(PluginManifest.safeParse({ ...manifest, artifact: { kind: 'doc' } }).success).toBe(false)
    expect(PluginManifest.safeParse({ ...manifest, artifact: { store: 'sqlite' } }).success).toBe(false)
    expect(PluginManifest.safeParse({ ...manifest, artifact: { editor: '../x' } }).success).toBe(false)
    expect(PluginManifest.safeParse({ ...manifest, artifact: { exports: ['docx'] } }).success).toBe(false)
  })

  it('reach the daemon with the run, prototype when an older server sends none', () => {
    const ref = { id: 'a', dir: 'design/x', headVersionId: null, digest: null, plugin: null }
    expect(DaemonArtifactRef.parse(ref).kind).toBe('prototype')
    expect(DaemonArtifactRef.parse({ ...ref, kind: 'slides' }).kind).toBe('slides')
  })

  it('are part of the artifact DTO', () => {
    expect(ArtifactDto.shape.kind.parse('site')).toBe('site')
  })
})

describe('artifact thread anchors', () => {
  it('take each kind its own place', () => {
    const ok = [
      {
        kind: 'prototype',
        file: 'screens/home.html',
        ggId: '12',
        selector: 'h1',
        rect: { x: 0, y: 0, w: 1, h: 1 },
        snippet: '<h1>',
      },
      { kind: 'slides', slide: 's1' },
      { kind: 'slides', slide: 's1', path: 'title', point: { x: 0.5, y: 0.2 } },
      { kind: 'whiteboard', point: { x: 10, y: -4 } },
      { kind: 'whiteboard', element: 'note-1', point: { x: 1, y: 2 } },
      { kind: 'motion', t: 2.5 },
      { kind: 'site', path: '/about', point: { x: 1, y: 2 } },
      '{"slide":"s1","el":"h1","x":0.5,"y":0.2}',
    ]
    for (const a of ok) expect(ArtifactThreadAnchor.parse(a)).toEqual(a)
    const bad = [
      { kind: 'prototype', file: '../x.html', ggId: null, selector: '', rect: { x: 0, y: 0, w: 0, h: 0 } },
      { kind: 'whiteboard', element: 'e' },
      { kind: 'motion', t: -1 },
      { kind: 'site', path: '/' },
      { kind: 'doc', point: { x: 0, y: 0 } },
      '',
    ]
    for (const a of bad) expect(ArtifactThreadAnchor.safeParse(a).success).toBe(false)
  })

  it('create a thread with its first message', () => {
    const r = CreateArtifactThreadReq.parse({
      versionId: 'v',
      anchor: { kind: 'motion', t: 1 },
      text: '这里慢一点',
    })
    expect(r.to).toEqual([])
    expect(r.label).toBe('')
    expect(r.location).toEqual({})
    expect(CreateArtifactThreadReq.safeParse({ ...r, text: '' }).success).toBe(false)
    const opaque = CreateArtifactThreadReq.parse({
      anchor: '{"slide":"s2"}',
      label: 'Slide 2',
      detail: 'Title block',
      location: { slide: 's2' },
      text: '字号加大',
    })
    expect(opaque.anchor).toBe('{"slide":"s2"}')
    expect(opaque.label).toBe('Slide 2')
    expect(opaque.versionId).toBeUndefined()
  })

  it('answer threads with their messages', () => {
    const dto = {
      id: 't',
      artifactId: 'a',
      versionId: 'v',
      anchor: { kind: 'site', path: '/', point: { x: 1, y: 1 } },
      label: '/',
      detail: null,
      location: {},
      status: 'sent',
      resolvedBy: null,
      resolvedByName: null,
      sentMessageId: 'm',
      createdBy: 'u',
      createdByName: '李建国',
      createdAt: '2026-11-22T00:00:00.000Z',
      messages: [
        {
          id: 'x',
          authorKind: 'user',
          authorId: 'u',
          authorName: '李建国',
          text: '改',
          to: [],
          reactions: [{ emoji: '👍', userIds: ['u'] }],
          at: '2026-11-22T00:00:00.000Z',
          editedAt: null,
        },
      ],
    }
    expect(ArtifactThreadDto.parse(dto)).toEqual(dto)
  })
})

describe('capability broker messages (open-artifact cap_*)', () => {
  it('carry the page side', () => {
    const want = { openArtifact: 'cap_want', cap: 'comments', protocol: 1, base: 'https://p/a/' }
    const call = { openArtifact: 'cap', id: 'k1', cap: 'comments', method: 'list', args: [], gen: 0 }
    expect(CapToShell.parse(want)).toEqual(want)
    expect(CapToShell.parse(call)).toEqual(call)
    expect(CapToShell.safeParse({ ...want, cap: 'Comments' }).success).toBe(false)
    expect(CapToShell.safeParse({ ...call, openArtifact: 'cap_r' }).success).toBe(false)
  })

  it('carry the Shell side', () => {
    const msgs = [
      { openArtifact: 'cap_grant', cap: 'user', ok: true, gen: 1, config: { artifactId: 'a' } },
      { openArtifact: 'cap_grant', cap: 'db', ok: false, gen: 1 },
      { openArtifact: 'cap_r', id: 'k1', result: [] },
      { openArtifact: 'cap_r', id: 'k2', error: { code: 'conflict', message: 'x', paths: ['a.json'] } },
      { openArtifact: 'cap_ack', id: 'k3' },
      { openArtifact: 'cap_ev', cap: 'artifact', event: 'files', data: ['a'] },
      { openArtifact: 'cap_rewired', gen: 2, caps: ['artifact'] },
    ]
    for (const m of msgs) expect(CapToPage.parse(m)).toEqual(m)
  })
})
