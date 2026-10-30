import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  GgArtifactManifest,
  PLUGIN_MANIFEST,
  PLUGIN_MAX_BYTES,
  PLUGIN_MAX_FILES,
  PluginManifest,
  tokensCssOk,
} from '@gonggong/protocol'
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
  return { root, manifest, skillDir: join(root, 'skills', manifest.entry) }
}

describe.each(readdirSync(OFFICIAL).sort())('official plugin %s', (name) => {
  const { root, manifest, skillDir } = load(name)

  it('has a valid manifest named after its folder', () => {
    expect(manifest.name).toBe(name)
    expect(manifest.templates.every((t) => t.group)).toBe(true)
    expect(manifest.designSystems.every((d) => d.category)).toBe(true)
    expect(manifest.inputs.find((i) => i.id === 'title')?.required).toBe(true)
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
    entry: string
    screens: { id: string; file: string }[]
  }
  const ids = new Set(app.screens.map((s) => s.id))

  it('ships the platform kit, the app-screens template and five design systems', () => {
    for (const f of ['index.html', 'gg-kit.css', 'gg-kit.js'])
      expect(existsSync(join(skillDir, 'kit', f)), f).toBe(true)
    expect(manifest.version).toBe('0.6.0')
    expect(manifest.templates.map((t) => t.id)).toEqual(['app-screens'])
    expect(manifest.designSystems.map((d) => d.id)).toEqual([
      'luke-plus',
      'warm-paper',
      'geometric',
      'glacier',
      'neon-night',
    ])
  })

  it('asks for the device and the design sources (DESIGN.md, website, repository)', () => {
    const inputs = new Map(manifest.inputs.map((i) => [i.id, i]))
    expect(inputs.get('device')).toMatchObject({
      type: 'select',
      options: ['小程序', '手机 App', '桌面 Web'],
      default: '小程序',
    })
    expect(inputs.get('design_md')).toMatchObject({ label: '粘贴 DESIGN.md', type: 'text' })
    expect(inputs.get('reference_url')).toMatchObject({ label: '参考网站', type: 'string' })
    expect(inputs.get('reference_repo')).toMatchObject({ label: '参考仓库', type: 'string' })
    expect([...inputs.values()].filter((i) => i.designSource).map((i) => i.id)).toEqual([
      'design_md',
      'reference_url',
      'reference_repo',
    ])
    expect(manifest.templates[0]?.inputs).toEqual(
      expect.arrayContaining(['device', 'design_md', 'reference_url', 'reference_repo']),
    )
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    for (const s of [
      '`小程序` → `miniprogram`, `手机 App` → `mobile`, `桌面 Web` → `desktop`',
      '`粘贴 DESIGN.md` is given, or an attachment is named `DESIGN.md`',
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
})

describe('official plugin slides', () => {
  const { manifest } = load('slides')

  it('is a deck plugin whose templates carry their own visual systems', () => {
    expect(manifest.category).toBe('deck')
    expect(manifest.designSystems).toEqual([])
    expect(manifest.templates[0]?.id).toBe('html-ppt')
  })
})
