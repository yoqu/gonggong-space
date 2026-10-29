import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  PLUGIN_MANIFEST,
  PLUGIN_MAX_BYTES,
  PLUGIN_MAX_FILES,
  PluginManifest,
  tokensCssOk,
} from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
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

  it('ships the platform kit and the app-screens template on the luke-plus design system', () => {
    for (const f of ['index.html', 'gg-kit.css', 'gg-kit.js'])
      expect(existsSync(join(skillDir, 'kit', f)), f).toBe(true)
    expect(manifest.templates.map((t) => t.id)).toEqual(['app-screens'])
    expect(manifest.designSystems.map((d) => d.id)).toEqual(['luke-plus'])
  })

  it('tells the agent to bring DESIGN.md along and to copy the kit only without hosting', () => {
    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(skill).toContain('├── DESIGN.md')
    expect(skill).toMatch(/Hosted.*Do \*\*not\*\* copy `index.html` or `_gg\/`/)
    expect(skill).toMatch(/Not hosted.*copy `kit\/index.html`/)
    for (const ds of manifest.designSystems)
      expect(tokensCssOk(readFileSync(join(skillDir, ds.dir, 'tokens.css'), 'utf8')), ds.id).toBe(true)
  })

  it('has an example that keeps the screen contract', () => {
    for (const f of ['DESIGN.md', 'tokens.css'])
      expect(readFileSync(join(example, f), 'utf8'), f).toBe(
        readFileSync(join(skillDir, 'design-systems/luke-plus', f), 'utf8'),
      )
    expect(ids.has(app.entry)).toBe(true)
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
