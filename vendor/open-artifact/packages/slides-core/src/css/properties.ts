/**
 * The closed CSS table of the slide subset: every property, the elements it
 * applies to, its value grammar and its canonical spelling. The compiler runs
 * every inline declaration through {@link parseDeclaration}; the serializer
 * writes properties in {@link CSS_PROPERTIES} order, which is what keeps a
 * re-saved slide byte-stable.
 */

import type { ItemMargin, ShapeKind } from '../model.ts';
import { formatNumber } from './color.ts';
import {
  formatBackground,
  formatBorder,
  formatFilters,
  formatShadows,
  formatTracks,
  formatTransform,
  parseBackground,
  parseBorder,
  parseColorValue,
  parseFilters,
  parseFontFamily,
  parseGap,
  parseLength,
  parseNumber,
  parsePadding,
  parsePercent,
  parseRadius,
  parseShadows,
  parseTracks,
  parseTransform,
  px,
  splitTopLevel,
  type ParseResult,
} from './values.ts';

/** Every property of the subset, in serialization order. */
export const CSS_PROPERTIES = [
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'aspect-ratio',
  'display',
  'flex-direction',
  'flex-wrap',
  'gap',
  'align-items',
  'justify-content',
  'justify-items',
  'align-self',
  'justify-self',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'padding',
  'margin',
  'overflow',
  'background',
  'background-clip',
  '-webkit-text-fill-color',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'white-space',
  'text-decoration',
  'font-variant-numeric',
  'list-style-type',
  'list-style-position',
  '-webkit-text-stroke',
  'text-shadow',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-radius',
  'box-shadow',
  'opacity',
  'transform',
  'filter',
  'backdrop-filter',
  'mix-blend-mode',
  'object-fit',
] as const;

export type CssProperty = (typeof CSS_PROPERTIES)[number];

const PROPERTY_SET: ReadonlySet<string> = new Set(CSS_PROPERTIES);

/** True when the name is a property of the subset. */
export function isCssProperty(name: string): name is CssProperty {
  return PROPERTY_SET.has(name);
}

/** Properties that inherit down from section / div into text (styles.md). */
export const INHERITED_TEXT_PROPERTIES: readonly CssProperty[] = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
  'text-transform',
];

/** What kind of element a declaration sits on. */
export type ElementKind =
  | 'section'
  | 'div'
  | 'textbox'
  | 'text'
  | 'list'
  | 'span'
  | 'img'
  | 'table'
  | 'tr'
  | 'cell'
  | 'svg'
  | 'shape'
  | 'icon'
  | 'connector'
  | 'embed'
  | 'hr';

/** Where the declaration sits, as far as the table cares. */
export interface StyleContext {
  element: ElementKind;
  /** The cell is a `<th>`. */
  header?: boolean;
  /** `<x-shape kind>`. */
  shape?: ShapeKind;
  /** The element is `position:absolute`. */
  pinned: boolean;
  /** The element is a flow child of a `<div>` or `<section>`. */
  flowChild: boolean;
  /** Its parent lays out as a grid. */
  gridChild: boolean;
  /** Its own layout (section / div). */
  display?: 'flex' | 'grid' | 'none';
  /** Its own flex direction (section / div), `column` when unset. */
  direction?: string;
  /** Lower-case families the deck declares (deck.json `faces`). */
  faces: ReadonlySet<string>;
  /** A source slide's reading: a pinned element keeps its `margin` too. */
  pinnedMargins?: boolean;
}

/** The outcome of one declaration. */
export type DeclResult =
  | {
      ok: true;
      /** Canonical declarations to store (a shorthand may expand). */
      set: Array<[CssProperty, string]>;
      note?: string;
      warning?: string;
    }
  | {
      ok: false;
      /** Why it was dropped. */
      reason: string;
      /** Accepted as a no-op (margin:0, box-sizing:border-box): dropped silently. */
      noop?: boolean;
    };

const TEXTUAL: ReadonlySet<ElementKind> = new Set(['text', 'list', 'textbox']);
const CONTAINERS: ReadonlySet<ElementKind> = new Set(['section', 'div', 'textbox']);

function isText(ctx: StyleContext): boolean {
  return TEXTUAL.has(ctx.element);
}

function isContainer(ctx: StyleContext): boolean {
  return CONTAINERS.has(ctx.element);
}

function isDiv(ctx: StyleContext): boolean {
  return ctx.element === 'div' || ctx.element === 'textbox';
}

function tagName(ctx: StyleContext): string {
  switch (ctx.element) {
    case 'text':
      return 'text';
    case 'textbox':
      return '<div data-text>';
    case 'cell':
      return ctx.header ? '<th>' : '<td>';
    case 'shape':
      return '<x-shape>';
    case 'icon':
      return '<x-icon>';
    case 'connector':
      return '<x-connector>';
    case 'embed':
      return '<x-embed>';
    case 'list':
      return 'a list';
    default:
      return `<${ctx.element}>`;
  }
}

function done(property: CssProperty, value: string, extra: { note?: string; warning?: string } = {}): DeclResult {
  return { ok: true, set: [[property, value]], ...extra };
}

function fail(reason: string): DeclResult {
  return { ok: false, reason };
}

function from(property: CssProperty, result: ParseResult): DeclResult {
  return result.ok ? done(property, result.value, { note: result.note, warning: result.warning }) : fail(result.reason);
}

function keyword(property: CssProperty, raw: string, allowed: readonly string[], aliases: Record<string, string> = {}): DeclResult {
  const value = raw.trim().toLowerCase();
  if (Object.hasOwn(aliases, value)) return done(property, aliases[value]!, { note: `${property}:${value} → ${aliases[value]}` });
  if (allowed.includes(value)) return done(property, value);
  return fail(`${property}:${value} is not supported (${allowed.join(' | ')})`);
}

/** Length or percent or auto, with optional clamp-at-zero for offsets. */
function lengthPercentAuto(property: CssProperty, raw: string, options: { calc?: boolean; clampNegative?: boolean; min?: number } = {}): DeclResult {
  const value = raw.trim().toLowerCase();
  if (value === 'auto') return done(property, 'auto');
  const pct = parsePercent(value);
  if (pct.ok) {
    if (options.clampNegative && pct.value < 0) return done(property, '0', { warning: `${property}:${value} is negative; clamped to 0` });
    return done(property, `${formatNumber(pct.value, 3)}%`);
  }
  if (options.calc) {
    const calc = /^calc\(\s*([+-]?[\d.]+)%\s*([+-])\s*([\d.]+)(px)?\s*\)$/.exec(value);
    if (calc) {
      return done(property, `calc(${formatNumber(Number(calc[1]), 3)}% ${calc[2]} ${px(Number(calc[3]))})`);
    }
  }
  const len = parseLength(value);
  if (!len.ok) return fail(`${property}:${value} — use Npx, N% or auto`);
  if (options.clampNegative && len.value < 0) return done(property, '0', { warning: `${property}:${value} is negative; clamped to 0 (leave room in the parent's padding instead)` });
  if (options.min !== undefined && len.value < options.min) return done(property, px(options.min), { warning: `${property}:${value} clamped to ${px(options.min)}` });
  return done(property, px(len.value), { note: len.note });
}

const ALIGN = ['start', 'center', 'end', 'stretch', 'baseline'];
const ALIGN_ALIASES: Record<string, string> = { 'flex-start': 'start', 'flex-end': 'end', 'self-start': 'start', 'self-end': 'end', normal: 'stretch' };

/** Reads a `flex` shorthand: none | auto | N [N] [LEN | 0% | auto]. */
function parseFlex(raw: string): DeclResult {
  const value = raw.trim().toLowerCase();
  if (value === 'none' || value === 'auto') return done('flex', value);
  const parts = splitTopLevel(value, 'space');
  if (parts.length < 1 || parts.length > 3) return fail(`flex:${value} — use none, auto or N [N] [basis]`);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const isLast = i === parts.length - 1;
    const num = parseNumber(part, 0, 1000);
    if (num.ok && (i < 2 || part === '0')) {
      out.push(formatNumber(num.value));
      continue;
    }
    if (isLast && i >= 1) {
      if (part === 'auto' || part === '0%') {
        out.push(part);
        continue;
      }
      const len = parseLength(part, { min: 0 });
      if (len.ok) {
        out.push(px(len.value));
        continue;
      }
    }
    if (i === 0 && parts.length === 1) {
      const len = parseLength(part, { min: 0 });
      if (len.ok) return done('flex', `1 1 ${px(len.value)}`, { note: `flex:${value} → 1 1 ${px(len.value)}` });
    }
    return fail(`flex:${value} — use none, auto or N [N] [LEN | 0% | auto]`);
  }
  return done('flex', out.join(' '));
}

/** Reads `font` shorthand into longhands. */
function parseFontShorthand(raw: string, ctx: StyleContext): DeclResult {
  const value = raw.trim();
  const m = /^((?:(?:italic|normal|bold|[1-9]00)\s+)*)([\d.]+(?:px|pt)?)(?:\s*\/\s*([\d.]+(?:px|%)?))?\s+(.+)$/i.exec(value);
  if (!m) return fail(`font:${value} — use [italic] [weight] SIZE[/LINE] FAMILY`);
  const set: Array<[CssProperty, string]> = [];
  for (const word of m[1]!.trim().split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (lower === 'italic') set.push(['font-style', 'italic']);
    else if (lower === 'bold') set.push(['font-weight', '700']);
    else if (/^[1-9]00$/.test(lower)) set.push(['font-weight', lower]);
  }
  const size = parseLength(m[2]!, { min: 8, max: 400, clamp: true });
  if (!size.ok) return fail(size.reason);
  set.push(['font-size', px(size.value)]);
  if (m[3]) {
    const lh = parseLineHeight(m[3]);
    if (!lh.ok) return lh;
    set.push(...lh.set);
  }
  const family = parseFontFamily(m[4]!, ctx.faces);
  if (!family.ok) return fail(family.reason);
  set.push(['font-family', family.value]);
  return { ok: true, set, note: 'font shorthand expanded', warning: family.warning ?? size.warning };
}

function parseLineHeight(raw: string): DeclResult {
  const value = raw.trim().toLowerCase();
  if (value === 'normal') return done('line-height', '1.2', { note: 'line-height:normal → 1.2' });
  const pct = parsePercent(value);
  if (pct.ok) {
    const n = Math.min(4, Math.max(0.5, pct.value / 100));
    return done('line-height', formatNumber(n), { note: `line-height:${value} → ${formatNumber(n)}` });
  }
  const num = parseNumber(value);
  if (num.ok) {
    const n = Math.min(4, Math.max(0.5, num.value));
    return done('line-height', formatNumber(n), n !== num.value ? { warning: `line-height:${value} clamped to ${formatNumber(n)}` } : {});
  }
  const len = parseLength(value, { min: 4, max: 1600, clamp: true });
  if (!len.ok) return fail(`line-height:${value} — use N, N% or Npx`);
  return done('line-height', px(len.value), { note: len.note, warning: len.warning });
}

function parseTextDecoration(raw: string, ctx: StyleContext): DeclResult {
  const words = splitTopLevel(raw.trim().toLowerCase(), 'space');
  let line: string | undefined;
  let style: string | undefined;
  let color: string | undefined;
  for (const word of words) {
    if (['none', 'underline', 'line-through'].includes(word) && !line) line = word;
    else if (['solid', 'double', 'dotted', 'dashed', 'wavy'].includes(word) && !style) style = word;
    else {
      const c = parseColorValue(word);
      if (!c.ok || color) return fail(`text-decoration:${raw.trim()} — use none | underline | line-through [style] [color]`);
      color = c.value;
    }
  }
  if (!line) return fail('text-decoration needs underline, line-through or none');
  if (ctx.element === 'span' && line !== 'underline') return fail('a <span> takes text-decoration:underline only');
  if (ctx.element === 'span') return done('text-decoration', 'underline');
  return done('text-decoration', [line, line === 'none' ? '' : style ?? '', line === 'none' ? '' : color ?? ''].filter(Boolean).join(' '));
}

function parseTextStroke(raw: string): DeclResult {
  const parts = splitTopLevel(raw.trim(), 'space');
  if (parts.length !== 2) return fail('-webkit-text-stroke takes LEN COLOR');
  const len = parseLength(parts[0]!, { min: 0, max: 8, clamp: true });
  if (!len.ok) return fail(len.reason);
  const c = parseColorValue(parts[1]!);
  if (!c.ok) return fail(c.reason);
  return done('-webkit-text-stroke', `${px(len.value)} ${c.value}`, { warning: len.warning });
}

function parseLetterSpacing(raw: string): DeclResult {
  const value = raw.trim().toLowerCase();
  if (value === 'normal') return done('letter-spacing', 'normal');
  const em = /^([+-]?(?:\d+\.?\d*|\.\d+))em$/.exec(value);
  if (em) {
    const n = Math.min(1, Math.max(-0.5, Number(em[1])));
    return done('letter-spacing', `${formatNumber(n)}em`);
  }
  const len = parseLength(value, { min: -24, max: 32, clamp: true });
  if (!len.ok) return fail(`letter-spacing:${value} — use Npx or Nem`);
  return done('letter-spacing', px(len.value), { note: len.note, warning: len.warning });
}

function parseAspectRatio(raw: string): DeclResult {
  const value = raw.trim();
  const m = /^([\d.]+)\s*(?:\/\s*([\d.]+))?$/.exec(value);
  if (!m) return fail(`aspect-ratio:${value} — use N or N / N`);
  const a = Number(m[1]);
  const b = m[2] === undefined ? 1 : Number(m[2]);
  if (!(a > 0) || !(b > 0)) return fail('aspect-ratio must be positive');
  return done('aspect-ratio', m[2] === undefined ? formatNumber(a) : `${formatNumber(a)} / ${formatNumber(b)}`);
}

function parseSpan(property: CssProperty, raw: string): DeclResult {
  const m = /^span\s+(\d+)$/.exec(raw.trim().toLowerCase());
  if (!m) return fail(`${property}:${raw.trim()} — use span N (cells fill in source order)`);
  const n = Math.min(24, Math.max(1, Number(m[1])));
  return done(property, `span ${n}`);
}

function parseFontWeight(raw: string, ctx: StyleContext): DeclResult {
  const value = raw.trim().toLowerCase();
  let n: number;
  if (value === 'normal') n = 400;
  else if (value === 'bold') n = 700;
  else if (value === 'bolder') n = 700;
  else if (value === 'lighter') n = 300;
  else if (/^\d+$/.test(value)) n = Number(value);
  else return fail(`font-weight:${value} — use 100–900 or bold`);
  if (n < 100 || n > 900) return fail(`font-weight:${value} is outside 100–900`);
  const rounded = Math.round(n / 100) * 100;
  if (ctx.element === 'span') {
    if (rounded >= 600) return done('font-weight', '700');
    if (rounded === 400) return done('font-weight', '400');
    return fail(`font-weight:${value} — a phrase is bold (600 or more) or regular (400)`);
  }
  return done('font-weight', String(rounded), rounded !== n ? { note: `font-weight:${n} → ${rounded}` } : {});
}

function backgroundFor(raw: string, ctx: StyleContext): DeclResult {
  const parsed = parseBackground(raw);
  if (!parsed.ok) return fail(parsed.reason);
  const bg = parsed.value;
  const flatOnly = ctx.element === 'tr' || ctx.element === 'shape' || ctx.element === 'hr';
  if (flatOnly && (bg.gradient || bg.image)) {
    if (ctx.element === 'tr') return fail('a <tr> background is a flat color');
    // Shapes and lines take a flat fill: heal a gradient to its color under, else its first stop.
    const color = bg.color ?? bg.gradient?.stops[0]?.color;
    if (!color) return fail('a flat color is needed here');
    return done('background', color, { warning: `${tagName(ctx)} takes a flat fill; the gradient became ${color}` });
  }
  if (bg.image && !isText(ctx)) return fail('url() backgrounds fill text only (background-clip:text); use an <img>');
  return done('background', formatBackground(bg));
}

/**
 * Checks and normalizes one declaration. `name` and `raw` are as written;
 * the context says which element carries it.
 */
export function parseDeclaration(name: string, raw: string, ctx: StyleContext): DeclResult {
  const property = name.trim().toLowerCase();
  const value = raw.trim();
  if (!value) return fail(`${property} has no value`);
  if (/!important/i.test(value)) return parseDeclaration(name, value.replace(/!important/gi, ''), ctx);
  if (/\bvar\(/i.test(value)) return fail(`${property}: var() is not supported; write the value`);
  const tag = tagName(ctx);
  const notHere = (): DeclResult => fail(`${property} does not apply to ${tag}`);
  const text = isText(ctx);
  const container = isContainer(ctx);

  switch (property) {
    case 'margin':
    case 'margin-top':
    case 'margin-right':
    case 'margin-bottom':
    case 'margin-left':
      if (/^0(px)?(\s+0(px)?)*$/.test(value)) return { ok: false, reason: 'margin:0 is a no-op', noop: true };
      if (ctx.element === 'section' || ctx.element === 'cell' || ctx.element === 'span' || ctx.element === 'tr') return notHere();
      if (ctx.pinned && !ctx.pinnedMargins) return fail('margin applies to flow children only — place a pinned element with left, top, right or bottom');
      if (!ctx.pinned && !ctx.flowChild) return notHere();
      return parseMargin(value);
    case 'box-sizing':
      return value.toLowerCase() === 'border-box' ? { ok: false, reason: 'box-sizing is always border-box', noop: true } : fail('box-sizing is always border-box');
    case 'grid-template':
      return value.toLowerCase() === 'none' ? { ok: false, reason: 'grid-template:none is a no-op', noop: true } : fail('grid-template is not supported: use grid-template-columns / rows');
    case 'z-index':
      return fail('z-index is not supported: paint order is source order');
    case 'font':
      // Input-only shorthand: stored as its longhands.
      if (!(text || container || ctx.element === 'table')) return notHere();
      return parseFontShorthand(value, ctx);
    case 'list-style':
      if (ctx.element !== 'list') return notHere();
      return parseListStyle(value);
    case 'background-color':
      if (ctx.element === 'span') return fail('a <span> takes color only');
    {
      const result = parseDeclaration('background', value, ctx);
      return result.ok ? { ...result, note: result.note ?? 'background-color → background' } : result;
    }
  }

  if (!isCssProperty(property)) return fail(`${property} is not in the subset`);

  switch (property) {
    case 'position': {
      if (ctx.element === 'section' || ctx.element === 'span' || ctx.element === 'cell' || ctx.element === 'tr') return notHere();
      if (ctx.element === 'connector') return { ok: false, reason: 'an <x-connector> is placed by x1 y1 x2 y2', noop: true };
      const v = value.toLowerCase();
      if (v === 'static') return { ok: false, reason: 'position:static is the default', noop: true };
      if (v === 'relative' && !isDiv(ctx)) return { ok: false, reason: 'position:relative only hosts pinned children on a <div>', noop: true };
      return keyword('position', v, ['absolute', 'relative']);
    }
    case 'left':
    case 'top':
    case 'right':
    case 'bottom':
      if (!ctx.pinned) return fail(`${property} applies to position:absolute elements only (relative does not offset)`);
      return lengthPercentAuto(property, value, { calc: property === 'left' || property === 'top', clampNegative: true });
    case 'width':
    case 'height':
      if (['section', 'span', 'tr', 'connector'].includes(ctx.element)) return notHere();
      if (ctx.element === 'cell' && property === 'height') return notHere();
      if (ctx.element === 'table' && property === 'height') return { ok: false, reason: 'a table is as tall as its rows; height ignored', noop: true };
      return lengthPercentAuto(property, value, { min: 0 });
    case 'min-width': {
      if (!ctx.flowChild) return fail('min-width applies to flow children only');
      const v = value.toLowerCase();
      if (v === 'min-content' || v === 'max-content') return done(property, v);
      return from(property, mapLen(parseLength(v, { min: 0 })));
    }
    case 'min-height':
    case 'max-width':
    case 'max-height':
      if (!ctx.flowChild) return fail(`${property} applies to flow children only`);
      if (value.toLowerCase() === 'none') return { ok: false, reason: `${property}:none is the default`, noop: true };
      return from(property, mapLen(parseLength(value, { min: 0 })));
    case 'aspect-ratio':
      if (ctx.element === 'section') return notHere();
      return parseAspectRatio(value);
    case 'display': {
      if (!(ctx.element === 'section' || isDiv(ctx))) {
        const v = value.toLowerCase();
        return ['block', 'inline', 'inline-block'].includes(v) ? { ok: false, reason: `display:${v} is ignored`, noop: true } : notHere();
      }
      const v = value.toLowerCase();
      if (v === 'block') return { ok: false, reason: 'no display = column', noop: true };
      if (v === 'inline-flex') return done('display', 'flex', { note: 'display:inline-flex → flex' });
      return keyword('display', v, ['flex', 'grid', 'none']);
    }
    case 'flex-direction':
      if (!(ctx.element === 'section' || isDiv(ctx)) || ctx.display === 'grid') return notHere();
      return keyword(property, value, ['row', 'column', 'row-reverse', 'column-reverse']);
    case 'flex-wrap':
      if (!(ctx.element === 'section' || isDiv(ctx))) return notHere();
      if (!(ctx.direction ?? 'column').startsWith('row')) return value.toLowerCase() === 'nowrap' ? { ok: false, reason: 'flex-wrap:nowrap is the default', noop: true } : fail('flex-wrap applies to rows only');
      return keyword(property, value, ['wrap', 'nowrap']);
    case 'gap':
      if (!(ctx.element === 'section' || isDiv(ctx))) return notHere();
      return from('gap', parseGap(value));
    case 'align-items':
      if (!(ctx.element === 'section' || isDiv(ctx))) return notHere();
      return keyword(property, value, ALIGN, ALIGN_ALIASES);
    case 'justify-content':
      if (!(ctx.element === 'section' || isDiv(ctx)) || ctx.display === 'grid') return notHere();
      return keyword(property, value, ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'], { 'flex-start': 'start', 'flex-end': 'end', normal: 'start', left: 'start', right: 'end' });
    case 'justify-items':
      if (!(ctx.element === 'section' || isDiv(ctx)) || ctx.display !== 'grid') return notHere();
      return keyword(property, value, ['start', 'center', 'end', 'stretch'], ALIGN_ALIASES);
    case 'align-self':
      if (!ctx.flowChild) return notHere();
      return keyword(property, value, [...ALIGN, 'auto'], ALIGN_ALIASES);
    case 'justify-self':
      if (!ctx.gridChild) return fail('justify-self applies to grid children only');
      return keyword(property, value, ['start', 'center', 'end', 'stretch', 'auto'], ALIGN_ALIASES);
    case 'flex':
      if (!ctx.flowChild) return fail('flex applies to flow children only');
      return parseFlex(value);
    case 'flex-grow':
    case 'flex-shrink':
      if (!ctx.flowChild) return fail(`${property} applies to flow children only`);
      return from(property, mapNum(parseNumber(value, 0, 1000)));
    case 'flex-basis':
      if (!ctx.flowChild) return fail('flex-basis applies to flow children only');
      if (value.toLowerCase() === 'auto') return done(property, 'auto');
      return from(property, mapLen(parseLength(value, { min: 0 })));
    case 'grid-template-columns':
    case 'grid-template-rows': {
      if (!(ctx.element === 'section' || isDiv(ctx)) || ctx.display !== 'grid') return fail(`${property} applies to display:grid boxes only`);
      const tracks = parseTracks(value);
      return tracks.ok ? done(property, formatTracks(tracks.value)) : fail(tracks.reason);
    }
    case 'grid-column':
    case 'grid-row':
      if (!ctx.gridChild) return fail(`${property} applies to grid children only`);
      return parseSpan(property, value);
    case 'padding': {
      if (ctx.element === 'cell') return from(property, parsePadding(value, 64));
      if (!(container || text || ctx.element === 'table')) return notHere();
      return from(property, parsePadding(value, 1920));
    }
    case 'overflow':
      if (!isDiv(ctx)) return notHere();
      return keyword(property, value, ['hidden', 'visible'], { clip: 'hidden' });
    case 'background':
      if (ctx.element === 'span' || ctx.element === 'cell') return fail(`${tag} takes no background (color a <tr>, or the table)`);
      if (!(container || text || ['img', 'table', 'icon', 'tr', 'shape', 'hr'].includes(ctx.element))) return notHere();
      return backgroundFor(value, ctx);
    case 'background-clip':
      if (!text) return notHere();
      if (!/^text$/i.test(value)) return { ok: false, reason: 'background-clip other than text is a no-op', noop: true };
      return done(property, 'text');
    case '-webkit-text-fill-color': {
      const v = value.toLowerCase();
      if (ctx.element === 'span') return v === 'currentcolor' ? done(property, 'currentcolor') : fail('a <span> takes -webkit-text-fill-color:currentcolor only');
      if (!text) return notHere();
      return v === 'transparent' ? done(property, 'transparent') : fail('-webkit-text-fill-color takes transparent (with background-clip:text)');
    }
    case 'color':
      if (!(text || container || ['span', 'cell', 'icon', 'connector', 'hr', 'table'].includes(ctx.element))) return notHere();
      return from(property, parseColorValue(value));
    case 'font-family': {
      if (!(text || container || ctx.element === 'table')) return notHere();
      return from(property, parseFontFamily(value, ctx.faces));
    }
    case 'font-size': {
      if (!(text || container || ctx.element === 'table')) return notHere();
      const len = parseLength(value, { min: 8, max: 400, clamp: true });
      if (!len.ok) return fail(`font-size:${value} — use Npx 8–400 (no em, rem, %)`);
      return done(property, px(len.value), { note: len.note, warning: len.warning });
    }
    case 'font-weight':
      if (!(text || container || ctx.element === 'span' || ctx.element === 'table' || (ctx.element === 'cell' && ctx.header))) return notHere();
      return parseFontWeight(value, ctx);
    case 'font-style':
      if (!(text || container || ctx.element === 'span')) return notHere();
      return keyword(property, value, ['normal', 'italic'], { oblique: 'italic' });
    case 'line-height':
      if (!(text || container || ctx.element === 'table')) return notHere();
      return parseLineHeight(value);
    case 'letter-spacing':
      if (!(text || container || ctx.element === 'table')) return notHere();
      return parseLetterSpacing(value);
    case 'text-align':
      if (!(text || container || ctx.element === 'cell')) return notHere();
      if (ctx.element === 'cell' && value.toLowerCase() === 'justify') return fail('a cell aligns left, center or right');
      return keyword(property, value, ['left', 'center', 'right', 'justify'], { start: 'left', end: 'right' });
    case 'text-transform':
      if (!(text || container)) return notHere();
      return keyword(property, value, ['none', 'uppercase', 'lowercase', 'capitalize']);
    case 'white-space':
      if (!text) return notHere();
      return keyword(property, value, ['normal', 'nowrap'], { pre: 'nowrap', 'pre-line': 'normal', 'pre-wrap': 'normal' });
    case 'text-decoration':
      if (!(text || ctx.element === 'span')) return notHere();
      return parseTextDecoration(value, ctx);
    case 'font-variant-numeric':
      if (!(text || ctx.element === 'table')) return notHere();
      return keyword(property, value, ['normal', 'tabular-nums']);
    case '-webkit-text-stroke':
      if (!text) return notHere();
      return parseTextStroke(value);
    case 'text-shadow': {
      if (!(text || ctx.element === 'table')) return notHere();
      const s = parseShadows(value, true);
      return s.ok ? done(property, formatShadows(s.value, true), { warning: s.warning }) : fail(s.reason);
    }
    case 'border': {
      const strokeOnly = ctx.element === 'shape' || ctx.element === 'hr' || ctx.element === 'connector';
      if (!(isDiv(ctx) || text || strokeOnly || ['img', 'table', 'icon'].includes(ctx.element))) return notHere();
      const b = parseBorder(value, strokeOnly ? 32 : 16);
      return b.ok ? done(property, formatBorder(b.value), { note: b.note, warning: b.warning }) : fail(b.reason);
    }
    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left': {
      if (ctx.element === 'hr' && property === 'border-top') {
        const b = parseBorder(value, 32);
        return b.ok ? done('border', formatBorder(b.value), { note: `${property} on <hr> → border` }) : fail(b.reason);
      }
      if (!(isDiv(ctx) || text || ['img', 'table', 'icon'].includes(ctx.element))) return notHere();
      const b = parseBorder(value, 16);
      return b.ok ? done(property, formatBorder(b.value), { note: b.note, warning: b.warning }) : fail(b.reason);
    }
    case 'border-width': {
      if (ctx.element !== 'connector') return fail('border-width alone applies to <x-connector>; write border: WIDTH STYLE COLOR');
      const len = parseLength(value, { min: 0, max: 32, clamp: true });
      return len.ok ? done(property, px(len.value), { warning: len.warning }) : fail(len.reason);
    }
    case 'border-style':
      if (ctx.element !== 'connector') return fail('border-style alone applies to <x-connector>; write border: WIDTH STYLE COLOR');
      return keyword(property, value, ['solid', 'dashed', 'dotted']);
    case 'border-radius':
      if (ctx.element === 'shape' && ctx.shape !== 'rect' && ctx.shape !== 'rounded') return fail('border-radius applies to rect shapes only');
      if (!(isDiv(ctx) || text || ['img', 'table', 'shape'].includes(ctx.element))) return notHere();
      return from(property, parseRadius(value));
    case 'box-shadow': {
      if (!(isDiv(ctx) || text || ['img', 'table', 'icon', 'shape'].includes(ctx.element))) return notHere();
      const s = parseShadows(value);
      return s.ok ? done(property, formatShadows(s.value), { warning: s.warning }) : fail(s.reason);
    }
    case 'opacity': {
      if (ctx.element === 'span' || ctx.element === 'cell' || ctx.element === 'tr') return notHere();
      const pct = parsePercent(value);
      const n = pct.ok ? pct.value / 100 : parseNumber(value).ok ? Number(value) : NaN;
      if (!Number.isFinite(n)) return fail(`opacity:${value} — use N 0–1`);
      const c = Math.min(1, Math.max(0, n));
      return done(property, formatNumber(c), c !== n ? { warning: `opacity:${value} clamped to ${formatNumber(c)}` } : {});
    }
    case 'transform': {
      if (['connector', 'span', 'cell', 'tr', 'section'].includes(ctx.element)) return notHere();
      const t = parseTransform(value);
      if (!t.ok) return fail(t.reason);
      if (ctx.element === 'shape') {
        const { rotate, ...rest } = t.value;
        if (Object.values(rest).some((v) => v !== undefined)) return fail('an <x-shape> takes transform:rotate() only');
        return done(property, formatTransform({ rotate }) || 'none');
      }
      const text2 = formatTransform(t.value);
      return text2 ? done(property, text2, { warning: t.warning }) : { ok: false, reason: 'transform:none', noop: true };
    }
    case 'filter':
    case 'backdrop-filter': {
      if (!(isDiv(ctx) || text || ['img', 'shape'].includes(ctx.element))) return notHere();
      const f = parseFilters(value);
      if (!f.ok) return fail(f.reason);
      const text2 = formatFilters(f.value);
      return text2 ? done(property, text2, { warning: f.warning }) : { ok: false, reason: `${property}:none`, noop: true };
    }
    case 'mix-blend-mode':
      if (!(isDiv(ctx) || text || ['img', 'shape'].includes(ctx.element))) return notHere();
      return keyword(property, value, ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']);
    case 'list-style-type':
      if (ctx.element !== 'list') return notHere();
      return parseListMarker(value);
    case 'list-style-position':
      if (ctx.element !== 'list') return notHere();
      return keyword(property, value, ['outside', 'inside']);
    case 'object-fit':
      if (ctx.element !== 'img') return notHere();
      return keyword(property, value, ['cover', 'contain'], { fill: 'cover', 'scale-down': 'contain' });
  }
  return fail(`${property} is not in the subset`);
}

const LIST_MARKERS = ['none', 'disc', 'circle', 'square', 'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'];
const LIST_MARKER_TEXT = 8;

/** `list-style-type`: a marker keyword, or a quoted marker of up to eight characters. */
function parseListMarker(raw: string): DeclResult {
  const value = raw.trim();
  const quoted = /^(["'])(.*)\1$/s.exec(value);
  if (quoted) {
    const text = quoted[2]!;
    if (!text || /["\\;<>\n]/.test(text)) return fail(`list-style-type:${value} — a quoted marker holds plain characters (no quotes, backslashes, ; < or >)`);
    if ([...text].length > LIST_MARKER_TEXT) return fail(`list-style-type:${value} — a quoted marker is at most ${LIST_MARKER_TEXT} characters`);
    return done('list-style-type', `"${text}"`);
  }
  const result = keyword('list-style-type', value, LIST_MARKERS, { 'lower-latin': 'lower-alpha', 'upper-latin': 'upper-alpha' });
  return result.ok ? result : fail(`list-style-type:${value.toLowerCase()} — use ${LIST_MARKERS.join(', ')} or a quoted marker of up to ${LIST_MARKER_TEXT} characters`);
}

/** `list-style`: a marker and a position, in either order; no images. */
function parseListStyle(raw: string): DeclResult {
  const value = raw.trim();
  if (/url\(|gradient\(/i.test(value)) return fail(`list-style:${value} — markers are text, not images`);
  const parts = splitTopLevel(value, 'space');
  let marker: string | undefined;
  let position: string | undefined;
  const notes: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if ((lower === 'inside' || lower === 'outside') && position === undefined) position = lower;
    else if (marker === undefined) {
      const parsed = parseListMarker(part);
      if (!parsed.ok) return parsed;
      marker = parsed.set[0]![1];
      if (parsed.note) notes.push(parsed.note);
    } else if (lower === 'none' && marker === 'none') continue;
    else return fail(`list-style:${value} — one marker and one position (inside or outside)`);
  }
  return {
    ok: true,
    set: [
      ['list-style-type', marker ?? 'disc'],
      ['list-style-position', position ?? 'outside'],
    ],
    ...(notes.length ? { note: notes.join('; ') } : {}),
  };
}

/** `margin`: one to four px lengths (−1920 to 1920) or `auto`. */
function parseMargin(value: string): DeclResult {
  const parts = splitTopLevel(value.trim().toLowerCase(), 'space');
  if (parts.length < 1 || parts.length > 4) return fail(`margin:${value} — one to four lengths`);
  const out: string[] = [];
  let warning: string | undefined;
  for (const part of parts) {
    if (part === 'auto') {
      out.push('auto');
      continue;
    }
    const len = parseLength(part);
    if (!len.ok) return fail(`margin:${value} — use Npx or auto`);
    const n = Math.max(-1920, Math.min(1920, len.value));
    if (n !== len.value) warning = `margin:${value} clamped to ±1920px`;
    out.push(px(n));
  }
  const [t, r = t, b = t, l = r] = out as [string, string?, string?, string?];
  const text = t === b && r === l ? (t === r ? t : `${t} ${r}`) : r === l ? `${t} ${r} ${b}` : `${t} ${r} ${b} ${l}`;
  return done('margin', text, warning ? { warning } : {});
}

/** What one `<li>`'s margin declarations come to. */
export interface ItemMarginRead {
  /** Its top and bottom margin, when both are 0 or more px. */
  margin?: ItemMargin;
  /** Why the top and bottom margin can't be kept. */
  reason?: string;
  /** It gives itself a left or right margin, which an item can't keep. */
  sideways: boolean;
}

const ITEM_MARGIN_SIDES: Record<string, readonly number[]> = {
  'margin-top': [0],
  'margin-right': [1],
  'margin-bottom': [2],
  'margin-left': [3],
  'margin-block-start': [0],
  'margin-block-end': [2],
  'margin-inline-start': [3],
  'margin-inline-end': [1],
};

/** True for the name of a margin declaration, shorthand or side. */
export function isMarginProperty(name: string): boolean {
  return /^margin(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/.test(name);
}

/** Reads one `<li>`'s margin declarations, in the order they apply, as its space above and below. */
export function readItemMargin(declarations: Iterable<readonly [string, string]>): ItemMarginRead {
  const sides: [string, string, string, string] = ['0', '0', '0', '0'];
  for (const [rawName, rawValue] of declarations) {
    const name = rawName.trim().toLowerCase();
    if (!isMarginProperty(name)) continue;
    const parts = splitTopLevel(rawValue.trim().toLowerCase(), 'space');
    if (name === 'margin') {
      const [t = '0', r = t, b = t, l = r] = parts;
      sides.splice(0, 4, t, r, b, l);
    } else if (name === 'margin-block' || name === 'margin-inline') {
      const [a = '0', b = a] = parts;
      if (name === 'margin-block') [sides[0], sides[2]] = [a, b];
      else [sides[3], sides[1]] = [a, b];
    } else for (const side of ITEM_MARGIN_SIDES[name] ?? []) sides[side] = parts[0] ?? '0';
  }
  const zero = (value: string): boolean => {
    const len = parseLength(value);
    return len.ok && len.value === 0;
  };
  const sideways = !zero(sides[1]) || !zero(sides[3]);
  const top = parseLength(sides[0], { min: 0, max: 1920 });
  const bottom = parseLength(sides[2], { min: 0, max: 1920 });
  if (!top.ok || !bottom.ok) return { reason: `margin ${sides[0]} ${sides[2]} — an item takes a top and bottom margin of 0 or more px`, sideways };
  return { margin: { top: top.value, bottom: bottom.value }, sideways };
}

/** The `margin` value of an {@link ItemMargin}: `12px 0`, or `0 0 8px` when top and bottom differ. */
export function formatItemMargin(margin: ItemMargin): string {
  return margin.top === margin.bottom ? `${px(margin.top)} 0` : `${px(margin.top)} 0 ${px(margin.bottom)}`;
}

function mapLen(result: ParseResult<number>): ParseResult {
  return result.ok ? { ...result, value: px(result.value) } : result;
}

function mapNum(result: ParseResult<number>): ParseResult {
  return result.ok ? { ...result, value: formatNumber(result.value) } : result;
}

/** Splits an inline `style` attribute into `[name, value]` pairs (as written). */
export function splitDeclarations(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const chunk of splitStyle(style)) {
    const colon = chunk.indexOf(':');
    if (colon <= 0) continue;
    const name = chunk.slice(0, colon).trim();
    const value = chunk.slice(colon + 1).trim();
    if (name) out.push([name, value]);
  }
  return out;
}

/**
 * Folds longhand and alternate spellings into the subset's own properties,
 * in source order, so `padding-top:24px` or `row-gap:16px` written by hand
 * is kept instead of dropped:
 *
 * - `padding-top|right|bottom|left|inline|block` → `padding` (seeded from an
 *   earlier `padding`), `row-gap|column-gap|grid-*gap` → `gap`;
 * - `inset` → `top right bottom left`; `flex-flow` → `flex-direction` +
 *   `flex-wrap`; `place-items|place-self` → `align-*` + `justify-*`;
 * - `overflow-x|y` → `overflow`; `grid-column-end|grid-row-end` →
 *   `grid-column|grid-row`;
 * - `text-decoration-line|style|color` → `text-decoration`;
 *   `-webkit-text-stroke-width|color` → `-webkit-text-stroke`;
 * - `background-image` → `background`; `-webkit-background-clip` →
 *   `background-clip`; `-webkit-backdrop-filter` → `backdrop-filter`;
 * - `border-width|style|color` together → `border` (except on connectors,
 *   which take width and style alone);
 * - `rotate` / `translate` → `transform`.
 *
 * Each folded group is emitted once, where its first declaration stood.
 */
export function foldAliases(declarations: ReadonlyArray<readonly [string, string]>, element?: ElementKind): {
  declarations: Array<[string, string]>;
  notes: string[];
} {
  const out: Array<[string, string] | null> = [];
  const notes: string[] = [];
  const slots = new Map<string, number>();
  /** Reserves (or reuses) the output slot of a folded group. */
  const slot = (group: string): number => {
    let at = slots.get(group);
    if (at === undefined) {
      at = out.length;
      out.push(null);
      slots.set(group, at);
    }
    return at;
  };
  const sides = (value: string): string[] => {
    const parts = splitTopLevel(value.trim(), 'space');
    const [t = '0', r = t, b = t, l = r] = parts;
    return [t, r, b, l];
  };
  let padding: string[] | undefined;
  let margin: string[] | undefined;
  let gap: [string, string] | undefined;
  const decoration: { line?: string; style?: string; color?: string } = {};
  const stroke: { width?: string; color?: string } = {};
  const border: { width?: string; style?: string; color?: string } = {};
  const transforms: string[] = [];
  const isConnector = element === 'connector';

  for (const [rawName, value] of declarations) {
    const name = rawName.trim().toLowerCase();
    const v = value.trim();
    switch (name) {
      case 'padding':
        padding = sides(v);
        slot('padding');
        continue;
      case 'padding-top':
      case 'padding-right':
      case 'padding-bottom':
      case 'padding-left': {
        padding ??= ['0', '0', '0', '0'];
        padding[['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].indexOf(name)] = v;
        slot('padding');
        notes.push(`${name} → padding`);
        continue;
      }
      case 'padding-inline':
      case 'padding-block': {
        padding ??= ['0', '0', '0', '0'];
        const [a = '0', b = a] = splitTopLevel(v, 'space');
        if (name === 'padding-inline') [padding[3], padding[1]] = [a, b];
        else [padding[0], padding[2]] = [a, b];
        slot('padding');
        notes.push(`${name} → padding`);
        continue;
      }
      case 'margin':
        margin = sides(v);
        slot('margin');
        continue;
      case 'margin-top':
      case 'margin-right':
      case 'margin-bottom':
      case 'margin-left': {
        margin ??= ['0', '0', '0', '0'];
        margin[['margin-top', 'margin-right', 'margin-bottom', 'margin-left'].indexOf(name)] = v;
        slot('margin');
        continue;
      }
      case 'gap': {
        const [row = '0', col = row] = splitTopLevel(v, 'space');
        gap = [row, col];
        slot('gap');
        continue;
      }
      case 'row-gap':
      case 'grid-row-gap':
      case 'column-gap':
      case 'grid-column-gap':
      case 'grid-gap': {
        if (name === 'grid-gap') {
          const [row = '0', col = row] = splitTopLevel(v, 'space');
          gap = [row, col];
        } else {
          gap ??= ['0', '0'];
          if (name.includes('row')) gap[0] = v;
          else gap[1] = v;
        }
        slot('gap');
        notes.push(`${name} → gap`);
        continue;
      }
      case 'inset': {
        const [t, r, b, l] = sides(v);
        out.push(['top', t!], ['right', r!], ['bottom', b!], ['left', l!]);
        notes.push('inset → top/right/bottom/left');
        continue;
      }
      case 'flex-flow':
        for (const word of splitTopLevel(v, 'space')) {
          out.push([/wrap/.test(word) ? 'flex-wrap' : 'flex-direction', word]);
        }
        notes.push('flex-flow → flex-direction/flex-wrap');
        continue;
      case 'place-items':
      case 'place-self': {
        const [a = '', b = a] = splitTopLevel(v, 'space');
        const suffix = name === 'place-items' ? 'items' : 'self';
        out.push([`align-${suffix}`, a], [`justify-${suffix}`, b]);
        notes.push(`${name} → align-${suffix}/justify-${suffix}`);
        continue;
      }
      case 'overflow-x':
      case 'overflow-y':
        out.push(['overflow', v]);
        notes.push(`${name} → overflow`);
        continue;
      case 'grid-column-end':
      case 'grid-row-end':
        out.push([name.replace('-end', ''), v]);
        notes.push(`${name} → ${name.replace('-end', '')}`);
        continue;
      case 'text-decoration-line':
      case 'text-decoration-style':
      case 'text-decoration-color':
        decoration[name.slice('text-decoration-'.length) as 'line' | 'style' | 'color'] = v;
        slot('text-decoration');
        continue;
      case '-webkit-text-stroke-width':
      case '-webkit-text-stroke-color':
        stroke[name.endsWith('width') ? 'width' : 'color'] = v;
        slot('-webkit-text-stroke');
        continue;
      case 'background-image':
        out.push(['background', v]);
        continue;
      case '-webkit-background-clip':
        out.push(['background-clip', v]);
        continue;
      case '-webkit-backdrop-filter':
        out.push(['backdrop-filter', v]);
        continue;
      case 'border-width':
      case 'border-style':
      case 'border-color':
        if (isConnector && name !== 'border-color') {
          out.push([name, v]);
          continue;
        }
        border[name.slice('border-'.length) as 'width' | 'style' | 'color'] = v;
        slot('border');
        continue;
      case 'transform':
        transforms.length = 0;
        transforms.push(v);
        slot('transform');
        continue;
      case 'rotate':
        transforms.push(`rotate(${v})`);
        slot('transform');
        notes.push('rotate → transform');
        continue;
      case 'translate': {
        const [x = '0', y = '0'] = splitTopLevel(v, 'space');
        transforms.push(`translate(${x}, ${y})`);
        slot('transform');
        notes.push('translate → transform');
        continue;
      }
      default:
        out.push([rawName, value]);
    }
  }

  const fill = (group: string, entry: [string, string] | null): void => {
    const at = slots.get(group);
    if (at !== undefined) out[at] = entry;
  };
  if (padding) {
    const [t, r, b, l] = padding as [string, string, string, string];
    const value = t === b && r === l ? (t === r ? t : `${t} ${r}`) : r === l ? `${t} ${r} ${b}` : `${t} ${r} ${b} ${l}`;
    fill('padding', ['padding', value]);
  }
  if (margin) {
    const [t, r, b, l] = margin as [string, string, string, string];
    const value = t === b && r === l ? (t === r ? t : `${t} ${r}`) : r === l ? `${t} ${r} ${b}` : `${t} ${r} ${b} ${l}`;
    fill('margin', ['margin', value]);
  }
  if (gap) fill('gap', ['gap', gap[0] === gap[1] ? gap[0] : `${gap[0]} ${gap[1]}`]);
  if (decoration.line || decoration.style || decoration.color) {
    fill('text-decoration', ['text-decoration', [decoration.line ?? 'underline', decoration.style, decoration.color].filter(Boolean).join(' ')]);
    notes.push('text-decoration-* → text-decoration');
  }
  if (stroke.width || stroke.color) {
    fill('-webkit-text-stroke', ['-webkit-text-stroke', `${stroke.width ?? '1px'} ${stroke.color ?? 'currentcolor'}`]);
    notes.push('-webkit-text-stroke-* → -webkit-text-stroke');
  }
  if (border.width || border.style || border.color) {
    if (isConnector) fill('border', border.color ? ['color', border.color] : null);
    else fill('border', ['border', `${border.width ?? '1px'} ${border.style ?? 'solid'} ${border.color ?? 'currentcolor'}`]);
    notes.push('border-width/style/color → border');
  }
  if (transforms.length) fill('transform', ['transform', transforms.join(' ')]);
  return { declarations: out.filter((entry): entry is [string, string] => entry !== null), notes };
}

/** Splits on `;` outside parentheses and quotes. */
function splitStyle(style: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of style) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Writes a style map as an inline `style` attribute value, in table order. */
export function formatStyle(style: Partial<Record<CssProperty, string>>): string {
  const parts: string[] = [];
  for (const property of CSS_PROPERTIES) {
    const value = style[property];
    if (value !== undefined && value !== '') parts.push(`${property}:${value}`);
  }
  return parts.join(';');
}
