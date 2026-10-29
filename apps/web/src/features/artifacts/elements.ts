import type { StyleProp } from '@gonggong/protocol'
import type { BridgeRect, FromScreen } from './bridge'
import type { CanvasNode, View } from './geometry'

/** An element a screen reported as clicked (mark or direct edit), with the screen it is on. */
export type PickedElement = Extract<FromScreen, { type: 'select' }> & {
  screenId: string
  screenTitle: string
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** How chips and lists name an element: `button「加入本周共读」`. */
export const elementLabel = (e: Pick<PickedElement, 'tag' | 'text'>) =>
  e.text ? `${e.tag}「${clip(e.text, 16)}」` : `<${e.tag}>`

/** The last parts of a selector: `section:nth-of-type(2) > div > button`. */
export function crumbs(selector: string, keep = 3) {
  const parts = selector.split(' > ')
  return parts.length > keep ? ['…', ...parts.slice(-keep)] : parts
}

/** An element rect (the screen frame's viewport px) in the canvas's viewport px at the current pan and zoom. */
export const elementBox = (n: Pick<CanvasNode, 'x' | 'y'>, r: BridgeRect, v: View) => ({
  left: v.x + (n.x + r.x) * v.z,
  top: v.y + (n.y + r.y) * v.z,
  width: r.w * v.z,
  height: r.h * v.z,
})

/** `color: var(--color-primary); padding: 8px` → its declarations. */
export function parseInlineStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of style.split(';')) {
    const at = decl.indexOf(':')
    if (at < 0) continue
    const k = decl.slice(0, at).trim().toLowerCase()
    const v = decl.slice(at + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

/** Colour props pick a `--color-*` token; the rest take a number with a unit, a token or a keyword. */
export const COLOR_FIELDS: StyleProp[] = ['color', 'background-color', 'border-color']
export const SIZE_FIELDS: StyleProp[] = [
  'font-size',
  'font-weight',
  'line-height',
  'padding',
  'margin',
  'border-radius',
  'width',
  'height',
]

/** The props whose draft differs from what the element had inline ('' removes one). */
export function styleChanges(before: Record<string, string>, draft: Record<string, string>) {
  const out: Partial<Record<StyleProp, string>> = {}
  for (const [k, v] of Object.entries(draft)) {
    const next = v.trim()
    if (next !== (before[k] ?? '')) out[k as StyleProp] = next
  }
  return out
}
