import { describe, expect, it } from 'vitest'
import {
  frontMatterName,
  renderableMd,
  setFrontMatter,
  syncDesignMd,
} from '../src/features/artifacts/designMd'
import { designOps } from '../src/features/artifacts/designSystem'
import {
  contrast,
  hexToHsl,
  hslToHex,
  modeOf,
  neutralRole,
  neutralScheme,
  seedScheme,
} from '../src/features/artifacts/palette'
import { parseTokens, writeTokens } from '../src/features/artifacts/tokens'

// R4 of docs/plan/原型编辑器-Stitch对标-开发计划.md: the design-system panel's derivations and file edits.

describe('palette', () => {
  it('round-trips hex through HSL', () => {
    for (const hex of ['#8c5835', '#155332', '#ffffff', '#000000', '#0088ff'])
      expect(hslToHex(hexToHsl(hex) as never)).toBe(hex)
    expect(hexToHsl('#fff')).toEqual({ h: 0, s: 0, l: 1 })
    expect(hexToHsl('nope')).toBeNull()
  })

  it('derives the same primary roles from a seed every time, keeping its hue', () => {
    const light = seedScheme('#8C5835', 'light')
    expect(light).toEqual(seedScheme('#8C5835', 'light'))
    expect(light).toMatchInlineSnapshot(`
      {
        "on-primary": "#ffffff",
        "on-primary-container": "#2c1c11",
        "primary": "#8c5835",
        "primary-container": "#f1e3da",
      }
    `)
    expect(Math.round(hexToHsl(light.primary as string)?.h ?? 0)).toBe(
      Math.round(hexToHsl('#8C5835')?.h ?? 0),
    )
    for (const mode of ['light', 'dark'] as const)
      for (const seed of ['#8C5835', '#ffcc00', '#0088ff', '#155332']) {
        const s = seedScheme(seed, mode)
        expect(contrast(s.primary as string, s['on-primary'] as string)).toBeGreaterThanOrEqual(4.5)
        expect(
          contrast(s['primary-container'] as string, s['on-primary-container'] as string),
        ).toBeGreaterThanOrEqual(4.5)
      }
    // Dark mode lifts the primary and darkens its container.
    const dark = seedScheme('#8C5835', 'dark')
    expect(hexToHsl(dark.primary as string)?.l).toBeGreaterThan(hexToHsl(light.primary as string)?.l ?? 1)
    expect(hexToHsl(dark['primary-container'] as string)?.l).toBeLessThan(0.3)
  })

  it('derives the other mode’s neutrals from the seed, and reads a palette’s mode', () => {
    const colors = {
      primary: '#155332',
      background: '#F5F5F7',
      surface: '#FFFFFF',
      'surface-placeholder': '#F6F6F6',
      'on-surface': '#000000',
      'on-surface-variant': '#737374',
      outline: '#D8D8D8',
      scrim: 'rgba(0, 0, 0, 0.55)',
      error: '#FF4D4F',
    }
    expect(modeOf(colors)).toBe('light')
    const dark = neutralScheme('#155332', 'dark', colors)
    expect(Object.keys(dark)).toEqual([
      'background',
      'surface',
      'surface-placeholder',
      'on-surface',
      'on-surface-variant',
      'outline',
    ])
    expect(dark).toEqual(neutralScheme('#155332', 'dark', colors))
    expect(modeOf({ ...colors, ...dark })).toBe('dark')
    // Text reads on the derived surfaces; the surface sits above the background.
    expect(contrast(dark['on-surface'] as string, dark.surface as string)).toBeGreaterThan(12)
    expect(contrast(dark['on-surface-variant'] as string, dark.background as string)).toBeGreaterThan(4.5)
    expect(hexToHsl(dark.surface as string)?.l).toBeGreaterThan(hexToHsl(dark.background as string)?.l ?? 1)
    // Tinted with the seed's hue (give or take 8-bit rounding at this lightness).
    expect(Math.abs((hexToHsl(dark.surface as string)?.h ?? 0) - (hexToHsl('#155332')?.h ?? 0))).toBeLessThan(
      5,
    )
    expect(neutralRole('primary')).toBeNull()
    expect(neutralRole('on-primary')).toBeNull()
  })
})

const CSS = `/* 麓客+ — generated from DESIGN.md front matter
 * --color-primary: #000; in a comment stays */
:root {
  --color-primary: #155332;
  /* --color-surface: #EEEEEE; */
  --color-surface: #FFFFFF;
  --space-sm:8px ;
  --font-sans: "PingFang SC", sans-serif;
}

.t-body { font-size: var(--text-body-size); }
`

describe('tokens.css write-back', () => {
  it('replaces values in place, keeping comments, order and spacing', () => {
    const out = writeTokens(CSS, {
      '--color-surface': '#101010',
      '--space-sm': '12px',
      '--color-missing': 'red',
    })
    expect(out).toBe(
      CSS.replace('--color-surface: #FFFFFF;', '--color-surface: #101010;').replace(
        '--space-sm:8px ;',
        '--space-sm:12px ;',
      ),
    )
    expect(out).toContain('/* --color-surface: #EEEEEE; */')
    expect(out).toContain('--color-primary: #000; in a comment stays')
    expect(parseTokens(out).vars).toEqual([
      ['--color-primary', '#155332'],
      ['--color-surface', '#101010'],
      ['--space-sm', '12px'],
      ['--font-sans', '"PingFang SC", sans-serif'],
    ])
    expect(writeTokens('.a{}', { '--x': '1' })).toBe('.a{}')
  })
})

const MD = `---
version: alpha
name: 麓客+ 小程序
colors:
  primary: "#155332"
  surface: "#FFFFFF" # cards
rounded:
  sm: 8px
typography:
  body-md:
    fontFamily: PingFang SC
    fontSize: 14px
  title-md:
    fontFamily: PingFang SC
    fontSize: 15px
---

## 品牌色

primary: 主色
`

describe('DESIGN.md front matter', () => {
  it('reads and sets the name, adding it (and a front matter) when missing', () => {
    expect(frontMatterName(MD)).toBe('麓客+ 小程序')
    expect(frontMatterName(setFrontMatter(MD, ['name'], '暖色书房'))).toBe('暖色书房')
    expect(setFrontMatter(MD, ['name'], 'a: b')).toContain('name: "a: b"')
    expect(frontMatterName(setFrontMatter('---\nversion: alpha\n---\n# x', ['name'], '新'))).toBe('新')
    const created = setFrontMatter('# 正文', ['name'], '新系统')
    expect(created).toBe('---\nname: 新系统\n---\n\n# 正文')
    expect(frontMatterName(null)).toBe('')
  })

  it('mirrors token edits into the front matter, keeping quotes, comments and the prose', () => {
    const out = syncDesignMd(MD, {
      '--color-surface': '#101010',
      '--rounded-sm': '12px',
      '--text-title-md-size': '17px',
      '--font-sans': '"Source Han Serif SC", serif',
      '--color-unknown': '#000000',
      '--whatever': '1',
    })
    expect(out).toBe(
      MD.replace('surface: "#FFFFFF" # cards', 'surface: "#101010" # cards')
        .replace('sm: 8px', 'sm: 12px')
        .replace('fontSize: 15px', 'fontSize: 17px')
        .replaceAll('fontFamily: PingFang SC', 'fontFamily: Source Han Serif SC'),
    )
    // The prose's `primary:` is not front matter.
    expect(syncDesignMd(MD, { '--color-primary': '#000000' })).toContain('primary: 主色')
  })

  it('renders the front matter as a YAML block', () => {
    expect(renderableMd(MD).startsWith('```yaml\nversion: alpha')).toBe(true)
    expect(renderableMd('# x')).toBe('# x')
  })
})

describe('save ops', () => {
  const base = { versionId: 'v2', css: CSS, md: MD }
  it('sends changed tokens as token ops and DESIGN.md as a file op', () => {
    const draft = {
      ...base,
      css: writeTokens(CSS, { '--color-surface': '#101010' }),
      md: setFrontMatter(MD, ['name'], '新'),
    }
    expect(designOps(base, draft)).toEqual([
      { kind: 'token', name: '--color-surface', value: '#101010' },
      { kind: 'file', path: 'DESIGN.md', content: draft.md },
    ])
    expect(designOps(base, base)).toEqual([])
  })

  it('sends many token changes as one tokens.css file op', () => {
    const many = `:root {\n${Array.from({ length: 45 }, (_, i) => `  --space-s${i}: ${i}px;`).join('\n')}\n}\n`
    const css = writeTokens(
      many,
      Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`--space-s${i}`, `${i + 1}px`])),
    )
    expect(designOps({ versionId: 'v2', css: many, md: null }, { versionId: 'v2', css, md: null })).toEqual([
      { kind: 'file', path: 'tokens.css', content: css },
    ])
  })
})
