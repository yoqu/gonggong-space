import {
  type GgArtifactManifest,
  type LintIssue,
  parseStateSet,
  parseStateWhen,
  screenDims,
} from '@gonggong/protocol'
import { screenIdOf } from './files.js'

const WHEN = /\bdata-gg-when\s*=\s*["']([^"']*)["']/gi
const SET_TAG = /<[a-z][^>]*\bdata-gg-set\s*=\s*["']([^"']*)["'][^>]*>/gi
const LINK = /\bdata-gg-link\s*=\s*["']([^"']*)["']/i

const warn = (code: string, message: string, file: string): LintIssue => ({
  code,
  message,
  severity: 'warn',
  file,
})

/** Screen-state findings of a screen (artifact-states.ts): conditions and switches naming what it has not, dims unused. */
export function lintStates(m: GgArtifactManifest, path: string, html: string): LintIssue[] {
  const id = screenIdOf(path)
  if (!id || !m.screens.some((s) => s.id === id)) return []
  const issues: LintIssue[] = []
  const used = new Set<string>()
  const check = (screen: string, pairs: [string, string[]][]) => {
    const dims = screenDims(m, screen)
    for (const [dim, values] of pairs) {
      const d = dims.find((x) => x.id === dim)
      if (screen === id) used.add(dim)
      if (!d)
        issues.push(
          warn(
            'state-unknown',
            screen === id ? `本屏没有状态维度：${dim}` : `屏幕 ${screen} 没有状态维度：${dim}`,
            path,
          ),
        )
      else
        for (const v of values)
          if (!d.values.some((x) => x.id === v))
            issues.push(warn('state-unknown', `状态取值不存在：${dim}=${v}`, path))
    }
  }
  for (const [, text = ''] of html.matchAll(WHEN)) {
    const when = parseStateWhen(text)
    if (!when) issues.push(warn('state-invalid', `状态条件写法不对：${text}`, path))
    else
      check(
        id,
        when.map((c) => [c.dim, c.values]),
      )
  }
  for (const [tag, text = ''] of html.matchAll(SET_TAG)) {
    const set = parseStateSet(text)
    const target = LINK.exec(tag)?.[1] ?? id
    if (!set) issues.push(warn('state-invalid', `状态切换写法不对：${text}`, path))
    else if (m.screens.some((s) => s.id === target))
      check(
        target,
        Object.entries(set).map(([k, v]) => [k, [v]]),
      )
  }
  const unused = screenDims(m, id).filter((d) => !used.has(d.id))
  if (unused.length)
    issues.push(warn('state-unused', `声明了却没用到的状态维度：${unused.map((d) => d.id).join('、')}`, path))
  return issues
}
