import { BRIDGE_SCRIPT_PATH } from '@gonggong/protocol'
import { type DefaultTreeAdapterMap, parse } from 'parse5'
import { fail } from '../../lib/errors.js'

/**
 * Elements of an artifact's HTML by `data-gg-id` (§3.5): the start offset of their start tag in the stored source.
 * Elements the parser implied (no start tag in the source) have none and cannot be edited directly.
 */
export type Element = DefaultTreeAdapterMap['element']
type Node = DefaultTreeAdapterMap['childNode'] | DefaultTreeAdapterMap['document']

const isElement = (n: unknown): n is Element => !!n && typeof n === 'object' && 'tagName' in n

function walk(node: Node, visit: (el: Element) => void) {
  if (isElement(node)) {
    visit(node)
    if (node.tagName === 'template')
      walk((node as DefaultTreeAdapterMap['template']).content as unknown as Node, visit)
  }
  if ('childNodes' in node) for (const c of node.childNodes) walk(c, visit)
}

export function parseHtml(html: string) {
  return parse(html, { sourceCodeLocationInfo: true })
}

/** Located elements by their start tag offset. */
export function elementsOf(html: string) {
  const out = new Map<number, Element>()
  walk(parseHtml(html), (el) => {
    const at = el.sourceCodeLocation?.startTag?.startOffset
    if (at !== undefined) out.set(at, el)
  })
  return out
}

export const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value ?? null

export function textOf(node: Node): string {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value
  return 'childNodes' in node ? node.childNodes.map((c) => textOf(c)).join('') : ''
}

/** The nearest `data-section` around an element (itself included). */
export function sectionOf(el: Element) {
  for (let n: unknown = el; isElement(n); n = n.parentNode) {
    const s = attr(n, 'data-section')
    if (s !== null) return s
  }
  return null
}

/** One-based line of an offset. */
export const lineOf = (html: string, offset: number) => html.slice(0, offset).split('\n').length

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const escText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A screen as a member's preview serves it: every located element gets `data-gg-id`, and the bridge script loads
 * before `</body>` with the main site's origin. The stored source is never changed.
 */
export function injectBridge(html: string, parentOrigin: string) {
  const doc = parseHtml(html)
  const inserts: [number, string][] = []
  let body: Element | undefined
  walk(doc, (el) => {
    const tag = el.sourceCodeLocation?.startTag
    if (tag) inserts.push([tag.startOffset + 1 + el.tagName.length, ` data-gg-id="${tag.startOffset}"`])
    if (el.tagName === 'body') body = el
  })
  const end = body?.sourceCodeLocation?.endTag?.startOffset ?? html.length
  inserts.push([
    end,
    `<script src="${BRIDGE_SCRIPT_PATH}" data-gg-parent="${escAttr(parentOrigin)}"></script>`,
  ])
  inserts.sort((a, b) => b[0] - a[0])
  let out = html
  for (const [at, text] of inserts) out = out.slice(0, at) + text + out.slice(at)
  return out
}

/** `data-gg-link`s of a screen. */
export function linksOf(html: string) {
  return [...elementsOf(html)].flatMap(([at, el]) => {
    const to = attr(el, 'data-gg-link')
    return to === null
      ? []
      : [{ to, ggId: String(at), text: textOf(el).replace(/\s+/g, ' ').trim().slice(0, 80) }]
  })
}

// ── Direct edits ──
export type ElementEdit =
  | { ggId: string; kind: 'text'; text: string }
  | { ggId: string; kind: 'attr'; name: string; value: string | null }
  | { ggId: string; kind: 'style'; props: Record<string, string | undefined> }
  | { ggId: string; kind: 'delete' }

/** Their attributes could load or run code: only the AI changes them. */
const LOCKED = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'frame',
  'object',
  'embed',
  'template',
])
const SKELETON = new Set(['html', 'head', 'body'])
const VOID = new Set([
  'area',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/** `;`-separated declarations, ignoring `;` inside quotes or parentheses (data URLs). */
function declarations(style: string) {
  const out: [string, string][] = []
  let depth = 0
  let quote = ''
  let start = 0
  const push = (s: string) => {
    const i = s.indexOf(':')
    if (i > 0) out.push([s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()])
  }
  for (let i = 0; i < style.length; i++) {
    const c = style[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) {
      push(style.slice(start, i))
      start = i + 1
    }
  }
  push(style.slice(start))
  return out
}

function mergeStyle(current: string | null, props: Record<string, string | undefined>) {
  const decls = new Map(declarations(current ?? ''))
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue
    decls.delete(k)
    if (v.trim()) decls.set(k, v.trim())
  }
  return decls.size ? [...decls].map(([k, v]) => `${k}: ${v}`).join('; ') : null
}

type Splice = { start: number; end: number; text: string }

/** A start tag with `changes` applied (null removes the attribute), keeping everything else as written. */
function rewriteStartTag(html: string, el: Element, ggId: string, changes: Map<string, string | null>) {
  const loc = el.sourceCodeLocation
  const tag = loc?.startTag
  if (!loc || !tag) return fail('invalid', '元素在源码里找不到：{ggId}', { ggId })
  const src = html.slice(tag.startOffset, tag.endOffset)
  const local: Splice[] = []
  let added = ''
  for (const [name, value] of changes) {
    const at = loc.attrs?.[name]
    if (!at) {
      if (value !== null) added += ` ${name}="${escAttr(value)}"`
      continue
    }
    let start = at.startOffset - tag.startOffset
    if (value === null) while (start > 0 && /\s/.test(src[start - 1] ?? '')) start--
    local.push({
      start,
      end: at.endOffset - tag.startOffset,
      text: value === null ? '' : `${name}="${escAttr(value)}"`,
    })
  }
  if (added) {
    const close = src.endsWith('/>') ? src.length - 2 : src.length - 1
    local.push({ start: close, end: close, text: added })
  }
  local.sort((a, b) => b.start - a.start)
  let out = src
  for (const s of local) out = out.slice(0, s.start) + s.text + out.slice(s.end)
  return { start: tag.startOffset, end: tag.endOffset, text: out }
}

/**
 * Applies a file's element edits to its source (§3.5): edits of one element are merged, splices go from the end
 * back so earlier offsets stay valid, and overlapping ranges are refused.
 */
export function editHtml(html: string, edits: ElementEdit[]) {
  const els = elementsOf(html)
  type Merged = {
    text?: string
    attrs: Map<string, string | null>
    style?: Record<string, string | undefined>
    del: boolean
  }
  const byEl = new Map<string, Merged>()
  for (const e of edits) {
    const m: Merged = byEl.get(e.ggId) ?? { attrs: new Map(), del: false }
    byEl.set(e.ggId, m)
    if (e.kind === 'text') m.text = e.text
    else if (e.kind === 'attr') m.attrs.set(e.name, e.value)
    else if (e.kind === 'style') m.style = { ...m.style, ...e.props }
    else m.del = true
  }
  const splices: Splice[] = []
  for (const [ggId, m] of byEl) {
    const missing = () => fail('invalid', '元素在源码里找不到：{ggId}', { ggId })
    const el = els.get(Number(ggId)) ?? missing()
    const loc = el.sourceCodeLocation ?? missing()
    const tag = loc.startTag ?? missing()
    if (m.del) {
      if (m.text !== undefined || m.attrs.size || m.style) fail('invalid', '同一元素不能既删除又修改')
      if (SKELETON.has(el.tagName)) fail('invalid', '不能删除页面骨架元素')
      if (!loc.endTag && !VOID.has(el.tagName)) fail('invalid', '元素没有结束标签，不能直接修改，请交给 AI')
      splices.push({ start: loc.startOffset, end: loc.endOffset, text: '' })
      continue
    }
    if (LOCKED.has(el.tagName)) fail('invalid', '不能修改 <{tag}> 元素', { tag: el.tagName })
    if (m.style) m.attrs.set('style', mergeStyle(attr(el, 'style'), m.style))
    if (m.attrs.size) splices.push(rewriteStartTag(html, el, ggId, m.attrs))
    if (m.text !== undefined) {
      if (el.childNodes.some(isElement)) fail('invalid', '元素包含子元素，不能直接改文字，请交给 AI')
      const end = loc.endTag ?? fail('invalid', '元素没有结束标签，不能直接修改，请交给 AI')
      splices.push({ start: tag.endOffset, end: end.startOffset, text: escText(m.text) })
    }
  }
  splices.sort((a, b) => a.start - b.start)
  for (let i = 1; i < splices.length; i++)
    if ((splices[i]?.start ?? 0) < (splices[i - 1]?.end ?? 0))
      fail('invalid', '修改的元素范围重叠，请分次保存')
  let out = html
  for (const s of splices.reverse()) out = out.slice(0, s.start) + s.text + out.slice(s.end)
  return out
}

/** Sets an existing `--name` under `:root` in tokens.css; null when there is none. */
export function editToken(css: string, name: string, value: string) {
  const esc = name.replace(/[-]/g, '\\-')
  for (const root of css.matchAll(/:root\b[^{]*\{([^}]*)\}/g)) {
    const body = root[1] ?? ''
    const bodyAt = (root.index ?? 0) + root[0].indexOf('{') + 1
    const decl = new RegExp(`(^|[;{\\s])${esc}\\s*:([^;]*)`).exec(body)
    if (!decl) continue
    const valueAt = bodyAt + decl.index + decl[0].length - (decl[2] ?? '').length
    const old = decl[2] ?? ''
    const trailing = old.match(/\s*$/)?.[0] ?? ''
    return `${css.slice(0, valueAt)} ${value.trim()}${trailing}${css.slice(valueAt + old.length)}`
  }
  return null
}
