/**
 * ⌘B and ⌘I on selected items (not while typing): bold or italic on all
 * of each item's text at once, written as one undo step.
 *
 * Works over the stored Markdown through the same round trip the editor
 * uses (`rich-text.ts`): the text becomes the editor's blocks, every word
 * run gets or loses the mark, and the blocks are written back. Code and
 * links keep their look (the stored subset cannot mark them).
 *
 * A selection turns the mark on unless its last item already has it
 * throughout; turning it on skips items that already have it, so a mixed
 * selection ends all marked and a second press clears it.
 */

import {
  DEFAULT_TEXT_PROFILE,
  TEXT_SIZE_STYLES,
  textProfileForElement,
  type BoardElement,
  type InlineToken,
  type NoteElement,
  type ShapeElement,
  type TextElement,
  type TextProfile,
} from '@open-artifact/whiteboard-core';
import { capText } from './edit.ts';
import { buildEditorNodes, editorBlocks, serializeEditorText, type EditorBlock, type EditorList, type RichNode, type RichNodeFactory } from './rich-text.ts';

/** A mark ⌘B or ⌘I toggles. */
export type TextMark = 'bold' | 'italic';

/** An item whose whole text ⌘B and ⌘I format. */
export type RichTextItem = NoteElement | ShapeElement | TextElement;

/** The key fields {@link markShortcutOf} reads. */
export interface MarkKeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Weight from which a text size already draws bold (bold cannot be added). */
const BOLD_WEIGHT = 600;

/** Said when bold cannot be added to an item. */
export const ALREADY_BOLD_MESSAGE = 'This text is already bold';

/**
 * The mark a key press toggles: ⌘B or ⌘I (Ctrl elsewhere), without Shift
 * or ⌥. Latin layouts go by the letter, others by the key's place.
 */
export function markShortcutOf(event: MarkKeyPress): TextMark | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return undefined;
  const code = /^\p{Script=Latin}$/u.test(event.key) ? `Key${event.key.toUpperCase()}` : event.code;
  return code === 'KeyB' ? 'bold' : code === 'KeyI' ? 'italic' : undefined;
}

/** True for items whose whole text ⌘B and ⌘I format. */
export function isRichTextItem(element: BoardElement): element is RichTextItem {
  return element.type === 'note' || element.type === 'shape' || element.type === 'text';
}

/**
 * The items of a selection that ⌘B and ⌘I format: its notes, shapes and
 * texts, as long as everything else in it is an arrow or a table (any
 * other item makes the shortcut pass).
 */
export function richTextTargets(elements: readonly BoardElement[]): RichTextItem[] {
  return elements.every((element) => element.type === 'arrow' || element.type === 'table' || isRichTextItem(element)) ? elements.filter(isRichTextItem) : [];
}

/** Why a mark cannot be toggled on an item (`''` when it can): text sizes that already draw bold take no bold. */
export function markDisabledReason(mark: TextMark, element: RichTextItem): string {
  if (mark !== 'bold' || element.size === undefined) return '';
  return TEXT_SIZE_STYLES[element.size].weight >= BOLD_WEIGHT ? ALREADY_BOLD_MESSAGE : '';
}

/* ------------------------------------------------------------------------ */
/* Tokens                                                                   */
/* ------------------------------------------------------------------------ */

/** Token kinds that hold words a mark applies to. */
type WordKind = 'text' | 'bold' | 'italic' | 'bolditalic';

/** A token holding words. */
type WordToken = InlineToken & { kind: WordKind };

function isWordToken(token: InlineToken): token is WordToken {
  return token.kind === 'text' || token.kind === 'bold' || token.kind === 'italic' || token.kind === 'bolditalic';
}

function hasMark(kind: WordKind, mark: TextMark): boolean {
  return kind === 'bolditalic' || kind === mark;
}

/** A word kind with a mark added or taken away. */
function withMark(kind: WordKind, mark: TextMark, on: boolean): WordKind {
  const bold = mark === 'bold' ? on : kind === 'bold' || kind === 'bolditalic';
  const italic = mark === 'italic' ? on : kind === 'italic' || kind === 'bolditalic';
  return bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'text';
}

/** Every line's tokens of some blocks, lists included. */
function blockTokens(blocks: readonly EditorBlock[]): InlineToken[][] {
  const lines: InlineToken[][] = [];
  const walk = (block: EditorBlock): void => {
    if (block.kind === 'p') lines.push(block.tokens);
    else
      for (const item of block.items) {
        lines.push(item.tokens);
        item.lists.forEach(walk);
      }
  };
  blocks.forEach(walk);
  return lines;
}

/** Blocks with each line's tokens mapped. */
function mapBlockTokens(blocks: readonly EditorBlock[], map: (tokens: InlineToken[]) => InlineToken[]): EditorBlock[] {
  const list = (block: EditorList): EditorList => ({
    ...block,
    items: block.items.map((item) => ({ tokens: map(item.tokens), lists: item.lists.map(list) })),
  });
  return blocks.map((block) => (block.kind === 'p' ? { kind: 'p', tokens: map(block.tokens) } : list(block)));
}

/** The word tokens that show something (blank runs carry no mark). */
function visibleWords(blocks: readonly EditorBlock[]): WordToken[] {
  return blockTokens(blocks)
    .flat()
    .filter(isWordToken)
    .filter((token) => token.text.trim() !== '');
}

/* ------------------------------------------------------------------------ */
/* Writing back                                                             */
/* ------------------------------------------------------------------------ */

/** A small node for the round trip, so this runs without a DOM. */
class PlainNode implements RichNode {
  parentNode: PlainNode | null = null;
  readonly childNodes: PlainNode[] = [];
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  private readonly attributes: Readonly<Record<string, string>>;
  constructor(nodeType: number, nodeName: string, nodeValue: string | null, attributes: Readonly<Record<string, string>> = {}) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.nodeValue = nodeValue;
    this.attributes = attributes;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
}

const PLAIN_NODES: RichNodeFactory<PlainNode> = {
  element(tag, attributes, children) {
    const node = new PlainNode(1, tag.toUpperCase(), null, attributes);
    for (const child of children) {
      child.parentNode = node;
      node.childNodes.push(child);
    }
    return node;
  },
  text: (value) => new PlainNode(3, '#text', value),
};

/** The stored text of some blocks. */
function storedText(blocks: readonly EditorBlock[], profile: TextProfile): string {
  return serializeEditorText(PLAIN_NODES.element('div', {}, buildEditorNodes(blocks, PLAIN_NODES)), profile);
}

/** Blocks keeping only the first `count` characters of visible text. */
function keepVisible(blocks: readonly EditorBlock[], count: number): EditorBlock[] {
  let left = count;
  return mapBlockTokens(blocks, (tokens) =>
    tokens.flatMap((token) => {
      if (left <= 0) return [];
      const chars = [...token.text];
      if (chars.length <= left) {
        left -= chars.length;
        return [token];
      }
      // Code and links are kept whole or not at all.
      if (!isWordToken(token)) {
        left = 0;
        return [];
      }
      const kept = { ...token, text: chars.slice(0, left).join('') };
      left = 0;
      return [kept];
    }),
  );
}

/** The longest start of some blocks whose stored text fits `cap` (a cut text drops its trailing blanks). */
function fitBlocks(blocks: readonly EditorBlock[], profile: TextProfile, cap: number): { text: string; cut: boolean } {
  const full = storedText(blocks, profile);
  if ([...full].length <= cap) return { text: full, cut: false };
  const total = blockTokens(blocks)
    .flat()
    .reduce((sum, token) => sum + [...token.text].length, 0);
  let [low, high] = [0, total];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ([...storedText(keepVisible(blocks, mid), profile)].length <= cap) low = mid;
    else high = mid - 1;
  }
  return { text: capText(storedText(keepVisible(blocks, low), profile), cap).trimEnd(), cut: true };
}

/* ------------------------------------------------------------------------ */
/* Toggling                                                                 */
/* ------------------------------------------------------------------------ */

/** The profile an item's text is stored with. */
function profileOf(element: RichTextItem): TextProfile {
  return textProfileForElement(element) ?? DEFAULT_TEXT_PROFILE;
}

/** Whether stored text has words, and whether all of them carry a mark. */
export function markCoverage(text: string, profile: TextProfile, mark: TextMark): { words: boolean; all: boolean } {
  const words = visibleWords(editorBlocks(text, profile));
  return { words: words.length > 0, all: words.length > 0 && words.every((token) => hasMark(token.kind, mark)) };
}

/**
 * Stored text with a mark on (or off) all of its words, cut to the
 * profile's cap. `undefined` when nothing would change.
 */
export function toggleMarkInText(text: string, profile: TextProfile, mark: TextMark, on: boolean): { text: string; cut: boolean } | undefined {
  const blocks = editorBlocks(text, profile);
  let changed = false;
  const next = mapBlockTokens(blocks, (tokens) =>
    tokens.map((token) => {
      if (!isWordToken(token) || token.text.trim() === '') return token;
      const kind = withMark(token.kind, mark, on);
      if (kind === token.kind) return token;
      changed = true;
      return { ...token, kind };
    }),
  );
  if (!changed) return undefined;
  const fitted = fitBlocks(next, profile, profile.cap);
  return fitted.text === text ? undefined : fitted;
}

/** What {@link toggleMarkAcross} changes. */
export interface MarkAcrossResult {
  /** The next text of each item that changes. */
  texts: Map<string, string>;
  /** Some text was cut to its limit. */
  cut: boolean;
}

/**
 * Toggles a mark across items: on, unless the last item that can take it
 * already has it throughout. Items without words, or that cannot take the
 * mark, are left alone; turning on skips items already marked.
 */
export function toggleMarkAcross(elements: readonly RichTextItem[], mark: TextMark): MarkAcrossResult {
  const targets = elements.filter((element) => markDisabledReason(mark, element) === '' && markCoverage(element.text, profileOf(element), mark).words);
  const last = targets[targets.length - 1];
  const on = last !== undefined && !markCoverage(last.text, profileOf(last), mark).all;
  const texts = new Map<string, string>();
  let cut = false;
  for (const element of targets) {
    const profile = profileOf(element);
    if (on && markCoverage(element.text, profile, mark).all) continue;
    const next = toggleMarkInText(element.text, profile, mark, on);
    if (next === undefined) continue;
    texts.set(element.id, next.text);
    cut ||= next.cut;
  }
  return { texts, cut };
}
