import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Component CSS of web and desktop (desktop reuses web components); tokens.css defines the scale itself.
const ROOTS = ['src', '../desktop/src']
const files = ROOTS.flatMap((root) =>
  (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.css') && !f.endsWith('styles/tokens.css'))
    .map((f) => join(root, f)),
)

const declarations = (prop: RegExp) =>
  files.flatMap((file) =>
    [
      ...readFileSync(file, 'utf8').matchAll(new RegExp(`(?:^|[\\s;{])(${prop.source}):\\s*([^;{}]+)`, 'g')),
    ].map(([, , value]) => ({ file: relative('src', file), value: (value ?? '').trim() })),
  )

/** Lengths outside any calc()/var(): those are the values the rule actually sets. */
const topLevelLengths = (value: string) => {
  let depth = 0
  return value.split(/([()]|\s+)/).filter((tok) => {
    if (tok === '(') depth++
    else if (tok === ')') depth--
    return depth === 0 && /^[\d.]+(px|%)$/.test(tok)
  })
}

// Shapes that are not on the radius scale, each with the reason it stays a literal.
const RADIUS_LITERALS: Record<string, string[]> = {
  // Circles and the avatar squircle.
  '50%': ['*'],
  '28%': ['*'],
  // Half the height of a thin bar, rail, swatch or grip.
  '1px': ['ui/toast.css', 'features/files/files.css'],
  '1.5px': ['features/diff/diff.css'],
  '2px': [
    'ui/level.css',
    'ui/video-player.css',
    'features/artifacts/artifacts.css',
    'features/chat/composer-dock.css',
    'features/diff/diff.css',
    'features/usage/usage.css',
    'features/files/files.css',
    'features/runs/context-window.css',
    'features/git/branches.css',
  ],
  // Speech-bubble notes on the artifact canvas: three round corners and a pointed one.
  '9px': ['features/artifacts/artifacts.css'],
  '11px': ['features/artifacts/artifacts.css'],
  // macOS notification card and the pinned provider banner that mimics it.
  '18px': ['ui/notification-banner.css', 'features/chat/composer.css'],
  // HUD and the floating composer orb.
  '22px': ['ui/toast.css', 'features/chat/composer-dock.css'],
  // Phone / tablet frames around prototype screens.
  '20px': ['features/artifacts/prototype.css'],
  '28px': ['features/artifacts/artifacts.css'],
  '30px': ['features/artifacts/prototype.css'],
  '36px': ['features/artifacts/prototype.css'],
  '46px': ['features/artifacts/prototype.css'],
}

describe('component CSS stays on the design scale', () => {
  it('scans both web and desktop CSS', () => {
    expect(files.some((f) => f.includes('desktop'))).toBe(true)
    expect(files.length).toBeGreaterThan(100)
  })

  it('uses --radius-* tokens instead of literal radii', () => {
    const offScale = declarations(/border(?:-[a-z]+)*-radius/).flatMap(({ file, value }) =>
      topLevelLengths(value)
        .filter((len) => {
          const allowed = RADIUS_LITERALS[len]
          return !allowed || !(allowed.includes('*') || allowed.includes(file))
        })
        .map((len) => `${file}: ${len} (${value})`),
    )
    expect(offScale).toEqual([])
  })

  it('uses only the 400 / 500 / 600 font weights', () => {
    const offScale = declarations(/font-weight/)
      .filter(({ value }) => !/^(400|500|600|inherit|normal|var\(--text-[\w-]+-weight\))$/.test(value))
      .map(({ file, value }) => `${file}: ${value}`)
    expect(offScale).toEqual([])
  })

  it('no longer references the legacy motion tokens', () => {
    const legacy = files.filter((f) => /var\(--(motion-base|ease-apple)\)/.test(readFileSync(f, 'utf8')))
    expect(legacy).toEqual([])
  })
})
