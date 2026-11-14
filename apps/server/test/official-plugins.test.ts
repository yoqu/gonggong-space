import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  GgArtifactManifest,
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
    'agent-deepseek',
    'agent-gemini',
    'agent-pi',
    'provider-presets',
    'slides',
    'web-prototype',
  ])
})

describe.each(['gemini', 'codebuddy', 'pi', 'deepseek', 'antigravity'])(
  'official agent plugin agent-%s',
  (id) => {
    it('adapts that agent, runs code, and ships its launch script and icon', () => {
      const { root, manifest } = load(`agent-${id}`)
      expect(manifest).toMatchObject({ category: 'agent', entry: null, permissions: ['exec'], agents: [id] })
      const [agent, ...more] = manifest.contributes.agents
      expect(more).toEqual([])
      expect(agent!.id).toBe(id)
      for (const f of [manifest.icon!, ...(agent!.launchScript ? [agent!.launchScript] : [])])
        expect(existsSync(join(root, f)), f).toBe(true)
    })
  },
)

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

describe('official plugin provider-presets', () => {
  it('carries the presets built into the daemon, and nothing a group would turn on', () => {
    const { manifest } = load('provider-presets')
    const bundled = JSON.parse(
      readFileSync(join(OFFICIAL, '../../../../crates/gonggong/presets/providers.json'), 'utf8'),
    ) as { source: string; presets: unknown[] }
    expect(manifest.contributes.providers).toEqual(bundled.presets.map((p) => ProviderPreset.parse(p)))
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
      if (t.preview) expect(existsSync(join(root, t.preview)), t.preview).toBe(true)
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
  const { manifest } = load('slides')

  it('is a deck plugin whose templates carry their own visual systems', () => {
    expect(manifest.category).toBe('deck')
    expect(manifest.designSystems).toEqual([])
    expect(manifest.templates[0]?.id).toBe('html-ppt')
  })
})
