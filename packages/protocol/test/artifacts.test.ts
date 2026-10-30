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
  ArtifactCommandReq,
  ArtifactContext,
  ArtifactDto,
  ArtifactEditOp,
  ArtifactEditReq,
  ArtifactPatchReq,
  ArtifactShareDto,
  ArtifactShareReq,
  ArtifactSubmitReq,
  artifactDigestText,
  attrValueOk,
  BridgeFromShell,
  BridgeToShell,
  CreateAnnotationReq,
  DaemonFeature,
  GgArtifactManifest,
  MessageCanvas,
  MessageCard,
  MessageDto,
  PluginManifest,
  RunArtifact,
  RunDto,
  RunStart,
  SendAnnotationsReq,
  SendMessageReq,
  STYLE_PROPS,
  styleValueOk,
  tokensCssOk,
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
  it('screens may carry a design prompt of up to 4000 characters', () => {
    const withPrompt = (prompt: string) => ({
      ...manifest,
      screens: [{ ...manifest.screens[0], prompt }, manifest.screens[1]],
    })
    expect(
      GgArtifactManifest.parse(withPrompt('首页：活动横幅、本周共读、报名按钮')).screens[0]?.prompt,
    ).toBe('首页：活动横幅、本周共读、报名按钮')
    expect(GgArtifactManifest.safeParse(withPrompt('x'.repeat(4000))).success).toBe(true)
    expect(GgArtifactManifest.safeParse(withPrompt('x'.repeat(4001))).success).toBe(false)
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
    for (const v of ['none', 'push', 'push-back', 'slide-up', 'fade'])
      expect(attrValueOk('data-gg-transition', v)).toBe(true)
  })
  it('an empty data-gg-link or data-gg-transition removes it', () => {
    expect(attrValueOk('data-gg-link', '')).toBe(true)
    expect(attrValueOk('data-gg-transition', '')).toBe(true)
    expect(attrValueOk('alt', '')).toBe(true)
    expect(attrValueOk('src', '')).toBe(false)
  })
})

describe('tokens.css', () => {
  const LUKE = readFileSync(
    join(
      import.meta.dirname,
      '../../../apps/server/plugins/official/web-prototype/skills/web-prototype/design-systems/luke-plus/tokens.css',
    ),
    'utf8',
  )
  it('takes custom properties under :root, .t-* rules and comments', () => {
    expect(tokensCssOk(LUKE)).toBe(true)
    expect(tokensCssOk('')).toBe(true)
    expect(tokensCssOk(':root{--a:1px}.t-x,.t-y{font-size:var(--a);}/* c */')).toBe(true)
  })
  it.each([
    ['@import', '@import "x.css"; :root { --a: 1px; }'],
    ['@media', '@media (min-width: 1px) { :root { --a: 1px; } }'],
    ['url(', ':root { --a: url(x.png); }'],
    ['expression', '.t-x { width: expression(alert(1)); }'],
    ['<', ':root { --a: 1px; } </style><script>'],
    ['backslash', ':root { --a: "\\3c"; }'],
    ['other selectors', 'body { --a: 1px; }'],
    ['mixed selectors', ':root, body { --a: 1px; }'],
    ['plain property under :root', ':root { color: red; }'],
    ['custom-looking class', '.title { font-size: 1px; }'],
    ['unbalanced brace', ':root { --a: 1px; '],
    ['nested braces', ':root { --a: { x }; }'],
    ['text outside rules', 'x :root { --a: 1px; }'],
    ['unterminated comment', ':root { --a: 1px; } /* x'],
    ['declaration without colon', ':root { --a; }'],
  ])('rejects %s', (_, css) => {
    expect(tokensCssOk(css)).toBe(false)
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
      { kind: 'file', path: 'DESIGN.md', content: '# 设计 <b>' },
      { kind: 'file', path: 'tokens.css', content: ':root { --color-primary: #000; }' },
      { kind: 'design-system', id: 'luke-plus' },
      { kind: 'attr', file, ggId: '10', name: 'data-gg-link', value: '' },
      { kind: 'attr', file, ggId: '10', name: 'data-gg-transition', value: 'push-back' },
    ]
    expect(ArtifactEditReq.parse({ baseVersionId: 'v1', ops }).ops).toHaveLength(ops.length)
  })
  it('file ops take DESIGN.md or a safe tokens.css up to 200 KB', () => {
    const op = (path: string, content: string) =>
      ArtifactEditOp.safeParse({ kind: 'file', path, content }).success
    expect(op('DESIGN.md', 'x'.repeat(200 * 1024))).toBe(true)
    expect(op('DESIGN.md', 'x'.repeat(200 * 1024 + 1))).toBe(false)
    expect(op('DESIGN.md', '设'.repeat(70 * 1024))).toBe(false)
    expect(op('tokens.css', '@import "x.css";')).toBe(false)
    expect(op('index.html', '<p>')).toBe(false)
    expect(op('screens/home.html', '<p>')).toBe(false)
    expect(ArtifactEditOp.safeParse({ kind: 'design-system', id: '../x' }).success).toBe(false)
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
    for (const p of ['.env', 'assets/.DS_Store', 'node_modules/a/b.js', 'x/node_modules/y'])
      expect(req([f(p)])).toBe(false)
    expect(req([f('_gg/gg-kit.css')])).toBe(true)
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
      favorites: ['home'],
      botId: 'b1',
    }
    expect(ArtifactDto.parse(dto)).toEqual(dto)
    expect(ArtifactDto.parse({ ...dto, botId: null }).botId).toBeNull()
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
  it('the server fills in the snippet when the client sends none', () => {
    const { snippet: _, ...rest } = base
    expect(CreateAnnotationReq.parse(rest).snippet).toBeUndefined()
    expect(
      AnnotationDto.safeParse({
        ...rest,
        id: 'n1',
        artifactId: 'a1',
        authorId: 'u1',
        authorName: '王',
        status: 'open',
        createdAt: 'x',
      }).success,
    ).toBe(false)
  })
})

describe('bridge', () => {
  it('main site → screen', () => {
    for (const m of [
      { type: 'mode', mode: 'mark' },
      { type: 'highlight', ggIds: ['3', '40'] },
      { type: 'select-clear' },
      { type: 'scroll-to', ggId: '3' },
      { type: 'reload' },
    ])
      expect(BridgeToShell.parse(m)).toEqual(m)
    expect(BridgeToShell.safeParse({ type: 'mode', mode: 'draw' }).success).toBe(false)
    expect(BridgeToShell.safeParse({ type: 'highlight', ggIds: ['x'] }).success).toBe(false)
  })
  it('screen → main site', () => {
    const at = { source: 'gg-bridge', file: 'screens/home.html' }
    const select = {
      ...at,
      type: 'select',
      ggId: '3',
      selector: 'h1',
      rect: { x: 0, y: 0, w: 10, h: 10 },
      tag: 'h1',
      text: '标题',
      textOnly: true,
      computed: { color: 'rgb(0, 0, 0)' },
      inlineStyle: '',
      src: null,
      href: null,
      link: 'member-card',
      transition: 'push-back',
      snippet: '<h1 class="t">标题</h1>',
    }
    for (const m of [
      { ...at, type: 'ready', width: 390, height: 900 },
      { ...at, type: 'size', width: 390, height: 1200 },
      { ...at, type: 'hover', ggId: '3', rect: { x: 0, y: 0, w: 1, h: 1 } },
      { ...at, type: 'hover', ggId: null, rect: null },
      select,
      { ...at, type: 'nav', screen: 'home' },
      { ...at, type: 'nav', screen: 'home', transition: 'push-back' },
      { ...at, type: 'back' },
      { ...at, type: 'scroll', scrollX: 0, scrollY: 320 },
      {
        ...at,
        type: 'ready',
        width: 390,
        height: 900,
        links: [{ ggId: '3', screen: 'detail', rect: { x: 0, y: 1200, w: 100, h: 40 } }],
        back: [{ ggId: '9', rect: { x: 0, y: 0, w: 44, h: 44 } }],
      },
      {
        ...at,
        type: 'size',
        width: 390,
        height: 900,
        links: [{ ggId: null, screen: 'x', rect: { x: 0, y: 0, w: 1, h: 1 } }],
        back: [],
      },
    ])
      expect(BridgeFromShell.parse(m)).toEqual(m)
    expect(BridgeFromShell.safeParse({ ...at, type: 'scroll', scrollY: 1 }).success).toBe(false)
    expect(BridgeFromShell.safeParse({ ...select, source: 'x' }).success).toBe(false)
    expect(BridgeFromShell.safeParse({ ...select, file: '../x.html' }).success).toBe(false)
    expect(BridgeFromShell.parse({ ...select, transition: null }).type).toBe('select')
    expect(BridgeFromShell.safeParse({ ...select, transition: 'zoom' }).success).toBe(false)
    expect(BridgeFromShell.safeParse({ ...select, snippet: 'x'.repeat(300) }).success).toBe(true)
    expect(BridgeFromShell.safeParse({ ...select, snippet: 'x'.repeat(301) }).success).toBe(false)
  })
})

describe('share', () => {
  it('toggles a public link to the head preview', () => {
    expect(ArtifactShareReq.parse({ enabled: true })).toEqual({ enabled: true })
    expect(ArtifactShareReq.safeParse({}).success).toBe(false)
    const on = {
      enabled: true,
      url: 'https://x.preview.test/__gg/share/ps_x',
      expiresAt: '2026-11-06T00:00:00.000Z',
    }
    expect(ArtifactShareDto.parse(on)).toEqual(on)
    const off = { enabled: false, url: null, expiresAt: null }
    expect(ArtifactShareDto.parse(off)).toEqual(off)
  })
})

describe('commands and context', () => {
  it('edit-with-ai needs a request and elements or screens', () => {
    const base = { command: 'edit-with-ai', botId: 'b1' }
    expect(ArtifactCommandReq.safeParse(base).success).toBe(false)
    expect(
      ArtifactCommandReq.safeParse({
        ...base,
        text: '更醒目',
        ggIds: [{ file: 'screens/home.html', ggId: '3' }],
      }).success,
    ).toBe(true)
    // A whole screen instead of elements.
    expect(ArtifactCommandReq.safeParse({ ...base, text: '更醒目', screenIds: ['home'] }).success).toBe(true)
    expect(ArtifactCommandReq.safeParse({ ...base, text: '更醒目' }).success).toBe(false)
    expect(ArtifactCommandReq.safeParse({ ...base, text: '更醒目', screenIds: [] }).success).toBe(false)
    expect(ArtifactCommandReq.safeParse({ ...base, text: ' ', screenIds: ['home'] }).success).toBe(false)
    expect(ArtifactCommandReq.safeParse({ command: 'variations', botId: 'b1', count: 9 }).success).toBe(false)
    expect(ArtifactCommandReq.parse({ command: 'regenerate', botId: 'b1', screenIds: ['home'] })).toEqual({
      command: 'regenerate',
      botId: 'b1',
      screenIds: ['home'],
    })
  })
  it('connect-element needs a description of the new screen and elements or screens', () => {
    const base = { command: 'connect-element', botId: 'b1' }
    expect(ArtifactCommandReq.safeParse(base).success).toBe(false)
    expect(ArtifactCommandReq.safeParse({ ...base, text: '订单详情' }).success).toBe(false)
    expect(
      ArtifactCommandReq.safeParse({
        ...base,
        text: '订单详情',
        ggIds: [{ file: 'screens/home.html', ggId: '3' }],
      }).success,
    ).toBe(true)
    expect(ArtifactCommandReq.safeParse({ ...base, text: '订单详情', screenIds: ['home'] }).success).toBe(
      true,
    )
    expect(ArtifactCommandReq.safeParse({ ...base, screenIds: ['home'] }).success).toBe(false)
    expect(ArtifactCommandReq.safeParse({ command: 'apply-design-system', botId: 'b1' }).success).toBe(true)
  })
  it('the composer may carry the canvas selection', () => {
    const ctx = {
      artifactId: 'a1',
      screenIds: ['home'],
      elements: [{ file: 'screens/home.html', ggId: '3', label: 'h1' }],
    }
    expect(
      SendMessageReq.parse({ body: 'x', clientId: '12345678', artifactContext: ctx }).artifactContext,
    ).toEqual(ctx)
    expect(SendMessageReq.parse({ body: 'x', clientId: '12345678' }).artifactContext).toBeUndefined()
    expect(ArtifactContext.safeParse({ ...ctx, screenIds: ['../x'] }).success).toBe(false)
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

describe('canvas context on messages and runs (G11)', () => {
  const canvas = {
    artifactId: 'a1',
    title: '活动报名',
    screens: [{ id: 'home', title: '首页' }],
    elements: [{ file: 'screens/home.html', ggId: '12', label: '报名' }],
  }
  it('a message carries the canvas selection it was sent with', () => {
    expect(MessageCanvas.parse(canvas)).toEqual(canvas)
    expect(
      MessageCanvas.safeParse({ ...canvas, elements: [{ file: 'x.js', ggId: '1', label: '' }] }).success,
    ).toBe(false)
    expect(MessageDto.shape.canvas.safeParse(undefined).success).toBe(true)
    expect(MessageDto.shape.canvas.parse(canvas)).toEqual(canvas)
  })
  it('a run lists the artifact versions it made and the screens they changed', () => {
    const made = {
      artifactId: 'a1',
      title: '活动报名',
      versionId: 'v3',
      n: 3,
      changedScreens: [{ id: 'home', title: '首页' }],
    }
    expect(RunArtifact.parse(made)).toEqual(made)
    expect(RunDto.shape.artifacts.parse([made])).toEqual([made])
    expect(RunDto.shape.artifacts.safeParse(undefined).success).toBe(true)
  })
})

describe('artifact rename (G18)', () => {
  it('takes a trimmed title of 1..80 characters', () => {
    expect(ArtifactPatchReq.parse({ title: '  新标题 ' })).toEqual({ title: '新标题' })
    expect(ArtifactPatchReq.safeParse({ title: '  ' }).success).toBe(false)
    expect(ArtifactPatchReq.safeParse({ title: 'x'.repeat(81) }).success).toBe(false)
  })
})
