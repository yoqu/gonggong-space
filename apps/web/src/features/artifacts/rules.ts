import {
  type ArtifactEditOp,
  BridgeAnchorRect,
  formatRules,
  type PageRule,
  parseRules,
  parseSharedRules,
  ruleFileOf,
  SHARED_RULES_FILE,
  sharedRefsOf,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'

/** One screen's rules file, parsed. */
export interface ScreenRules {
  title: string | null
  rules: PageRule[]
  /** The file as written. */
  md: string
}

/** The shown version's rule files: page rules by screen id, the shared rules' Markdown (null: none). */
export interface RuleData {
  pages: Record<string, ScreenRules>
  shared: string | null
}

export const NO_RULES: RuleData = { pages: {}, shared: null }
const RULE_FILE = /^rules\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

/** Loads every `rules/*.md` of the version; reloads when one of them changes. A missing file is no rules. */
export function useRuleFiles(
  files: { path: string; hash: string }[] | null,
  read: (file: string) => Promise<string>,
  versionKey: string,
): RuleData {
  const ruleFiles = (files ?? []).filter((f) => RULE_FILE.test(f.path))
  const key = `${versionKey}|${ruleFiles.map((f) => `${f.path}:${f.hash}`).join('|')}`
  const [data, setData] = useState<{ key: string; data: RuleData }>({ key: '', data: NO_RULES })
  // biome-ignore lint/correctness/useExhaustiveDependencies: by the files' key only
  useEffect(() => {
    if (!ruleFiles.length) return setData({ key, data: NO_RULES })
    let live = true
    void Promise.all(ruleFiles.map((f) => read(f.path).then((text) => [f.path, text] as const))).then(
      (texts) => {
        if (!live) return
        const out: RuleData = { pages: {}, shared: null }
        for (const [path, text] of texts) {
          if (path === SHARED_RULES_FILE) out.shared = text
          else out.pages[RULE_FILE.exec(path)?.[1] as string] = { ...parseRules(text), md: text }
        }
        setData({ key, data: out })
      },
      () => live && setData({ key, data: NO_RULES }),
    )
    return () => {
      live = false
    }
  }, [key])
  return data.data
}

export const ruleStats = (rules: readonly PageRule[]) => ({
  total: rules.length,
  pending: rules.filter((r) => r.pending).length,
})

/** The label the agent and people read for a whole-page rule. */
export const WHOLE_PAGE = '整页'
export const isWholePage = (r: Pick<PageRule, 'anchor'>) => !r.anchor

/** What a new rule hangs on by default: the element's text, first 12 characters, else its tag. */
export const defaultLabel = (el: { text: string; tag: string }) => {
  const text = el.text.replace(/\s+/g, ' ').trim()
  return text ? [...text].slice(0, 12).join('') : el.tag
}

const ANCHOR_MAX = 40
const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** `s` cut to `max` characters at a word boundary of the kebab. */
const cut = (s: string, max: number) => {
  if (s.length <= max) return s
  const at = s.lastIndexOf('-', max)
  return at > 0 ? s.slice(0, at) : s.slice(0, max)
}

/**
 * A `data-gg-anchor` for an element named `label`: its kebab (Chinese romanized by `romanize`), else its tag, unique in
 * the screen (`taken`) with `-2`, `-3`….
 */
export function anchorFor(
  label: string,
  tag: string,
  taken: Iterable<string>,
  romanize: (s: string) => string = (s) => s,
) {
  const used = new Set(taken)
  const base = cut(kebab(romanize(label)), ANCHOR_MAX) || kebab(tag) || 'el'
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const tail = `-${i}`
    const next = `${cut(base, ANCHOR_MAX - tail.length)}${tail}`
    if (!used.has(next)) return next
  }
}

/** Romanizes Chinese with pinyin (the dictionary loads on first use, when a rule is saved). */
export async function loadRomanizer() {
  const { pinyin } = await import('pinyin-pro')
  return (s: string) => pinyin(s, { toneType: 'none', separator: ' ', nonZh: 'consecutive', v: true })
}

/** Where a new rule goes: an element of the screen (`ggId`, its anchor when it has one), or the whole page. */
export interface RuleTarget {
  label: string
  file: string
  ggId: string | null
  /** The element's `data-gg-anchor`, when it has one. */
  anchor: string | null
  tag: string
}

/** The screen's rules file rewritten (rules numbered by their order). */
export const ruleFileOp = (
  screenId: string,
  title: string | null,
  rules: readonly PageRule[],
): ArtifactEditOp => ({
  kind: 'file',
  path: ruleFileOf(screenId),
  content: formatRules(title, rules),
})

/**
 * The ops adding a rule: the rules file, and before it the element's new `data-gg-anchor` when it has none yet (one
 * version for both). Without a target or a ggId the rule hangs on the whole page.
 */
export function addRuleOps(o: {
  screenId: string
  title: string | null
  rules: readonly PageRule[]
  target: RuleTarget | null
  text: string
  pending: boolean
  /** Anchors already in the screen (its elements' and its rules'). */
  taken: Iterable<string>
  romanize?: (s: string) => string
}): ArtifactEditOp[] {
  const t = o.target
  const anchor = t ? (t.anchor ?? (t.ggId ? anchorFor(t.label, t.tag, o.taken, o.romanize) : null)) : null
  const rule: PageRule = {
    label: anchor ? t?.label.trim() || null : WHOLE_PAGE,
    anchor,
    pending: o.pending,
    text: o.text.trim(),
  }
  const ops: ArtifactEditOp[] = []
  if (t?.ggId && anchor && !t.anchor)
    ops.push({ kind: 'attr', file: t.file, ggId: t.ggId, name: 'data-gg-anchor', value: anchor })
  ops.push(ruleFileOp(o.screenId, o.title, [...o.rules, rule]))
  return ops
}

/** The well-formed anchor spots of a `ready` / `size` message; undefined when it reports none. */
export function anchorSpots(anchors: unknown): BridgeAnchorRect[] | undefined {
  if (!Array.isArray(anchors)) return undefined
  return anchors.flatMap((a) => {
    const ok = BridgeAnchorRect.safeParse(a)
    return ok.success ? [ok.data] : []
  })
}

/** A page rule that refers to a shared one: its screen and number. */
export interface SharedRef {
  screenId: string
  title: string
  n: number
}

/** Per shared rule (`S1`…), the page rules referring to it, in screen order. */
export function sharedRefs(pages: RuleData['pages'], screens: { id: string; title: string }[]) {
  const out: Record<string, SharedRef[]> = {}
  for (const s of screens)
    for (const [i, r] of (pages[s.id]?.rules ?? []).entries())
      for (const id of sharedRefsOf(r.text)) {
        out[id] = out[id] ?? []
        out[id].push({ screenId: s.id, title: s.title, n: i + 1 })
      }
  return out
}

/** How many screens refer to any shared rule. */
export const referringScreens = (refs: Record<string, SharedRef[]>) =>
  new Set(Object.values(refs).flatMap((l) => l.map((r) => r.screenId))).size

/** The shared rules' Markdown in chunks, one per `##` section (`id`: its `S<n>`, null for the rest). */
export function sharedChunks(md: string): { id: string | null; text: string }[] {
  const out: { id: string | null; lines: string[] }[] = [{ id: null, lines: [] }]
  for (const line of md.split(/\r?\n/)) {
    if (/^#{1,2}\s/.test(line)) out.push({ id: /^##\s+(S\d{1,3})\b/.exec(line)?.[1] ?? null, lines: [] })
    out.at(-1)?.lines.push(line)
  }
  return out.map((c) => ({ id: c.id, text: c.lines.join('\n').trim() })).filter((c) => c.text)
}

/** A page rule's text split at its `S<n>` references (odd parts are the references). */
export const splitRefs = (text: string) => text.split(/(?<![A-Za-z0-9])(S\d{1,3})(?!\d)/)

export const NEW_SHARED = '# 共享规则\n\n## S1 \n'

/**
 * The prompt's rules of one screen (for an agent, never translated): its settled rules, the pending ones apart as 未定,
 * and the shared rules they refer to. Empty without rules.
 */
export function promptRules(
  rules: readonly PageRule[] | undefined,
  shared: string | null,
  sharedPath: string,
) {
  if (!rules?.length) return []
  const line = (r: PageRule, i: number) =>
    `  ${i + 1}. ${r.anchor ? `${r.label ?? r.anchor}（data-gg-anchor="${r.anchor}"）` : WHOLE_PAGE}：${r.text.replace(/\s*\n\s*/g, ' ')}`
  const numbered = rules.map((r, i) => ({ r, i }))
  const settled = numbered.filter((x) => !x.r.pending)
  const pending = numbered.filter((x) => x.r.pending)
  const out: string[] = []
  if (settled.length) out.push('  本屏业务规则：', ...settled.map((x) => line(x.r, x.i)))
  if (pending.length) out.push('  未定（待确认，实现前先问清楚）：', ...pending.map((x) => line(x.r, x.i)))
  const ids = new Set(rules.flatMap((r) => sharedRefsOf(r.text)))
  const sections = shared ? parseSharedRules(shared).filter((s) => ids.has(s.id)) : []
  if (sections.length)
    out.push(`  引用的共享规则（全文见 ${sharedPath}）：`, ...sections.map((s) => `  - ${s.id} ${s.title}`))
  return out
}
