/**
 * The pure half of the formatted (rich) in-place text editor.
 *
 * The editor shows stored text formatted: bold, italic, code and links as
 * marks, list lines as real lists, typed arrows drawn. What is stored stays
 * the Markdown subset core parses (`text/markup.ts`): this module turns
 * stored text into the editor's DOM and the editor's DOM back into stored
 * text, and plans the as-you-type conveniences (list shortcuts, typed
 * arrows, plain-text paste, web links).
 *
 * Everything here works over {@link RichNode}, the few node fields the
 * round trip reads, so it runs without a DOM (the editor passes real
 * nodes; tests pass small fakes). `rich-dom.ts` holds the DOM side.
 */

import {
  DEFAULT_TEXT_PROFILE,
  ESCAPED_LIST_MARKER_PATTERN,
  HTTP_LINK_HREF_PATTERN,
  HTTP_LINK_PATTERN,
  breakMarkdownLinkSyntax,
  canWrapInlineCode,
  drawArrowsInLines,
  drawTextArrows,
  dropArrowJoiners,
  escapeInlineMarkdown,
  escapeListMarker,
  joinLinesWithSpaces,
  linkTargetsInText,
  nestListRows,
  parseMarkdownBlocks,
  parseTextRows,
  percentEncodeMarkdownChars,
  pushListIndent,
  tokenizeNoteInline,
  unescapeMarkdownChars,
  wrapInlineCode,
  type InlineToken,
  type NestedTextList,
  type NoteBlock,
  type TextProfile,
  type TextTransform,
} from '@open-artifact/whiteboard-core';

/* ------------------------------------------------------------------------ */
/* Nodes                                                                    */
/* ------------------------------------------------------------------------ */

/** `nodeType` of elements. */
const ELEMENT_NODE = 1;
/** `nodeType` of text. */
const TEXT_NODE = 3;

/**
 * The node fields the round trip reads; DOM nodes have them all. Element
 * names are upper case (`DIV`, `LI`), text nodes are `#text`.
 */
export interface RichNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly parentNode: RichNode | null;
  readonly childNodes: ArrayLike<RichNode>;
  getAttribute?(name: string): string | null;
}

/** Makes the editor's nodes: real DOM nodes in the editor, fakes in tests. */
export interface RichNodeFactory<N> {
  element(tag: string, attributes: Readonly<Record<string, string>>, children: readonly N[]): N;
  text(value: string): N;
}

/** An element's upper-case tag name (`''` for other nodes). */
function tagOf(node: RichNode | null | undefined): string {
  return node?.nodeType === ELEMENT_NODE ? node.nodeName.toUpperCase() : '';
}

/** An attribute of an element (`null` when absent or not an element). */
function attributeOf(node: RichNode | null | undefined, name: string): string | null {
  return node?.nodeType === ELEMENT_NODE ? (node.getAttribute?.(name) ?? null) : null;
}

/** The element a node sits in. */
function parentElementOf(node: RichNode): RichNode | null {
  return node.parentNode?.nodeType === ELEMENT_NODE ? node.parentNode : null;
}

/** The node before or after `node` in its parent (`null` at either end). */
function siblingOf(node: RichNode, step: -1 | 1): RichNode | null {
  const parent = node.parentNode;
  if (!parent) return null;
  const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
  return index < 0 ? null : (parent.childNodes[index + step] ?? null);
}

/** A node's text, as `textContent` reads it. */
export function richTextOf(node: RichNode): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? '';
  if (node.nodeType !== ELEMENT_NODE) return '';
  let text = '';
  for (const child of Array.from(node.childNodes)) text += richTextOf(child);
  return text;
}

/** Whether a node is an atomic chip (a link or code span the caret cannot enter). */
export function isAtomicNode(node: RichNode | null | undefined): boolean {
  return attributeOf(node, 'contenteditable') === 'false';
}

/* ------------------------------------------------------------------------ */
/* Inline styles                                                            */
/* ------------------------------------------------------------------------ */

/** The style each formatting tag gives its text. */
export const INLINE_STYLE_TAGS: Readonly<Record<string, 'bold' | 'italic' | 'code'>> = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
  CODE: 'code',
};

/** Block elements: each starts a line of its own. */
export const BLOCK_TAG_PATTERN = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|TABLE|TR)$/;

/** Elements that make their text bold. */
export const BOLD_ELEMENT_SELECTOR = 'b,strong,i[style*="font-weight: bold"],em[style*="font-weight: bold"],span[style*="font-weight: bold"]';
/** Elements that make their text italic. */
export const ITALIC_ELEMENT_SELECTOR = 'i,em,b[style*="font-style: italic"],strong[style*="font-style: italic"],span[style*="font-style: italic"]';

/** Whether an element makes its text bold (`<b>`, `<strong>`, or a bold inline style). */
export function isBoldElement(node: RichNode): boolean {
  const tag = tagOf(node);
  if (tag === 'B' || tag === 'STRONG') return true;
  return (tag === 'I' || tag === 'EM' || tag === 'SPAN') && (attributeOf(node, 'style') ?? '').includes('font-weight: bold');
}

/** Whether an element makes its text italic (`<i>`, `<em>`, or an italic inline style). */
export function isItalicElement(node: RichNode): boolean {
  const tag = tagOf(node);
  if (tag === 'I' || tag === 'EM') return true;
  return (tag === 'B' || tag === 'STRONG' || tag === 'SPAN') && (attributeOf(node, 'style') ?? '').includes('font-style: italic');
}

/* ------------------------------------------------------------------------ */
/* DOM → stored text                                                        */
/* ------------------------------------------------------------------------ */

/** A styled kind of run. */
type StyleKind = 'bold' | 'italic' | 'bolditalic' | 'code';

/** A run of one line: text, styled text or a link. */
interface Run {
  k: 'text' | 'link' | StyleKind;
  text: string;
  href?: string;
}

/** The Markdown marks around each style. */
const STYLE_MARKERS: Readonly<Record<StyleKind, string>> = { bold: '**', italic: '*', bolditalic: '***', code: '`' };

/** How {@link serializeNoteMarkdown} writes lists. */
export interface SerializeOptions {
  /** List items become list lines (default true); otherwise every line is a paragraph. */
  lists?: boolean;
  /** Nested lists are indented two spaces per level. */
  levels?: boolean;
}

/** Escapes what a link's label cannot hold. */
function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&');
}

/** A space between code spans that would otherwise run together. */
function separateAdjacentCode(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.k === 'code' && out[out.length - 1]?.k === 'code') out.push({ k: 'text', text: ' ' });
    out.push(run);
  }
  return out;
}

/** The Markdown of a line's runs. */
function runsToMarkdown(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      switch (run.k) {
        case 'text':
          return escapeInlineMarkdown(run.text);
        case 'link':
          return `[${escapeLinkText(run.text)}](${(run.href ?? '').replace(/[\\[]/g, '\\$&')})`;
        case 'code':
          return wrapInlineCode(run.text) ?? escapeInlineMarkdown(run.text);
        default:
          return STYLE_MARKERS[run.k] + escapeInlineMarkdown(run.text) + STYLE_MARKERS[run.k];
      }
    })
    .join('');
}

/** Runs compared by what they show: adjacent text merged, empty text dropped. */
function runsSignature(runs: readonly Run[]): string {
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (run.k === 'text' && last?.k === 'text') last.text += run.text;
    else if (run.text !== '' || run.k !== 'text') merged.push({ ...run });
  }
  return merged.map((run) => `${run.k}\x01${run.text}\x01${run.href ?? ''}`).join('\x02');
}

/**
 * Serializes an editing surface into note Markdown, line by line: block
 * elements and `<br>` break lines, list items get their markers (and,
 * with `levels`, their nesting indent), bold and italic become marks,
 * code and link chips their source. A line whose marks would read back
 * differently (marks inside words that the tokenizer would not see) keeps
 * its text without them.
 */
export function serializeNoteMarkdown(root: RichNode, options?: SerializeOptions): string {
  const listsEnabled = options?.lists !== false;
  const lines: string[] = [];
  let linePrefix = '';
  let runs: Run[] = [];
  let pending: { k: StyleKind; text: string } | null = null;
  let activeStyle: StyleKind | null = null;
  let lineHasContent = false;

  const flushPendingRun = (): void => {
    const run = pending;
    if (!run) return;
    const [, leading = '', inner = '', trailing = ''] = (run.k === 'code' ? /^()(.*)()$/s : /^(\s*)(.*?)(\s*)$/s).exec(run.text) ?? [];
    if (inner === '' || (run.k === 'code' && !canWrapInlineCode(inner))) runs.push({ k: 'text', text: run.text });
    else runs.push({ k: 'text', text: leading }, { k: run.k, text: inner }, { k: 'text', text: trailing });
    pending = null;
  };

  const reparseRuns = (markdown: string): Run[] =>
    tokenizeNoteInline(listsEnabled ? markdown.replace(ESCAPED_LIST_MARKER_PATTERN, '$1$2') : markdown).map((token) => ({
      k: token.kind,
      text: token.text,
      ...(token.kind === 'link' ? { href: token.href } : {}),
    }));

  const flushLine = (): void => {
    flushPendingRun();
    if (lineHasContent) {
      runs = separateAdjacentCode(runs);
      let markdown = runsToMarkdown(runs);
      if (linePrefix === '' && listsEnabled) markdown = escapeListMarker(markdown);
      if (runsSignature(reparseRuns(markdown)) !== runsSignature(runs))
        markdown = runsToMarkdown(runs.map((run) => (run.k === 'bold' || run.k === 'italic' || run.k === 'bolditalic' ? { k: 'text', text: run.text } : run)));
      lines.push(linePrefix + markdown);
    }
    runs = [];
    lineHasContent = false;
  };

  const appendText = (text: string): void => {
    text
      .replace(/\u00A0/g, ' ')
      .split('\n')
      .forEach((part, index) => {
        if (index > 0) {
          lineHasContent = true;
          flushLine();
        }
        if (part === '') return;
        if (activeStyle !== null) (pending ??= { k: activeStyle, text: '' }).text += part;
        else runs.push({ k: 'text', text: part });
        lineHasContent = true;
      });
  };

  const listItemPrefix = (item: RichNode): string => {
    const list = parentElementOf(item);
    if (!list) return '';
    let indent = '';
    if (options?.levels === true) {
      for (let node = parentElementOf(list); node !== null && node !== root; node = parentElementOf(node)) if (/^[UO]L$/.test(tagOf(node))) indent += '  ';
    }
    if (tagOf(list) !== 'OL') return indent + '- ';
    const start = Number.parseInt(attributeOf(list, 'start') ?? '1', 10);
    let ordinal = Number.isFinite(start) && start >= 0 ? start : 1;
    for (let node = siblingOf(item, -1); node !== null; node = siblingOf(node, -1)) if (tagOf(node) === 'LI') ordinal += 1;
    return `${indent}${Math.min(ordinal, 999)}. `;
  };

  const visitNode = (node: RichNode): void => {
    if (node.nodeType === TEXT_NODE) {
      appendText(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const tag = tagOf(node);
    if (tag === 'BR') {
      const outer = parentElementOf(node);
      const inBlock = outer !== null && (outer === root || BLOCK_TAG_PATTERN.test(tagOf(outer)));
      // A placeholder `<br>` holding a line that starts with a chip open.
      if (inBlock && siblingOf(node, -1) === null && isAtomicNode(siblingOf(node, 1))) return;
      lineHasContent = true;
      if (!(inBlock && siblingOf(node, 1) === null)) flushLine();
      return;
    }
    if (BLOCK_TAG_PATTERN.test(tag)) {
      flushLine();
      const outerPrefix = linePrefix;
      if (tag === 'LI' && listsEnabled) linePrefix = listItemPrefix(node);
      const before = lines.length;
      Array.from(node.childNodes).forEach(visitNode);
      if (tag === 'LI' && lines.length === before) lineHasContent = true;
      flushLine();
      linePrefix = outerPrefix;
      return;
    }
    const text = richTextOf(node).replace(/[\n\u00A0]/g, ' ');
    const href = attributeOf(node, 'data-href') ?? '';
    const atomic: Run | null =
      tag === 'A' && HTTP_LINK_HREF_PATTERN.test(href) && text !== ''
        ? { k: 'link', text, href }
        : tag === 'CODE' && text !== '' && canWrapInlineCode(text)
          ? { k: 'code', text }
          : null;
    if (atomic !== null) {
      flushPendingRun();
      runs.push(atomic);
      lineHasContent = true;
      return;
    }
    if (tag === 'A') {
      Array.from(node.childNodes).forEach(visitNode);
      return;
    }
    const style = INLINE_STYLE_TAGS[tag] ?? (isBoldElement(node) ? 'bold' : isItalicElement(node) ? 'italic' : undefined);
    const outerStyle = activeStyle;
    if (style !== undefined && (outerStyle === null || (outerStyle === 'bold' && style === 'italic') || (outerStyle === 'italic' && style === 'bold'))) {
      flushPendingRun();
      activeStyle = outerStyle !== null || (isBoldElement(node) && isItalicElement(node)) ? 'bolditalic' : style;
      Array.from(node.childNodes).forEach(visitNode);
      flushPendingRun();
      activeStyle = outerStyle;
      return;
    }
    Array.from(node.childNodes).forEach(visitNode);
  };

  Array.from(root.childNodes).forEach(visitNode);
  flushLine();
  return lines.join('\n');
}

/**
 * The stored text of an editing surface, for a field's profile: list
 * lines indented two spaces per level (as core reads them), trailing
 * empty list items dropped, one-line fields joined, and with marks off
 * the plain characters (no escapes).
 */
export function serializeEditorText(root: RichNode, profile: TextProfile = DEFAULT_TEXT_PROFILE): string {
  const serialized = serializeNoteMarkdown(root, { lists: profile.lists, levels: true });
  const stack: number[] = [];
  const text = !profile.lists
    ? serialized.replace(/\n+$/, '')
    : serialized
        .replace(/(?:\n(?: *(?:- |\d{1,3}\. ))?)+$/, '')
        .replace(/^(?:- |\d{1,3}\. )$/, '')
        .split('\n')
        .map((line) => {
          const [, indent, rest] = /^( *)((?:- |\d{1,3}\. ).*)$/.exec(line) ?? [];
          if (indent !== undefined && rest !== undefined) return '  '.repeat(pushListIndent(stack, indent.length)) + rest;
          const unescaped = stack.length === 0 ? line.replace(/^( +(?:\d{1,3})?)\\([-\u2022.](?= ))/, '$1$2') : line;
          stack.length = 0;
          return unescaped;
        })
        .join('\n');
  const result = profile.lines === 'one' ? joinLinesWithSpaces(text) : text;
  return profile.marks === 'off' ? unescapeMarkdownChars(result) : result;
}

/* ------------------------------------------------------------------------ */
/* Stored text → DOM                                                        */
/* ------------------------------------------------------------------------ */

/** A paragraph line of the editing surface. */
export interface EditorParagraph {
  kind: 'p';
  tokens: InlineToken[];
}

/** A list item: its tokens and the lists nested under it. */
export interface EditorListItem {
  tokens: InlineToken[];
  lists: EditorList[];
}

/** A list of the editing surface (`start` is the first number of a numbered list). */
export interface EditorList {
  kind: 'ul' | 'ol';
  start: number;
  items: EditorListItem[];
}

/** A top-level block of the editing surface. */
export type EditorBlock = EditorParagraph | EditorList;

/** Trims the outer whitespace of a line's tokens (only plain text at either end). */
function trimTokens(tokens: InlineToken[]): InlineToken[] {
  const out = tokens.map((token) => ({ ...token }));
  const first = out[0];
  const last = out[out.length - 1];
  if (first?.kind === 'text') first.text = first.text.trimStart();
  if (last?.kind === 'text') last.text = last.text.trimEnd();
  return out;
}

/**
 * What the editing surface shows for stored text: a paragraph per line,
 * lists nested by level, each line's inline tokens (links only to targets
 * the text links to, typed arrows drawn). A one-line field gets one
 * paragraph: its non-blank lines joined with spaces.
 */
export function editorBlocks(text: string, profile: TextProfile = DEFAULT_TEXT_PROFILE): EditorBlock[] {
  const { rows } = parseTextRows(text, profile);
  const linksTo = linkTargetsInText(text);
  const tokensOf = (line: string): InlineToken[] => tokenizeNoteInline(line, linksTo, true);
  if (profile.lines === 'one') {
    const [first, ...rest] = rows.filter((row, index) => index === 0 || row.text.trim() !== '').map((row) => tokensOf(row.text));
    if (first === undefined) return [{ kind: 'p', tokens: [] }];
    if (rest.length === 0) return [{ kind: 'p', tokens: first }];
    const joined = first.every((token) => token.text.trim() === '') ? [] : trimTokens(first);
    for (const line of rest) {
      if (joined.length > 0) joined.push({ kind: 'text', text: ' ' });
      joined.push(...trimTokens(line));
    }
    return [{ kind: 'p', tokens: joined }];
  }
  if (!profile.lists) return rows.map((row) => ({ kind: 'p', tokens: tokensOf(row.text) }));
  const buildList = (list: NestedTextList): EditorList => ({
    kind: list.kind,
    start: list.start,
    items: list.items.map((item) => ({ tokens: tokensOf(item.text), lists: item.lists.map(buildList) })),
  });
  return nestListRows(rows).map((block) => (block.kind === 'p' ? { kind: 'p', tokens: tokensOf(block.text) } : buildList(block)));
}

/**
 * Builds the nodes of {@link editorBlocks}: a `<div>` per paragraph, lists
 * with their nested lists right after the item they belong to (as the
 * browser's indent command makes them), `<strong>`/`<em>` marks, and code
 * and links as atomic chips. An empty line holds a `<br>`.
 */
export function buildEditorNodes<N>(blocks: readonly EditorBlock[], make: RichNodeFactory<N>): N[] {
  const inline = (tokens: readonly InlineToken[]): N[] => {
    if (tokens.every((token) => token.text === '')) return [make.element('br', {}, [])];
    return tokens.map((token) => {
      switch (token.kind) {
        case 'text':
          return make.text(token.text);
        case 'bold':
          return make.element('strong', {}, [make.text(token.text)]);
        case 'italic':
          return make.element('em', {}, [make.text(token.text)]);
        case 'bolditalic':
          return make.element('strong', {}, [make.element('em', {}, [make.text(token.text)])]);
        case 'code':
          return make.element('code', { contenteditable: 'false' }, [make.text(token.text)]);
        case 'link':
          return make.element('a', { contenteditable: 'false', 'data-href': token.href, title: token.href }, [make.text(token.text)]);
      }
    });
  };
  const list = (block: EditorList): N =>
    make.element(
      block.kind,
      block.kind === 'ol' && block.start !== 1 ? { start: String(block.start) } : {},
      block.items.flatMap((item) => [make.element('li', {}, inline(item.tokens)), ...item.lists.map(list)]),
    );
  return blocks.map((block) => (block.kind === 'p' ? make.element('div', {}, inline(block.tokens)) : list(block)));
}

/* ------------------------------------------------------------------------ */
/* As-you-type lists                                                        */
/* ------------------------------------------------------------------------ */

/** The list kind a typed line start makes. */
export type ListKind = 'ul' | 'ol';

/** Line starts that make a list once their space is typed. */
export const LIST_SHORTCUTS: readonly (readonly [string, ListKind])[] = [
  ['- ', 'ul'],
  ['* ', 'ul'],
  ['1. ', 'ol'],
];

/**
 * The list a line start (the text from the line's start to the caret)
 * makes: `- ` and `* ` bullets, `1. ` numbers; with `extra`, also after
 * indentation, `• ` and any number (`7. ` starts a list at 7).
 */
export function listShortcutOf(lineStart: string, extra = false): ListKind | null {
  let value = lineStart.replace(/\u00A0/g, ' ');
  if (extra) {
    value = value.replace(/^ +/, '');
    if (value === '• ') return 'ul';
    if (/^\d{1,3}\. $/.test(value)) return 'ol';
  }
  for (const [shortcut, kind] of LIST_SHORTCUTS) if (value === shortcut) return kind;
  return null;
}

/** The first number of a numbered list a line start makes (`1` unless it names another). */
export function listShortcutStart(lineStart: string): number {
  const start = Number.parseInt(lineStart.replace(/\u00A0/g, ' ').trim(), 10);
  return Number.isFinite(start) && start > 0 ? start : 1;
}

/**
 * The bullets button on a whole stored text (when the surface holds
 * chips the browser's list command would break): every line with text
 * becomes a bullet (numbered items too, keeping their nesting), or, when
 * all of them already are bullets, plain lines again. Empty lines stay.
 */
export function toggleBulletLines(text: string): string {
  const lines = text.split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  const allBullets = filled.length > 0 && filled.every((line) => /^ *- /.test(line));
  return lines
    .map((line) => {
      if (line.trim() === '') return line;
      if (allBullets) return line.replace(/^ *- /, '');
      const item = /^( *)(?:- |\d{1,3}\. )(.*)$/.exec(line);
      return item ? `${item[1]}- ${item[2]}` : `- ${line.trimStart()}`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------------ */
/* As-you-type arrows                                                       */
/* ------------------------------------------------------------------------ */

/** An arrow the editor just drew: what was typed, what shows, and its rule. */
export interface DrawnArrow {
  raw: string;
  drawn: string;
  rule: TextTransform;
}

/** The text around the caret an arrow is planned from. */
export interface ArrowCaretContext {
  /** The caret's text node up to the caret. */
  before: string;
  /** The text of the line's earlier runs, each followed by `TEXT_RUN_SEPARATOR` (code runs empty). */
  lead: string;
  /** The whole line (its direction decides whether arrows apply). */
  line: string;
}

/** What a keystroke does: replace characters before the caret, step by step (one undo step each). */
export interface ArrowPlan {
  /** `[characters before the caret to replace, text to put there]`, in order. */
  steps: Array<[remove: number, insert: string]>;
  /** The arrow drawn, if one is. */
  made?: DrawnArrow;
}

/**
 * Plans what a keystroke does to typed arrows (the editor applies it in
 * place of the keystroke when it has steps):
 *
 * - a character that completes an arrow (`-` then `>`) draws it, in two
 *   steps: the raw text kept apart by a joiner, then the arrow, so one
 *   undo leaves the typed characters;
 * - right after an arrow was drawn, a character that extends it (`<-`
 *   then `>`) redraws it, and one that cannot (`->` then `>`) puts the
 *   raw text back with the character;
 * - Backspace right after a drawn arrow puts back its raw text, kept apart;
 * - Backspace after a joiner deletes the joiner and the character before it.
 */
export function planArrowInput(context: ArrowCaretContext, input: { typed: string | null; deleting: boolean }, previous: DrawnArrow | null): ArrowPlan {
  const plan: ArrowPlan = { steps: [] };
  const planDraw = (replace: number, raw: string, drawn: string, rule: TextTransform): void => {
    plan.made = { raw, drawn, rule };
    plan.steps = [
      [replace, rule.apart(raw)],
      [rule.apart(raw).length, drawn],
    ];
  };
  const { typed, deleting } = input;
  const { before } = context;
  if (previous !== null && typed !== null) {
    const extended = previous.raw + typed;
    const unchanged = drawTextArrows(extended, (token, drawn, _end, rule) => void (token === extended && planDraw(previous.drawn.length, token, drawn, rule))) === extended;
    if (unchanged) plan.steps = [[previous.drawn.length, extended]];
  } else if (previous !== null && deleting) {
    plan.steps = [[previous.drawn.length, previous.rule.apart(previous.raw)]];
  } else if (deleting && before.length >= 3 && before.at(-2) === '\u200C' && dropArrowJoiners(before.slice(-3)).length === 2) {
    plan.steps = [[3, before.slice(-3, -2)]];
  } else if (typed !== null) {
    const joiner = before.endsWith('\u200C') ? 1 : 0;
    const text = context.lead + before.slice(0, before.length - joiner) + typed;
    drawTextArrows(
      text,
      (token, drawn, end, rule) => void (end === text.length && token.length - 1 + joiner <= before.length && planDraw(token.length - 1 + joiner, token, drawn, rule)),
      context.line,
    );
  }
  return plan;
}

/* ------------------------------------------------------------------------ */
/* Paste, copy and links                                                    */
/* ------------------------------------------------------------------------ */

/** Pasted plain text as the editor inserts it. */
export interface PastePlan {
  /** The text to insert (cut to the room left, arrows drawn); `''` for nothing. */
  text: string;
  /** Blocks to insert as lists and lines; `undefined` to insert {@link text} as typed text. */
  blocks: NoteBlock[] | undefined;
  /** The text's lines (paragraph blocks take theirs in order). */
  lines: string[];
  /** Whether the text was cut to fit. */
  cut: boolean;
}

/**
 * What typed text costs against a field's cap: its characters as stored,
 * so with marks the escapes that `*`, `` ` ``, `[`, `]` and `\` take count.
 */
export function storedTextCost(text: string, profile: Pick<TextProfile, 'marks'>): number {
  return [...(profile.marks === 'off' ? text : escapeInlineMarkdown(text))].length;
}

/** The longest start of `text` whose stored cost fits `room`. */
export function fitTextToRoom(text: string, room: number, profile: Pick<TextProfile, 'marks'>): string {
  if (storedTextCost(text, profile) <= room) return text;
  let total = 0;
  let kept = '';
  for (const char of text) {
    total += storedTextCost(char, profile);
    if (total > room) break;
    kept += char;
  }
  return kept;
}

/**
 * Plans a plain-text paste into a field: one-line fields join lines with
 * spaces; the text is cut to the `room` left (as stored) and its arrows
 * drawn; text with list lines goes in as lists unless it is a single line
 * pasted after other text on the caret's line (`atLineStart` false).
 */
export function planPaste(text: string, profile: TextProfile, room: number, atLineStart: boolean): PastePlan {
  const normalized = text.replace(/\r\n?/g, '\n');
  const flattened = profile.lines === 'one' ? normalized.replace(/\s+/g, (space) => (space.includes('\n') ? ' ' : space)) : normalized;
  const kept = fitTextToRoom(flattened, Math.max(0, room), profile);
  const clean = drawArrowsInLines(kept);
  const lines = clean.split('\n');
  const blocks = parseMarkdownBlocks(clean, profile);
  const asText = blocks.every((block) => block.kind === 'p') || (lines.length === 1 && !atLineStart);
  return { text: clean, blocks: clean === '' || asText ? undefined : blocks, lines, cut: kept !== flattened };
}

/** The plain text copied from a selection: link sources defused, arrow joiners dropped. */
export function plainCopyText(selected: string): string {
  return dropArrowJoiners(breakMarkdownLinkSyntax(selected));
}

/** A link target as shown in a field: control and format characters made visible. */
export function visibleLinkHref(href: string): string {
  return href.replace(/[\p{Cc}\p{Cf}\uFDD0-\uFDD4]/gu, '\uFFFD');
}

/** The longest web address a text link takes. */
export const MAX_TEXT_LINK_CHARS = 2048;

/**
 * The web address typed into the link field as text links to it: `https://`
 * added when no scheme is given, Markdown-breaking characters escaped;
 * `null` for anything but a plain `http(s)` address of a named host
 * without credentials.
 */
export function normalizeTextLinkUrl(input: string): string | null {
  if (/^\s*(?!https?:\/\/)[a-z][a-z0-9+.-]*:\/\//i.test(input)) return null;
  const trimmed = input.trim();
  const withScheme = (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase());
  if (!/^https?:\/\/\S+$/.test(withScheme) || withScheme.length > MAX_TEXT_LINK_CHARS) return null;
  const href = percentEncodeMarkdownChars(withScheme);
  if (/[\p{Cc}\p{Cf}\uFDD0-\uFDD4\uFFFD]/u.test(href) || !HTTP_LINK_PATTERN.test(href)) return null;
  try {
    const url = new URL(href);
    if (url.hostname === '' || url.hostname.endsWith('.') || url.username !== '' || url.password !== '') return null;
  } catch {
    return null;
  }
  return href;
}

/** Told when the link field holds no web address. */
export const INVALID_LINK_MESSAGE = 'Enter a web address (http or https)';
/** Told when a link would take the text over its limit. */
export const LINK_TOO_LONG_MESSAGE = 'The text is too long to hold this link';
