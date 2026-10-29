import { createHash } from 'node:crypto'
import {
  type ArtifactFile,
  GG_ARTIFACT_MANIFEST,
  GgArtifactManifest,
  type LintIssue,
} from '@gonggong/protocol'
import { type Kit, kitName } from './kit.js'

const warn = (code: string, message: string, file?: string): LintIssue => ({
  code,
  message,
  severity: 'warn',
  ...(file && { file }),
})

const LINK = /\bdata-gg-link\s*=\s*["']([^"']*)["']/gi
const STYLE_ATTR = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const STYLE_TAG = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi
const EXTERNAL = [
  /<script\b[^>]*\bsrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi,
  /<link\b[^>]*\bhref\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi,
  /@import\s+(?:url\()?\s*["']?((?:https?:)?\/\/[^"')\s;]+)/gi,
]

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/**
 * Design-rule findings of a version (§3.3): they never block it, the next run's context lists them. `read` gives a
 * file's content; `kit` is the plugin's shell, which L1 artifacts must not change.
 */
export async function lintVersion(
  files: ArtifactFile[],
  read: (f: ArtifactFile) => Promise<Buffer>,
  kit: Kit | null,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const byPath = new Map(files.map((f) => [f.path, f]))
  const manifestFile = byPath.get(GG_ARTIFACT_MANIFEST)
  let screens: Set<string> | null = null
  if (manifestFile) {
    const parsed = parseManifest((await read(manifestFile)).toString('utf8'))
    if ('error' in parsed) issues.push(warn('manifest-invalid', parsed.error, GG_ARTIFACT_MANIFEST))
    else {
      screens = new Set(parsed.manifest.screens.map((s) => s.id))
      for (const s of parsed.manifest.screens)
        if (!byPath.has(s.file))
          issues.push(warn('screen-missing', `清单里的屏幕文件不存在：${s.file}`, GG_ARTIFACT_MANIFEST))
    }
  } else if (!byPath.has('index.html'))
    issues.push(warn('entry-missing', `缺少 ${GG_ARTIFACT_MANIFEST}（多屏）或 index.html（单页）`))

  const l1 = !!manifestFile
  for (const f of files) {
    if (!f.path.endsWith('.html') || (l1 && kitName(f.path))) continue
    const html = (await read(f)).toString('utf8')
    if (screens) {
      const missing = new Set(
        [...html.matchAll(LINK)].map((m) => m[1] ?? '').filter((id) => !screens.has(id)),
      )
      for (const id of missing) issues.push(warn('link-missing', `跳转目标屏幕不存在：${id}`, f.path))
    }
    const styles = [
      ...[...html.matchAll(STYLE_ATTR)].map((m) => m[1] ?? m[2] ?? ''),
      ...[...html.matchAll(STYLE_TAG)].map((m) => m[1] ?? ''),
    ]
    const colors = styles.reduce((n, s) => n + (s.match(COLOR)?.length ?? 0), 0)
    if (colors)
      issues.push(
        warn('hardcoded-color', `样式里有 ${colors} 处写死的色值，请改用令牌 var(--color-…)`, f.path),
      )
    const external = new Set(EXTERNAL.flatMap((re) => [...html.matchAll(re)].map((m) => m[1] ?? '')))
    for (const url of external) issues.push(warn('external-resource', `引用了外部资源：${url}`, f.path))
  }

  if (l1 && kit)
    for (const f of files) {
      const name = kitName(f.path)
      if (!name) continue
      const want = kit.get(name)
      if (!want || sha256(want) !== f.hash)
        issues.push(warn('kit-modified', `平台外壳文件被改动：${f.path}（预览以插件外壳为准）`, f.path))
    }
  return issues
}

export function parseManifest(text: string): { manifest: GgArtifactManifest } | { error: string } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { error: `${GG_ARTIFACT_MANIFEST} 不是合法的 JSON` }
  }
  const r = GgArtifactManifest.safeParse(json)
  if (r.success) return { manifest: r.data }
  const i = r.error.issues[0]
  return {
    error: `${GG_ARTIFACT_MANIFEST} 不符合清单格式：${i?.path.join('.') ?? ''} ${i?.message ?? ''}`.trim(),
  }
}
