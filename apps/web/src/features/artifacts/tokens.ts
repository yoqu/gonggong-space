/**
 * What the design-system node shows of an artifact's tokens.css (web-prototype kit naming: --color-x, --rounded-x,
 * --space-x, --text-x-{size,weight,leading} with a .t-x class each, --font-sans). Values are only ever used as
 * inline custom properties, never as a stylesheet, so the artifact cannot style the main site.
 */
export interface DesignTokens {
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
