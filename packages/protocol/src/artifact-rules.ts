import { z } from 'zod'

// ── Page business rules: Markdown files that travel with the artifact version, like prototype notes ─────────────
/**
 * `rules/<screen id>.md` holds one screen's rules, `rules/shared.md` the rules several screens use (sections
 * `## S1 …`, referenced as `S1` in page rules). A page rule is a numbered item:
 * `1. **<element>** \`#<anchor>\` [待确认]：<one sentence>`; the anchor names the element's `data-gg-anchor`, none means
 * the whole page. Parsing is lenient (agents write these files too), formatting is canonical.
 */
export const ArtifactRuleFile = z.string().regex(/^rules\/[a-z0-9]+(-[a-z0-9]+)*\.md$/)
export const SHARED_RULES_FILE = 'rules/shared.md'
export const ruleFileOf = (screenId: string) => `rules/${screenId}.md`
/** A stable element mark (`data-gg-anchor`) page rules hang on; survives regenerating the screen, unlike `data-gg-id`. */
export const ArtifactAnchor = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
export const PENDING_MARK = '[待确认]'

export interface PageRule {
  /** What it hangs on, as people read it (an element's name, or 整页). */
  label: string | null
  anchor: string | null
  pending: boolean
  text: string
}

const ITEM = /^\d+[.)]\s+(.*)$/
const LABEL = /^\*\*(.+?)\*\*\s*/
const ANCHOR = /^`#([a-z0-9]+(?:-[a-z0-9]+)*)`\s*/
const PENDING = /^(?:\[待确认\]|【待确认】)\s*/

function parseItem(head: string): PageRule {
  let rest = head
  const take = (re: RegExp) => {
    const m = re.exec(rest)
    if (m) rest = rest.slice(m[0].length)
    return m
  }
  const label = take(LABEL)?.[1] ?? null
  const anchor = take(ANCHOR)?.[1] ?? null
  const pending = take(PENDING) !== null
  return { label, anchor, pending, text: rest.replace(/^[:：]\s*/, '').trim() }
}

export function parseRules(md: string): { title: string | null; rules: PageRule[] } {
  let title: string | null = null
  const rules: PageRule[] = []
  let cur: PageRule | null = null
  for (const line of md.split(/\r?\n/)) {
    const h = /^#\s+(.+)$/.exec(line)
    if (h && title === null && rules.length === 0) {
      title = h[1]?.trim() ?? null
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      cur = parseItem(item[1] ?? '')
      rules.push(cur)
    } else if (cur && /^\s+\S/.test(line)) cur.text = cur.text ? `${cur.text}\n${line.trim()}` : line.trim()
    else if (line.trim()) cur = null
  }
  return { title, rules }
}

export function formatRules(title: string | null, rules: readonly PageRule[]) {
  const items = rules.map((r, i) => {
    const head = [
      `${i + 1}.`,
      r.label ? `**${r.label}**` : '',
      r.anchor ? `\`#${r.anchor}\`` : '',
      r.pending ? PENDING_MARK : '',
    ]
      .filter(Boolean)
      .join(' ')
    const [first = '', ...more] = r.text.split('\n')
    const sep = r.label || r.anchor || r.pending ? '：' : ' '
    return [`${head}${sep}${first}`, ...more.map((l) => `   ${l}`)].join('\n')
  })
  return `${title ? `# ${title}\n\n` : ''}${items.join('\n')}\n`
}

/** `S<n>` references to shared rules in a page rule's text, first occurrence order, unique. */
export function sharedRefsOf(text: string) {
  return [...new Set([...text.matchAll(/(?<![A-Za-z0-9])S(\d{1,3})(?!\d)/g)].map((m) => `S${m[1]}`))]
}

export interface SharedRuleSection {
  id: string
  title: string
  body: string
}

export function parseSharedRules(md: string): SharedRuleSection[] {
  const out: SharedRuleSection[] = []
  let cur: { id: string; title: string; lines: string[] } | null = null
  const flush = () => {
    if (cur) out.push({ id: cur.id, title: cur.title, body: cur.lines.join('\n').trim() })
  }
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(S\d{1,3})\s*[·.:：-]?\s*(.*)$/.exec(line)
    if (h) {
      flush()
      cur = { id: h[1] ?? '', title: (h[2] ?? '').trim(), lines: [] }
    } else if (/^#{1,2}\s/.test(line)) {
      flush()
      cur = null
    } else cur?.lines.push(line)
  }
  flush()
  return out
}
