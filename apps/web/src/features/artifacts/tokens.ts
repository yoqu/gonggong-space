/**
 * What the design-system node shows of an artifact's tokens.css (web-prototype kit naming: --color-x, --rounded-x,
 * --space-x, --text-x-{size,weight,leading} with a .t-x class each, --font-sans). Values are only ever used as
 * inline custom properties, never as a stylesheet, so the artifact cannot style the main site.
 */
export interface DesignTokens {
  /** DESIGN.md's front-matter `name`, when there is one. */
  name?: string
  /** Every `:root` custom property, in source order. */
  vars: [string, string][]
  /** Colours grouped by role: `primary` holds --color-primary and --color-on-primary. */
  colors: { group: string; items: { name: string; value: string }[] }[]
  /** One per `.t-x` class. */
  type: { name: string; size: string; weight: string; leading: string }[]
  radii: { name: string; value: string }[]
  spacing: { name: string; value: string }[]
}

const DECL = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi
const TYPE_CLASS = /\.t-([a-z0-9-]+)\s*\{/gi

const usable = (v: string) => !/url\(|expression|[<>]/i.test(v)

export function parseTokens(css: string): DesignTokens {
  const root = /:root\s*\{([^}]*)\}/i.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? ''
  const vars: [string, string][] = []
  for (const m of root.matchAll(DECL)) {
    const value = (m[2] ?? '').trim()
    if (usable(value)) vars.push([m[1] as string, value])
  }
  const map = new Map(vars)
  const groups = new Map<string, { name: string; value: string }[]>()
  for (const [k, value] of vars) {
    if (!k.startsWith('--color-')) continue
    const name = k.slice('--color-'.length)
    const group = name.replace(/^on-/, '').split('-')[0] ?? name
    groups.set(group, [...(groups.get(group) ?? []), { name, value }])
  }
  const scale = (prefix: string) =>
    vars.filter(([k]) => k.startsWith(prefix)).map(([k, value]) => ({ name: k.slice(prefix.length), value }))
  const type = [...new Set([...css.matchAll(TYPE_CLASS)].map((m) => m[1] as string))].map((name) => ({
    name,
    size: map.get(`--text-${name}-size`) ?? '',
    weight: map.get(`--text-${name}-weight`) ?? '',
    leading: map.get(`--text-${name}-leading`) ?? '',
  }))
  return {
    vars,
    colors: [...groups].map(([group, items]) => ({ group, items })),
    type,
    radii: scale('--rounded-'),
    spacing: scale('--space-'),
  }
}

/** Comments blanked to spaces, so offsets into it are offsets into the source. */
const masked = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))

/**
 * tokens.css with the `:root` values of `changes` (keyed `--x`) replaced in place: comments, order, formatting and
 * the rest of the file stay as they were. Names not declared are ignored (a token op only changes existing ones).
 */
export function writeTokens(css: string, changes: Record<string, string>) {
  const src = masked(css)
  const root = /:root\s*\{([^}]*)\}/i.exec(src)
  if (!root) return css
  const start = root.index + root[0].indexOf('{') + 1
  const spans: [number, number, string][] = []
  for (const m of (root[1] ?? '').matchAll(DECL)) {
    const value = changes[m[1] as string]
    if (value === undefined) continue
    const raw = m[2] as string
    const at = start + (m.index ?? 0) + m[0].length - 1 - raw.length
    spans.push([at, at + raw.trimEnd().length, value])
  }
  let out = css
  for (const [from, to, value] of spans.reverse()) out = out.slice(0, from) + value + out.slice(to)
  return out
}

export type ColorRole = 'primary' | 'accent' | 'neutral' | 'semantic' | 'other'

const ROLE_OF: [ColorRole, RegExp][] = [
  ['primary', /^(on-)?(primary|brand)\b/],
  ['accent', /^(on-)?(secondary|tertiary|accent)\b/],
  ['semantic', /^(on-)?(success|warning|danger|error|info|positive|negative|critical)\b/],
  [
    'neutral',
    /^(on-)?(background|bg|surface|foreground|fg|text|ink|outline|border|divider|separator|neutral|muted|gray|grey|black|white|scrim|shadow|overlay|inverse|disabled)\b/,
  ],
]

/** The role a colour token plays, by its name (`on-primary` goes with `primary`). */
export const colorRole = (name: string): ColorRole => ROLE_OF.find(([, re]) => re.test(name))?.[0] ?? 'other'

/** Colour tokens by role (Stitch's Primary / Secondary / Neutral …), in role order, each in source order. */
export function colorRoles<T extends { name: string }>(colors: T[]) {
  const order: ColorRole[] = ['primary', 'accent', 'neutral', 'semantic', 'other']
  return order
    .map((role) => ({ role, items: colors.filter((c) => colorRole(c.name) === role) }))
    .filter((g) => g.items.length)
}
