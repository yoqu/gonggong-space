/**
 * A small, tolerant HTML parser that keeps source offsets.
 *
 * The Design Component format needs three things a browser's DOM parser does
 * not give: the exact source range of every node (so an edit rewrites only the
 * bytes it changes), the attribute names as written (`onClick`, `viewBox`), and
 * the same element order on every platform (Node checks and the browser
 * editor must number elements identically). This parser follows source order
 * strictly: no foster parenting, no implied `<tbody>`, no auto-closed `<p>`.
 * The format requires authors to close every non-void element, so that is
 * enough.
 */

/** Elements that never have children or an end tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

/** Elements whose content is raw text up to the matching end tag. */
export const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'title']);

/** One attribute as written. */
export interface HtmlAttribute {
  /** Name exactly as written (case kept). */
  name: string;
  /** Decoded value; `null` for a bare attribute (`disabled`). */
  value: string | null;
  /** Source offsets of the whole `name="value"` text (`-1` when synthesized). */
  start: number;
  end: number;
}

/** Fields shared by every node. */
interface NodeBase {
  /** Source offset of the first character, `-1` for nodes created by edits. */
  start: number;
  /** Source offset just past the last character, `-1` for created nodes. */
  end: number;
  /** The parent element, `null` at the top level. Not serialized. */
  parent: HtmlElement | null;
}

/** An element. */
export interface HtmlElement extends NodeBase {
  type: 'element';
  /** Lower-case tag name. */
  tag: string;
  /** Tag name as written (for faithful re-serialization). */
  rawTag: string;
  attrs: HtmlAttribute[];
  children: HtmlNode[];
  /** Offset just past the start tag's `>`. */
  openEnd: number;
  /** Offset of the end tag's `<`, or `-1` when there is none. */
  closeStart: number;
  /** Written as `<x/>`. */
  selfClosing: boolean;
  /** Edit bookkeeping: the start tag must be rebuilt from `attrs`. */
  dirtyTag?: boolean;
  /** Edit bookkeeping: some descendant changed; children must be re-serialized. */
  dirtyChildren?: boolean;
}

/** A run of text. */
export interface HtmlText extends NodeBase {
  type: 'text';
  /** Decoded text (raw for script/style content). */
  value: string;
  /** Edit bookkeeping: `value` changed and must be re-escaped. */
  dirty?: boolean;
}

/** A comment (`<!-- … -->`) or a doctype / processing instruction. */
export interface HtmlComment extends NodeBase {
  type: 'comment';
  /** The full source text of the node. */
  raw: string;
}

export type HtmlNode = HtmlElement | HtmlText | HtmlComment;

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«',
  raquo: '»', middot: '·', bull: '•', times: '×', divide: '÷', deg: '°', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', para: '¶', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  plusmn: '±', le: '≤', ge: '≥', ne: '≠', minus: '−', infin: '∞', hearts: '♥', star: '☆', check: '✓',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwj: '‍', zwnj: '‌', shy: '­',
};

/** Decodes HTML character references; unknown names are left as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Escapes text content. */
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes a double-quoted attribute value. */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* Parser                                                                      */
/* -------------------------------------------------------------------------- */

const NAME_CHAR = /[^\s/>"'=<]/;

/** Options of {@link parseHtml}. */
export interface ParseOptions {
  /** Added to every offset (when parsing a slice of a larger source). */
  offset?: number;
}

/**
 * Parses an HTML fragment into nodes with source offsets.
 *
 * Unmatched end tags are ignored; an end tag closes the nearest open element
 * with that name, implicitly closing any elements opened after it. Elements
 * still open at the end of input end there.
 */
export function parseHtml(source: string, options: ParseOptions = {}): HtmlNode[] {
  const base = options.offset ?? 0;
  const roots: HtmlNode[] = [];
  const stack: HtmlElement[] = [];
  let i = 0;
  const n = source.length;

  const append = (node: HtmlNode): void => {
    const parent = stack[stack.length - 1] ?? null;
    node.parent = parent;
    (parent ? parent.children : roots).push(node);
  };

  const pushText = (from: number, to: number): void => {
    if (to <= from) return;
    const top = stack[stack.length - 1];
    const raw = source.slice(from, to);
    const value = top && (top.tag === 'script' || top.tag === 'style') ? raw : decodeEntities(raw);
    append({ type: 'text', value, start: base + from, end: base + to, parent: null });
  };

  let textStart = 0;
  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;

    // Comments, doctype and processing instructions.
    if (source.startsWith('<!--', lt)) {
      pushText(textStart, lt);
      const close = source.indexOf('-->', lt + 4);
      const end = close === -1 ? n : close + 3;
      append({ type: 'comment', raw: source.slice(lt, end), start: base + lt, end: base + end, parent: null });
      i = textStart = end;
      continue;
    }
    if (source[lt + 1] === '!' || source[lt + 1] === '?') {
      pushText(textStart, lt);
      const close = source.indexOf('>', lt);
      const end = close === -1 ? n : close + 1;
      append({ type: 'comment', raw: source.slice(lt, end), start: base + lt, end: base + end, parent: null });
      i = textStart = end;
      continue;
    }

    // End tag.
    if (source[lt + 1] === '/') {
      const match = /^<\/([A-Za-z][^\s/>]*)\s*>/.exec(source.slice(lt, lt + 200));
      if (!match) {
        i = lt + 1;
        continue;
      }
      pushText(textStart, lt);
      const tag = match[1]!.toLowerCase();
      const end = lt + match[0].length;
      for (let depth = stack.length - 1; depth >= 0; depth--) {
        if (stack[depth]!.tag !== tag) continue;
        // Elements opened after the matching one end where this end tag starts.
        while (stack.length - 1 > depth) {
          const open = stack.pop()!;
          open.end = base + lt;
        }
        const element = stack.pop()!;
        element.closeStart = base + lt;
        element.end = base + end;
        break;
      }
      i = textStart = end;
      continue;
    }

    // Start tag.
    if (!/[A-Za-z]/.test(source[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }
    pushText(textStart, lt);
    let j = lt + 1;
    while (j < n && NAME_CHAR.test(source[j]!)) j++;
    const rawTag = source.slice(lt + 1, j);
    const tag = rawTag.toLowerCase();
    const attrs: HtmlAttribute[] = [];
    let selfClosing = false;

    // Attributes.
    for (;;) {
      while (j < n && /\s/.test(source[j]!)) j++;
      if (j >= n) break;
      if (source[j] === '>') {
        j++;
        break;
      }
      if (source[j] === '/' && source[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      if (source[j] === '/') {
        j++;
        continue;
      }
      const attrStart = j;
      while (j < n && NAME_CHAR.test(source[j]!)) j++;
      if (j === attrStart) {
        j++; // stray character such as `"` or `=`: skip it
        continue;
      }
      const name = source.slice(attrStart, j);
      let k = j;
      while (k < n && /\s/.test(source[k]!)) k++;
      if (source[k] !== '=') {
        attrs.push({ name, value: null, start: base + attrStart, end: base + j });
        continue;
      }
      k++;
      while (k < n && /\s/.test(source[k]!)) k++;
      const quote = source[k];
      let value: string;
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, k + 1);
        const valueEnd = close === -1 ? n : close;
        value = source.slice(k + 1, valueEnd);
        j = close === -1 ? n : close + 1;
      } else {
        let e = k;
        while (e < n && !/[\s>]/.test(source[e]!)) e++;
        value = source.slice(k, e);
        j = e;
      }
      attrs.push({ name, value: decodeEntities(value), start: base + attrStart, end: base + j });
    }

    const element: HtmlElement = {
      type: 'element',
      tag,
      rawTag,
      attrs,
      children: [],
      start: base + lt,
      end: base + j,
      openEnd: base + j,
      closeStart: -1,
      selfClosing,
      parent: null,
    };
    append(element);
    i = textStart = j;

    if (VOID_ELEMENTS.has(tag) || selfClosing) continue;

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      // Raw text up to the matching end tag, case-insensitively.
      const re = new RegExp(`</${tag}\\s*>`, 'ig');
      re.lastIndex = j;
      const match = re.exec(source);
      const contentEnd = match ? match.index : n;
      if (contentEnd > j) {
        const raw = source.slice(j, contentEnd);
        element.children.push({
          type: 'text',
          value: tag === 'script' || tag === 'style' ? raw : decodeEntities(raw),
          start: base + j,
          end: base + contentEnd,
          parent: element,
        });
      }
      element.closeStart = match ? base + contentEnd : -1;
      element.end = match ? base + contentEnd + match[0].length : base + n;
      i = textStart = match ? contentEnd + match[0].length : n;
      continue;
    }
    stack.push(element);
  }
  pushText(textStart, n);
  // Elements never closed end at the end of input.
  while (stack.length) stack.pop()!.end = base + n;
  return roots;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Element children only. */
export function elementChildren(node: { children: HtmlNode[] } | HtmlNode[]): HtmlElement[] {
  const list = Array.isArray(node) ? node : node.children;
  return list.filter((child): child is HtmlElement => child.type === 'element');
}

/** Case-insensitive attribute lookup. */
export function getAttribute(element: HtmlElement, name: string): HtmlAttribute | undefined {
  const lower = name.toLowerCase();
  return element.attrs.find((attr) => attr.name.toLowerCase() === lower);
}

/** The value of an attribute, `''` for a bare one, `undefined` when absent. */
export function attributeValue(element: HtmlElement, name: string): string | undefined {
  const attr = getAttribute(element, name);
  return attr ? (attr.value ?? '') : undefined;
}

/** Visits every element depth-first in source order. */
export function walkElements(nodes: HtmlNode[], visit: (element: HtmlElement) => void): void {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    visit(node);
    walkElements(node.children, visit);
  }
}

/** The concatenated text content of a node. */
export function textContent(node: HtmlNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'comment') return '';
  return node.children.map(textContent).join('');
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

/** Builds a start tag from an element's current attributes. */
export function buildStartTag(element: HtmlElement): string {
  const parts = [element.rawTag || element.tag];
  for (const attr of element.attrs) {
    if (attr.value === null) parts.push(attr.name);
    else if (attr.value.includes('"') && !attr.value.includes("'")) parts.push(`${attr.name}='${attr.value.replace(/&/g, '&amp;')}'`);
    else parts.push(`${attr.name}="${escapeAttribute(attr.value)}"`);
  }
  return `<${parts.join(' ')}${element.selfClosing ? '/' : ''}>`;
}

/** True when the node, or anything inside it, was changed or created by an edit. */
function isDirty(node: HtmlNode): boolean {
  if (node.start < 0) return true;
  if (node.type === 'text') return Boolean(node.dirty);
  if (node.type === 'comment') return false;
  return Boolean(node.dirtyTag || node.dirtyChildren);
}

/**
 * Serializes nodes back to HTML. Untouched nodes are copied byte for byte
 * from `source`, so an edit changes only the text of what it touched.
 */
export function serializeNodes(nodes: HtmlNode[], source: string, offset = 0): string {
  let out = '';
  for (const node of nodes) out += serializeNode(node, source, offset);
  return out;
}

/** Serializes one node; see {@link serializeNodes}. */
export function serializeNode(node: HtmlNode, source: string, offset = 0): string {
  const slice = (from: number, to: number): string => source.slice(from - offset, to - offset);
  if (!isDirty(node)) return slice(node.start, node.end);

  if (node.type === 'text') {
    const raw = node.parent && (node.parent.tag === 'script' || node.parent.tag === 'style');
    return raw ? node.value : escapeText(node.value);
  }
  if (node.type === 'comment') return node.raw;

  const created = node.start < 0;
  const startTag = created || node.dirtyTag ? buildStartTag(node) : slice(node.start, node.openEnd);
  if (VOID_ELEMENTS.has(node.tag) || node.selfClosing) return startTag;

  const inner = serializeNodes(node.children, source, offset);
  const endTag = !created && node.closeStart >= 0 ? slice(node.closeStart, node.end) : `</${node.rawTag || node.tag}>`;
  return startTag + inner + endTag;
}

/** Marks an element's ancestors so serialization descends into them. */
export function markAncestorsDirty(node: HtmlNode): void {
  for (let parent = node.parent; parent; parent = parent.parent) parent.dirtyChildren = true;
}
