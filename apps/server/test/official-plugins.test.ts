import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  GgArtifactManifest,
  LegacyProviderPreset,
  normalizePresets,
  PLUGIN_MANIFEST,
  PLUGIN_MAX_BYTES,
  PLUGIN_MAX_FILES,
  PluginManifest,
  ProviderPreset,
  tokensCssOk,
} from '@gonggong/protocol'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { frontmatter } from '../src/modules/skills/service.js'

const OFFICIAL = join(import.meta.dirname, '../plugins/official')
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

function load(name: string) {
  const root = join(OFFICIAL, name)
  const manifest = PluginManifest.parse(JSON.parse(readFileSync(join(root, PLUGIN_MANIFEST), 'utf8')))
  return { root, manifest, skillDir: join(root, 'skills', manifest.entry ?? '') }
}

const CREATION = readdirSync(OFFICIAL)
  .sort()
  .filter((name) => load(name).manifest.entry)

it('ships the creation plugins and the provider presets', () => {
  expect(readdirSync(OFFICIAL).sort()).toEqual([
    'agent-antigravity',
    'agent-codebuddy',
    'agent-copilot',
    'agent-deepseek',
    'agent-gemini',
    'agent-goose',
    'agent-kimi',
    'agent-opencode',
    'agent-pi',
    'agent-qwen',
    'provider-presets',
    'slides',
    'web-prototype',
  ])
})

describe.each([
  'gemini',
  'codebuddy',
  'pi',
  'deepseek',
  'antigravity',
  'opencode',
  'qwen',
  'kimi',
  'goose',
  'copilot',
])('official agent plugin agent-%s', (id) => {
  it('adapts that agent, runs code, and ships its launch script and icon', () => {
    const { root, manifest } = load(`agent-${id}`)
    expect(manifest).toMatchObject({ category: 'agent', entry: null, permissions: ['exec'], agents: [id] })
    const [agent, ...more] = manifest.contributes.agents
    expect(more).toEqual([])
    expect(agent!.id).toBe(id)
    for (const f of [manifest.icon!, ...(agent!.launchScript ? [agent!.launchScript] : [])])
      expect(existsSync(join(root, f)), f).toBe(true)
  })
})

it('Antigravity CLI is not on npm: the owner installs it, and the bot prompt goes in session _meta', () => {
  const [agent] = load('agent-antigravity').manifest.contributes.agents
  expect(agent!.install).toMatchObject({
    npm: null,
    bin: 'agy',
    command: expect.stringContaining('antigravity.google'),
  })
  expect(agent!.acp).toEqual({ kind: 'native', args: ['acp', '--disable-telemetry'] })
  expect(agent!.systemPrompt).toEqual({ via: 'meta', key: 'antigravity' })
  // Its ACP modes are default / accept-edits / plan; 完全访问 is answered by the daemon on top of accept-edits.
  expect(agent!.tiers).toMatchObject({
    full: { mode: 'accept-edits' },
    workspace: { mode: 'accept-edits' },
    readonly: { mode: 'default' },
  })
  // An agent off npm must say how to install it.
  const raw = JSON.parse(readFileSync(join(OFFICIAL, 'agent-antigravity', PLUGIN_MANIFEST), 'utf8'))
  delete raw.contributes.agents[0].install.command
  expect(PluginManifest.safeParse(raw).success).toBe(false)
})

describe('the agents speaking ACP themselves (三期)', () => {
  const agent = (id: string) => load(`agent-${id}`).manifest.contributes.agents[0]!

  it('starts each in its own ACP mode', () => {
    const acp = Object.fromEntries(
      ['opencode', 'qwen', 'kimi', 'goose', 'copilot'].map((id) => [id, agent(id).acp]),
    )
    expect(acp).toEqual({
      opencode: { kind: 'native', args: ['acp'] },
      qwen: { kind: 'native', args: ['--acp'] },
      kimi: { kind: 'native', args: ['acp'] },
      goose: { kind: 'native', args: ['acp'] },
      copilot: { kind: 'native', args: ['--acp'] },
    })
  })

  it('installs them from npm, but Goose with its own script', () => {
    expect(agent('opencode').install).toMatchObject({ npm: '@opencode/cli', bin: 'opencode', script: null })
    expect(agent('qwen').install).toMatchObject({ npm: '@qwen-code/qwen-code', bin: 'qwen' })
    expect(agent('kimi').install).toMatchObject({
      npm: '@moonshot-ai/kimi-code',
      bin: 'kimi',
      minNode: '22.19.0',
    })
    expect(agent('copilot').install).toMatchObject({ npm: '@github/copilot', bin: 'copilot' })
    expect(agent('goose').install).toMatchObject({
      npm: null,
      bin: 'goose',
      command:
        'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash',
    })
  })

  it('OpenCode keeps its own login; the others take a provider and need its model', () => {
    expect(agent('opencode').provider).toBeNull()
    for (const id of ['qwen', 'kimi', 'goose', 'copilot']) expect(agent(id).provider?.needsModel).toBe(true)
    expect(agent('qwen').provider).toMatchObject({
      protocols: ['openai'],
      env: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL', model: 'OPENAI_MODEL' },
      byProtocol: { openai: { args: ['--auth-type', 'openai'] } },
    })
    expect(agent('kimi').provider).toMatchObject({
      protocols: ['anthropic', 'openai'],
      env: { apiKey: 'KIMI_MODEL_API_KEY', baseUrl: 'KIMI_MODEL_BASE_URL', model: 'KIMI_MODEL_NAME' },
      byProtocol: {
        anthropic: { set: { KIMI_MODEL_PROVIDER_TYPE: 'anthropic' } },
        openai: { set: { KIMI_MODEL_PROVIDER_TYPE: 'openai' } },
      },
    })
    expect(agent('goose').provider).toMatchObject({
      protocols: ['anthropic', 'openai'],
      env: { apiKey: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_HOST', model: 'GOOSE_MODEL' },
      byProtocol: {
        anthropic: { set: { GOOSE_PROVIDER: 'anthropic' } },
        openai: {
          env: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL', model: 'GOOSE_MODEL' },
          set: { GOOSE_PROVIDER: 'openai' },
        },
      },
    })
    expect(agent('copilot').provider).toMatchObject({
      protocols: ['anthropic', 'openai'],
      env: {
        apiKey: 'COPILOT_PROVIDER_API_KEY',
        baseUrl: 'COPILOT_PROVIDER_BASE_URL',
        model: 'COPILOT_MODEL',
      },
      byProtocol: {
        anthropic: { set: { COPILOT_PROVIDER_TYPE: 'anthropic' } },
        openai: { set: { COPILOT_PROVIDER_TYPE: 'openai' } },
      },
    })
  })

  it('hands the bot prompt over as each CLI reads it', () => {
    expect(agent('qwen').systemPrompt).toEqual({ via: 'arg', args: ['--append-system-prompt', '{prompt}'] })
    for (const id of ['opencode', 'kimi', 'goose', 'copilot'])
      expect(agent(id).systemPrompt).toEqual({ via: 'script' })
  })
})

describe('official plugin provider-presets', () => {
  it('carries the presets built into the daemon, and nothing a group would turn on', () => {
    const { manifest } = load('provider-presets')
    const bundled = JSON.parse(
      readFileSync(join(OFFICIAL, '../../../../crates/gonggong/presets/providers.json'), 'utf8'),
    ) as { source: string; presets: unknown[] }
    // Compared as vendors: either side may still be in the one-copy-per-agent shape.
    const presets = z.array(z.union([ProviderPreset, LegacyProviderPreset])).parse(bundled.presets)
    expect(normalizePresets(manifest.contributes.providers)).toEqual(normalizePresets(presets))
    expect(`cc-switch@${manifest.source?.revision}`).toBe(bundled.source)
    expect([manifest.entry, manifest.contributes.mcp, manifest.contributes.commands]).toEqual([null, [], []])
  })
})

describe.each(CREATION)('official plugin %s', (name) => {
  const { root, manifest, skillDir } = load(name)

  it('has a valid manifest named after its folder', () => {
    expect(manifest.name).toBe(name)
    expect(manifest.templates.every((t) => t.group)).toBe(true)
    expect(manifest.designSystems.every((d) => d.category)).toBe(true)
    const lead = manifest.composer?.prompt ?? 'title'
    expect(manifest.inputs.find((i) => i.id === lead)?.required).toBe(true)
  })

  it('has a guide for every template and every preview file', () => {
    for (const t of manifest.templates) {
      expect(existsSync(join(skillDir, 'templates', t.id, 'GUIDE.md')), t.id).toBe(true)
      for (const f of [t.preview, t.demo]) if (f) expect(existsSync(join(root, f)), f).toBe(true)
    }
  })

  it('lists every template in the entry skill index', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    for (const t of manifest.templates) expect(skill, t.id).toContain(`\`${t.id}\``)
  })

  it('has an entry SKILL.md whose frontmatter names the entry', () => {
    const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(frontmatter([{ path: 'SKILL.md', content, encoding: 'utf8' }]).name).toBe(manifest.entry)
  })

  it('ships DESIGN.md and tokens.css for every design system', () => {
    for (const ds of manifest.designSystems) {
      expect(existsSync(join(skillDir, ds.dir, 'DESIGN.md')), ds.dir).toBe(true)
      expect(existsSync(join(skillDir, ds.dir, 'tokens.css')), ds.dir).toBe(true)
    }
  })

  it('stays within the upload limits', () => {
    const files = walk(root)
    expect(files.length).toBeLessThan(PLUGIN_MAX_FILES)
    expect(files.reduce((n, f) => n + statSync(f).size, 0)).toBeLessThan(PLUGIN_MAX_BYTES)
  })

  it('carries no open-design specifics', () => {
    for (const f of walk(skillDir))
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /data-od-id|lint-artifact|<artifact>|discovery-question-form/,
      )
  })
})

describe('official plugin web-prototype', () => {
  const { manifest, skillDir } = load('web-prototype')
  const example = join(skillDir, 'templates/app-screens/example')
  const app = JSON.parse(readFileSync(join(example, 'gg-artifact.json'), 'utf8')) as {
    title: string
    entry: string
    screens: { id: string; file: string }[]
  }
  const ids = new Set(app.screens.map((s) => s.id))

  it('ships the platform kit, the app-screens template and five design systems', () => {
    for (const f of ['index.html', 'gg-kit.css', 'gg-kit.js'])
      expect(existsSync(join(skillDir, 'kit', f)), f).toBe(true)
    expect(manifest.version).toBe('0.7.0')
    expect(manifest.templates.map((t) => t.id)).toEqual(['app-screens'])
    expect(manifest.designSystems.map((d) => d.id)).toEqual([
      'luke-plus',
      'warm-paper',
      'geometric',
      'glacier',
      'neon-night',
    ])
  })

  it("asks for the request in one box and the device; design sources come from the group's imports", () => {
    expect(manifest.composer).toEqual({ prompt: 'prompt' })
    expect(manifest.templates[0]?.inputs).toEqual(['prompt', 'device'])
    const inputs = new Map(manifest.inputs.map((i) => [i.id, i]))
    expect(inputs.get('prompt')).toMatchObject({ label: '需求', type: 'text', required: true })
    expect(inputs.get('device')).toMatchObject({
      type: 'select',
      options: ['小程序', '手机 App', '桌面 Web'],
      default: '小程序',
    })
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    for (const s of [
      '`小程序` → `miniprogram`, `手机 App` → `mobile`, `桌面 Web` → `desktop`',
      '`需求` (the request',
      '自动: `设计系统：未指定…`',
      '`设计系统：本群导入的设计系统「<title>」`',
      '`粘贴 DESIGN.md` or a `DESIGN.md 原文` block is given',
      '`参考网站` is given: fetch the page',
      '`参考仓库`: read its style sources',
    ])
      expect(skill).toContain(s)
  })

  it('reports Stitch-like stages on a progress card', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill).toContain('`progress_card`')
    for (const stage of ['`搭建设计系统`', '`搭建应用骨架`', '`生成 <屏幕标题>（<i>/<n>）`', '`自检与连线`'])
      expect(skill).toContain(stage)
  })

  it('generates every tokens.css from its DESIGN.md front matter', () => {
    for (const ds of manifest.designSystems) {
      const md = readFileSync(join(skillDir, ds.dir, 'DESIGN.md'), 'utf8')
      const css = readFileSync(join(skillDir, ds.dir, 'tokens.css'), 'utf8')
      const fm = parseYaml(md.split(/^---$/m)[1] ?? '') as {
        name: string
        colors: Record<string, string>
        rounded: Record<string, string>
        spacing: Record<string, string>
        typography: Record<string, { fontSize: string; fontWeight: number; lineHeight: string }>
      }
      expect(css.startsWith(`/* ${fm.name} — generated from DESIGN.md front matter`), ds.id).toBe(true)
      for (const [k, v] of Object.entries(fm.colors))
        expect(css, `${ds.id} ${k}`).toContain(`--color-${k}: ${v};`)
      for (const [k, v] of Object.entries(fm.rounded)) expect(css).toContain(`--rounded-${k}: ${v};`)
      for (const [k, v] of Object.entries(fm.spacing)) expect(css).toContain(`--space-${k}: ${v};`)
      for (const [k, ty] of Object.entries(fm.typography)) {
        expect(css).toContain(`--text-${k}-size: ${ty.fontSize};`)
        expect(css).toContain(`--text-${k}-weight: ${ty.fontWeight};`)
        expect(css).toContain(`--text-${k}-leading: ${ty.lineHeight};`)
        expect(css).toContain(`.t-${k} { font-family: var(--font-sans);`)
      }
      for (const sw of ds.swatches) expect(Object.values(fm.colors), `${ds.id} ${sw}`).toContain(sw)
      for (const section of [
        '## Overview',
        '## Colors',
        '## Typography',
        '## Components',
        "## Do's and Don'ts",
      ])
        expect(md, `${ds.id} ${section}`).toContain(section)
    }
  })

  it('tells the agent to bring DESIGN.md along and to copy the kit only without hosting', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill).toContain('├── DESIGN.md')
    expect(skill).toMatch(/Hosted.*Do \*\*not\*\* copy `index.html` or `_gg\/`/)
    expect(skill).toMatch(/Not hosted.*copy `kit\/index.html`/)
    expect(skill).toContain('Give every screen a `prompt`')
    expect(skill).toMatch(/`seed`.*optional metadata.*not a token/)
    for (const ds of manifest.designSystems)
      expect(tokensCssOk(readFileSync(join(skillDir, ds.dir, 'tokens.css'), 'utf8')), ds.id).toBe(true)
  })

  it('has an example that keeps the screen contract', () => {
    for (const f of ['DESIGN.md', 'tokens.css'])
      expect(readFileSync(join(example, f), 'utf8'), f).toBe(
        readFileSync(join(skillDir, 'design-systems/luke-plus', f), 'utf8'),
      )
    expect(ids.has(app.entry)).toBe(true)
    expect(GgArtifactManifest.parse(app).screens.every((s) => s.prompt)).toBe(true)
    for (const s of app.screens) {
      expect(s.file).toBe(`screens/${s.id}.html`)
      const html = readFileSync(join(example, s.file), 'utf8')
      expect(html).toContain('href="../_gg/gg-kit.css"')
      expect(html).toContain('href="../tokens.css"')
      for (const [, id] of html.matchAll(/data-gg-link="([^"]+)"/g)) expect(ids.has(id ?? ''), id).toBe(true)
      expect(html.replaceAll('href="#"', ''), s.file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    }
  })

  const openShell = (hash: string, width = 1440, meta?: object) => {
    const shell = readFileSync(join(skillDir, 'kit/index.html'), 'utf8')
      .replace(
        '</head>',
        meta
          ? `<script type="application/json" id="gg-meta">${JSON.stringify(meta)}</script></head>`
          : '</head>',
      )
      .replace(
        '<script>',
        `<script type="application/json" id="gg-manifest">${JSON.stringify(app)}</script><script>`,
      )
    const { window: w } = new JSDOM(shell, {
      url: `https://p.test/${hash}`,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(win) {
        win.matchMedia = ((q: string) => ({
          matches: q.includes('reduce') || (q.includes('max-width') && width <= 520),
          addEventListener() {},
        })) as never
        Object.defineProperty(win, 'innerWidth', { value: width })
      },
    })
    return { w, $: (sel: string) => w.document.querySelector(sel) as HTMLButtonElement }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const pressed = (w: { document: Document }) =>
    [...w.document.querySelectorAll('[data-view]')].find((b) => b.getAttribute('aria-pressed') === 'true')
      ?.textContent

  it('shell: a link opens straight into 预览 at the entry; 总览 is a click (or #canvas) away', async () => {
    const plain = openShell('', 1440, { version: 11 })
    await tick()
    expect(pressed(plain.w)).toBe('预览')
    expect(plain.$('.stage iframe').getAttribute('src')).toBe(
      app.screens.find((s) => s.id === app.entry)?.file,
    )
    expect(plain.$('.ver').textContent).toBe('v11')
    expect(plain.w.document.title).toBe(app.title)
    plain.$('[data-view="canvas"]').click()
    expect(pressed(plain.w)).toBe('总览')
    expect(plain.w.location.hash).toBe('#canvas')
    expect([...plain.w.document.querySelectorAll('.label button')].map((b) => b.textContent)).toEqual(
      app.screens.map(() => '预览'),
    )
    const canvas = openShell('#canvas')
    await tick()
    expect(pressed(canvas.w)).toBe('总览')
    expect(canvas.$('.ver').hidden).toBe(true)
  })

  it('shell: lists every screen, goes back the way it came, and pages with the arrow keys', async () => {
    const { w, $ } = openShell(`#play:${app.entry}`)
    await tick()
    expect(
      [...w.document.querySelectorAll('.screens [data-id]')].map((b) => b.getAttribute('data-id')),
    ).toEqual(app.screens.map((s) => s.id))
    expect($('.back').hidden).toBe(true)
    const other = app.screens.find((s) => s.id !== app.entry)?.id
    $(`.screens [data-id="${other}"]`).click()
    expect(w.location.hash).toBe(`#play:${other}`)
    expect($('.back').hidden).toBe(false)
    expect($('.where').textContent).toContain(`2/${app.screens.length}`)
    $('.back').click()
    expect($('.back').hidden).toBe(true)
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(w.location.hash).toBe(`#play:${app.screens[1]?.id}`)
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(w.location.hash).toBe(`#play:${app.screens[0]?.id}`)
  })

  it('shell: on a phone the screen fills the window, with no device frame and no 总览', async () => {
    const { w, $ } = openShell('#canvas', 390)
    await tick()
    expect(w.document.body.classList.contains('compact')).toBe(true)
    expect(pressed(w)).toBe('预览')
    expect(($('.stage .status') as HTMLElement).hidden).toBe(true)
  })
})

describe('official plugin slides', () => {
  const { manifest, skillDir } = load('slides')
  const toolkitPath = join(skillDir, 'toolkit/deck-toolkit.js')
  const toolkit = readFileSync(toolkitPath, 'utf8')
  const decks = walk(join(skillDir, 'templates')).filter((f) =>
    /\/(example\.html|full-decks\/[^/]+\/index\.html|templates\/deck\.html|assets\/template\.html)$/.test(f),
  )

  it('is a deck plugin whose templates carry their own visual systems', () => {
    expect(manifest.category).toBe('deck')
    expect(manifest.designSystems).toEqual([])
    expect(manifest.templates[0]?.id).toBe('html-ppt')
  })

  it('loads the presenting toolkit in <head> of every example and seed', () => {
    expect(decks.length).toBeGreaterThan(45)
    for (const f of decks) {
      const head = readFileSync(f, 'utf8').split('</head>')[0] ?? ''
      const src = /<script src="([^"]*deck-toolkit\.js)"><\/script>/.exec(head)?.[1]
      expect(src && join(dirname(f), src), f).toBe(toolkitPath)
    }
  })

  it('pages every html-ppt example with the shared runtime', () => {
    for (const t of manifest.templates.filter((t) => /^html-ppt-(?!zhangzara|taste)/.test(t.id)))
      expect(readFileSync(join(skillDir, 'templates', t.id, 'example.html'), 'utf8'), t.id).toContain(
        '<script src="../html-ppt/assets/runtime.js"></script>',
      )
  })

  it('groups 31 templates as 经典 / 交互实验 with short names, and every guide covers linked edits and print', () => {
    expect(manifest.templates).toHaveLength(31)
    for (const t of manifest.templates) {
      expect(['经典·汇报', '经典·发布路演', '经典·技术教育', '经典·创意社媒', '交互实验'], t.id).toContain(
        t.group,
      )
      expect(t.title.length, t.title).toBeLessThanOrEqual(6)
      const guide = readFileSync(join(skillDir, 'templates', t.id, 'GUIDE.md'), 'utf8')
      expect(guide, t.id).toContain('## Linked edits')
      expect(guide, t.id).toContain('## Print')
    }
  })

  it('maps every retired template id to a template that still ships', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    const rows = [...(skill.split('<!-- RETIRED -->')[1] ?? '').matchAll(/^\| `([^`]+)` \| `([^`]+)`/gm)]
    expect(rows).toHaveLength(30)
    const ids = new Set(manifest.templates.map((t) => t.id))
    for (const [, from, to] of rows) {
      expect(ids.has(from ?? ''), from).toBe(false)
      expect(ids.has(to ?? ''), `${from} → ${to}`).toBe(true)
    }
  })

  it('tells the agent to inject the toolkit into every deck', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill).toContain('`<script src="./assets/deck-toolkit.js"></script>`')
    expect(skill).toContain('window.deck = { slides, index, go(i) }')
  })

  it('check-deck passes every example and catches broken decks', async () => {
    const { checkDeck } = (await import(join(skillDir, 'toolkit/check-deck.mjs'))) as {
      checkDeck: (f: string, o?: { allowOutside?: boolean }) => { slides: number; problems: string[] }
    }
    for (const t of manifest.templates) {
      const f = join(skillDir, 'templates', t.id, 'example.html')
      if (existsSync(f)) expect(checkDeck(f, { allowOutside: true }).problems, t.id).toEqual([])
    }
    const dir = mkdtempSync(join(tmpdir(), 'deck-'))
    writeFileSync(join(dir, 'deck-toolkit.js'), '')
    writeFileSync(
      join(dir, 'index.html'),
      `<html><head><script src="./deck-toolkit.js"></script></head><body>
<section class="slide" data-section="cover"></section>
<section class="slide" data-section="cover"></section>
<div class="slide big"></div>
<script type="application/json" id="speaker-notes">{"a":1}</script>
<script>if (</script>
<img src="./missing.png"><link href="../../outside.css">
</body></html>`,
    )
    const { slides, problems } = checkDeck(join(dir, 'index.html'))
    expect(slides).toBe(3)
    expect(problems.map((p) => p.replace(/^line \d+: /, ''))).toEqual([
      '#speaker-notes must be a JSON array, one entry per slide',
      expect.stringContaining('inline script has a syntax error'),
      'data-section "cover" repeats line 2',
      'slide without data-section',
      './missing.png does not exist',
      '../../outside.css points outside the deck folder',
    ])
  })

  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
  function openDeck(withAdapter = true) {
    const body = ['封面', '问题', '方案', '数据', '结论']
      .map(
        (t, i) =>
          `<section class="slide${i ? '' : ' active'}" data-section="s${i}"><h2>${t}</h2><aside class="notes">备注${i + 1}</aside></section>`,
      )
      .join('')
    const kernel = `<script>
      var slides = Array.from(document.querySelectorAll('.slide')), idx = 0, log = [];
      function go(n) { idx = Math.max(0, Math.min(slides.length - 1, n)); slides.forEach((s, i) => s.classList.toggle('active', i === idx)); }
      ${withAdapter ? 'window.deck = { slides: slides, get index() { return idx; }, go: go };' : ''}
      document.addEventListener('keydown', (e) => { log.push(e.key); if (e.key === 'ArrowRight' || e.key === 'Enter') go(idx + 1); if (e.key === 'ArrowLeft') go(idx - 1); });
    </script>`
    const { window: w } = new JSDOM(
      `<!doctype html><html><head><script>${toolkit}</script></head><body>${body}<input id="q">${kernel}</body></html>`,
      { url: 'https://p.test/deck/index.html', runScripts: 'dangerously', pretendToBeVisual: true },
    )
    const opened: string[] = []
    w.open = ((...a: string[]) => {
      opened.push(a[1] ?? '')
      return null
    }) as never
    const press = (key: string, target: EventTarget = w.document.body) =>
      target.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    const layer = (k: string) => w.document.querySelector(`[data-ggt="${k}"]`)
    const state = w as unknown as { idx: number; log: string[] }
    return { w, press, layer, state, opened }
  }

  it('toolkit: digits + Enter jump through window.deck; Enter alone still reaches the template', async () => {
    const { press, layer, state } = openDeck()
    press('4')
    expect(layer('jump')?.textContent).toContain('4')
    press('Enter')
    expect(state.idx).toBe(3)
    expect(layer('jump')).toBeNull()
    press('Enter')
    expect(state.idx).toBe(4)
    expect(state.log).toEqual(['Enter'])
    press('9')
    press('Escape')
    expect(layer('jump')).toBeNull()
    expect(state.log).toEqual(['Enter'])
  })

  it('toolkit: ? help, O overview of every slide, B/W screens swallow the next key, S opens the presenter', async () => {
    const { w, press, layer, state, opened } = openDeck()
    press('?')
    expect(layer('help')?.textContent).toContain('演讲者窗口')
    press('Escape')
    expect(layer('help')).toBeNull()
    press('o')
    const frames = [...w.document.querySelectorAll('[data-ggt="overview"] iframe')].map((f) =>
      f.getAttribute('src'),
    )
    expect(frames).toEqual([1, 2, 3, 4, 5].map((n) => `https://p.test/deck/index.html?gg-slide=${n}`))
    ;(w.document.querySelectorAll('[data-ggt="overview"] .ggt-tile')[2] as HTMLElement).click()
    expect(state.idx).toBe(2)
    expect(layer('overview')).toBeNull()
    press('b')
    expect(layer('black')).not.toBeNull()
    press('ArrowRight')
    expect(layer('black')).toBeNull()
    expect(state.idx).toBe(2)
    press('w')
    expect(layer('white')).not.toBeNull()
    press('s')
    expect(layer('white')).toBeNull()
    press('s')
    expect(opened).toEqual(['gg-deck-presenter'])
  })

  it('toolkit: E edits text in place and leaves with Esc', () => {
    const { w, press, layer } = openDeck()
    press('e')
    expect(layer('edit')?.textContent).toContain('保存副本')
    const h2 = w.document.querySelector('.slide h2') as HTMLElement
    h2.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    expect(h2.isContentEditable || h2.getAttribute('contenteditable')).toBeTruthy()
    h2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(h2.getAttribute('contenteditable')).toBeNull()
    press('Escape')
    expect(layer('edit')).toBeNull()
  })

  it('toolkit: laser and pen toggle; keys pause while typing; idle Esc reaches the template', () => {
    const { w, press, layer, state } = openDeck()
    press('l')
    expect(layer('laser')).not.toBeNull()
    press('d')
    expect(layer('ink')?.classList.contains('on')).toBe(true)
    press('l')
    expect(layer('ink')?.classList.contains('on')).toBe(false)
    press('Escape')
    expect(layer('laser')).toBeNull()
    const input = w.document.getElementById('q') as HTMLInputElement
    input.focus()
    for (const k of ['o', '3', 'b']) press(k, input)
    expect([layer('overview'), layer('jump'), layer('black')]).toEqual([null, null, null])
    expect(state.log).toEqual(['o', '3', 'b'])
    press('Escape')
    expect(state.log.at(-1)).toBe('Escape')
  })

  it('toolkit: without window.deck it pages the template with arrow keys and opens #N', async () => {
    const { press, state, w } = openDeck(false)
    press('3')
    press('Enter')
    for (let i = 0; i < 20 && state.idx !== 2; i++) await tick(50)
    expect(state.idx).toBe(2)
    expect(state.log).toEqual(['ArrowRight', 'ArrowRight'])
    await tick(250)
    expect(w.location.hash).toBe('#3')
  })
})
