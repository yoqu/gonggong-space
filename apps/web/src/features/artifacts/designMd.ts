/**
 * DESIGN.md's YAML front matter (web-prototype kit: `name`, `colors.x`, `rounded.x`, `spacing.x`,
 * `typography.x.{fontFamily,fontSize,fontWeight,lineHeight}`), edited line by line so the rest of the file — the
 * prose, comments, key order — stays as written. tokens.css is generated from it, so token edits are mirrored here.
 */

const FENCE = /^---[ \t]*$/

/** The front matter's lines and where they sit; null without one. */
function frontMatter(md: string) {
  const lines = md.split('\n')
  if (!FENCE.test(lines[0] ?? '')) return null
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l))
  return end < 0 ? null : { lines, end }
}

const KEY = /^(\s*)([^\s:#][^:]*?):(?:\s+(.*))?$/

const unquote = (v: string) => {
  const s = v.trim()
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1)
    try {
      return JSON.parse(s) as string
    } catch {
      return s.slice(1, -1)
    }
  if (s.startsWith("'") && s.endsWith("'") && s.length > 1) return s.slice(1, -1).replaceAll("''", "'")
  return s
}

/** Plain when YAML reads it back as the same string, double-quoted otherwise. */
const scalar = (v: string, wasQuoted: boolean) =>
  wasQuoted || !/^[\p{L}\p{N}][\p{L}\p{N} .,()（）_+/-]*$/u.test(v) || /^(true|false|null|yes|no|~)$/i.test(v)
    ? JSON.stringify(v)
    : v

/** Each key line of the front matter with its path (`['typography', 'body-md', 'fontSize']`). */
function* keyLines(lines: string[], end: number) {
  const stack: { indent: number; key: string }[] = []
  for (let i = 1; i < end; i++) {
    const m = KEY.exec(lines[i] as string)
    if (!m || (lines[i] as string).trimStart().startsWith('#')) continue
    const indent = (m[1] as string).length
    while (stack.length && (stack.at(-1) as { indent: number }).indent >= indent) stack.pop()
    stack.push({ indent, key: unquote(m[2] as string) })
    yield { i, indent, path: stack.map((s) => s.key), value: m[3] ?? '' }
  }
}

/** A top-level front-matter value; '' when there is none. */
export function frontMatterValue(md: string | null, key: string) {
  const fm = md ? frontMatter(md) : null
  if (!fm) return ''
  for (const k of keyLines(fm.lines, fm.end))
    if (k.path.length === 1 && k.path[0] === key) return unquote(k.value)
  return ''
}

export const frontMatterName = (md: string | null) => frontMatterValue(md, 'name')

/** The seed colour the member picked (the panel keeps it as `seed:`, the tokens hold only what it derived). */
export const SEED_KEY = 'seed'

const samePath = (path: string[], want: string[]) =>
  path.length === want.length && want.every((w, i) => w === '*' || w === path[i])

/**
 * `md` with every front-matter value at `path` (`*` matches any key) set to `value`. A missing top-level key is
 * added (a missing front matter too); missing nested keys are left alone.
 */
export function setFrontMatter(md: string, path: string[], value: string) {
  const fm = frontMatter(md)
  if (!fm) return path.length === 1 ? `---\n${path[0]}: ${scalar(value, false)}\n---\n\n${md}` : md
  const lines = [...fm.lines]
  let hit = false
  for (const k of keyLines(fm.lines, fm.end)) {
    if (!samePath(k.path, path) || !k.value.trim()) continue
    hit = true
    const quoted = /^["']/.test(k.value)
    // A trailing `# comment` stays; inside a quoted value `#` is text.
    const close = quoted ? k.value.indexOf(k.value[0] as string, 1) : 0
    const comment = /\s+#.*$/.exec(k.value.slice(Math.max(close, 0) + (quoted ? 1 : 0)))?.[0] ?? ''
    const key = (lines[k.i] as string).slice(0, (lines[k.i] as string).indexOf(':') + 1)
    lines[k.i] = `${key} ${scalar(value, quoted)}${comment}`
  }
  if (!hit && path.length === 1) lines.splice(fm.end, 0, `${path[0]}: ${scalar(value, false)}`)
  return lines.join('\n')
}

const TEXT_FIELD: Record<string, string> = { size: 'fontSize', weight: 'fontWeight', leading: 'lineHeight' }

/** Where a tokens.css name lives in the front matter. */
export function frontMatterPath(token: string): string[] | null {
  let m = /^--color-(.+)$/.exec(token)
  if (m) return ['colors', m[1] as string]
  m = /^--rounded-(.+)$/.exec(token)
  if (m) return ['rounded', m[1] as string]
  m = /^--space-(.+)$/.exec(token)
  if (m) return ['spacing', m[1] as string]
  m = /^--text-(.+)-(size|weight|leading)$/.exec(token)
  if (m) return ['typography', m[1] as string, TEXT_FIELD[m[2] as string] as string]
  // One family for every style (the kit's --font-sans); the front matter names it by its first family.
  if (token === '--font-sans') return ['typography', '*', 'fontFamily']
  return null
}

const firstFamily = (stack: string) => unquote(stack.split(',')[0] ?? '')

/** DESIGN.md with token edits mirrored into its front matter. */
export function syncDesignMd(md: string, changes: Record<string, string>) {
  let out = md
  for (const [token, value] of Object.entries(changes)) {
    const path = frontMatterPath(token)
    if (path) out = setFrontMatter(out, path, token === '--font-sans' ? firstFamily(value) : value)
  }
  return out
}

/** For rendering: the front matter as a fenced YAML block instead of a stray rule and paragraph. */
export function renderableMd(md: string) {
  const fm = frontMatter(md)
  if (!fm) return md
  return ['```yaml', ...fm.lines.slice(1, fm.end), '```', ...fm.lines.slice(fm.end + 1)].join('\n')
}
