import {
  type ArtifactFile,
  formatRules,
  type GgArtifactManifest,
  type LintIssue,
  type PageRule,
  parseRules,
  parseSharedRules,
  ruleFileOf,
  SHARED_RULES_FILE,
  sharedRefsOf,
} from '@gonggong/protocol'

// Page business rules (rules/<screen id>.md, rules/shared.md; packages/protocol/src/artifact-rules.ts).

type Read = (path: string) => Promise<string | null>

const RULE_FILE = /^rules\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const hasAnchor = (html: string, anchor: string) =>
  new RegExp(`\\bdata-gg-anchor\\s*=\\s*["']?${anchor}(?=["'\\s>])`).test(html)

const screenFile = (m: GgArtifactManifest | null, id: string) =>
  m?.screens.find((s) => s.id === id)?.file ?? `screens/${id}.html`

/** Rules naming an anchor their screen does not have, or a shared rule rules/shared.md does not define. */
export async function lintRules(files: ArtifactFile[], read: Read, m: GgArtifactManifest | null) {
  const issues: LintIssue[] = []
  const warn = (code: string, message: string, file: string) =>
    issues.push({ code, message, severity: 'warn', file })
  const shared = await read(SHARED_RULES_FILE)
  const sharedIds = new Set(shared === null ? [] : parseSharedRules(shared).map((s) => s.id))
  for (const f of files) {
    const id = RULE_FILE.exec(f.path)?.[1]
    if (!id || f.path === SHARED_RULES_FILE) continue
    const { rules } = parseRules((await read(f.path)) ?? '')
    const html = await read(screenFile(m, id))
    const anchors = new Set(rules.flatMap((r) => (r.anchor ? [r.anchor] : [])))
    if (html !== null)
      for (const a of anchors)
        if (!hasAnchor(html, a))
          warn('rule-anchor-missing', `规则引用的锚点 #${a} 在屏幕里没有对应的 data-gg-anchor`, f.path)
    const refs = new Set(rules.flatMap((r) => sharedRefsOf(r.text)))
    for (const ref of refs)
      if (!sharedIds.has(ref))
        warn('rule-shared-missing', `规则引用的共享规则 ${ref} 在 ${SHARED_RULES_FILE} 里不存在`, f.path)
  }
  return issues
}

/** A rule as written in the file, keeping its number. */
const ruleLine = (r: PageRule, n: number) => formatRules(null, [r]).trimEnd().replace(/^1\./, `${n}.`)

/** The rules of `screenIds` with the shared ones they cite, for the agent (not translated); empty when none. */
export async function rulesContext(read: Read, screenIds: string[]) {
  const lines: string[] = []
  const cited = new Set<string>()
  for (const id of screenIds) {
    const md = await read(ruleFileOf(id))
    if (md === null) continue
    const numbered = parseRules(md).rules.map((r, i) => ({ r, n: i + 1 }))
    if (!numbered.length) continue
    const settled = numbered.filter((x) => !x.r.pending)
    const pending = numbered.filter((x) => x.r.pending)
    lines.push(`屏幕 ${id} 的业务规则（${ruleFileOf(id)}）：`, ...settled.map((x) => ruleLine(x.r, x.n)))
    if (pending.length)
      lines.push(
        '未定（[待确认]，先按建议值实现，不要删掉标记）：',
        ...pending.map((x) => ruleLine(x.r, x.n)),
      )
    for (const x of numbered) for (const ref of sharedRefsOf(x.r.text)) cited.add(ref)
  }
  const shared = cited.size ? await read(SHARED_RULES_FILE) : null
  const sections = shared === null ? [] : parseSharedRules(shared).filter((s) => cited.has(s.id))
  if (sections.length)
    lines.push(
      `引用的共享规则（${SHARED_RULES_FILE}）：`,
      ...sections.map((s) => `## ${s.id} ${s.title}\n${s.body}`),
    )
  return lines
}
