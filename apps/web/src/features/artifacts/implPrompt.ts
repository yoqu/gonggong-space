import type { ArtifactLink, GgArtifactManifest } from '@gonggong/protocol'

/** The front matter's top-level scalars and one level of maps (`colors.primary: #fff`), as `key: value` lines. */
function frontMatterLines(md: string) {
  const lines = md.split('\n')
  if (!/^---\s*$/.test(lines[0] ?? '')) return []
  const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l))
  if (end < 0) return []
  const out: string[] = []
  let section = ''
  for (const l of lines.slice(1, end)) {
    const m = /^(\s*)([^\s:#][^:]*?):\s*(.*)$/.exec(l)
    if (!m) continue
    const [, indent = '', key = '', value = ''] = m
    if (!indent) section = value ? '' : key
    if (!value) continue
    const name = indent.length === 2 && section ? `${section}.${key}` : indent ? '' : key
    if (name) out.push(`- ${name}: ${value.replace(/^["']|["']$/g, '')}`)
  }
  return out
}

/**
 * A prompt to hand a coding agent (Stitch's Export › MCP › Copy Prompt): where the prototype is, its screens and
 * flows, and the design system to follow. Written for an agent, so never translated.
 */
export function implementationPrompt(o: {
  title: string
  dir: string
  manifest: GgArtifactManifest | null | undefined
  links: ArtifactLink[]
  designMd: string | null
  /** tokens.css custom properties, for when there is no DESIGN.md front matter. */
  tokens: [string, string][]
}) {
  const { manifest } = o
  const out = [
    `请按共工产物「${o.title}」的高保真原型实现这个产品。原型在仓库的 ${o.dir}/ 目录下（每屏一个 HTML，gg-artifact.json 是屏幕清单，DESIGN.md 与 tokens.css 是设计系统）。`,
    '技术栈：<在这里填写，例如 React + Vite / 微信小程序 / Flutter>',
    '',
  ]
  if (manifest) {
    out.push(`## 屏幕（设备：${manifest.device}，入口：${manifest.entry}）`)
    for (const s of manifest.screens) {
      out.push(`- ${s.id}「${s.title}」：${o.dir}/${s.file}`)
      if (s.prompt?.trim()) out.push(`  说明：${s.prompt.trim().replace(/\s+/g, ' ')}`)
    }
    out.push('')
  }
  if (o.links.length) {
    const title = (id: string) => manifest?.screens.find((s) => s.id === id)?.title ?? id
    out.push('## 跳转关系')
    for (const l of o.links)
      out.push(`- ${title(l.from)} → ${title(l.to)}${l.text ? `（点「${l.text.trim()}」）` : ''}`)
    out.push('')
  }
  const fm = o.designMd ? frontMatterLines(o.designMd) : []
  const tokens = fm.length ? fm : o.tokens.map(([k, v]) => `- ${k}: ${v}`)
  if (tokens.length) {
    out.push('## 设计系统', `完整规范见 ${o.dir}/DESIGN.md；主要令牌：`, ...tokens, '')
  }
  out.push(
    '## 要求',
    '- 先读原型的 HTML 和 DESIGN.md，按原型还原布局、文案与交互，颜色、字体、圆角、间距使用上面的设计令牌。',
    '- 按跳转关系实现页面导航；原型里的示例数据换成真实数据接口或明确的 mock。',
    '- 原型中的 data-gg-* 属性只用于原型工具，实现时不需要保留。',
  )
  return out.join('\n')
}
