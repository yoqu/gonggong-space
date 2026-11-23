/**
 * A source deck's shared stylesheet, `project/deck.css`: parsed into the
 * style rules that apply at the deck's slide size.
 *
 * A slide is read by browser rules, so the parser follows CSS Syntax where a
 * slide sheet needs it: comments, strings, nested blocks, `!important`, and
 * error recovery that drops one rule or declaration, never the rest. At-rules
 * are sorted on the way in:
 *
 * - `@media` is evaluated at the slide's size: `screen`, `all`, `only`,
 *   `not`, `orientation` and px `min-`/`max-` `width`/`height` apply;
 *   `prefers-reduced-motion: no-preference` holds for every viewer and
 *   `reduce` for none; any other feature never matches.
 * - `@keyframes` and `@property` draw nothing on a still slide: they are
 *   kept as written in `motion` (played when presenting). `@starting-style`
 *   rules are kept apart in `starting` (where an element starts its
 *   transition from). `@font-face`, `@page` and `@layer` statements are
 *   skipped quietly: fonts come from deck.json `faces`.
 * - `@import`, `@supports`, `@container`, `@layer` blocks, `@scope` and
 *   anything else are dropped, each with a note.
 */

import { parseSelectorList, type ComplexSelector } from './selectors.ts';

/** One declaration as written (name lower-cased, value trimmed, `!important` split off). */
export interface SheetDeclaration {
  name: string;
  value: string;
  important: boolean;
}

/** A style rule that applies at the slide size. */
export interface SheetRule {
  selectors: ComplexSelector[];
  declarations: SheetDeclaration[];
  /** Source order across the sheet (later wins on equal specificity). */
  order: number;
  /** 1-based line of the rule's selector, for reports. */
  line: number;
}

/** Something of the sheet the reader does not use, and why. */
export interface SheetDrop {
  what: string;
  line?: number;
}

/** A parsed sheet. */
export interface Stylesheet {
  rules: SheetRule[];
  drops: SheetDrop[];
  /** `@keyframes` names the sheet defines. */
  keyframes: string[];
  /**
   * `@keyframes` and `@property` rules as written, for playing motion when
   * presenting (never read into a still slide). Rules that load anything
   * (`url(`) are left out.
   */
  motion: string[];
  /** Rules inside `@starting-style`: an element's style before its first transition. */
  starting: SheetRule[];
}

/** True when a motion rule is safe to hand to a page as written. */
function safeMotionRule(text: string): boolean {
  return !/url\s*\(|@import|expression\s*\(|<\/?style|\\/i.test(text);
}

/** The viewport media queries are read at. */
export interface MediaViewport {
  width: number;
  height: number;
}

/** At-rules skipped without a note. */
const QUIET_AT_RULES = new Set(['keyframes', '-webkit-keyframes', 'starting-style', 'font-face', 'property', 'page', 'charset', 'counter-style']);

/** Removes comments, keeping newlines so lines still count. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** Index of the `}` that closes the block opened just before `from`, or the end. */
function blockEnd(text: string, from: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return text.length;
}

/** Index of the next `{` or `;` at top level from `from`, or the end. */
function nextStop(text: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if ((ch === '{' || ch === ';') && depth === 0) return i;
  }
  return text.length;
}

/** Splits a declaration block on top-level `;`. */
export function parseDeclarationBlock(text: string): SheetDeclaration[] {
  const out: SheetDeclaration[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  const push = (chunk: string): void => {
    const colon = chunk.indexOf(':');
    if (colon <= 0) return;
    const name = chunk.slice(0, colon).trim();
    let value = chunk.slice(colon + 1).trim();
    if (!name || !value) return;
    let important = false;
    const bang = /!\s*important\s*$/i.exec(value);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index).trim();
    }
    out.push({ name: name.startsWith('--') ? name : name.toLowerCase(), value, important });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      push(text.slice(start, i));
      start = i + 1;
    }
  }
  push(text.slice(start));
  return out;
}

/** Evaluates one media query (`screen and (min-width: 1200px)`). */
function matchesQuery(query: string, viewport: MediaViewport): boolean {
  let text = query.trim().toLowerCase();
  let negate = false;
  if (text.startsWith('not ')) {
    negate = true;
    text = text.slice(4).trim();
  } else if (text.startsWith('only ')) text = text.slice(5).trim();
  let result = true;
  for (const raw of text.split(/\s+and\s+/)) {
    const part = raw.trim();
    if (!part) continue;
    if (part === 'screen' || part === 'all') continue;
    if (!part.startsWith('(')) {
      result = false;
      break;
    }
    const feature = /^\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)$/.exec(part);
    if (!feature || !matchesFeature(feature[1]!, feature[2]?.trim(), viewport)) {
      result = false;
      break;
    }
  }
  return negate ? !result : result;
}

/** Reads a media feature length in px (`em` and `rem` at the browser's 16px). */
function mediaLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(-?[\d.]+)(px|em|rem)?$/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * (match[2] === 'em' || match[2] === 'rem' ? 16 : 1);
}

function matchesFeature(name: string, value: string | undefined, viewport: MediaViewport): boolean {
  const length = mediaLength(value);
  switch (name) {
    case 'orientation':
      return value === (viewport.width >= viewport.height ? 'landscape' : 'portrait');
    case 'width':
      return length !== undefined && viewport.width === length;
    case 'min-width':
      return length !== undefined && viewport.width >= length;
    case 'max-width':
      return length !== undefined && viewport.width <= length;
    case 'height':
      return length !== undefined && viewport.height === length;
    case 'min-height':
      return length !== undefined && viewport.height >= length;
    case 'max-height':
      return length !== undefined && viewport.height <= length;
    case 'prefers-reduced-motion':
      return value === 'no-preference';
    default:
      return false;
  }
}

/** True when a media query list matches the viewport (an empty list matches). */
export function matchesMedia(list: string, viewport: MediaViewport): boolean {
  const queries = list.split(',').map((q) => q.trim()).filter(Boolean);
  return queries.length === 0 || queries.some((query) => matchesQuery(query, viewport));
}

/** Parses a shared stylesheet at a viewport. */
export function parseStylesheet(text: string, viewport: MediaViewport): Stylesheet {
  const source = stripComments(text);
  const sheet: Stylesheet = { rules: [], drops: [], keyframes: [], motion: [], starting: [] };
  const newlines: number[] = [];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) newlines.push(i);
  /** 1-based line of an offset (binary search over the newline offsets). */
  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid]! < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  let order = 0;
  const parseBlock = (from: number, to: number, into: SheetRule[] = sheet.rules): void => {
    let at = from;
    while (at < to) {
      while (at < to && /\s/.test(source[at]!)) at++;
      if (at >= to) return;
      const stop = Math.min(nextStop(source, at), to);
      const prelude = source.slice(at, stop).trim();
      if (stop >= to || source[stop] === ';') {
        // A statement: an at-rule without a block, or stray text.
        if (prelude.startsWith('@')) {
          const name = /^@([-\w]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
          if (name === 'import') sheet.drops.push({ what: `${prelude.slice(0, 80)} — @import is not read: put the rules in project/deck.css`, line: lineAt(at) });
          else if (!QUIET_AT_RULES.has(name) && name !== 'layer') sheet.drops.push({ what: `@${name} is not read`, line: lineAt(at) });
        } else if (prelude) sheet.drops.push({ what: `"${prelude.slice(0, 60)}" is not a rule`, line: lineAt(at) });
        at = stop + 1;
        continue;
      }
      const close = Math.min(blockEnd(source, stop + 1), to);
      const body = source.slice(stop + 1, close);
      if (prelude.startsWith('@')) {
        const match = /^@([-\w]+)\s*([\s\S]*)$/.exec(prelude);
        const name = match?.[1]?.toLowerCase() ?? '';
        const rest = match?.[2]?.trim() ?? '';
        if (name === 'media') {
          if (matchesMedia(rest, viewport)) parseBlock(stop + 1, close, into);
        } else if (name === 'keyframes' || name === '-webkit-keyframes') {
          if (rest) sheet.keyframes.push(rest);
          const rule = `@keyframes ${rest} {${body}}`;
          if (rest && into === sheet.rules && safeMotionRule(rule)) sheet.motion.push(rule);
        } else if (name === 'property') {
          const rule = `@property ${rest} {${body}}`;
          if (/^--[-\w]+$/.test(rest) && into === sheet.rules && safeMotionRule(rule)) sheet.motion.push(rule);
        } else if (name === 'starting-style') {
          if (into === sheet.rules) parseBlock(stop + 1, close, sheet.starting);
        } else if (!QUIET_AT_RULES.has(name)) {
          sheet.drops.push({ what: `@${name} — ${name === 'supports' || name === 'container' ? 'not read; write the rules plainly' : 'not read'}`, line: lineAt(at) });
        }
      } else if (prelude) {
        const parsed = parseSelectorList(prelude);
        if (!parsed.ok) sheet.drops.push({ what: `${parsed.reason}; rule dropped`, line: lineAt(at) });
        else if (/\{/.test(body)) sheet.drops.push({ what: `${prelude.slice(0, 60)} — nested rules are not read; rule dropped`, line: lineAt(at) });
        else {
          const declarations = parseDeclarationBlock(body);
          if (declarations.length) into.push({ selectors: parsed.selectors, declarations, order: order++, line: lineAt(at) });
        }
      }
      at = close + 1;
    }
  };
  parseBlock(0, source.length);
  return sheet;
}
