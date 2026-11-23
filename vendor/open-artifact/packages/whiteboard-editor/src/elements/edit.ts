/**
 * Pure helpers of the in-place text editor, and the hook other areas use
 * to handle keys the editor hands back.
 *
 * Text with a profile (notes, shapes, free text, cells, titles, labels) is
 * edited formatted (`rich-text.ts`, `rich-dom.ts`). The plain editor, kept
 * for embed sources, edits the stored source as plain text; these helpers
 * give it the list conveniences: Return continues a list (and ends it on an
 * empty item), Tab and Shift+Tab nest and un-nest an item, Mod+B and Mod+I
 * wrap the selection in bold and italic marks.
 */

import type { TextEditTarget } from '../state/selection.ts';
import type { TextKeyAction } from '@open-artifact/whiteboard-core';

/** A text with a selection (`start === end` for a caret). */
export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

/** Spaces one list nesting level adds. */
export const LIST_INDENT = '  ';

/** A list line: its indent, its marker (with the space after it) and its content. */
export interface ListLine {
  indent: string;
  marker: string;
  content: string;
}

/** The modifier keys of a key event. */
export interface KeyChordInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * A key event as the chord names text profiles use (`Return`,
 * `Shift+Return`, `Mod+Return`, `Tab`, `Escape`, `Menu`, `Mod+B`…). `Mod`
 * is ⌘ on Apple platforms and Ctrl elsewhere.
 */
export function keyChord(event: KeyChordInput, apple: boolean): string {
  const names: Record<string, string> = { Enter: 'Return', ContextMenu: 'Menu', Esc: 'Escape' };
  const key = names[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const mod = apple ? event.metaKey : event.ctrlKey;
  return [mod && 'Mod', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

/** Where the line holding `offset` starts and ends. */
export function lineBounds(text: string, offset: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const newline = text.indexOf('\n', offset);
  return { start, end: newline === -1 ? text.length : newline };
}

/** The list parts of a line, or `undefined` when it is not a list item. */
export function parseListLine(line: string): ListLine | undefined {
  const match = /^([  ]*)((?:[-•*]|\d{1,3}\.)[  ])(.*)$/s.exec(line);
  return match ? { indent: match[1]!, marker: match[2]!, content: match[3]! } : undefined;
}

/** The marker of the next item after `marker` (numbers count up, bullets repeat). */
export function nextListMarker(marker: string): string {
  const number = /^(\d{1,3})\.(.)$/s.exec(marker);
  return number ? `${Number(number[1]) + 1}.${number[2]}` : marker;
}

/**
 * Return on a list line: a new item with the next marker, or, on an empty
 * item, the end of the list (the marker is removed). `undefined` when the
 * caret is not on a list line or a range is selected.
 */
export function continueList({ text, start, end }: TextSelection): TextSelection | undefined {
  if (start !== end) return undefined;
  const bounds = lineBounds(text, start);
  const list = parseListLine(text.slice(bounds.start, bounds.end));
  if (!list || start < bounds.start + list.indent.length + list.marker.length) return undefined;
  if (list.content.trim() === '') {
    const next = text.slice(0, bounds.start) + text.slice(bounds.end);
    return { text: next, start: bounds.start, end: bounds.start };
  }
  const insert = `\n${list.indent}${nextListMarker(list.marker)}`;
  const next = text.slice(0, start) + insert + text.slice(end);
  return { text: next, start: start + insert.length, end: start + insert.length };
}

/**
 * Tab (nest) or Shift+Tab (un-nest) on the list lines the selection
 * touches. `undefined` when no selected line is a list item.
 */
export function indentListLines({ text, start, end }: TextSelection, outdent: boolean): TextSelection | undefined {
  const from = lineBounds(text, start).start;
  const to = lineBounds(text, end).end;
  const lines = text.slice(from, to).split('\n');
  if (!lines.some((line) => parseListLine(line) !== undefined)) return undefined;
  let shiftStart = 0;
  let shiftEnd = 0;
  const changed = lines.map((line, index) => {
    if (!parseListLine(line)) return line;
    let delta = 0;
    let next = line;
    if (!outdent) {
      next = LIST_INDENT + line;
      delta = LIST_INDENT.length;
    } else {
      const removable = /^[  ]{0,2}/.exec(line)![0].length;
      next = line.slice(removable);
      delta = -removable;
    }
    if (index === 0) shiftStart = delta;
    shiftEnd += delta;
    return next;
  });
  const next = text.slice(0, from) + changed.join('\n') + text.slice(to);
  return { text: next, start: Math.max(from, start + shiftStart), end: Math.max(from, end + shiftEnd) };
}

/** Wraps the selection in a Markdown mark (`**` bold, `*` italic), or unwraps it when already wrapped. */
export function toggleMark({ text, start, end }: TextSelection, mark: string): TextSelection {
  const before = text.slice(start - mark.length, start);
  const after = text.slice(end, end + mark.length);
  if (before === mark && after === mark) {
    const next = text.slice(0, start - mark.length) + text.slice(start, end) + text.slice(end + mark.length);
    return { text: next, start: start - mark.length, end: end - mark.length };
  }
  const next = text.slice(0, start) + mark + text.slice(start, end) + mark + text.slice(end);
  return { text: next, start: start + mark.length, end: end + mark.length };
}

/** Cuts text to a field's cap (by code points, so emoji are not split). */
export function capText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  let out = '';
  for (const char of text) {
    if (out.length + char.length > cap) break;
    out += char;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Host                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * What the editor hands back to the rest of the page: keys its profile
 * maps to `next`, `step` or `host`, and the end of an edit. Each handler
 * returns `true` when it took care of the key (the editor then does
 * nothing more); without a handler, `step` and `host` keys end the edit.
 */
export interface TextEditHost {
  /** Mod+Return in a note, shape or text: go on to a next element. */
  next?(target: TextEditTarget): boolean;
  /** Tab or Shift+Tab in a single-line field. */
  step?(target: TextEditTarget, backwards: boolean): boolean;
  /** A key a table cell hands to its grid. */
  cell?(target: Extract<TextEditTarget, { kind: 'cell' }>, chord: string): boolean;
  /** An edit finished (after its last change was written). */
  ended?(target: TextEditTarget): void;
}

let host: TextEditHost = {};

/** Installs the text editor's host; returns a function that removes it. */
export function setTextEditHost(next: TextEditHost): () => void {
  host = next;
  return () => {
    if (host === next) host = {};
  };
}

/** The installed text editor host. */
export function textEditHost(): TextEditHost {
  return host;
}

/** What a chord does in a profile (`undefined`: the browser's default). */
export function keyAction(keys: Readonly<Record<string, TextKeyAction>> | undefined, chord: string): TextKeyAction | undefined {
  return keys?.[chord];
}
