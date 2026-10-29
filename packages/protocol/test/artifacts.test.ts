import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AnnotationDto,
  ARTIFACT_FILE_MAX_BYTES,
  ARTIFACT_MAX_FILES,
  ArtifactCard,
  ArtifactCommand,
  ArtifactDto,
  ArtifactEditOp,
  ArtifactEditReq,
  ArtifactSubmitReq,
  artifactDigestText,
  attrValueOk,
  BridgeFromShell,
  BridgeToShell,
  CreateAnnotationReq,
  DaemonFeature,
  GgArtifactManifest,
  MessageCard,
  PluginManifest,
  RunStart,
  SendAnnotationsReq,
  STYLE_PROPS,
  styleValueOk,
  tokenValueOk,
} from '../src/index.js'

const H = 'a'.repeat(64)
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures', name), 'utf8'))
const manifest = {
  title: '麓客+ 会员',
  device: 'miniprogram',
  entry: 'home',
  screens: [
    { id: 'home', title: '首页', file: 'screens/home.html' },
    { id: 'member-card', title: '会员卡', file: 'screens/member-card.html', statusBar: 'light' },
  ],
}

describe('gg-artifact.json', () => {
  it('accepts the L1 manifest', () => {
    expect(GgArtifactManifest.parse(manifest)).toEqual(manifest)
  })
  it.each([
    ['non-kebab id', { screens: [{ id: 'Home', title: 'x', file: 'screens/Home.html' }], entry: 'Home' }],
    ['file not screens/<id>.html', { screens: [{ id: 'home', title: 'x', file: 'home.html' }] }],
    [
      'duplicate id',
      {
        screens: [
          { id: 'home', title: 'a', file: 'screens/home.html' },
          { id: 'home', title: 'b', file: 'screens/home.html' },
        ],
      },
    ],
    ['entry missing', { entry: 'nope' }],
    ['unknown device', { device: 'watch' }],
    ['no screens', { screens: [] }],
  ])('rejects %s', (_, patch) => {
    expect(GgArtifactManifest.safeParse({ ...manifest, ...patch }).success).toBe(false)
  })
})

describe('style values', () => {
  it.each([
    'var(--color-primary)',
    '12px',
    '1.5',
    '0',
    '-4px',
    '50%',
    'auto',
    'bold',
    '600',
    '8px 16px',
    '1px solid var(--color-line)',
  ])('accepts %s', (v) => expect(styleValueOk(v)).toBe(true))
  it.each([
    'url(x.png)',
    'expression(alert(1))',
    'red; background: url(x)',
    '"Arial"',
    "'a'",
    '#ff0000',
    'rgb(0,0,0)',
    'var(--x) !important',
    '',
    'calc(1px + 2px)',
    'redd',
  ])('rejects %s', (v) => expect(styleValueOk(v)).toBe(false))
  it('whitelists layout and colour props only', () => {
    expect(STYLE_PROPS).toContain('font-size')
    expect(STYLE_PROPS).toContain('background-color')
    expect(STYLE_PROPS).not.toContain('position')
    expect(
      ArtifactEditOp.safeParse({
        kind: 'style',
        file: 'screens/home.html',
        ggId: '120',
        props: { position: 'fixed' },
      }).success,
    ).toBe(false)
    expect(
      ArtifactEditOp.safeParse({
        kind: 'style',
        file: 'screens/home.html',
        ggId: '120',
        props: { color: '12px' },
      }).success,
    ).toBe(false)
  })
  it('token values allow hex and quoted font names but nothing that breaks out of the declaration', () => {
    expect(tokenValueOk('#1a73e8')).toBe(true)
    expect(tokenValueOk('"PingFang SC", system-ui, sans-serif')).toBe(true)
    for (const v of ['#000; } body { x', 'url(x)', '"unbalanced', 'a</style>', '/* c */'])
      expect(tokenValueOk(v)).toBe(false)
  })
})

describe('attr values', () => {
  it('href takes relative paths or http(s) only', () => {
    expect(attrValueOk('href', 'member-card.html')).toBe(true)
    expect(attrValueOk('href', 'https://example.com')).toBe(true)
    expect(attrValueOk('href', 'javascript:alert(1)')).toBe(false)
    expect(attrValueOk('href', '//evil.com')).toBe(false)
  })
  it('src takes a relative path inside the artifact', () => {
    expect(attrValueOk('src', '../assets/a.png')).toBe(true)
    expect(attrValueOk('src', 'data:image/png;base64,xx')).toBe(false)
    expect(attrValueOk('src', 'https://cdn.example.com/a.png')).toBe(false)
    expect(attrValueOk('src', '/etc/passwd')).toBe(false)
  })
  it('data-gg-link names a screen, data-gg-transition a known transition', () => {
    expect(attrValueOk('data-gg-link', 'member-card')).toBe(true)
    expect(attrValueOk('data-gg-link', 'x" onload="')).toBe(false)
    expect(attrValueOk('data-gg-transition', 'push')).toBe(true)
    expect(attrValueOk('data-gg-transition', 'spin')).toBe(false)
  })
})

describe('edits', () => {
  const file = 'screens/home.html'
  it('accepts every op kind', () => {
    const ops = [
      { kind: 'text', file, ggId: '10', text: '你好 <b>' },
      { kind: 'attr', file, ggId: '10', name: 'alt', value: '头像' },
      { kind: 'attr', file, ggId: '10', name: 'data-gg-link', value: null },
      { kind: 'style', file, ggId: '10', props: { 'font-size': '14px', color: 'var(--color-ink)' } },
      { kind: 'token', name: '--color-primary', value: '#1a73e8' },
      { kind: 'delete', file, ggId: '10' },
      { kind: 'asset', file, ggId: '10', uploadId: 'u1' },
      { kind: 'manifest', op: 'rename', screenId: 'home', title: '主页' },
      { kind: 'manifest', op: 'duplicate', screenId: 'home' },
      { kind: 'manifest', op: 'delete', screenId: 'home' },
      { kind: 'manifest', op: 'reorder', screenId: 'home', index: 2 },
    ]
    expect(ArtifactEditReq.parse({ baseVersionId: 'v1', ops }).ops).toHaveLength(ops.length)
  })
  it.each([
    ['file outside screens', { kind: 'text', file: '../x.html', ggId: '1', text: 'x' }],
    ['non-numeric ggId', { kind: 'delete', file, ggId: 'a' }],
    ['unknown attr', { kind: 'attr', file, ggId: '1', name: 'onclick', value: 'x' }],
    ['bad href', { kind: 'attr', file, ggId: '1', name: 'href', value: 'javascript:x' }],
    ['token name', { kind: 'token', name: 'color', value: '#000' }],
    ['rename without title', { kind: 'manifest', op: 'rename', screenId: 'home' }],
    ['reorder without index', { kind: 'manifest', op: 'reorder', screenId: 'home' }],
  ])('rejects %s', (_, op) => {
    expect(ArtifactEditOp.safeParse(op).success).toBe(false)
  })
  it('takes 1..50 ops', () => {
    const op = { kind: 'delete', file, ggId: '1' }
    expect(ArtifactEditReq.safeParse({ baseVersionId: 'v1', ops: [] }).success).toBe(false)
    expect(ArtifactEditReq.safeParse({ baseVersionId: 'v1', ops: Array(51).fill(op) }).success).toBe(false)
  })
  it('L0 artifacts edit index.html', () => {
    expect(ArtifactEditOp.safeParse({ kind: 'delete', file: 'index.html', ggId: '1' }).success).toBe(true)
  })
})

describe('versions and submit', () => {
  const f = (path: string, size = 1) => ({ path, hash: H, size })
  it('rejects unsafe paths, oversize files and too many files', () => {
    const req = (files: unknown[]) =>
      ArtifactSubmitReq.safeParse({ parentVersionId: null, submitKey: crypto.randomUUID(), files }).success
    expect(req([f('screens/home.html')])).toBe(true)
    expect(req([f('../x')])).toBe(false)
    expect(req([f('a'), f('a')])).toBe(false)
    expect(req([f('a', ARTIFACT_FILE_MAX_BYTES + 1)])).toBe(false)
    expect(req(Array.from({ length: ARTIFACT_MAX_FILES + 1 }, (_, i) => f(`f${i}`)))).toBe(false)
  })
  it('digest is the sync root hash of the files (exec false)', () => {
    const text = artifactDigestText([f('b'), f('a')])
    expect(text).toBe(`a\0-\0${H}\nb\0-\0${H}\n`)
    expect(createHash('sha256').update(text).digest('hex')).toMatch(/^[0-9a-f]{64}$/)
  })
  it('ArtifactDto carries head summary and manifest', () => {
    const head = {
      id: 'v2',
      artifactId: 'a1',
      n: 2,
      parentVersionId: 'v1',
      source: 'edit',
      runId: null,
      userId: 'u1',
      digest: H,
      thumbnailUrl: null,
      stale: false,
      issues: [
        { code: 'hardcoded-color', file: 'screens/home.html', message: '写死色值 #fff', severity: 'warn' },
      ],
      createdAt: '2026-10-29T00:00:00Z',
      authorName: '姜维川',
    }
    const dto = {
      id: 'a1',
      groupId: 'g1',
      title: '会员',
      dir: 'design/app-screens-a1b2',
      pluginId: 'p1',
      pluginVersionId: 'pv1',
      designSystemId: 'luke-plus',
      headVersionId: 'v2',
      head,
      manifest,
      createdAt: '2026-10-29T00:00:00Z',
      updatedAt: '2026-10-29T00:00:00Z',
      archivedAt: null,
      running: false,
    }
    expect(ArtifactDto.parse(dto)).toEqual(dto)
    expect(ArtifactDto.safeParse({ ...dto, dir: '../x' }).success).toBe(false)
  })
})

describe('annotations', () => {
  const base = {
    versionId: 'v1',
    file: 'screens/home.html',
    ggId: '42',
    selector: 'section[data-section=hero] > h1',
    rect: { x: 1, y: 2, w: 3, h: 4 },
    snippet: '<h1>标题</h1>',
    note: '字大一点',
  }
  it('create, dto and send', () => {
    expect(CreateAnnotationReq.parse(base)).toEqual(base)
    const dto = {
      ...base,
      id: 'n1',
      artifactId: 'a1',
      authorId: 'u1',
      authorName: '王',
      status: 'open',
      createdAt: 'x',
    }
    expect(AnnotationDto.parse(dto)).toEqual(dto)
    expect(CreateAnnotationReq.safeParse({ ...base, note: '' }).success).toBe(false)
    expect(SendAnnotationsReq.safeParse({ annotationIds: [], botId: 'b1' }).success).toBe(false)
    expect(SendAnnotationsReq.parse({ annotationIds: ['n1'], botId: 'b1' })).toEqual({
      annotationIds: ['n1'],
      botId: 'b1',
    })
  })
  it('elements generated by scripts have no ggId and can still be annotated', () => {
    expect(CreateAnnotationReq.parse({ ...base, ggId: null }).ggId).toBeNull()
  })
})

describe('bridge', () => {
  it('parent → shell', () => {
    for (const m of [
      { t: 'mode', mode: 'mark' },
      { t: 'highlight', file: 'screens/home.html', ggId: '3' },
      { t: 'reload' },
      { t: 'select-clear' },
    ])
      expect(BridgeToShell.parse(m)).toEqual(m)
    expect(BridgeToShell.safeParse({ t: 'mode', mode: 'draw' }).success).toBe(false)
  })
  it('shell → parent', () => {
    const select = {
      t: 'select',
      file: 'screens/home.html',
      ggId: '3',
      selector: 'h1',
      rect: { x: 0, y: 0, w: 10, h: 10 },
      tag: 'h1',
      text: '标题',
      textOnly: true,
      computed: { color: 'rgb(0, 0, 0)' },
      inlineStyle: '',
      link: 'member-card',
    }
    for (const m of [
      { t: 'ready' },
      { t: 'hover', file: 'screens/home.html', ggId: '3', rect: { x: 0, y: 0, w: 1, h: 1 } },
      { t: 'hover', file: null, ggId: null, rect: null },
      select,
      { t: 'nav', screenId: 'home' },
    ])
      expect(BridgeFromShell.parse(m)).toEqual(m)
  })
})

describe('card, commands, features', () => {
  it('artifact card joins MessageCard', () => {
    const card = {
      type: 'artifact',
      artifactId: 'a1',
      title: '会员',
      versionN: null,
      status: 'generating',
      thumbnailUrl: null,
      issueCount: 0,
    }
    expect(ArtifactCard.parse(card)).toEqual(card)
    expect(MessageCard.parse(card)).toEqual(card)
  })
  it('commands', () => {
    expect(ArtifactCommand.options).toContain('variations')
    expect(ArtifactCommand.options).toContain('edit-with-ai')
  })
  it('daemon feature and run start defaults', () => {
    expect(DaemonFeature.options).toContain('artifacts')
    const start = RunStart.parse(fixture('s2d.run.start.json'))
    expect(start.artifacts).toEqual([])
    expect(start.artifactExclude).toEqual([])
    const withArtifacts = RunStart.parse(fixture('s2d.run.start.artifacts.json'))
    expect(withArtifacts.artifacts[0]?.dir).toMatch(/^design\//)
  })
  it('plugin manifest artifact declaration is optional', () => {
    const m = {
      name: 'web-prototype',
      version: '1.0.0',
      title: '原型',
      description: 'x',
      category: 'web',
      agents: ['claude'],
      minDaemon: '0.5.0',
      entry: 'web-prototype',
      license: 'MIT',
    }
    expect(PluginManifest.parse(m).artifact).toBeUndefined()
    expect(
      PluginManifest.parse({ ...m, artifact: { editable: true, tokens: 'tokens.css' } }).artifact,
    ).toEqual({
      editable: true,
      tokens: 'tokens.css',
    })
  })
})
