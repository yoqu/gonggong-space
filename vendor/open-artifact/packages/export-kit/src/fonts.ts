/**
 * Reading font stylesheets for exports that inline their fonts. Pictures
 * drawn from serialized markup cannot load fonts from the network, and an
 * exported page should open offline, so editors inline `@font-face` rules
 * with `data:` URLs. Stylesheets such as Google Fonts' are split by
 * `unicode-range`; these helpers find the blocks that cover the characters
 * a document uses. Pure.
 */

/** The `@font-face` blocks of a stylesheet. */
export function fontFaceBlocks(css: string): string[] {
  return css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
}

/** The `unicode-range` value of a `@font-face` block, if it has one. */
export function blockUnicodeRange(block: string): string | undefined {
  return /unicode-range\s*:\s*([^;}]+)/i.exec(block)?.[1];
}

/** A `unicode-range` as inclusive code point ranges (null: everything). */
export function parseUnicodeRange(value: string | undefined): [number, number][] | null {
  if (!value) return null;
  const ranges: [number, number][] = [];
  for (const part of value.split(',')) {
    const text = part.trim().replace(/^u\+/i, '');
    if (!text) continue;
    if (text.includes('?')) {
      ranges.push([parseInt(text.replace(/\?/g, '0'), 16), parseInt(text.replace(/\?/g, 'f'), 16)]);
    } else if (text.includes('-')) {
      const [from, to] = text.split('-');
      ranges.push([parseInt(from!, 16), parseInt(to!, 16)]);
    } else {
      const point = parseInt(text, 16);
      ranges.push([point, point]);
    }
  }
  return ranges.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

/** True when any of the code points falls in the ranges (always, for null ranges). */
export function rangeCovers(ranges: [number, number][] | null, points: Iterable<number>): boolean {
  if (!ranges) return true;
  for (const point of points) for (const [from, to] of ranges) if (point >= from && point <= to) return true;
  return false;
}

/** Splits `text` at `separator`s that are outside quotes and parentheses (a `data:` URL holds both). */
function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The descriptors of a `@font-face` block by lower-case name (`font-family`, `src`, …), values as written; a later one replaces an earlier one. */
export function fontFaceDescriptors(block: string): Map<string, string> {
  const open = block.indexOf('{');
  const close = block.lastIndexOf('}');
  const descriptors = new Map<string, string>();
  for (const declaration of splitOutside(block.slice(open + 1, close < 0 ? undefined : close), ';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    descriptors.delete(name);
    descriptors.set(name, declaration.slice(colon + 1).trim());
  }
  return descriptors;
}

/** A family name as it compares: no quotes, lower case, single spaces. */
export function familyName(value: string | undefined): string {
  return (value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\s+/g, ' ').toLowerCase();
}

/** What tells one face of a family from another. */
export interface FaceTraits {
  family?: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
}

/**
 * One string for a face, the same whether its traits were read from a
 * `@font-face` block or from a `FontFace` object (which spell defaults and
 * keywords differently: `normal` for `400`, `U+0-10FFFF` for no range).
 */
export function faceKey(traits: FaceTraits): string {
  const weight = (traits.weight ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).map((token) => (token === 'normal' ? '400' : token === 'bold' ? '700' : token)).join(' ') || '400';
  const style = (traits.style ?? '').trim().toLowerCase().replace(/\s+/g, ' ') || 'normal';
  const ranges = parseUnicodeRange(traits.unicodeRange?.trim() || undefined);
  const range = !ranges || ranges.some(([from, to]) => from <= 0 && to >= 0x10ffff) ? '*' : ranges.map(([from, to]) => `${from}-${to}`).sort().join(',');
  return `${familyName(traits.family)}|${weight}|${style}|${range}`;
}

/** One entry of a `src` descriptor. */
export interface FontSource {
  /** The entry as written. */
  text: string;
  /** Its `url(…)` as written (`match`) and the address; none for `local(…)`. */
  url?: { match: string; url: string };
  /** Its `format(…)` hint, lower case, without quotes. */
  format?: string;
}

/** The entries of a `src` descriptor, in order. */
export function fontSources(src: string): FontSource[] {
  return splitOutside(src, ',').map((text) => {
    const url = cssUrls(text)[0];
    const format = /format\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(text)?.[2]?.trim().toLowerCase();
    return { text, ...(url ? { url } : {}), ...(format ? { format } : {}) };
  });
}

/** Every `url(…)` in a CSS text: the whole match and the address. */
export function cssUrls(css: string): { match: string; url: string }[] {
  return Array.from(css.matchAll(/url\((['"]?)([^'")]+)\1\)/g), (match) => ({ match: match[0], url: match[2]! }));
}
