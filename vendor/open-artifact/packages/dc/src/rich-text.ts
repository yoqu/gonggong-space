/**
 * Rich text in templates in-place text editing:
 *
 * - which elements are edited in place ({@link isRichTextElement}): their
 *   content is words and inline formatting (`<b>`, `<i>`, `<a>`, `<br>`…);
 * - cleaning the HTML an edit produced before it is written back
 *   ({@link sanitizeTextHtml});
 * - the string literals of a logic script ({@link scriptLiterals}), so text
 *   a script supplies can be edited where it is written.
 */

import { RAW_TEXT_ELEMENTS, VOID_ELEMENTS, attributeValue, parseHtml, type HtmlElement, type HtmlNode } from './html.ts';
import { hasHoles } from './holes.ts';

/** Inline formatting an editable text may hold. */
export const INLINE_TEXT_TAGS: ReadonlySet<string> = new Set(
  'a abbr b bdi bdo br cite code del dfn em i ins kbd mark q s samp small span strike strong sub sup u var wbr'.split(' '),
);

/** Tags whose content is never edited as text. */
const NOT_TEXT = new Set([
  ...VOID_ELEMENTS,
  ...RAW_TEXT_ELEMENTS,
  'helmet', 'sc-for', 'sc-if', 'dc-import', 'x-import', 'svg', 'canvas', 'iframe', 'video', 'audio', 'select',
  'option', 'noscript', 'template', 'xmp', 'noembed', 'noframes', 'plaintext', 'object', 'embed', 'math',
]);

/** Tags that may be edited while still empty (a fresh text box). */
const EMPTY_TEXT_TAGS = new Set(
  'p h1 h2 h3 h4 h5 h6 span li dt dd td th blockquote q cite label button figcaption caption code pre em strong b i u s small mark sub sup a'.split(' '),
);

/** Display values that take a link out of the text flow. */
const BOXED_DISPLAY = /^(block|flex|grid|flow-root|list-item|table|inline-(block|flex|grid))$/;

/** Private-use characters: icon-font glyphs, not words. */
const ICON_GLYPHS = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

/** The `display` an element's inline style sets, or `''`. */
function inlineDisplay(element: HtmlElement): string {
  const match = /(?:^|;)\s*display\s*:\s*([^;!]+)/i.exec(attributeValue(element, 'style') ?? '');
  return match ? match[1]!.trim().toLowerCase() : '';
}

/** The text an element's subtree spells out in the template (holes included as written). */
function templateText(node: HtmlNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'comment') return '';
  return node.children.map(templateText).join('');
}

/** True when the element is inside an `<svg>` (or is one). */
function inSvg(element: HtmlElement): boolean {
  for (let node: HtmlElement | null = element; node; node = node.parent) if (node.tag === 'svg') return true;
  return false;
}

/** An inline element that is words in the flow (a boxed link counts only when it is inline). */
function inlineChild(element: HtmlElement): boolean {
  if (!INLINE_TEXT_TAGS.has(element.tag)) return false;
  if (element.tag !== 'a') return true;
  const display = inlineDisplay(element);
  return !BOXED_DISPLAY.test(display) || display.startsWith('inline-');
}

/**
 * An icon-and-label wrapper: no words of its own, several
 * inline children of which at most one has words. Its label is edited, not
 * the wrapper.
 */
function iconLabelWrapper(element: HtmlElement): boolean {
  if (element.children.some((child) => child.type === 'text' && child.value.trim() !== '')) return false;
  const kids = element.children.filter((child): child is HtmlElement => child.type === 'element' && child.tag !== 'br' && child.tag !== 'wbr');
  const worded = kids.filter((kid) => templateText(kid).replace(ICON_GLYPHS, '').trim() !== '');
  return (kids.length > 1 && worded.length <= 1) || kids.some(iconLabelWrapper);
}

/**
 * True when the element's content is edited in place as rich text: words
 * and inline formatting only, written in the template (holes allowed: they
 * are edited as written).
 */
export function isRichTextElement(element: HtmlElement): boolean {
  if (NOT_TEXT.has(element.tag) || element.closeStart < 0) return false;
  // In a drawing, a run of text (`<text>`, `<tspan>`, `<textPath>`) holding words only.
  if (inSvg(element)) return isSvgText(element);
  const text = templateText(element);
  if (text.trim() === '') return EMPTY_TEXT_TAGS.has(element.tag) && element.children.every((child) => child.type !== 'element' || child.tag === 'br');
  const inline = (nodes: HtmlNode[]): boolean =>
    nodes.every((node) => node.type !== 'element' || (inlineChild(node) && inline(node.children)));
  if (!inline(element.children)) return false;
  // Inside code, words are code: edit them as a whole.
  let code = false;
  for (let node: HtmlElement | null = element; node; node = node.parent) if (node.tag === 'pre' || node.tag === 'code') code = true;
  return code || !iconLabelWrapper(element);
}

/** SVG elements whose words are edited in place. */
const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'textpath']);

/** True for an SVG text element holding words and nothing else: edited as plain text. */
export function isSvgText(element: HtmlElement): boolean {
  return (
    SVG_TEXT_TAGS.has(element.tag) &&
    element.closeStart >= 0 &&
    inSvg(element) &&
    element.children.every((child) => child.type !== 'element') &&
    templateText(element).trim() !== ''
  );
}

/** True when text inside the element has `{{ … }}` holes. */
export function hasTextHoles(element: HtmlElement): boolean {
  const walk = (nodes: HtmlNode[]): boolean =>
    nodes.some((node) => (node.type === 'text' ? hasHoles(node.value) : node.type === 'element' && walk(node.children)));
  return walk(element.children);
}

/* -------------------------------------------------------------------------- */
/* Sanitizing                                                                  */
/* -------------------------------------------------------------------------- */

/** Elements dropped with their content. */
const DROPPED = new Set([
  'script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript', 'template', 'object', 'embed',
  'link', 'meta', 'base', 'title', 'frame', 'frameset', 'form', 'input', 'textarea', 'select', 'button', 'dialog',
]);

/** Attributes an edit's HTML never keeps. */
const DROPPED_ATTRIBUTES = /^(on|sc-|data-dc-|data-sc-)|^(is|contenteditable|spellcheck|autofocus|srcdoc|formaction|action)$/i;

/** Attributes that hold an address. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'poster', 'background', 'cite']);

/** True for an address that runs code. */
function unsafeUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const bare = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
  return /^(javascript|vbscript|data:text\/html)/.test(bare) || bare.startsWith('data:') && !/^data:image\/(png|jpe?g|gif|webp|avif);/.test(bare);
}

/** Escapes text content. */
const escapeHtmlText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');

/** Serializes one attribute, double-quoted unless the value holds `"`. */
function attributeText(name: string, value: string | null): string {
  if (value === null) return ` ${name}`;
  const amp = value.replace(/&/g, '&amp;');
  return amp.includes('"') && !amp.includes("'") ? ` ${name}='${amp}'` : ` ${name}="${amp.replace(/"/g, '&quot;')}"`;
}

/**
 * Cleans HTML an in-place edit produced (`innerHTML` of the edited
 * element) for writing into the template: comments, scripts, frames, form
 * controls, event handlers, code-running addresses and the editor's own
 * attributes go; the words and their formatting stay. A trailing `<br>`
 * the browser keeps for the caret goes too.
 */
export function sanitizeTextHtml(html: string): string {
  const out: string[] = [];
  const walk = (nodes: HtmlNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'comment') continue;
      if (node.type === 'text') {
        out.push(escapeHtmlText(node.value));
        continue;
      }
      const tag = node.tag;
      if (DROPPED.has(tag) || tag.includes(':')) continue;
      let attrs = '';
      for (const attr of node.attrs) {
        const name = attr.name.toLowerCase();
        if (DROPPED_ATTRIBUTES.test(name)) continue;
        if (name === 'role' || name === 'aria-label' || name === 'aria-multiline') continue;
        if (URL_ATTRIBUTES.has(name) && attr.value !== null && unsafeUrl(attr.value)) continue;
        if (name === 'style' && attr.value !== null && /expression\s*\(|javascript:|-moz-binding/i.test(attr.value)) continue;
        attrs += attributeText(attr.name, attr.value);
      }
      out.push(`<${tag}${attrs}>`);
      if (VOID_ELEMENTS.has(tag)) continue;
      walk(node.children);
      out.push(`</${tag}>`);
    }
  };
  walk(parseHtml(html));
  let result = out.join('');
  // Chrome keeps a `<br>` after the last line so the caret has a place.
  if (/<br>$/.test(result) && result !== '<br>' && !/<br><br>$/.test(result)) result = result.slice(0, -4);
  return result;
}

/** Block content in an edit's HTML (a list, a paragraph): a `<p>` holding it must become a `<div>`. */
export function hasBlockContent(html: string): boolean {
  return /<(ul|ol|li|div|p|h[1-6]|blockquote|pre|table)\b/i.test(html);
}

/* -------------------------------------------------------------------------- */
/* Script literals                                                             */
/* -------------------------------------------------------------------------- */

/** A string literal in a script: `[start, end)` covers the quotes. */
export interface ScriptLiteral {
  start: number;
  end: number;
  /** The quote character: `'`, `"` or `` ` `` (a template without `${}`). */
  quote: string;
  /** The decoded value. */
  value: string;
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };

/** Decodes the body of a JS string literal; `null` when it uses escapes we do not read. */
function decodeLiteral(body: string): string | null {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[++i];
    if (next === undefined) return null;
    if (next === 'u') {
      const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(body.slice(i + 1));
      const plain = /^[0-9a-fA-F]{4}/.exec(body.slice(i + 1));
      if (braced) {
        out += String.fromCodePoint(parseInt(braced[1]!, 16));
        i += braced[0].length;
      } else if (plain) {
        out += String.fromCharCode(parseInt(plain[0], 16));
        i += 4;
      } else return null;
    } else if (next === 'x') {
      const hex = /^[0-9a-fA-F]{2}/.exec(body.slice(i + 1));
      if (!hex) return null;
      out += String.fromCharCode(parseInt(hex[0], 16));
      i += 2;
    } else if (next === '\n') {
      // A line continuation.
    } else if (next === '\r') {
      if (body[i + 1] === '\n') i++;
    } else out += ESCAPES[next] ?? next;
  }
  return out;
}

/**
 * The string literals of a script, in order. Comments and regular
 * expressions are skipped (a `/` after a value is division); template
 * literals with `${}` are not literals.
 */
export function scriptLiterals(js: string): ScriptLiteral[] {
  const out: ScriptLiteral[] = [];
  let i = 0;
  // Whether a `/` here starts a regular expression (no value before it).
  let regexAllowed = true;
  while (i < js.length) {
    const ch = js[i]!;
    if (ch === '/' && js[i + 1] === '/') {
      const end = js.indexOf('\n', i);
      i = end < 0 ? js.length : end;
      continue;
    }
    if (ch === '/' && js[i + 1] === '*') {
      const end = js.indexOf('*/', i + 2);
      i = end < 0 ? js.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let dynamic = false;
      while (j < js.length && js[j] !== ch) {
        if (js[j] === '\\') j++;
        else if (ch === '`' && js[j] === '$' && js[j + 1] === '{') {
          dynamic = true;
          // Skip the substitution, counting braces.
          let depth = 0;
          for (j += 1; j < js.length; j++) {
            if (js[j] === '{') depth++;
            else if (js[j] === '}' && --depth === 0) break;
          }
        } else if (ch !== '`' && js[j] === '\n') break;
        j++;
      }
      const end = Math.min(j + 1, js.length);
      if (!dynamic && js[j] === ch) {
        const value = decodeLiteral(js.slice(i + 1, j));
        if (value !== null) out.push({ start: i, end, quote: ch, value });
      }
      i = end;
      regexAllowed = false;
      continue;
    }
    if (ch === '/' && regexAllowed) {
      let j = i + 1;
      let inClass = false;
      while (j < js.length && js[j] !== '\n') {
        if (js[j] === '\\') j++;
        else if (js[j] === '[') inClass = true;
        else if (js[j] === ']') inClass = false;
        else if (js[j] === '/' && !inClass) break;
        j++;
      }
      i = j + 1;
      while (i < js.length && /[a-z]/i.test(js[i]!)) i++;
      regexAllowed = false;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[\w$]/.test(ch)) {
      let j = i;
      while (j < js.length && /[\w$]/.test(js[j]!)) j++;
      const word = js.slice(i, j);
      regexAllowed = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(word);
      i = j;
      continue;
    }
    regexAllowed = !/[)\]}]/.test(ch);
    i++;
  }
  return out;
}

/** Writes text as a JS string literal with the given quote. */
export function quoteScriptString(text: string, quote: string): string {
  let body = text.replace(/\\/g, '\\\\');
  if (quote === '`') body = body.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  else body = body.split(quote).join(`\\${quote}`).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  body = body.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  // `</script>` inside would end the script block.
  body = body.replace(/<\/(script)/gi, '<\\/$1');
  return `${quote}${body}${quote}`;
}

/* -------------------------------------------------------------------------- */
/* Loose words                                                                 */
/* -------------------------------------------------------------------------- */

/** Elements whose loose words are never wrapped. */
const NO_WRAP = new Set([...VOID_ELEMENTS, ...RAW_TEXT_ELEMENTS, 'helmet', 'x-import', 'dc-import', 'svg', 'math', 'select', 'option', 'template']);

/** An inline element that is words in the flow, all the way down. */
function inlineThroughout(element: HtmlElement): boolean {
  return inlineChild(element) && element.children.every((child) => child.type !== 'element' || inlineThroughout(child));
}

/** A source range to wrap: `[start, end)` of the template text. */
export interface TextRun {
  start: number;
  end: number;
}

/**
 * The runs of loose words in an element that mixes words with other layout
 * each run of text — with the inline formatting
 * around it unless the element lays its children out as items (`inline`
 * false) — trimmed of the spaces at its ends. `<sc-if>` / `<sc-for>`
 * children are looked into. `text` is the template text.
 */
export function looseTextRuns(element: HtmlElement, text: string, inline: boolean): TextRun[] {
  if (NO_WRAP.has(element.tag) || inSvg(element) || element.closeStart < 0) return [];
  const worded = (node: HtmlNode): boolean => node.type === 'text' && node.value.trim() !== '';
  const blank = (node: HtmlNode): boolean => (node.type === 'text' && node.value.trim() === '') || node.type === 'comment';
  const phrasing = (node: HtmlNode): boolean => inline && node.type === 'element' && inlineThroughout(node);
  const runs: TextRun[] = [];
  let run: HtmlNode[] = [];
  const close = (): void => {
    while (run.length && blank(run[run.length - 1]!)) run.pop();
    if (run.some(worded) && run[0]!.start >= 0 && run[run.length - 1]!.end >= 0) {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      let start = first.start;
      if (first.type === 'text') start += text.slice(first.start, first.end).length - text.slice(first.start, first.end).trimStart().length;
      let end = last.end;
      if (last.type === 'text') end -= text.slice(last.start, last.end).length - text.slice(last.start, last.end).trimEnd().length;
      if (end > start) runs.push({ start, end });
    }
    run = [];
  };
  for (const child of element.children) {
    if (worded(child) || phrasing(child) || (blank(child) && run.length > 0)) run.push(child);
    else close();
  }
  close();
  for (const child of element.children) {
    if (child.type === 'element' && (child.tag === 'sc-if' || child.tag === 'sc-for')) runs.push(...looseTextRuns(child, text, inline));
  }
  return runs;
}

/* -------------------------------------------------------------------------- */
/* Words of a component instance                                               */
/* -------------------------------------------------------------------------- */

/** Words of an `<x-import>` that can be retyped where the component draws them. */
export interface ImportTextTarget {
  /** The words as drawn (spaces squashed). */
  words: string;
  /** Where they are written: `__text` (between its tags) or `@name` (an attribute). */
  key: string;
  /** The attribute holds a number (`{{ 3 }}`): the retyped words must be one. */
  number?: boolean;
}

/** Spaces squashed and trimmed, as text is drawn. */
export const squashSpaces = (text: string): string => text.replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '');

/** Attributes of an instance that are never its words, plus code and addresses. */
const NOT_WORDS = /^(component(-from-global-scope|FromGlobalScope)?|from|dc-props|dcProps|sc-name|hint-size|hintSize|style-.*|data-(dc|om)-.*|class|style|id|slot|key|ref|href|src|srcset|srcdoc|on.*)$/;
/** A hole that is a literal: a number, a boolean or a quoted string. */
const LITERAL_HOLE = /^\s*\{\{\s*(?:(-?\d+(?:\.\d+)?|true|false)|(['"])([^{}]*)\2)\s*\}\}\s*$/;
/** A value that is a number or a boolean as written. */
const PLAIN_SCALAR = /^(-?\d+(\.\d+)?|true|false)$/;
/** Words that could be anything (numbers, separators). */
const NUMBERISH = /^-?[\d.,\s]+$/;
/** Longest words taken as an instance's own. */
export const MAX_IMPORT_WORDS = 2000;

/**
 * The words of an `<x-import>` instance that are written on it — between
 * its tags or in an attribute — and appear as-is where the component draws
 * them. Words written twice, or that a hole
 * could also be supplying (`known`: the script's strings and the props'
 * values), are left out; so is everything when an attribute mixes words
 * with holes.
 */
export function importTextTargets(element: HtmlElement, known: ReadonlySet<string> | null): ImportTextTarget[] {
  if (element.tag !== 'x-import' || element.closeStart < 0) return [];
  const component = element.attrs.find((attr) => attr.name === 'component-from-global-scope' || attr.name === 'component')?.value ?? '';
  if (!component || component.includes('{{')) return [];
  for (let node = element.parent; node; node = node.parent) if (node.tag === 'sc-for') return [];
  const found = new Map<string, string | null>();
  const numbers = new Set<string>();
  let dynamic = false;
  let mixed = false;
  const add = (words: string, key: string | null): void => {
    if (words !== '') found.set(words, found.has(words) ? null : key);
  };
  const consider = (key: string | null, value: string, kind: 'own' | 'deep' | 'attr' | 'handler'): void => {
    const literal = LITERAL_HOLE.exec(value);
    if (literal) {
      const scalar = literal[1];
      const words = squashSpaces(scalar ?? literal[3] ?? '');
      const number = scalar != null && kind === 'attr' && key != null && /^-?\d/.test(scalar);
      if (number) numbers.add(key!);
      // Only a number can be retyped in a hole; other literals just claim their words.
      add(words, number ? key : null);
      return;
    }
    if (!value.includes('{{')) {
      const words = squashSpaces(value);
      add(words, words.length > MAX_IMPORT_WORDS ? null : key);
      return;
    }
    if (kind !== 'handler') dynamic = true;
    const parts = value.split(/\{\{[^{}]*\}\}/);
    if (kind === 'deep') for (const part of parts) add(squashSpaces(part), null);
    else if (parts.length > 2 || parts.some((part) => /[^\s{}]/.test(part))) mixed = true;
  };
  const own: string[] = [];
  const deep: string[] = [];
  const collect = (nodes: HtmlNode[], inside: boolean): void => {
    for (const node of nodes) {
      if (node.type === 'text') (inside ? deep : own).push(node.value);
      else if (node.type === 'element') collect(node.children, true);
    }
  };
  collect(element.children, false);
  if (own.filter((value) => value.trim() !== '').length > 1) deep.push(...own);
  // Words between its tags are retyped as its text only when nothing else is there.
  consider(element.children.some((child) => child.type === 'element') ? null : '__text', own.join(''), 'own');
  for (const value of deep) consider(null, value, 'deep');
  for (const attr of element.attrs) {
    if (attr.value == null) continue;
    if (attr.name === 'dc-props' || attr.name === 'dcProps') dynamic = true;
    if (NOT_WORDS.test(attr.name)) {
      if (/^on/.test(attr.name)) consider(null, attr.value, 'handler');
      continue;
    }
    consider(PLAIN_SCALAR.test(attr.value.trim()) ? null : `@${attr.name}`, attr.value, 'attr');
  }
  if (mixed) return [];
  const out: ImportTextTarget[] = [];
  for (const [words, key] of found) {
    if (key == null) continue;
    if (dynamic && (known == null || words.length < 2 || NUMBERISH.test(words) || known.has(words))) continue;
    out.push(numbers.has(key) ? { words, key, number: true } : { words, key });
  }
  return out;
}

/** Normalizes retyped words. */
export const retypedWords = (text: string): string =>
  text.replace(/[ \t\n\r\f ]*[ \t\n\r\f][ \t\n\r\f ]*/g, ' ').replace(/^[\s ]+|[\s ]+$/g, '');

/** What retyping an instance's words comes to. */
export type ImportTextOutcome =
  | { kind: 'commit'; key: string; text: string }
  | { kind: 'noop' }
  | { kind: 'refuse' }
  | { kind: 'toolong' }
  | { kind: 'notnumber' };

/** Checks retyped words against the instance's targets now. */
export function importTextOutcome(target: { key: string; words: string }, text: string, targets: readonly ImportTextTarget[]): ImportTextOutcome {
  const found = targets.find((each) => each.key === target.key && each.words === target.words);
  if (!found) return { kind: 'refuse' };
  if (text.length > 16 * 1024) return { kind: 'toolong' };
  const words = retypedWords(text);
  if (words.length > MAX_IMPORT_WORDS) return { kind: 'toolong' };
  if (words === '' || words === target.words) return { kind: 'noop' };
  if (!found.number) return { kind: 'commit', key: target.key, text: words };
  if (!/^-?\d+(\.\d+)?$/.test(words)) return { kind: 'notnumber' };
  const value = Number(words);
  if (!Number.isFinite(value)) return { kind: 'notnumber' };
  return value === Number(target.words) ? { kind: 'noop' } : { kind: 'commit', key: target.key, text: `{{ ${String(value)} }}` };
}
