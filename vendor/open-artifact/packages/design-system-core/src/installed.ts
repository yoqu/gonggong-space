/**
 * Reading an installed copy of a design system the way the editors that use
 * one (Design, Slides) offer it: type styles as plain declarations in px
 * (size, line height, weight, letter spacing, style, case, family; never a
 * token reference), and the key that decides when to re-read the copies.
 */

import type { NormalizedStyle, NormalizedTokens } from './tokens.ts';

/** Root font size for `rem`/`em` lengths in tokens. */
export const TOKEN_ROOT_PX = 16;

/** A length token in px (`24`, `24px`, `1.5rem`, `1.5em`), or null. */
export function lengthPx(value: string | undefined, em = TOKEN_ROOT_PX): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em)?$/.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2] ?? 'px';
  const px = unit === 'px' ? n : unit === 'rem' ? n * TOKEN_ROOT_PX : n * em;
  return Math.round(px * 100) / 100;
}

/** A line height as written: a unitless number or `Npx`. */
export function lineHeightValue(value: string | undefined, fontSize: number): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return text;
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(text);
  if (percent) return String(Math.round(Number(percent[1])) / 100);
  const px = lengthPx(text, fontSize);
  return px === null ? undefined : `${px}px`;
}

/** The heading level a type style reads as, from its group and name (`p` for body styles). */
export function styleTag(style: NormalizedStyle): 'h1' | 'h2' | 'h3' | 'p' {
  const name = `${style.group} ${style.name}`.toLowerCase();
  if (/\b(display|hero|h1|title)\b/.test(name)) return 'h1';
  if (/\b(h2|heading|headline)\b/.test(name)) return 'h2';
  if (/\b(h3|subhead|subheading|subtitle)\b/.test(name)) return 'h3';
  return 'p';
}

/** A type style's declarations in px; null when its size is not a length. */
export function styleDeclarations(tokens: NormalizedTokens, style: NormalizedStyle): Record<string, string> | null {
  const fontSize = lengthPx(style.fontSize);
  if (fontSize === null || fontSize <= 0) return null;
  const declarations: Record<string, string> = { 'font-size': `${fontSize}px` };
  const lineHeight = lineHeightValue(style.lineHeight, fontSize);
  if (lineHeight) declarations['line-height'] = lineHeight;
  if (style.fontWeight && /^\d{3}$/.test(style.fontWeight)) declarations['font-weight'] = style.fontWeight;
  const spacing = lengthPx(style.letterSpacing, fontSize);
  if (spacing) declarations['letter-spacing'] = `${spacing}px`;
  if (style.fontStyle === 'italic') declarations['font-style'] = 'italic';
  if (style.textTransform && /^(uppercase|lowercase|capitalize)$/.test(style.textTransform)) declarations['text-transform'] = style.textTransform;
  // A `families` key resolves to its stack; an inline stack is used as is (never `var()`).
  const family = style.familyKey ? tokens.families[style.familyKey] : style.family;
  if (family && !family.includes('var(')) declarations['font-family'] = family;
  return declarations;
}

/** What decides a reload of installed copies: their folders and versions. */
export function installedKey(records: readonly { namespace: string; version?: string | null; copiedAt: string }[]): string {
  return records.map((record) => `${record.namespace}@${record.version ?? ''}@${record.copiedAt}`).join('|');
}
