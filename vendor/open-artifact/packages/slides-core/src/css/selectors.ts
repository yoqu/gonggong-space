/**
 * CSS selectors for a source deck's shared stylesheet (`project/deck.css`).
 *
 * The reader matches rules against a slide's parsed markup, so this is the
 * part of Selectors Level 4 a slide needs: type, universal, class and id
 * selectors, the four combinators, structural pseudo-classes
 * (`:first-child`, `:nth-child()`, `:first-of-type`, …), `:not()`, `:root`
 * and `:empty`, and the `::before` / `::after` pseudo-elements. What a slide
 * can't use (attribute selectors, `:is()`, `:where()`, `:has()`, `:hover`,
 * `::marker`, …) fails to parse with the reason, and the rule is dropped.
 */

/** One simple selector inside a compound. */
export type SimpleSelector =
  | { type: 'tag'; name: string }
  | { type: 'universal' }
  | { type: 'class'; name: string }
  | { type: 'id'; name: string }
  | { type: 'nth'; of: 'child' | 'type'; last: boolean; a: number; b: number }
  | { type: 'only'; of: 'child' | 'type' }
  | { type: 'not'; list: ComplexSelector[] }
  | { type: 'root' }
  | { type: 'empty' };

/** A compound selector: simple selectors that all match one element. */
export interface CompoundSelector {
  parts: SimpleSelector[];
}

/** How a compound relates to the one before it. */
export type Combinator = ' ' | '>' | '+' | '~';

/** A complex selector, compounds joined by combinators, left to right. */
export interface ComplexSelector {
  compounds: CompoundSelector[];
  /** `combinators[i]` joins `compounds[i]` and `compounds[i + 1]`. */
  combinators: Combinator[];
  /** `::before` / `::after` on the last compound. */
  pseudo?: 'before' | 'after';
  /** `[ids, classes and pseudo-classes, types]`, as CSS counts them. */
  specificity: [number, number, number];
  /** The selector as written (trimmed), for reports. */
  text: string;
}

/** The outcome of parsing a selector list. */
export type SelectorParse = { ok: true; selectors: ComplexSelector[] } | { ok: false; reason: string };

/** The element interface the matcher needs; the source reader implements it. */
export interface MatchElement {
  /** Lower-case tag name. */
  readonly tag: string;
  readonly id: string | undefined;
  readonly classes: ReadonlySet<string>;
  readonly parent: MatchElement | null;
  /** Element siblings in order, this one included. */
  readonly siblings: readonly MatchElement[];
  /** True when the element has no element children and no text. */
  readonly empty: boolean;
}

const NAME = /^-?[_a-zA-Z -￿][-_a-zA-Z0-9 -￿]*/;
/** `\.` and other escapes in names are kept literally (rare in slide sheets). */
function readName(text: string, at: number): string | undefined {
  const match = NAME.exec(text.slice(at));
  return match?.[0];
}

/** Parses `an+b`, `odd`, `even` or a number. */
function parseNth(raw: string): { a: number; b: number } | undefined {
  const text = raw.replace(/\s+/g, '').toLowerCase();
  if (text === 'odd') return { a: 2, b: 1 };
  if (text === 'even') return { a: 2, b: 0 };
  if (/^[+-]?\d+$/.test(text)) return { a: 0, b: Number(text) };
  const match = /^([+-]?\d*)n([+-]\d+)?$/.exec(text);
  if (!match) return undefined;
  const a = match[1] === '' || match[1] === '+' ? 1 : match[1] === '-' ? -1 : Number(match[1]);
  return { a, b: match[2] ? Number(match[2]) : 0 };
}

/** Pseudo-classes that never match in a slide (nothing is interactive). */
const INTERACTIVE = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'link', 'target', 'checked', 'disabled', 'enabled']);

/** Splits on top-level commas (outside parentheses and quotes). */
function splitList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** The text up to the parenthesis that closes the one before `at`. */
function readArgument(text: string, at: number): { arg: string; end: number } | undefined {
  let depth = 1;
  for (let i = at; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return { arg: text.slice(at, i), end: i + 1 };
  }
  return undefined;
}

/** Parses one complex selector. */
function parseComplex(raw: string): ComplexSelector | string {
  const text = raw.trim();
  if (!text) return 'an empty selector';
  const compounds: CompoundSelector[] = [];
  const combinators: Combinator[] = [];
  const specificity: [number, number, number] = [0, 0, 0];
  let pseudo: ComplexSelector['pseudo'];
  let parts: SimpleSelector[] = [];
  let pending: Combinator | null = null;
  let i = 0;
  const closeCompound = (): string | undefined => {
    if (parts.length === 0) return pending === null && compounds.length === 0 ? 'a selector that starts with a combinator' : 'two combinators in a row';
    if (compounds.length > 0) combinators.push(pending ?? ' ');
    compounds.push({ parts });
    parts = [];
    pending = null;
    return undefined;
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (pseudo) return `${text}: ::${pseudo} must come last`;
    if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') {
      let combinator: Combinator = ' ';
      while (i < text.length && /[\s>+~]/.test(text[i]!)) {
        if (text[i] !== ' ' && !/\s/.test(text[i]!)) {
          if (combinator !== ' ') return `${text}: two combinators in a row`;
          combinator = text[i] as Combinator;
        }
        i++;
      }
      if (i >= text.length) break;
      const problem = closeCompound();
      if (problem) return `${text}: ${problem}`;
      pending = combinator;
      continue;
    }
    if (ch === '*') {
      parts.push({ type: 'universal' });
      i++;
      continue;
    }
    if (ch === '.' || ch === '#') {
      const name = readName(text, i + 1);
      if (!name) return `${text}: a ${ch === '.' ? 'class' : 'id'} needs a name`;
      parts.push(ch === '.' ? { type: 'class', name } : { type: 'id', name });
      if (ch === '.') specificity[1]++;
      else specificity[0]++;
      i += 1 + name.length;
      continue;
    }
    if (ch === '[') return `${text}: attribute selectors are not read — use a class`;
    if (ch === ':') {
      const element = text[i + 1] === ':';
      const name = readName(text, i + (element ? 2 : 1))?.toLowerCase();
      if (!name) return `${text}: a pseudo-class needs a name`;
      let at = i + (element ? 2 : 1) + name.length;
      if (element || name === 'before' || name === 'after') {
        if (name !== 'before' && name !== 'after') return `${text}: ::${name} is not read`;
        pseudo = name;
        specificity[2]++;
        i = at;
        continue;
      }
      let arg: string | undefined;
      if (text[at] === '(') {
        const read = readArgument(text, at + 1);
        if (!read) return `${text}: an unclosed parenthesis`;
        arg = read.arg;
        at = read.end;
      }
      i = at;
      if (INTERACTIVE.has(name)) return `${text}: :${name} never applies — nothing on a slide is interactive`;
      switch (name) {
        case 'root':
          parts.push({ type: 'root' });
          specificity[1]++;
          continue;
        case 'empty':
          parts.push({ type: 'empty' });
          specificity[1]++;
          continue;
        case 'first-child':
        case 'last-child':
          parts.push({ type: 'nth', of: 'child', last: name === 'last-child', a: 0, b: 1 });
          specificity[1]++;
          continue;
        case 'first-of-type':
        case 'last-of-type':
          parts.push({ type: 'nth', of: 'type', last: name === 'last-of-type', a: 0, b: 1 });
          specificity[1]++;
          continue;
        case 'only-child':
        case 'only-of-type':
          parts.push({ type: 'only', of: name === 'only-child' ? 'child' : 'type' });
          specificity[1]++;
          continue;
        case 'nth-child':
        case 'nth-last-child':
        case 'nth-of-type':
        case 'nth-last-of-type': {
          const nth = arg === undefined ? undefined : parseNth(arg);
          if (!nth) return `${text}: :${name}(${arg ?? ''}) — write an+b, odd or even`;
          parts.push({ type: 'nth', of: name.endsWith('type') ? 'type' : 'child', last: name.includes('last'), ...nth });
          specificity[1]++;
          continue;
        }
        case 'not': {
          if (arg === undefined) return `${text}: :not() needs a selector`;
          const inner = parseSelectorList(arg);
          if (!inner.ok) return inner.reason;
          if (inner.selectors.some((s) => s.pseudo)) return `${text}: ::before / ::after inside :not()`;
          parts.push({ type: 'not', list: inner.selectors });
          // :not() counts as its most specific argument.
          const most = inner.selectors.map((s) => s.specificity).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]!;
          specificity[0] += most[0];
          specificity[1] += most[1];
          specificity[2] += most[2];
          continue;
        }
        default:
          return `${text}: :${name} is not read — use a class`;
      }
    }
    const name = readName(text, i);
    if (!name) return `${text}: "${ch}" is not read in a selector`;
    parts.push({ type: 'tag', name: name.toLowerCase() });
    specificity[2]++;
    i += name.length;
  }
  if (parts.length === 0 && pseudo) parts.push({ type: 'universal' });
  if (pending !== null && parts.length === 0) return `${text}: a selector that ends with a combinator`;
  const problem = closeCompound();
  if (problem) return `${text}: ${problem}`;
  return { compounds, combinators, ...(pseudo ? { pseudo } : {}), specificity, text };
}

/** Parses a selector list (`h1, .card > p`); any selector that can't be read fails the whole list, as in CSS. */
export function parseSelectorList(text: string): SelectorParse {
  const selectors: ComplexSelector[] = [];
  for (const part of splitList(text)) {
    const parsed = parseComplex(part);
    if (typeof parsed === 'string') return { ok: false, reason: parsed };
    selectors.push(parsed);
  }
  return { ok: true, selectors };
}

/** Position (1-based) of an element among its siblings, counted as `nth` asks. */
function nthIndex(element: MatchElement, of: 'child' | 'type', last: boolean): number {
  const list = of === 'child' ? element.siblings : element.siblings.filter((s) => s.tag === element.tag);
  const at = list.indexOf(element);
  return last ? list.length - at : at + 1;
}

function matchesNth(index: number, a: number, b: number): boolean {
  if (a === 0) return index === b;
  const n = (index - b) / a;
  return Number.isInteger(n) && n >= 0;
}

/** True when one compound matches the element. */
function matchesCompound(compound: CompoundSelector, element: MatchElement): boolean {
  for (const part of compound.parts) {
    switch (part.type) {
      case 'universal':
        break;
      case 'tag':
        if (element.tag !== part.name) return false;
        break;
      case 'class':
        if (!element.classes.has(part.name)) return false;
        break;
      case 'id':
        if (element.id !== part.name) return false;
        break;
      case 'root':
        if (element.parent !== null) return false;
        break;
      case 'empty':
        if (!element.empty) return false;
        break;
      case 'nth':
        if (!matchesNth(nthIndex(element, part.of, part.last), part.a, part.b)) return false;
        break;
      case 'only': {
        const list = part.of === 'child' ? element.siblings : element.siblings.filter((s) => s.tag === element.tag);
        if (list.length !== 1) return false;
        break;
      }
      case 'not':
        if (part.list.some((selector) => matchesSelector(selector, element))) return false;
        break;
    }
  }
  return true;
}

/** Matches compounds `0..last` of a selector ending at `element`, right to left. */
function matchFrom(selector: ComplexSelector, last: number, element: MatchElement): boolean {
  if (!matchesCompound(selector.compounds[last]!, element)) return false;
  if (last === 0) return true;
  const combinator = selector.combinators[last - 1]!;
  switch (combinator) {
    case '>':
      return element.parent !== null && matchFrom(selector, last - 1, element.parent);
    case ' ':
      for (let up = element.parent; up; up = up.parent) if (matchFrom(selector, last - 1, up)) return true;
      return false;
    case '+': {
      const at = element.siblings.indexOf(element);
      return at > 0 && matchFrom(selector, last - 1, element.siblings[at - 1]!);
    }
    case '~': {
      const at = element.siblings.indexOf(element);
      for (let i = at - 1; i >= 0; i--) if (matchFrom(selector, last - 1, element.siblings[i]!)) return true;
      return false;
    }
  }
}

/** True when the selector (its pseudo-element aside) matches the element. */
export function matchesSelector(selector: ComplexSelector, element: MatchElement): boolean {
  return matchFrom(selector, selector.compounds.length - 1, element);
}

/** Orders two specificities: negative when `a` loses to `b`. */
export function compareSpecificity(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
