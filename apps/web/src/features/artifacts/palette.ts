/**
 * Deterministic colour derivations for the design-system panel: a seed colour's primary roles, and the neutral
 * roles (background, surface, on-surface, outline) of the other mode. HSL keeps it simple and predictable; the
 * results only seed the palette, the member can still edit every value.
 */
export type Mode = 'light' | 'dark'

export interface Hsl {
  h: number
  s: number
  l: number
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export const isHex = (v: string) => HEX.test(v.trim())

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

function rgbOf(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const raw = m[1] as string
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number]
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = rgbOf(hex)
  if (!rgb) return null
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l: round(l, 4) }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: round((h * 60 + 360) % 360, 2), s: round(s, 4), l: round(l, 4) }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return `#${[r, g, b]
    .map((v) =>
      Math.round(clamp(v + m, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** WCAG relative luminance. */
export function luminance(hex: string) {
  const rgb = rgbOf(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as number[]
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number)
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever reads better on `hex`. */
export const onColor = (hex: string) =>
  contrast(hex, '#ffffff') >= contrast(hex, '#000000') ? '#ffffff' : '#000000'

/** The mode a palette is in, read from its background (or surface) colour. */
export function modeOf(colors: Record<string, string>): Mode {
  const bg = [colors.background, colors.surface].find((v) => v && isHex(v))
  return bg && luminance(bg) < 0.2 ? 'dark' : 'light'
}

/** The primary roles a seed colour gives: the seed's hue and saturation at the mode's lightness. */
export function seedScheme(seed: string, mode: Mode): Record<string, string> {
  const hsl = hexToHsl(seed) ?? { h: 0, s: 0, l: 0.5 }
  const { h, s } = hsl
  const primary = hslToHex({ h, s, l: mode === 'light' ? clamp(hsl.l, 0.25, 0.45) : clamp(hsl.l, 0.6, 0.8) })
  const tint = Math.min(s, 0.6)
  return {
    primary,
    'on-primary': onColor(primary),
    'primary-container': hslToHex({ h, s: tint, l: mode === 'light' ? 0.9 : 0.25 }),
    'on-primary-container': hslToHex({ h, s: tint, l: mode === 'light' ? 0.12 : 0.9 }),
  }
}

type Role = 'background' | 'surface' | 'surface-variant' | 'text' | 'text-variant' | 'outline'

/** The neutral role of a `--color-*` name, or null for brand and state colours. */
export function neutralRole(name: string): Role | null {
  if (name === 'on-surface' || name === 'on-background') return 'text'
  if (/^on-(surface|background)-/.test(name)) return 'text-variant'
  if (/^background(-|$)/.test(name)) return 'background'
  if (name === 'surface') return 'surface'
  if (/^surface-/.test(name)) return 'surface-variant'
  if (/^outline(-|$)/.test(name)) return 'outline'
  return null
}

const NEUTRAL_L: Record<Mode, Record<Exclude<Role, 'text-variant'>, number>> = {
  light: { background: 0.97, surface: 1, 'surface-variant': 0.95, text: 0.1, outline: 0.85 },
  dark: { background: 0.07, surface: 0.11, 'surface-variant': 0.15, text: 0.93, outline: 0.3 },
}

/**
 * The neutral colours of `mode`, tinted with the seed's hue: fixed lightness per role, and secondary text keeps its
 * distance from the background by mirroring its lightness. Only hex colours with a neutral role are derived.
 */
export function neutralScheme(
  seed: string,
  mode: Mode,
  colors: Record<string, string>,
): Record<string, string> {
  const { h, s } = hexToHsl(seed) ?? { h: 0, s: 0 }
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(colors)) {
    const role = neutralRole(name)
    const hsl = isHex(value) ? hexToHsl(value) : null
    if (!role || !hsl) continue
    const tint = Math.min(s, role.startsWith('text') ? 0.08 : 0.12)
    const l =
      role === 'text-variant'
        ? mode === 'dark'
          ? clamp(1 - hsl.l, 0.45, 0.85)
          : clamp(1 - hsl.l, 0.25, 0.6)
        : NEUTRAL_L[mode][role]
    out[name] = hslToHex({ h, s: tint, l })
  }
  return out
}
