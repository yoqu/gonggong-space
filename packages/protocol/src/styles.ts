import { z } from 'zod'

// ── Direct edits (3.5): the inline style a manual edit may set, and the tokens.css values it may write ──
export const STYLE_PROPS = [
  'color',
  'background',
  'background-color',
  'border-color',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'border',
  'border-width',
  'border-style',
  'border-radius',
  'width',
  'height',
  'opacity',
  'box-shadow',
  'font-style',
  'text-decoration',
  'font-family',
  'rotate',
  'align-content',
  'display',
] as const
export const StyleProp = z.enum(STYLE_PROPS)
export type StyleProp = z.infer<typeof StyleProp>
/** Colours: the tokens first, or a hex colour picked by hand (the design-rule lint warns about it, never blocks). */
const COLOR_PROPS = new Set<string>(['color', 'background', 'background-color', 'border-color'])
const COLOR_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset'])
const STYLE_KEYWORDS = new Set([
  ...COLOR_KEYWORDS,
  'auto',
  'none',
  'normal',
  'solid',
  'dashed',
  'dotted',
  'bold',
  'bolder',
  'lighter',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
  'italic',
  'underline',
  'line-through',
])
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
/** 墨刀's 文本 › 字体: the families a manual edit sets (names a page can count on, no quotes needed). */
export const FONT_PRESETS = [
  'system-ui, sans-serif',
  'PingFang SC, Microsoft YaHei, sans-serif',
  'Noto Sans SC, sans-serif',
  'serif',
  'monospace',
] as const
/** 外观 › 阴影 with its colour picked: one drop shadow, `#rrggbbaa`. */
const SHADOW = /^0 \d{1,2}px \d{1,3}px #[0-9a-f]{8}$/i
/** 墨刀's shadow choices (外观 › 阴影): the only shadows a manual edit sets. */
export const SHADOW_PRESETS = [
  '0 1px 2px rgba(0, 0, 0, 0.08)',
  '0 4px 12px rgba(0, 0, 0, 0.12)',
  '0 12px 32px rgba(0, 0, 0, 0.18)',
] as const
const VAR = /^var\(--[a-z0-9-]+\)$/
const NUMBER = /^-?(\d+|\d*\.\d+)(px|rem|em|%|vh|vw|deg)?$/
const UNSAFE_CSS = /url\(|expression|[;"'\\<>{}!]|\/\*/i

/** An inline style value: space-separated token references (`var(--x)`), numbers with a unit, or keywords. */
export function styleValueOk(value: string, prop?: string) {
  if (prop === 'font-family') return (FONT_PRESETS as readonly string[]).includes(value)
  if (prop === 'display') return value === 'none'
  if (value.length > 200 || UNSAFE_CSS.test(value)) return false
  const parts = value.trim().split(/\s+/)
  if (prop === 'box-shadow')
    return value === 'none' || SHADOW.test(value) || (SHADOW_PRESETS as readonly string[]).includes(value)
  if (prop && COLOR_PROPS.has(prop))
    return parts.every((p) => VAR.test(p) || HEX.test(p) || COLOR_KEYWORDS.has(p))
  return parts.every((p) => VAR.test(p) || NUMBER.test(p) || STYLE_KEYWORDS.has(p))
}

/** A `:root` custom property value in tokens.css: anything that cannot leave the declaration. */
export function tokenValueOk(value: string) {
  if (!value.trim() || value.length > 200 || /url\(|expression|[;\\<>{}]|\/\*/i.test(value)) return false
  return (
    [...value].filter((c) => c === '"').length % 2 === 0 &&
    [...value].filter((c) => c === "'").length % 2 === 0
  )
}
