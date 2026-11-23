/**
 * Source decks (deck.json `"v":5` with a `format` key): slides written as
 * ordinary HTML with classes, sharing the rules and `--variables` of
 * `project/deck.css`.
 *
 * The editor and the checks work on the closed inline subset, so a source
 * slide is read in two steps:
 *
 * 1. {@link readSourceSlide} works every element's style out by browser
 *    rules (the sheet, the slide's inline styles, `!important`,
 *    specificity, inheritance, `var()`, `em`/`rem`/`calc()`, `box-sizing`,
 *    the tag defaults) and writes the slide out as flat inline HTML. Each
 *    element carries `data-open-artifact-src`, its place in the source file, so the
 *    compiled nodes know where they came from.
 * 2. {@link compileSlide} reads that flat HTML as usual (with `source`).
 *
 * An edit goes back the other way. {@link patchSourceSlide} writes it into
 * the source file itself: the words, or a style on that one tag, or that one
 * element replaced with inline styles beside its classes. When the result
 * would not read back as the edited slide, it gives up and the caller saves
 * the slide flat ({@link flattenSlide}, `data-flat`): inline styles that no
 * longer follow the sheet.
 */

import {
  attributeValue,
  escapeAttribute,
  escapeText,
  parseHtml,
  serializeNodes as serializeHtmlNodes,
  markAncestorsDirty,
  VOID_ELEMENTS,
  type HtmlAttribute,
  type HtmlElement,
  type HtmlNode,
} from '@open-artifact/dc/html';
import { compileSlide, misreadComments, type CompileResult, type Diagnostic } from './compile.ts';
import { formatNumber } from './css/color.ts';
import { compareSpecificity, matchesSelector, type MatchElement } from './css/selectors.ts';
import { formatItemMargin, isMarginProperty, readItemMargin } from './css/properties.ts';
import { parseDeclarationBlock, parseStylesheet, type SheetDeclaration, type Stylesheet } from './css/sheet.ts';
import { parseBackground, splitTopLevel } from './css/values.ts';
import type { DeckFormat, DeckIndex } from './deck.ts';
import { DECK_SIZE_WIDTHS, SLIDE_HEIGHT, SOURCE_MARK, type DeckSize } from './limits.ts';
import type { ItemMargin, Slide, SlideMotion, SlideNode } from './model.ts';
import { serializeNode, serializeSlide } from './serialize.ts';

/* -------------------------------------------------------------------------- */
/* The format key                                                              */
/* -------------------------------------------------------------------------- */

/** The shared stylesheet of a source deck. */
export const DECK_STYLESHEET_PATH = 'project/deck.css';
/** The attribute of a slide saved flat, with inline styles. */
export const FLAT_SLIDE_ATTRIBUTE = 'data-flat';

/** What kind of deck an index describes. */
export type DeckFormatKind = 'none' | 'source' | 'unknown';

/** Reads deck.json `format`: none (inline deck), a source deck, or a format this editor does not know. */
export function deckFormatKind(index: Pick<DeckIndex, 'format'>): DeckFormatKind {
  const format = index.format;
  if (format === undefined) return 'none';
  if (format.v === 1 && format.shared.every((path) => path === DECK_STYLESHEET_PATH)) return 'source';
  return 'unknown';
}

/** The `format` key a new source deck carries. */
export function sourceDeckFormat(): DeckFormat {
  return { v: 1, shared: [DECK_STYLESHEET_PATH] };
}

/**
 * The `project/deck.css` a new, empty source deck starts with: the deck's
 * plain defaults, for the agent to replace with its look before the first
 * slide.
 */
export const NEW_DECK_STYLESHEET = `/* The rules and --variables every slide of this deck shares. */
section {
  background: #ffffff;
  color: #1a1a1a;
}
`;

/** Said of a slide written for the sheet in a deck that has no `format` key. */
export const NEEDS_FORMAT_KEY =
  'This slide is written for project/deck.css, which the page can\'t use until project/deck.json has a "format" key.';
/** Said when that key can't be added because the deck's inline slides would change. */
export const FORMAT_KEY_BLOCKED =
  'This slide is written for project/deck.css, but project/deck.json has no "format" key, and adding one would change how this deck\'s inline-styled slides look.';

/** True when a slide file is a flat slide (`<section data-flat>`). */
export function isFlatSlideHtml(html: string): boolean {
  const section = /<section\b[^>]*>/i.exec(html)?.[0];
  return section !== undefined && /\sdata-flat(?:[\s=>/]|$)/i.test(section);
}

/**
 * What a slide file was written for: `sheet` when it uses classes, fragments,
 * `var()` or `data-deck-skip` (it needs `project/deck.css`), `inline` for a
 * slide of the inline subset, undefined when there is no `<section>`.
 */
export function slideMarkupMadeFor(html: string): 'sheet' | 'inline' | undefined {
  if (!/<section\b/i.test(html)) return undefined;
  if (/<[a-z][^>]*\sclass\s*=/i.test(html) || /var\(\s*--/.test(html) || /data-fragment-index|data-deck-skip/i.test(html)) return 'sheet';
  return 'inline';
}

/* -------------------------------------------------------------------------- */
/* The deck's sheet                                                            */
/* -------------------------------------------------------------------------- */

/** A source deck's shared rules, read at its slide size. */
export interface SourceDeck {
  sheet: Stylesheet;
  width: number;
  height: number;
  /** `project/deck.css` is missing. */
  missing: boolean;
}

/** Reads `project/deck.css` (undefined when it is missing) at the deck size. */
export function createSourceDeck(css: string | undefined, size?: DeckSize): SourceDeck {
  const width = DECK_SIZE_WIDTHS[size ?? '16:9'];
  const viewport = { width, height: SLIDE_HEIGHT };
  return { sheet: parseStylesheet(css ?? '', viewport), width, height: SLIDE_HEIGHT, missing: css === undefined };
}

/* -------------------------------------------------------------------------- */
/* Numbering                                                                   */
/* -------------------------------------------------------------------------- */

/** Elements whose inside is copied as written, never read. */
const OPAQUE = new Set(['svg', 'x-embed', 'aside', 'style', 'script', 'template']);

/**
 * The section's elements in document order: the section is 0, then every
 * element inside it (not inside an `<svg>`, `<x-embed>` or `<aside>`). Reader
 * and patcher number elements with this one walk.
 */
export function numberSourceElements(section: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [section];
  const walk = (nodes: HtmlNode[]): void => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      out.push(node);
      if (!OPAQUE.has(node.tag)) walk(node.children);
    }
  };
  walk(section.children);
  return out;
}

function findSection(nodes: HtmlNode[]): HtmlElement | undefined {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.tag === 'section') return node;
    if (node.tag === 'html' || node.tag === 'body') {
      const inner = findSection(node.children);
      if (inner) return inner;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** Lengths an element resolves its relative units against. */
interface UnitBase {
  /** The element's font size (`em`); for `font-size` itself, the parent's. */
  em: number;
  /** The root font size (`rem`). */
  rem: number;
  width: number;
  height: number;
}

const ABSOLUTE_UNITS: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };

function fmt(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return formatNumber(Object.is(rounded, -0) ? 0 : rounded, 2);
}

/** Converts every relative or absolute length in a value to px. */
export function resolveUnits(value: string, base: UnitBase): string {
  const replaced = value.replace(/(^|[\s(,*/+-])(-?(?:\d+\.?\d*|\.\d+))(em|rem|vw|vh|vmin|vmax|pt|pc|in|cm|mm|q|ch|ex)\b/gi, (_m, lead: string, num: string, unit: string) => {
    const n = Number(num);
    const u = unit.toLowerCase();
    let px: number;
    if (u === 'em') px = n * base.em;
    else if (u === 'rem') px = n * base.rem;
    else if (u === 'vw') px = (n * base.width) / 100;
    else if (u === 'vh') px = (n * base.height) / 100;
    else if (u === 'vmin') px = (n * Math.min(base.width, base.height)) / 100;
    else if (u === 'vmax') px = (n * Math.max(base.width, base.height)) / 100;
    else if (u === 'ch' || u === 'ex') px = n * base.em * 0.5;
    else px = n * (ABSOLUTE_UNITS[u] ?? 1);
    return `${lead}${fmt(px)}px`;
  });
  return evaluateMath(replaced);
}

interface Quantity {
  n: number;
  px: boolean;
}

/** Evaluates a `calc()` body of px and plain numbers; undefined when it holds anything else. */
function evaluateExpression(text: string): Quantity | undefined {
  const tokens = text.match(/(?:\d+\.?\d*|\.\d+)(?:px)?|[-+*/()]|\S+/g);
  if (!tokens) return undefined;
  let at = 0;
  const primary = (): Quantity | undefined => {
    const token = tokens[at++];
    if (token === undefined) return undefined;
    if (token === '(') {
      const inner = sum();
      if (tokens[at++] !== ')') return undefined;
      return inner;
    }
    if (token === '-') {
      const inner = primary();
      return inner && { n: -inner.n, px: inner.px };
    }
    const match = /^(\d+\.?\d*|\.\d+)(px)?$/.exec(token);
    if (!match) return undefined;
    return { n: Number(match[1]), px: match[2] === 'px' };
  };
  const product = (): Quantity | undefined => {
    let left = primary();
    while (left && (tokens[at] === '*' || tokens[at] === '/')) {
      const op = tokens[at++];
      const right = primary();
      if (!right) return undefined;
      if (op === '*') {
        if (left.px && right.px) return undefined;
        left = { n: left.n * right.n, px: left.px || right.px };
      } else {
        if (right.px || right.n === 0) return undefined;
        left = { n: left.n / right.n, px: left.px };
      }
    }
    return left;
  };
  const sum = (): Quantity | undefined => {
    let left = product();
    while (left && (tokens[at] === '+' || tokens[at] === '-')) {
      const op = tokens[at++];
      const right = product();
      if (!right) return undefined;
      const px = left.px || right.px;
      if (left.px !== right.px && left.n !== 0 && right.n !== 0) return undefined;
      left = { n: op === '+' ? left.n + right.n : left.n - right.n, px };
    }
    return left;
  };
  const result = sum();
  return result && at === tokens.length ? result : undefined;
}

/** Folds `calc()`, `min()`, `max()` and `clamp()` whose parts are all px or numbers. */
function evaluateMath(value: string): string {
  let text = value;
  for (let guard = 0; guard < 32; guard++) {
    let changed = false;
    text = text.replace(/\b(calc|min|max|clamp)\(([^()]*)\)/gi, (whole, name: string, body: string) => {
      const fn = name.toLowerCase();
      const quantity = (part: string): Quantity | undefined => evaluateExpression(part.trim());
      let result: Quantity | undefined;
      if (fn === 'calc') result = quantity(body);
      else {
        const parts = body.split(',').map(quantity);
        if (parts.some((p) => p === undefined)) return whole;
        const list = parts as Quantity[];
        if (fn === 'min') result = list.reduce((a, b) => (b.n < a.n ? b : a));
        else if (fn === 'max') result = list.reduce((a, b) => (b.n > a.n ? b : a));
        else if (list.length === 3) result = { n: Math.min(Math.max(list[0]!.n, list[1]!.n), list[2]!.n), px: list[1]!.px };
      }
      if (!result) return whole;
      changed = true;
      return result.px ? `${fmt(result.n)}px` : fmt(result.n);
    });
    // Grouping parentheses left inside a calc after its parts folded.
    if (!changed) break;
  }
  return text;
}

/** Substitutes `var(--x, fallback)`; undefined when a variable has no value. */
function substituteVars(value: string, vars: ReadonlyMap<string, string>, depth = 0): string | undefined {
  if (!value.includes('var(')) return value;
  if (depth > 16) return undefined;
  let out = '';
  let at = 0;
  for (;;) {
    const start = value.indexOf('var(', at);
    if (start < 0) {
      out += value.slice(at);
      break;
    }
    out += value.slice(at, start);
    let depthParen = 1;
    let i = start + 4;
    for (; i < value.length && depthParen > 0; i++) {
      if (value[i] === '(') depthParen++;
      else if (value[i] === ')') depthParen--;
    }
    const body = value.slice(start + 4, i - 1);
    const comma = topLevelComma(body);
    const name = (comma < 0 ? body : body.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : body.slice(comma + 1).trim();
    let resolved = vars.get(name);
    if (resolved === undefined && fallback !== undefined) resolved = fallback;
    if (resolved === undefined) return undefined;
    const inner = substituteVars(resolved, vars, depth + 1);
    if (inner === undefined) return undefined;
    out += inner;
    at = i;
  }
  return out;
}

function topLevelComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

/** Reads a px length (after unit resolution). */
function pxOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/.exec(value.trim());
  if (!match) return undefined;
  if (match[2] === undefined && Number(match[1]) !== 0) return undefined;
  return Number(match[1]);
}

const FONT_SIZE_KEYWORDS: Record<string, number> = {
  'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48,
};

/* -------------------------------------------------------------------------- */
/* The cascade                                                                 */
/* -------------------------------------------------------------------------- */

/** Tag defaults of the slide page (no default margins anywhere). */
const HEADING_SIZES: Record<string, number> = { h1: 96, h2: 64, h3: 44 };
/** The body's font size unless the sheet sets one. */
const BODY_FONT_SIZE = 32;
/** `line-height: normal`. */
const NORMAL_LINE_HEIGHT = '1.2';

/** Properties that inherit into children (the subset's inherited ones, plus a few). */
const INHERITED = new Set([
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color',
  'text-align', 'text-transform', 'white-space', 'font-variant-numeric', 'visibility',
]);

/** Declarations that draw nothing on a still slide, or are worked out here: dropped without a word. */
const LIST_MARKER = /^list-style(?:-type|-position)?$/;
/** What a list's items may give themselves, alike, for the list to carry. */
const ITEM_TEXT = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing'] as const;
const QUIET_DROP = /^(?:animation(?:-.*)?|transition(?:-.*)?|offset(?:-.*)?|will-change|box-sizing|content|counter-(?:increment|reset|set)|cursor|pointer-events|user-select|-webkit-user-select|-webkit-font-smoothing|-moz-osx-font-smoothing|text-rendering|font-kerning|font-optical-sizing|backface-visibility|transform-style|perspective|contain|isolation|scroll-.*|overscroll-.*|touch-action|caret-color|accent-color|appearance|-webkit-appearance|font-synthesis|text-size-adjust|-webkit-text-size-adjust|speak|visibility)$/;

/** One element of the virtual document the sheet is matched against. */
class SourceElement implements MatchElement {
  readonly tag: string;
  readonly id: string | undefined;
  readonly classes: Set<string>;
  parent: SourceElement | null;
  siblings: SourceElement[] = [];
  readonly empty: boolean;
  /** Custom properties in scope. */
  vars = new Map<string, string>();
  /** Cascaded declarations of the element itself, last-wins order. */
  own = new Map<string, string>();
  /** Inherited values (computed) as they reach this element. */
  inherited = new Map<string, string>();
  fontSize = BODY_FONT_SIZE;

  readonly el: HtmlElement | null;

  constructor(el: HtmlElement | null, tag: string, parent: SourceElement | null) {
    this.el = el;
    this.tag = tag;
    this.parent = parent;
    this.id = el ? attributeValue(el, 'id') : undefined;
    const classText = el ? (attributeValue(el, 'class') ?? '') : '';
    this.classes = new Set(classText.split(/\s+/).filter(Boolean));
    if (this.classes.has('fragment')) this.classes.add('visible');
    this.empty = el ? el.children.every((c) => c.type === 'comment' || (c.type === 'text' && c.value === '')) : false;
  }
}

/** A matched declaration, with what orders it in the cascade. */
interface Cascaded extends SheetDeclaration {
  inline: boolean;
  specificity: readonly [number, number, number];
  order: number;
}

function cascadeOrder(a: Cascaded, b: Cascaded): number {
  if (a.important !== b.important) return a.important ? 1 : -1;
  if (a.inline !== b.inline) return a.inline ? 1 : -1;
  return compareSpecificity(a.specificity, b.specificity) || a.order - b.order;
}

/** Declarations of the sheet (and an inline style) that apply to an element, lowest priority first. */
function matchDeclarations(deck: SourceDeck, element: SourceElement, inline: string | undefined, pseudo?: 'before' | 'after'): Cascaded[] {
  const list: Cascaded[] = [];
  let order = 0;
  for (const rule of deck.sheet.rules) {
    let best: readonly [number, number, number] | undefined;
    for (const selector of rule.selectors) {
      if ((selector.pseudo ?? undefined) !== pseudo) continue;
      if (!matchesSelector(selector, element)) continue;
      if (!best || compareSpecificity(selector.specificity, best) > 0) best = selector.specificity;
    }
    if (!best) continue;
    for (const declaration of rule.declarations) list.push({ ...declaration, inline: false, specificity: best, order: order++ });
  }
  if (inline !== undefined && !pseudo) {
    for (const declaration of parseDeclarationBlock(inline)) list.push({ ...declaration, inline: true, specificity: [0, 0, 0], order: order++ });
  }
  return list.sort(cascadeOrder);
}

/** Last-wins map of declarations, in the order they finally apply. */
function winners(list: readonly Cascaded[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const declaration of list) {
    map.delete(declaration.name);
    map.set(declaration.name, declaration.value);
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Options of {@link readSourceSlide}. */
export interface SourceReadOptions {
  /** The slide id the file name implies. */
  id?: string;
  /** The slide's place in the deck (0-based), for `counter()`. */
  index?: number;
  /** Families the deck declares. */
  faces?: Iterable<string>;
  /** Layout lints (default true). */
  lints?: boolean;
}

/** What {@link readSourceSlide} returns: the compiled slide plus the flat HTML it read. */
export interface SourceRead extends CompileResult {
  /** The slide as flat inline HTML, `data-open-artifact-src` marks included. */
  flat: string;
}

/** Tags read as a plain box. */
const BOX_TAGS = new Set([
  'div', 'header', 'footer', 'main', 'article', 'nav', 'figure', 'blockquote', 'dl', 'details', 'address',
  'hgroup', 'search', 'fieldset', 'form', 'center', 'menu',
]);
/** Tags read as a line of text. */
const LINE_TAGS = new Set(['h4', 'h5', 'h6', 'figcaption', 'dt', 'dd', 'summary', 'pre', 'caption', 'legend', 'label']);
/** Inline tags that keep a mark. */
const MARK_TAGS: Record<string, 'b' | 'i' | 'u' | 'a' | 'span' | 'br'> = {
  b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', a: 'a', span: 'span', br: 'br',
};
/** Inline tags whose text is kept as plain text. */
const PLAIN_INLINE = new Set(['code', 's', 'del', 'ins', 'mark', 'small', 'sup', 'sub', 'abbr', 'cite', 'q', 'kbd', 'time', 'var', 'samp', 'dfn', 'bdi', 'bdo', 'data', 'wbr']);
/** Block tags of the inline subset. */
const SUBSET_BLOCKS = new Set(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'div', 'img', 'video', 'table', 'svg', 'hr', 'x-shape', 'x-icon', 'x-connector', 'x-embed']);

function isInlineTag(tag: string): boolean {
  return Object.hasOwn(MARK_TAGS, tag) || PLAIN_INLINE.has(tag);
}

/** Line numbers of a text. */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

class SourceReader {
  readonly diagnostics: Diagnostic[] = [];
  private out = '';
  private outLine = 1;
  private readonly lineOf: (offset: number) => number;
  private readonly marks = new Map<HtmlElement, number>();
  private readonly base: UnitBase;
  private rootFontSize = 16;
  /** Counters the section increments (their value is the slide number). */
  private readonly counters = new Set<string>();
  /** What the slide plays when presenting. */
  readonly motion: SlideMotion = { elements: {}, starting: {}, fragments: [] };
  /** The deck with its `@starting-style` rules as its rules, when it has any. */
  private startingDeck: SourceDeck | undefined;

  private readonly html: string;
  private readonly deck: SourceDeck;
  private readonly options: SourceReadOptions;

  constructor(html: string, deck: SourceDeck, options: SourceReadOptions) {
    this.html = html;
    this.deck = deck;
    this.options = options;
    this.lineOf = lineIndex(html);
    this.base = { em: BODY_FONT_SIZE, rem: 16, width: deck.width, height: deck.height };
    const starting = deck.sheet.starting ?? [];
    if (starting.length) this.startingDeck = { ...deck, sheet: { ...deck.sheet, rules: starting } };
  }

  /** Notes an element's animations, transitions and `@starting-style` (dropped from the still slide). */
  private noteMotion(element: SourceElement): void {
    const origin = element.el ? this.marks.get(element.el) : undefined;
    if (origin === undefined) return;
    const own: Record<string, string> = {};
    for (const [name, value] of element.own) {
      if (!/^(?:animation|transition)(?:-|$)/.test(name)) continue;
      const text = substituteVars(value, element.vars);
      if (text !== undefined && text.trim()) own[name] = text.trim();
    }
    if (Object.keys(own).length) this.motion.elements[origin] = own;
    if (!this.startingDeck) return;
    const list = matchDeclarations(this.startingDeck, element, undefined);
    if (list.length === 0) return;
    const starting: Record<string, string> = {};
    for (const [name, value] of winners(list)) {
      if (name.startsWith('--') || QUIET_DROP.test(name)) continue;
      const resolved = this.resolve(name, value, element);
      if (resolved !== undefined) starting[name] = resolved;
    }
    if (Object.keys(starting).length) this.motion.starting[origin] = starting;
  }

  private report(level: Diagnostic['level'], message: string, offset?: number): void {
    this.diagnostics.push(offset === undefined || offset < 0 ? { level, message } : { level, message, line: this.lineOf(offset) });
  }

  read(): string {
    const nodes = parseHtml(this.html);
    const section = findSection(nodes);
    if (!section) return this.html;
    for (const [i, el] of numberSourceElements(section).entries()) this.marks.set(el, i);
    for (const { node, message } of misreadComments([section])) this.report('warning', message, node.start);
    for (const el of numberSourceElements(section)) {
      if (el.tag === 'style') this.report('error', '<style> in a slide is not read: put the rules in project/deck.css', el.start);
      else if (el.tag === 'link') this.report('error', '<link> in a slide is not read: put the rules in project/deck.css, fonts in deck.json "faces"', el.start);
    }

    // The virtual html → body chain the section sits in.
    const htmlEl = new SourceElement(null, 'html', null);
    htmlEl.siblings = [htmlEl];
    this.computeElement(htmlEl, undefined);
    this.rootFontSize = htmlEl.fontSize;
    this.base.rem = this.rootFontSize;
    const bodyEl = new SourceElement(null, 'body', htmlEl);
    bodyEl.siblings = [bodyEl];
    this.computeElement(bodyEl, undefined);
    if (!bodyEl.own.has('font-size') && !htmlEl.own.has('font-size')) {
      bodyEl.fontSize = BODY_FONT_SIZE;
      bodyEl.inherited.set('font-size', `${BODY_FONT_SIZE}px`);
    }

    const sectionEl = new SourceElement(section, 'section', bodyEl);
    sectionEl.siblings = [sectionEl];
    this.out = this.html.slice(0, section.start);
    this.outLine = this.lineOf(section.start);
    this.section(section, sectionEl);
    this.out += this.html.slice(section.end);
    return this.out;
  }

  /** Works out an element's cascade: its own declarations, variables, font size and inherited values. */
  private computeElement(element: SourceElement, inline: string | undefined): void {
    const parent = element.parent;
    const own = winners(matchDeclarations(this.deck, element, inline));
    element.vars = new Map(parent?.vars);
    for (const [name, value] of own) if (name.startsWith('--')) element.vars.set(name, value);
    element.inherited = new Map(parent?.inherited);
    for (const [name, value] of parent?.own ?? []) {
      if (INHERITED.has(name) && !name.startsWith('--')) {
        const resolved = this.resolve(name, value, parent!);
        if (resolved !== undefined) element.inherited.set(name, resolved);
      }
    }
    for (const [name] of own) if (name.startsWith('--')) own.delete(name);
    element.own = own;
    // Font size first: every em of the element depends on it.
    const parentSize = parent?.fontSize ?? 16;
    const declared = own.get('font-size');
    let size: number | undefined;
    if (declared !== undefined) {
      const value = substituteVars(declared, element.vars);
      if (value !== undefined) {
        const keyword = FONT_SIZE_KEYWORDS[value.trim().toLowerCase()];
        if (keyword !== undefined) size = keyword;
        else {
          const percent = /^(-?[\d.]+)%$/.exec(value.trim());
          if (percent) size = (Number(percent[1]) * parentSize) / 100;
          else size = pxOf(resolveUnits(value, { ...this.base, em: parentSize, rem: this.rootFontSize }));
        }
      }
    }
    if (size === undefined && element.tag in HEADING_SIZES) size = HEADING_SIZES[element.tag]!;
    element.fontSize = size ?? parentSize;
    if (declared !== undefined && size !== undefined) own.set('font-size', `${fmt(size)}px`);
    else if (declared !== undefined) own.delete('font-size');
  }

  /** One declaration of an element as a flat value, or undefined when it is dropped. */
  private resolve(name: string, value: string, element: SourceElement): string | undefined {
    let text = substituteVars(value, element.vars);
    if (text === undefined) return undefined;
    const keyword = text.trim().toLowerCase();
    if (keyword === 'inherit') return element.parent?.inherited.get(name) ?? element.parent?.own.get(name);
    if (keyword === 'initial' || keyword === 'unset' || keyword === 'revert' || keyword === 'revert-layer') return undefined;
    if (name === 'font-size') return `${fmt(element.fontSize)}px`;
    text = resolveUnits(text, { ...this.base, em: element.fontSize, rem: this.rootFontSize });
    if (name === 'line-height') {
      if (keyword === 'normal') return NORMAL_LINE_HEIGHT;
      const percent = /^([\d.]+)%$/.exec(text.trim());
      if (percent) return fmt(Number(percent[1]) / 100);
    }
    if (name === 'font-weight') {
      if (keyword === 'bold' || keyword === 'bolder') return '700';
      if (keyword === 'normal' || keyword === 'lighter') return '400';
    }
    return text.trim();
  }

  /** The flat style of an element: its own declarations, resolved, plus box-sizing. */
  private flatStyle(element: SourceElement, extra: Map<string, string> = new Map()): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    this.noteMotion(element);
    const borderBox = (element.own.get('box-sizing') ?? '').trim() === 'border-box';
    for (const [name, value] of [...extra, ...element.own]) {
      if (QUIET_DROP.test(name)) continue;
      if (name.startsWith('--')) continue;
      const resolved = this.resolve(name, value, element);
      if (resolved === undefined) continue;
      if (LIST_MARKER.test(name) && element.tag !== 'ul' && element.tag !== 'ol') continue;
      out.push([name, resolved]);
    }
    if (!borderBox) this.addBoxEdges(out, element.tag);
    return out;
  }

  /** Makes `width`/`height` include padding and border, as the flat format reads them. */
  private addBoxEdges(style: Array<[string, string]>, tag: string): void {
    if (tag === 'section' || tag === 'img' || tag === 'svg' || tag.startsWith('x-')) return;
    const edges = { top: 0, right: 0, bottom: 0, left: 0 };
    const borders = { top: 0, right: 0, bottom: 0, left: 0 };
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const four = (value: string): number[] | undefined => {
      const parts = splitTopLevel(value, 'space').map(pxOf);
      if (parts.length === 0 || parts.length > 4 || parts.some((p) => p === undefined)) return undefined;
      const [t, r = t, b = t, l = r] = parts as number[];
      return [t!, r!, b!, l!];
    };
    const borderWidth = (value: string): number | undefined => {
      if (/^\s*none\s*$/.test(value)) return 0;
      for (const part of splitTopLevel(value, 'space')) {
        const px = pxOf(part);
        if (px !== undefined) return px;
        if (part === 'thin') return 1;
        if (part === 'medium') return 3;
        if (part === 'thick') return 5;
      }
      return /\b(solid|dashed|dotted|double)\b/.test(value) ? 3 : 0;
    };
    for (const [name, value] of style) {
      if (name === 'padding') {
        const v = four(value);
        if (v) sides.forEach((side, i) => (edges[side] = v[i]!));
      } else if (name.startsWith('padding-')) {
        const side = name.slice(8) as (typeof sides)[number];
        const px = pxOf(value);
        if (side in edges && px !== undefined) edges[side] = px;
      } else if (name === 'border') {
        const w = borderWidth(value);
        if (w !== undefined) sides.forEach((side) => (borders[side] = w));
      } else if (name === 'border-width') {
        const v = four(value);
        if (v) sides.forEach((side, i) => (borders[side] = v[i]!));
      } else if (/^border-(top|right|bottom|left)$/.test(name)) {
        const w = borderWidth(value);
        if (w !== undefined) borders[name.slice(7) as (typeof sides)[number]] = w;
      }
    }
    const across = edges.left + edges.right + borders.left + borders.right;
    const down = edges.top + edges.bottom + borders.top + borders.bottom;
    if (across === 0 && down === 0) return;
    for (const entry of style) {
      const extraPx = /width$/.test(entry[0]) ? across : down;
      if (!/^(?:min-|max-)?(?:width|height)$/.test(entry[0]) || extraPx === 0) continue;
      const px = pxOf(entry[1]);
      if (px !== undefined) entry[1] = `${fmt(px + extraPx)}px`;
    }
  }

  private pad(offset: number): void {
    const line = this.lineOf(offset);
    if (line > this.outLine) {
      this.out += '\n'.repeat(line - this.outLine);
      this.outLine = line;
    }
  }

  private write(text: string): void {
    this.out += text;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.outLine++;
  }

  private styleText(style: Array<[string, string]>): string {
    return style.map(([name, value]) => `${name}:${value}`).join(';');
  }

  /** Writes a start tag: attributes kept as written, minus class and style, plus the flat style. */
  private startTag(tag: string, el: HtmlElement, style: Array<[string, string]>, extra: Array<[string, string | null]> = [], mark = true): string {
    const parts = [tag];
    const skip = new Set(['class', 'style', 'data-fragment-index', 'data-deck-skip']);
    for (const attr of el.attrs) {
      const name = attr.name.toLowerCase();
      if (skip.has(name) || name === SOURCE_MARK) continue;
      parts.push(attr.value === null ? attr.name : `${attr.name}="${escapeAttribute(attr.value)}"`);
    }
    for (const [name, value] of extra) parts.push(value === null ? name : `${name}="${escapeAttribute(value)}"`);
    if (style.length) parts.push(`style="${escapeAttribute(this.styleText(style))}"`);
    if (mark) parts.push(`${SOURCE_MARK}="${this.marks.get(el) ?? -1}"`);
    return `<${parts.join(' ')}>`;
  }

  /** Builds the cascade objects of an element list (siblings matter to `:nth-child`). */
  private elementsOf(el: HtmlElement, parent: SourceElement): Array<[HtmlElement, SourceElement]> {
    const list: Array<[HtmlElement, SourceElement]> = [];
    const siblings: SourceElement[] = [];
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      const element = new SourceElement(child, child.tag, parent);
      element.siblings = siblings;
      siblings.push(element);
      list.push([child, element]);
    }
    return list;
  }

  private section(el: HtmlElement, element: SourceElement): void {
    this.computeElement(element, attributeValue(el, 'style'));
    for (const value of [element.own.get('counter-increment'), element.own.get('counter-reset')]) {
      if (value) for (const part of value.split(/\s+/)) if (/^[a-z_-][\w-]*$/i.test(part) && part !== 'none') this.counters.add(part);
    }
    // Inherited values from html/body land on the section, where the flat format reads them.
    const extra = new Map<string, string>();
    for (const [name, value] of element.inherited) if (!element.own.has(name)) extra.set(name, value);
    if (!element.own.has('line-height') && !extra.has('line-height')) extra.set('line-height', NORMAL_LINE_HEIGHT);
    if (!element.own.has('font-size') && !extra.has('font-size')) extra.set('font-size', `${fmt(element.fontSize)}px`);
    const style = this.flatStyle(element, new Map([...extra].map(([n, v]) => [n, v])));
    this.pad(el.start);
    // `data-deck-skip` (any value but false) skips the slide, as `hidden` does.
    const skip = attributeValue(el, 'data-deck-skip');
    const skipped = skip !== undefined && !/^\s*false\s*$/i.test(skip) && attributeValue(el, 'hidden') === undefined;
    this.write(this.startTag('section', el, style, skipped ? [['hidden', null]] : [], false));
    this.children(el, element, true);
    this.write('</section>');
  }

  /** The children of a box: elements, text, generated `::before`/`::after`. */
  private children(el: HtmlElement, element: SourceElement, isSection: boolean): void {
    const before = this.generated(element, 'before');
    if (before) this.write(before);
    const elements = new Map(this.elementsOf(el, element));
    for (const child of el.children) {
      if (child.type === 'comment') continue;
      if (child.type === 'text') {
        this.write(escapeText(child.value));
        continue;
      }
      this.element(child, elements.get(child)!, isSection);
    }
    const after = this.generated(element, 'after');
    if (after) this.write(after);
  }

  /** `::before` / `::after` of a box: a generated line (or an empty box), never edited by hand. */
  private generated(element: SourceElement, pseudo: 'before' | 'after'): string | undefined {
    const list = matchDeclarations(this.deck, element, undefined, pseudo);
    if (list.length === 0) return undefined;
    const own = winners(list);
    const content = own.get('content');
    if (content === undefined) return undefined;
    const box = new SourceElement(null, 'p', element);
    box.siblings = [box];
    box.vars = new Map(element.vars);
    for (const [name, value] of own) if (name.startsWith('--')) box.vars.set(name, value);
    box.own = own;
    box.inherited = element.inherited;
    box.fontSize = element.fontSize;
    const fontSize = own.get('font-size');
    if (fontSize !== undefined) {
      const resolved = pxOf(resolveUnits(substituteVars(fontSize, box.vars) ?? '', { ...this.base, em: element.fontSize, rem: this.rootFontSize }));
      if (resolved !== undefined) {
        box.fontSize = resolved;
        own.set('font-size', `${fmt(resolved)}px`);
      }
    }
    const text = this.contentText(substituteVars(content, box.vars) ?? 'none', element);
    if (text === undefined) return undefined;
    const style = this.styleText(this.flatStyle(box));
    const styleAttr = style ? ` style="${escapeAttribute(style)}"` : '';
    if (text === '') return `<div${styleAttr} ${SOURCE_MARK}="-1"></div>`;
    return `<p${styleAttr} ${SOURCE_MARK}="-1">${escapeText(text)}</p>`;
  }

  /** Reads a `content` value: strings, `counter()` and `attr()`. */
  private contentText(value: string, element: SourceElement): string | undefined {
    const trimmed = value.trim();
    if (trimmed === 'none' || trimmed === 'normal') return undefined;
    let out = '';
    const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|counter\(\s*([\w-]+)[^)]*\)|attr\(\s*([\w-]+)\s*\)|(\S+)/g;
    for (let match = re.exec(trimmed); match; match = re.exec(trimmed)) {
      if (match[1] !== undefined || match[2] !== undefined) {
        out += (match[1] ?? match[2]!).replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, '$1');
      } else if (match[3] !== undefined) {
        out += this.counters.has(match[3]) ? String((this.options.index ?? 0) + 1) : '0';
      } else if (match[4] !== undefined) {
        out += element.el ? (attributeValue(element.el, match[4]) ?? '') : '';
      }
    }
    return out;
  }

  /** One element child of a box or the section. */
  private element(el: HtmlElement, element: SourceElement, inSection: boolean): void {
    const tag = el.tag;
    if (tag === 'aside' && inSection) {
      this.pad(el.start);
      this.write(this.html.slice(el.start, el.end));
      return;
    }
    if (tag === 'style' || tag === 'link' || tag === 'script' || tag === 'template' || tag === 'meta') {
      if (tag === 'script') this.write(this.html.slice(el.start, el.end));
      return;
    }
    this.computeElement(element, attributeValue(el, 'style'));
    if (isInlineTag(tag)) {
      // Loose inline content in a box: the compiler wraps it in a <p>.
      this.inline(el, element);
      return;
    }
    this.pad(el.start);
    const style = this.flatStyle(element);
    const extra: Array<[string, string | null]> = [];
    if (element.classes.has('fragment')) {
      const pinned = style.some(([n, v]) => n === 'position' && v === 'absolute');
      if (pinned && inSection && attributeValue(el, 'data-build-in') === undefined) {
        const index = Number(attributeValue(el, 'data-fragment-index') ?? 'NaN');
        extra.push(['data-build-in', Number.isInteger(index) && index >= 0 ? `fade ${Math.min(50, index + 1)}` : 'fade']);
      } else if (!pinned) {
        // In flow: shown while editing, stepped in when presenting.
        const origin = this.marks.get(el);
        const index = Number(attributeValue(el, 'data-fragment-index') ?? 'NaN');
        if (origin !== undefined) this.motion.fragments.push(Number.isInteger(index) && index >= 0 ? { origin, index } : { origin });
      }
    }
    if (tag === 'svg' || tag === 'x-embed') {
      const inner = el.closeStart >= 0 ? this.html.slice(el.openEnd, el.closeStart) : '';
      this.write(this.startTag(tag, el, style, extra) + inner + `</${el.rawTag}>`);
      return;
    }
    if (VOID_ELEMENTS.has(tag)) {
      this.write(this.startTag(tag, el, style, extra));
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const listStyle = (element.own.get('list-style') ?? element.own.get('list-style-type') ?? '').trim();
      if (/^none\b/.test(listStyle) || listStyle === 'none') {
        // A list without markers: plain boxes and lines.
        this.write(this.startTag('div', el, style.filter(([name]) => !LIST_MARKER.test(name)), extra));
        for (const [li, item] of this.elementsOf(el, element)) {
          this.computeElement(item, attributeValue(li, 'style'));
          this.pad(li.start);
          this.write(this.startTag('p', li, this.flatStyle(item)));
          this.inlineChildren(li, item);
          this.write('</p>');
        }
        this.write('</div>');
        return;
      }
      this.list(el, element, style, extra, true);
      return;
    }
    if (tag === 'table') {
      this.write(this.startTag('table', el, style, extra));
      this.table(el, element);
      this.write('</table>');
      return;
    }
    let out = SUBSET_BLOCKS.has(tag) ? tag : BOX_TAGS.has(tag) ? 'div' : LINE_TAGS.has(tag) ? 'p' : tag;
    if (out === 'div' && this.holdsOnlyInline(el) && !this.generatedOn(element)) out = 'p';
    if (out === 'p' || out === 'h1' || out === 'h2' || out === 'h3') {
      if (this.generatedOn(element)) this.report('unsupported', `::before/::after on <${tag}> is not read; write it as text`, el.start);
      this.write(this.startTag(out, el, style, extra));
      this.inlineChildren(el, element);
      this.write(`</${out}>`);
      return;
    }
    this.write(this.startTag(out, el, style, extra));
    if (out === 'div') this.children(el, element, false);
    else {
      // Not a tag of the slide format: the compiler reports it.
      for (const child of el.children) if (child.type === 'text') this.write(escapeText(child.value));
    }
    this.write(`</${out}>`);
  }

  private generatedOn(element: SourceElement): boolean {
    return (['before', 'after'] as const).some((pseudo) => winners(matchDeclarations(this.deck, element, undefined, pseudo)).has('content'));
  }

  /** True when a box holds text and inline tags only (it reads as a line). */
  private holdsOnlyInline(el: HtmlElement): boolean {
    let text = false;
    for (const child of el.children) {
      if (child.type === 'comment') continue;
      if (child.type === 'text') {
        if (child.value.trim()) text = true;
        continue;
      }
      if (!isInlineTag(child.tag)) return false;
      text = true;
    }
    return text;
  }

  /** Every item of a list, nested ones too, with its cascade worked out. */
  private itemsOf(el: HtmlElement, element: SourceElement): SourceElement[] {
    const items: SourceElement[] = [];
    const walk = (list: HtmlElement, parent: SourceElement): void => {
      for (const child of list.children) {
        if (child.type !== 'element' || child.tag !== 'li') continue;
        const item = new SourceElement(child, 'li', parent);
        item.siblings = [item];
        this.computeElement(item, attributeValue(child, 'style'));
        items.push(item);
        for (const node of child.children) {
          if (node.type !== 'element' || (node.tag !== 'ul' && node.tag !== 'ol')) continue;
          const nested = new SourceElement(node, node.tag, item);
          nested.siblings = [nested];
          this.computeElement(nested, attributeValue(node, 'style'));
          walk(node, nested);
        }
      }
    };
    walk(el, element);
    return items;
  }

  /** The font and colour declarations every item of a list (nested ones too) gives itself alike. */
  private sharedItemStyle(items: readonly SourceElement[]): Array<[string, string]> {
    const shared: Array<[string, string]> = [];
    for (const name of ITEM_TEXT) {
      const values = new Set(items.map((item) => (item.own.has(name) ? this.resolve(name, item.own.get(name)!, item) : undefined)));
      const value = values.size === 1 ? [...values][0] : undefined;
      if (value !== undefined) shared.push([name, value]);
    }
    return shared;
  }

  /** The flat colour a row group paints under its rows, if it has one. */
  private groupFill(el: HtmlElement, element: SourceElement): string | undefined {
    const name = element.own.has('background-color') && !element.own.has('background') ? 'background-color' : 'background';
    const raw = element.own.get(name);
    if (raw === undefined) return undefined;
    const value = this.resolve(name, raw, element);
    if (value === undefined) return undefined;
    const parsed = parseBackground(value);
    if (parsed.ok && !parsed.value.gradient && !parsed.value.image) return value;
    this.report('unsupported', `<${el.tag}> background: a row group gives its rows a flat colour only`, el.start);
    return undefined;
  }

  /** One item's margin declarations, resolved, in the order they apply. */
  private itemMarginOf(item: SourceElement): ReturnType<typeof readItemMargin> {
    const declarations: Array<[string, string]> = [];
    for (const [name, value] of item.own) {
      if (!isMarginProperty(name)) continue;
      declarations.push([name, this.resolve(name, value, item) ?? '0']);
    }
    return readItemMargin(declarations);
  }

  /** The positive px top and bottom margin every item of a list (nested ones too) gives itself alike. */
  private sharedItemMargin(items: readonly SourceElement[]): ItemMargin | undefined {
    const reads = items.map((item) => this.itemMarginOf(item));
    const first = reads[0]?.margin;
    if (!first || (first.top === 0 && first.bottom === 0)) return undefined;
    return reads.every((read) => read.margin?.top === first.top && read.margin.bottom === first.bottom) ? first : undefined;
  }

  /** A list, its items and the lists nested in them. */
  private list(el: HtmlElement, element: SourceElement, style: Array<[string, string]>, extra: Array<[string, string | null]>, top: boolean, lifted: ReadonlySet<string> = new Set(), spacing?: ItemMargin): void {
    if (top) {
      const items = this.itemsOf(el, element);
      const shared = this.sharedItemStyle(items);
      lifted = new Set(shared.map(([name]) => name));
      style = [...style.filter(([name]) => !lifted.has(name)), ...shared];
      spacing = this.sharedItemMargin(items);
    }
    this.write(this.startTag(el.tag, el, style, extra, top));
    for (const child of el.children) {
      if (child.type === 'comment') continue;
      if (child.type === 'text') {
        this.write(escapeText(child.value));
        continue;
      }
      if (child.tag !== 'li') {
        this.write(this.html.slice(child.start, child.end));
        continue;
      }
      const item = new SourceElement(child, 'li', element);
      item.siblings = [item];
      this.computeElement(item, attributeValue(child, 'style'));
      const margin = this.itemMarginOf(item);
      const quietMargin = spacing !== undefined || (margin.margin?.top === 0 && margin.margin.bottom === 0 && !margin.sideways);
      const dropped = [...item.own.keys()].filter((n) => !QUIET_DROP.test(n) && !LIST_MARKER.test(n) && !lifted.has(n) && !(isMarginProperty(n) && quietMargin));
      if (dropped.length) this.report('unsupported', `<li> ${dropped.join(', ')}: a list line takes no style of its own, only a top and bottom margin in px that every item shares; style the <${el.tag}>`, child.start);
      if (spacing && margin.sideways) this.report('unsupported', '<li> margin-left / margin-right: an item keeps only its top and bottom margin', child.start);
      this.pad(child.start);
      const indent = attributeValue(child, 'data-indent');
      this.write(`<li${indent !== undefined ? ` data-indent="${escapeAttribute(indent)}"` : ''}${spacing ? ` style="margin:${formatItemMargin(spacing)}"` : ''}>`);
      for (const node of child.children) {
        if (node.type === 'element' && (node.tag === 'ul' || node.tag === 'ol')) {
          const nested = new SourceElement(node, node.tag, item);
          nested.siblings = [nested];
          this.computeElement(nested, attributeValue(node, 'style'));
          this.list(node, nested, this.flatStyle(nested).filter(([name]) => LIST_MARKER.test(name)), [], false, lifted, spacing);
        } else this.inlineNode(node, item);
      }
      this.write('</li>');
    }
    this.write(`</${el.tag}>`);
  }

  /** A table: rows (row groups unwrapped by the compiler) and cells; a group's flat fill goes to its rows. */
  private table(el: HtmlElement, element: SourceElement, groupFill?: string): void {
    for (const [child, sub] of this.elementsOf(el, element)) {
      this.pad(child.start);
      if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
        this.computeElement(sub, attributeValue(child, 'style'));
        const fill = this.groupFill(child, sub);
        const others = [...sub.own.keys()].filter((n) => n !== 'background' && n !== 'background-color' && !QUIET_DROP.test(n) && !n.startsWith('--'));
        if (others.length) this.report('unsupported', `<${child.tag}> ${others.join(', ')} is not read; style its rows or cells`, child.start);
        this.write(`<${child.tag}>`);
        this.table(child, sub, fill);
        this.write(`</${child.tag}>`);
      } else if (child.tag === 'tr') {
        this.computeElement(sub, attributeValue(child, 'style'));
        const rowStyle = this.flatStyle(sub);
        const cells = this.elementsOf(child, sub).map(([cell, cellEl]) => {
          this.computeElement(cellEl, attributeValue(cell, 'style'));
          return { cell, cellEl, style: this.flatStyle(cellEl) };
        });
        const rowFill = fillOf(rowStyle) ?? groupFill;
        const fills = new Set(cells.map((c) => fillOf(c.style) ?? rowFill));
        const style = withoutFill(rowStyle);
        if (fills.size === 1) {
          const fill = [...fills][0];
          if (fill !== undefined) style.push(['background', fill]);
        } else if (fills.size > 1) {
          this.report('warning', '<tr> cells are filled differently — a row takes one fill; it was left unfilled', child.start);
        }
        this.write(this.startTag('tr', child, style, [], false));
        for (const { cell, cellEl, style: cellStyle } of cells) {
          this.write(this.startTag(cell.tag === 'th' ? 'th' : 'td', cell, withoutFill(cellStyle), [], false));
          this.inlineChildren(cell, cellEl);
          this.write(`</${cell.tag === 'th' ? 'th' : 'td'}>`);
        }
        this.write('</tr>');
      } else if (child.tag === 'caption' || child.tag === 'colgroup' || child.tag === 'col') {
        this.report('unsupported', `<${child.tag}> in a table is not read`, child.start);
      } else this.write(this.html.slice(child.start, child.end));
    }
  }

  private inlineChildren(el: HtmlElement, element: SourceElement): void {
    const elements = new Map(this.elementsOf(el, element));
    for (const node of el.children) {
      if (node.type === 'element') {
        const sub = elements.get(node)!;
        if (isInlineTag(node.tag)) {
          this.computeElement(sub, attributeValue(node, 'style'));
          this.inline(node, sub);
        } else this.write(this.html.slice(node.start, node.end));
      } else this.inlineNode(node, element);
    }
  }

  private inlineNode(node: HtmlNode, parent: SourceElement): void {
    if (node.type === 'comment') return;
    if (node.type === 'text') {
      this.write(escapeText(node.value));
      return;
    }
    const sub = new SourceElement(node, node.tag, parent);
    sub.siblings = [sub];
    if (isInlineTag(node.tag)) {
      this.computeElement(sub, attributeValue(node, 'style'));
      this.inline(node, sub);
    } else this.write(this.html.slice(node.start, node.end));
  }

  /** A phrase: colour, bold or regular weight, italic, underline and links survive. */
  private inline(el: HtmlElement, element: SourceElement): void {
    const tag = el.tag;
    if (tag === 'br') {
      this.write('<br>');
      return;
    }
    const wrap: string[] = [];
    const mark = Object.hasOwn(MARK_TAGS, tag) ? MARK_TAGS[tag] : undefined;
    if (mark === 'b' || mark === 'i' || mark === 'u') wrap.push(mark);
    let href: string | undefined;
    if (mark === 'a') href = attributeValue(el, 'href');
    let color: string | undefined;
    let regular = false;
    const dropped: string[] = [];
    for (const [name, value] of element.own) {
      if (QUIET_DROP.test(name) || name.startsWith('--')) continue;
      const resolved = this.resolve(name, value, element);
      if (resolved === undefined) continue;
      if (name === 'color') color = resolved;
      else if (name === 'font-weight') {
        const n = Math.round(Number(resolved) / 100) * 100;
        if (n >= 600) {
          if (!wrap.includes('b')) wrap.push('b');
        } else if (n === 400) {
          if (wrap.includes('b')) wrap.splice(wrap.indexOf('b'), 1);
          regular = element.parent?.inherited.get('font-weight') !== '400';
        } else this.report('unsupported', `<${tag}> font-weight:${resolved}: a phrase is bold (600 or more) or regular (400)`, el.start);
      } else if (name === 'font-style') {
        if (/italic|oblique/.test(resolved) && !wrap.includes('i')) wrap.push('i');
      } else if (name === 'text-decoration' || name === 'text-decoration-line') {
        if (/underline/.test(resolved) && !wrap.includes('u')) wrap.push('u');
      } else if (name === 'display' && /^(inline|contents)$/.test(resolved)) {
        // Inline already.
      } else dropped.push(name);
    }
    if (dropped.length) this.report('unsupported', `<${tag}> ${dropped.join(', ')}: a phrase keeps only colour, bold, italic and underline`, el.start);
    let open = '';
    let close = '';
    if (href !== undefined) {
      open += `<a href="${escapeAttribute(href)}">`;
      close = '</a>' + close;
    }
    for (const w of wrap) {
      open += `<${w}>`;
      close = `</${w}>` + close;
    }
    const span = [color !== undefined ? `color:${escapeAttribute(color)}` : '', regular ? 'font-weight:400' : ''].filter(Boolean);
    if (span.length) {
      open += `<span style="${span.join(';')}">`;
      close = '</span>' + close;
    }
    this.write(open);
    this.inlineChildren(el, element);
    this.write(close);
  }
}

/** The fill a flat style paints, as written. */
function fillOf(style: ReadonlyArray<[string, string]>): string | undefined {
  let fill: string | undefined;
  for (const [name, value] of style) if (name === 'background' || name === 'background-color') fill = value;
  return fill;
}

function withoutFill(style: ReadonlyArray<[string, string]>): Array<[string, string]> {
  return style.filter(([name]) => name !== 'background' && name !== 'background-color');
}

/**
 * Reads a source slide: works its styles out against the deck's sheet and
 * compiles the flat result. Errors of the reader (a `<style>` in the slide)
 * hold the slide like compiler errors.
 */
export function readSourceSlide(html: string, deck: SourceDeck, options: SourceReadOptions = {}): SourceRead {
  const reader = new SourceReader(html, deck, options);
  const flat = reader.read();
  const compileOptions: Parameters<typeof compileSlide>[1] = { source: true };
  if (options.id !== undefined) compileOptions.id = options.id;
  if (options.faces !== undefined) compileOptions.faces = options.faces;
  if (options.lints !== undefined) compileOptions.lints = options.lints;
  const result = compileSlide(flat, compileOptions);
  const diagnostics = [...reader.diagnostics, ...result.diagnostics];
  const held = result.held || reader.diagnostics.some((d) => d.level === 'error');
  const { motion } = reader;
  const moves = Object.keys(motion.elements).length > 0 || Object.keys(motion.starting).length > 0 || motion.fragments.length > 0;
  return { ...result, slide: moves ? { ...result.slide, motion } : result.slide, diagnostics, held, flat };
}

/* -------------------------------------------------------------------------- */
/* Flat slides                                                                 */
/* -------------------------------------------------------------------------- */

/** Strips source places (`src`) from a slide tree. */
export function stripSourcePlaces(slide: Slide): Slide {
  const strip = (node: SlideNode): SlideNode => {
    const copy = { ...node } as SlideNode;
    delete copy.origin;
    if (copy.kind === 'box') copy.children = copy.children.map(strip);
    return copy;
  };
  return { ...slide, children: slide.children.map(strip) };
}

/** A slide as a flat file: inline styles, `data-flat`, no source marks. */
export function flattenSlide(slide: Slide): string {
  return serializeSlide({ ...stripSourcePlaces(slide), flat: true });
}

/* -------------------------------------------------------------------------- */
/* Patching                                                                    */
/* -------------------------------------------------------------------------- */

/** What a removed property is reset to inline, so the sheet's value stops applying. */
function resetValue(property: string): string {
  if (/^(?:background|border(?:-(?:top|right|bottom|left))?|box-shadow|text-shadow|filter|backdrop-filter|transform|max-width|max-height|text-transform|text-decoration|-webkit-text-stroke)$/.test(property)) return 'none';
  if (/^(?:padding|margin|gap|border-width|border-radius|letter-spacing)$/.test(property)) return '0';
  if (/^(?:width|height|min-width|min-height|left|top|right|bottom|flex-basis|aspect-ratio|grid-column|grid-row)$/.test(property)) return 'auto';
  if (property === 'opacity' || property === 'flex-grow') return '1';
  if (property === 'flex-shrink') return '1';
  if (property === 'position') return 'static';
  if (property === 'font-style' || property === 'font-variant-numeric' || property === 'white-space') return 'normal';
  if (property === 'mix-blend-mode') return 'normal';
  return 'unset';
}

/** Sets (or removes, with undefined) declarations in an inline style text. */
function upsertStyle(text: string, changes: ReadonlyMap<string, string | undefined>): string {
  const declarations = parseDeclarationBlock(text).map((d) => [d.name, d.important ? `${d.value} !important` : d.value] as [string, string]);
  for (const [name, value] of changes) {
    const at = declarations.findIndex(([n]) => n === name);
    if (value === undefined) {
      if (at >= 0) declarations.splice(at, 1);
    } else if (at >= 0) declarations[at]![1] = value;
    else declarations.push([name, value]);
  }
  return declarations.map(([n, v]) => `${n}:${v}`).join(';');
}

function setAttribute(el: HtmlElement, name: string, value: string | null | undefined): void {
  const at = el.attrs.findIndex((a) => a.name.toLowerCase() === name);
  if (value === undefined) {
    if (at < 0) return;
    el.attrs.splice(at, 1);
  } else if (at >= 0) {
    if (el.attrs[at]!.value === value) return;
    el.attrs[at] = { ...el.attrs[at]!, value };
  } else el.attrs.push({ name, value, start: -1, end: -1 } satisfies HtmlAttribute);
  el.dirtyTag = true;
  markAncestorsDirty(el);
}

/** Parses flat HTML into nodes that serialize from their values (created nodes). */
function createdNodes(html: string): HtmlNode[] {
  const nodes = parseHtml(html);
  const mark = (list: HtmlNode[]): void => {
    for (const node of list) {
      node.start = -1;
      node.end = -1;
      if (node.type === 'element') {
        node.closeStart = -1;
        mark(node.children);
      }
    }
  };
  mark(nodes);
  return nodes;
}

/** The start-tag attributes of a node's flat serialization (minus style). */
function flatAttributes(node: SlideNode): Map<string, string | null> {
  const el = parseHtml(serializeNode(node)).find((n): n is HtmlElement => n.type === 'element');
  const map = new Map<string, string | null>();
  for (const attr of el?.attrs ?? []) if (attr.name !== 'style') map.set(attr.name.toLowerCase(), attr.value);
  return map;
}

/** The inner nodes of a node's flat serialization, as created nodes. */
function flatInner(node: SlideNode): HtmlNode[] {
  const el = createdNodes(serializeNode(node)).find((n): n is HtmlElement => n.type === 'element');
  return el?.children ?? [];
}

/** List items written plain, for the sheet to give their margin back. */
function withoutItemStyles(nodes: HtmlNode[]): HtmlNode[] {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.tag === 'li') node.attrs = node.attrs.filter((a) => a.name.toLowerCase() !== 'style');
    withoutItemStyles(node.children);
  }
  return nodes;
}

/** A node's flat element, with the classes of the element it replaces. */
function flatElement(node: SlideNode, classOf?: HtmlElement): HtmlElement | undefined {
  const el = createdNodes(serializeNode({ ...node, origin: undefined } as SlideNode)).find((n): n is HtmlElement => n.type === 'element');
  if (!el) return undefined;
  const cls = classOf ? attributeValue(classOf, 'class') : undefined;
  if (cls) el.attrs.unshift({ name: 'class', value: cls, start: -1, end: -1 });
  const sized = Object.keys(node.style).some((n) => /^(?:min-|max-)?(?:width|height)$/.test(n));
  if (sized && !el.attrs.some((a) => a.name === 'style' && /box-sizing/.test(a.value ?? ''))) {
    const style = el.attrs.find((a) => a.name === 'style');
    if (style) style.value = `${style.value};box-sizing:border-box`;
  }
  return el;
}

class Patcher {
  private readonly elements: HtmlElement[];
  /** Changed declarations the tag writes itself are taken off it, for the sheet to give back. */
  private readonly unwrite: boolean;
  /** A list's new type or colour is written on its items too, over the rules that style them. */
  private readonly items: boolean;

  constructor(section: HtmlElement, mode: PatchMode) {
    this.elements = numberSourceElements(section);
    this.unwrite = mode === 'unwrite';
    this.items = mode === 'items';
  }

  /** Writes the list's changed type and colour declarations on every item, nested ones too. */
  private itemStyle(el: HtmlElement, saved: Record<string, string | undefined>, edited: Record<string, string | undefined>): void {
    const changes = new Map<string, string>();
    for (const name of ITEM_TEXT) if (saved[name] !== edited[name] && edited[name] !== undefined) changes.set(name, edited[name]!);
    if (changes.size === 0) return;
    const walk = (list: HtmlElement): void => {
      for (const li of list.children) {
        if (li.type !== 'element' || li.tag !== 'li') continue;
        setAttribute(li, 'style', upsertStyle(attributeValue(li, 'style') ?? '', changes));
        for (const nested of li.children) if (nested.type === 'element' && (nested.tag === 'ul' || nested.tag === 'ol')) walk(nested);
      }
    };
    walk(el);
  }

  private at(src: number | undefined): HtmlElement | undefined {
    return src === undefined || src < 0 ? undefined : this.elements[src];
  }

  /** Writes the style difference of a node into its element's inline style. */
  private style(el: HtmlElement, saved: Record<string, string | undefined>, edited: Record<string, string | undefined>): void {
    const changes = new Map<string, string | undefined>();
    const own = this.unwrite ? new Set(parseDeclarationBlock(attributeValue(el, 'style') ?? '').map((d) => d.name)) : new Set<string>();
    for (const name of new Set([...Object.keys(saved), ...Object.keys(edited)])) {
      if (saved[name] === edited[name]) continue;
      changes.set(name, own.has(name) ? undefined : (edited[name] ?? resetValue(name)));
    }
    if (changes.size === 0) return;
    if ([...changes.keys()].some((n) => /^(?:min-|max-)?(?:width|height)$/.test(n))) changes.set('box-sizing', 'border-box');
    setAttribute(el, 'style', upsertStyle(attributeValue(el, 'style') ?? '', changes) || undefined);
  }

  private replaceChildren(el: HtmlElement, children: HtmlNode[]): void {
    for (const child of children) child.parent = el;
    el.children = children;
    el.dirtyChildren = true;
    markAncestorsDirty(el);
  }

  private replaceElement(el: HtmlElement, next: HtmlElement): void {
    const parent = el.parent;
    if (!parent) return;
    const at = parent.children.indexOf(el);
    next.parent = parent;
    parent.children[at] = next;
    parent.dirtyChildren = true;
    markAncestorsDirty(parent);
  }

  /** Patches one node into its element; false when it can't. */
  node(saved: SlideNode, edited: SlideNode, el: HtmlElement): boolean {
    const sameShape = saved.kind === edited.kind && ('tag' in saved ? saved.tag === (edited as typeof saved).tag : true);
    if (!sameShape || saved.kind === 'svg') {
      if (JSON.stringify(stripNode(saved)) === JSON.stringify(stripNode(edited))) return true;
      const next = flatElement(edited, el);
      if (!next) return false;
      this.replaceElement(el, next);
      return true;
    }
    this.style(el, saved.style, edited.style);
    const before = flatAttributes(saved);
    const after = flatAttributes(edited);
    for (const name of new Set([...before.keys(), ...after.keys()])) {
      if (name === SOURCE_MARK) continue;
      if (before.get(name) !== after.get(name)) setAttribute(el, name, after.has(name) ? after.get(name)! : undefined);
    }
    switch (edited.kind) {
      case 'box':
        return this.children(saved.kind === 'box' ? saved.children : [], edited.children, el);
      case 'text':
      case 'list':
      case 'textbox':
      case 'table':
      case 'embed': {
        const a = JSON.stringify(contentOf(saved));
        const b = JSON.stringify(contentOf(edited));
        if (a !== b) this.replaceChildren(el, edited.kind === 'embed' ? createdNodes(edited.html) : edited.kind === 'list' && !this.items ? withoutItemStyles(flatInner(edited)) : flatInner(edited));
        if (this.items && edited.kind === 'list') this.itemStyle(el, saved.style, edited.style);
        return true;
      }
      default:
        return true;
    }
  }

  /** Patches a container's children; rebuilds the list when nodes came, went or moved. */
  children(saved: readonly SlideNode[], edited: readonly SlideNode[], el: HtmlElement): boolean {
    const keyOf = (list: readonly SlideNode[]): string => list.filter((n) => n.origin !== -1).map((n) => n.origin ?? 'new').join(',');
    const generatedSaved = saved.filter((n) => n.origin === -1);
    const generatedEdited = edited.filter((n) => n.origin === -1);
    if (JSON.stringify(generatedSaved.map(stripNode)) !== JSON.stringify(generatedEdited.map(stripNode))) return false;
    const savedBySrc = new Map<number, SlideNode>();
    const index = (list: readonly SlideNode[]): void => {
      for (const node of list) {
        if (node.origin !== undefined && node.origin >= 0) savedBySrc.set(node.origin, node);
        if (node.kind === 'box') index(node.children);
      }
    };
    index(saved);
    if (keyOf(saved) === keyOf(edited)) {
      const kept = edited.filter((n) => n.origin !== -1);
      const old = saved.filter((n) => n.origin !== -1);
      for (let i = 0; i < kept.length; i++) {
        const target = this.at(kept[i]!.origin);
        if (!target || !this.node(old[i]!, kept[i]!, target)) return false;
      }
      return true;
    }
    // Rebuild: reuse source elements by place, create the rest flat.
    const next: HtmlNode[] = [];
    const indentText = el.children.find((c) => c.type === 'text' && /\n/.test(c.value));
    const indent = indentText && indentText.type === 'text' ? indentText.value.replace(/^[^\n]*/, '') : '\n';
    // Elements the reader did not turn into nodes (notes) stay, at the end.
    const keep = el.children.filter((c): c is HtmlElement => c.type === 'element' && c.tag === 'aside');
    const pairs: Array<[SlideNode, SlideNode, HtmlElement]> = [];
    for (const node of edited) {
      if (node.origin === -1) continue;
      next.push(...createdNodes(indent));
      const target = this.at(node.origin);
      const before = node.origin !== undefined ? savedBySrc.get(node.origin) : undefined;
      if (target && before) {
        const old = target.parent;
        if (old && old !== el) {
          old.children.splice(old.children.indexOf(target), 1);
          old.dirtyChildren = true;
          markAncestorsDirty(old);
        }
        next.push(target);
        pairs.push([before, node, target]);
      } else {
        const created = flatElement(node);
        if (!created) return false;
        next.push(created);
      }
    }
    for (const aside of keep) next.push(...createdNodes(indent), aside);
    next.push(...createdNodes(indent.replace(/ {1,2}$/, '')));
    this.replaceChildren(el, next);
    return pairs.every(([before, node, target]) => this.node(before, node, target));
  }
}

/** A slide with every style that only resets a property (`padding:0`, `background:none`) left out, for comparing reads. */
function withoutResets(slide: Slide): Slide {
  const clean = <T extends { style: Record<string, string | undefined> }>(item: T): T => {
    const style: Record<string, string> = {};
    for (const [name, value] of Object.entries(item.style)) if (value !== undefined && value !== resetValue(name) && value !== 'unset') style[name] = value;
    return { ...item, style };
  };
  const node = (n: SlideNode): SlideNode => {
    const copy = clean(n);
    if (copy.kind === 'box') copy.children = copy.children.map(node);
    return copy;
  };
  return { ...clean(slide), children: slide.children.map(node) };
}

function stripNode(node: SlideNode): SlideNode {
  return stripSourcePlaces({ id: 'x', hidden: false, style: {}, children: [node], notes: '' }).children[0]!;
}

function contentOf(node: SlideNode): unknown {
  switch (node.kind) {
    case 'text':
      return node.runs;
    case 'list':
      return { items: node.items, levels: node.levels, itemMargin: node.itemMargin };
    case 'textbox':
      return node.blocks.map(stripNode);
    case 'table':
      return node.rows;
    case 'embed':
      return node.html;
    default:
      return null;
  }
}

/** Options of {@link patchSourceSlide}. */
export interface PatchOptions extends SourceReadOptions {}

/**
 * Writes an edit into a source slide's own markup: a style on that one tag,
 * the words, or that element replaced with inline styles beside its classes.
 * The result is read back against the sheet; when it would not read as the
 * edited slide, this returns undefined and the caller saves the slide flat
 * ({@link flattenSlide}).
 */
export function patchSourceSlide(source: string, saved: Slide, edited: Slide, deck: SourceDeck, options: PatchOptions = {}): string | undefined {
  for (const mode of PATCH_MODES) {
    const out = patchOnce(source, saved, edited, deck, options, mode);
    if (out !== undefined) return out;
  }
  return undefined;
}

type PatchMode = 'unwrite' | 'plain' | 'items';

/** `unwrite` first lets the sheet give back what an edit had written on a tag; `items` last reaches past rules on list items. */
const PATCH_MODES: readonly PatchMode[] = ['unwrite', 'plain', 'items'];

/** One try at a patch. */
function patchOnce(source: string, saved: Slide, edited: Slide, deck: SourceDeck, options: PatchOptions, mode: PatchMode): string | undefined {
  const nodes = parseHtml(source);
  const section = findSection(nodes);
  if (!section || saved.id !== edited.id || edited.flat) return undefined;
  const patcher = new Patcher(section, mode);
  if (saved.hidden !== edited.hidden) {
    setAttribute(section, 'hidden', edited.hidden ? null : undefined);
    if (!edited.hidden) setAttribute(section, 'data-deck-skip', undefined);
  }
  if (saved.transition !== edited.transition) setAttribute(section, 'data-transition', edited.transition);
  if (saved.section !== edited.section) setAttribute(section, 'data-section', edited.section);
  const sectionStyle = (slide: Slide): Record<string, string | undefined> => slide.style;
  const changes = new Map<string, string | undefined>();
  for (const name of new Set([...Object.keys(saved.style), ...Object.keys(edited.style)])) {
    const a = sectionStyle(saved)[name];
    const b = sectionStyle(edited)[name];
    if (a !== b) changes.set(name, b ?? resetValue(name));
  }
  if (changes.size) setAttribute(section, 'style', upsertStyle(attributeValue(section, 'style') ?? '', changes));
  if (saved.notes !== edited.notes) {
    const aside = section.children.find((c): c is HtmlElement => c.type === 'element' && c.tag === 'aside');
    if (aside) {
      if (edited.notes) {
        aside.children = createdNodes(escapeText(edited.notes).replace(/\n/g, '<br>'));
        for (const child of aside.children) child.parent = aside;
        aside.dirtyChildren = true;
        markAncestorsDirty(aside);
      } else {
        section.children.splice(section.children.indexOf(aside), 1);
        section.dirtyChildren = true;
      }
    } else if (edited.notes) {
      const created = createdNodes(`<aside>${escapeText(edited.notes).replace(/\n/g, '<br>')}</aside>\n`);
      for (const c of created) c.parent = section;
      section.children.push(...created);
      section.dirtyChildren = true;
    }
  }
  if (!patcher.children(saved.children, edited.children, section)) return undefined;
  const out = serializeHtmlNodes(nodes, source);
  // Read it back: the patch must give the edited slide.
  const back = readSourceSlide(out, deck, { ...options, lints: false });
  if (back.held) return undefined;
  const want = serializeSlide(withoutResets(stripSourcePlaces({ ...edited, flat: undefined })));
  const got = serializeSlide(withoutResets(stripSourcePlaces({ ...back.slide, flat: undefined })));
  return want === got ? out : undefined;
}
