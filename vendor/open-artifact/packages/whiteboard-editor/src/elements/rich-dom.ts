/**
 * The DOM half of the formatted (rich) in-place text editor: filling the
 * editing surface, formatting commands, list handling, the as-you-type
 * conveniences, paste and copy (plain and formatted), and text links.
 *
 * The surface follows the browser's own editing conventions (what
 * `execCommand` makes): a `<div>` per paragraph, lists as `<ul>`/`<ol>`
 * with nested lists right after their item, `<strong>`/`<em>` marks
 * (`<b>`/`<i>` too), and code spans and links as atomic chips
 * (`contenteditable="false"`; links carry their target in `data-href`).
 * An empty line holds a `<br>`. `rich-text.ts` reads it back into stored
 * text and plans what is pure; this module applies those plans.
 *
 * Commands go through `document.execCommand`, so each is a step of the
 * browser's own undo history while editing.
 */

import { MAX_LIST_INDENT_LEVEL, isLinkableHref, linkEditCost, linkableTextSpans, type TextProfile } from '@open-artifact/whiteboard-core';
import {
  BLOCK_TAG_PATTERN,
  BOLD_ELEMENT_SELECTOR,
  ITALIC_ELEMENT_SELECTOR,
  buildEditorNodes,
  editorBlocks,
  listShortcutOf,
  listShortcutStart,
  planArrowInput,
  planPaste,
  plainCopyText,
  serializeEditorText,
  type ArrowCaretContext,
  type DrawnArrow,
  type ListKind,
  type RichNodeFactory,
} from './rich-text.ts';
import { RICH_TEXT_CLIPBOARD_TYPE, hasInlineFormat, richClipboardHtml } from '../lib/rich-clipboard.ts';

/* ------------------------------------------------------------------------ */
/* Events and chrome                                                        */
/* ------------------------------------------------------------------------ */

/** Dispatched (bubbling) on the editing surface for ⌘K: the format bar opens its link field. */
export const LINK_CHORD_EVENT = 'wb-link-chord';

/** Dispatched on the editing surface by the format bar's bullets button: the editor toggles a bulleted list. */
export const BULLETS_PRESS_EVENT = 'wb-bullets-press';

/**
 * Chrome that may take focus without ending the edit: the format bar, the
 * menus and popovers it opens, and the link card.
 */
export const EDITOR_CHROME_SELECTOR = '[data-wb-format-bar], [data-wb-chrome][role="menu"], [data-wb-chrome][role="dialog"], [data-wb-link-card]';

/** Whether an event target is editor chrome ({@link EDITOR_CHROME_SELECTOR}). */
export function isEditorChromeTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && target.closest(EDITOR_CHROME_SELECTOR) !== null;
}

/** Link chips of the editing surface. */
const LINK_CHIP_SELECTOR = 'a[contenteditable="false"]';

/** Indentation typed by Tab outside lists. */
const INDENT_SPACES = '    ';

/** The element a node is, or sits in. */
export function elementOf(node: Node | null | undefined): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** The editing surface a node sits in. */
export function editableRootOf(node: Node | null | undefined): HTMLElement | null {
  return elementOf(node)?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
}

/** The editing surface a range sits in. */
export function editableRootOfRange(range: Range): HTMLElement | null {
  return editableRootOf(range.commonAncestorContainer);
}

/* ------------------------------------------------------------------------ */
/* Filling the surface                                                      */
/* ------------------------------------------------------------------------ */

/** Makes real DOM nodes for `buildEditorNodes`. */
function domNodes(doc: Document): RichNodeFactory<Node> {
  return {
    element(tag, attributes, children) {
      const element = doc.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      element.append(...children);
      return element;
    },
    text: (value) => doc.createTextNode(value),
  };
}

/** Replaces the surface's content with stored text, formatted (see the module comment). */
export function renderIntoEditor(root: HTMLElement, text: string, profile: TextProfile): void {
  root.replaceChildren(...buildEditorNodes(editorBlocks(text, profile), domNodes(root.ownerDocument)));
  describeEditorLinks(root);
}

/** Gives each link of the surface its address as its accessible description. */
function describeEditorLinks(root: HTMLElement): void {
  for (const link of root.querySelectorAll<HTMLElement>('a[data-href]')) {
    const href = link.dataset.href ?? '';
    if (link.getAttribute('aria-description') !== href) link.setAttribute('aria-description', href);
  }
}

/** Puts the caret at the end of the surface's last line. */
export function placeCaretAtEnd(root: HTMLElement): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  let deepest: Node = root;
  while (deepest.lastChild && /^(DIV|UL|OL|LI)$/.test(deepest.lastChild.nodeName)) deepest = deepest.lastChild;
  const range = root.ownerDocument.createRange();
  // An empty line's `<br>` only holds it open: the caret goes before it.
  if (deepest.lastChild?.nodeName === 'BR') range.setStartBefore(deepest.lastChild);
  else {
    range.selectNodeContents(deepest);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Selects all of the surface's content. */
export function selectAllOf(root: HTMLElement): void {
  root.ownerDocument.getSelection()?.selectAllChildren(root);
}

/** Puts the caret right after an element. */
export function placeCaretAfter(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  element.ownerDocument.getSelection()?.collapse(parent, Array.prototype.indexOf.call(parent.childNodes, element) + 1);
}

/* ------------------------------------------------------------------------ */
/* Formatting commands                                                      */
/* ------------------------------------------------------------------------ */

let runningCommand = false;

/** Whether one of this module's commands is running (its input events are not the person's typing). */
export function isRunningFormatCommand(): boolean {
  return runningCommand;
}

/** Runs an editing command (marks as tags, not inline styles). */
export function runEditCommand(doc: Document, command: string, value?: string): boolean {
  runningCommand = true;
  try {
    doc.execCommand('styleWithCSS', false, 'false');
    return doc.execCommand(command, false, value);
  } finally {
    runningCommand = false;
  }
}

/** Marks that cannot be toggled (`true`: off), such as bold in text that is bold by its style. */
export interface MarkLocks {
  bold: boolean;
  italic: boolean;
}

/** Focuses the editing surface the selection is in (a chrome button may hold focus). */
export function focusSelectionEditable(doc: Document = document): void {
  const root = editableRootOf(doc.getSelection()?.anchorNode);
  if (root && doc.activeElement !== root) root.focus({ preventScroll: true });
}

/** Toggles bold or italic on the selection (nothing when that mark is locked). */
export function toggleInlineStyle(style: 'bold' | 'italic', locks: MarkLocks, doc: Document = document): void {
  if (locks[style]) return;
  focusSelectionEditable(doc);
  runEditCommand(doc, style);
}

/** What the selection shows: bold or italic all over, in a bulleted or numbered list. */
export interface SelectionFormat {
  allBold: boolean;
  allItalic: boolean;
  ul: boolean;
  ol: boolean;
}

/**
 * The format of the selection: a mark counts when every selected
 * character has it (at a caret, when typing would get it).
 */
export function readSelectionFormat(doc: Document = document, locks?: MarkLocks): SelectionFormat {
  const state: SelectionFormat = { allBold: false, allItalic: false, ul: false, ol: false };
  const selection = doc.getSelection();
  const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  if (!range && locks && selection?.rangeCount) {
    if (!locks.bold && doc.queryCommandState('bold')) state.allBold = true;
    if (!locks.italic && doc.queryCommandState('italic')) state.allItalic = true;
  }
  let editable: HTMLElement | null = null;
  for (let node: Node | null = range ? range.commonAncestorContainer : (selection?.anchorNode ?? null); node && node.nodeType !== Node.DOCUMENT_NODE; node = node.parentNode) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    if (element.contentEditable === 'true') {
      editable = element;
      break;
    }
    if (element.matches(BOLD_ELEMENT_SELECTOR)) state.allBold = true;
    if (element.matches(ITALIC_ELEMENT_SELECTOR)) state.allItalic = true;
    if (!state.ul && !state.ol && element.tagName === 'UL') state.ul = true;
    else if (!state.ul && !state.ol && element.tagName === 'OL') state.ol = true;
  }
  if (editable && range) {
    let bold = true;
    let italic = true;
    let ul = true;
    let ol = true;
    let sawText = false;
    const walker = doc.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!range.intersectsNode(text)) continue;
      sawText = true;
      const parent = text.parentElement;
      bold &&= !!parent?.closest(BOLD_ELEMENT_SELECTOR);
      italic &&= !!parent?.closest(ITALIC_ELEMENT_SELECTOR);
      ul &&= !!parent?.closest('ul');
      ol &&= !!parent?.closest('ol');
    }
    state.allBold ||= sawText && bold;
    state.allItalic ||= sawText && italic;
    if (!state.ul && !state.ol) {
      state.ul = sawText && ul;
      state.ol = sawText && !ul && ol;
    }
  }
  return state;
}

/* ------------------------------------------------------------------------ */
/* Lines and lists                                                          */
/* ------------------------------------------------------------------------ */

/** The range from the start of the caret's line (its list item, paragraph or last break) to the caret. */
export function lineStartToCaretRange(doc: Document = document): Range | null {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const { startContainer: container, startOffset: offset } = selection.getRangeAt(0);
  const element = elementOf(container);
  const block = element?.closest('li') ?? element?.closest('div, p');
  if (!block) return null;
  const range = doc.createRange();
  range.setStart(block, 0);
  let boundary: Node | null = block.tagName === 'LI' ? null : container === block ? (block.childNodes[offset - 1] ?? null) : container;
  while (boundary !== null && boundary.parentNode !== block) boundary = boundary.parentNode;
  while (boundary !== null && !/^(DIV|P|UL|OL|BR)$/.test(boundary.nodeName)) boundary = boundary.previousSibling;
  if (boundary !== null) range.setStartAfter(boundary);
  range.setEnd(container, offset);
  return range;
}

/** The text of the caret's line before the caret. */
export function textBeforeCaret(doc: Document = document): string {
  return lineStartToCaretRange(doc)?.toString() ?? '';
}

/** The list item the (collapsed) caret is in. */
export function caretListItem(root: HTMLElement): HTMLLIElement | null {
  const selection = root.ownerDocument.getSelection();
  const anchor = selection?.isCollapsed === true ? selection.anchorNode : null;
  const item = elementOf(anchor)?.closest('li') ?? null;
  return item !== null && root.contains(item) ? item : null;
}

/** The caret's list item, or the first list item the selection touches. */
export function selectedListItem(root: HTMLElement): HTMLLIElement | undefined {
  const selection = root.ownerDocument.getSelection();
  return (
    caretListItem(root) ??
    (selection && selection.rangeCount > 0 ? [...root.querySelectorAll('li')].find((item) => selection.getRangeAt(0).intersectsNode(item)) : undefined)
  );
}

/** Whether the bullets button must work on the whole text (chips, or a selection reaching out of a list). */
export function needsWholeBulletToggle(root: HTMLElement): boolean {
  const selection = root.ownerDocument.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
  const closestList = (node: Node): Element | null => elementOf(node)?.closest('ul') ?? null;
  return (
    root.querySelector('[contenteditable="false"]') !== null ||
    (range?.collapsed === false && closestList(range.startContainer) !== null && closestList(range.commonAncestorContainer) === null)
  );
}

/** Whether a node is a list. */
function isList(node: Node | null | undefined): node is HTMLElement {
  return node != null && /^[UO]L$/.test(node.nodeName);
}

/**
 * Tab and Shift+Tab: nests or un-nests the selected list items (within
 * {@link MAX_LIST_INDENT_LEVEL}, and only under a previous item); outside
 * lists, Tab types four spaces and Shift+Tab takes up to four from the
 * line's start. `force` un-nests even top-level items (out of the list).
 * Returns whether anything changed.
 */
export function indentListSelection(root: HTMLElement, outdent: boolean, fits: (text: string) => boolean, force = false): boolean {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const { startContainer: anchorNode, startOffset: anchorOffset, endContainer: endNode, endOffset } = selection.getRangeAt(0);
  const isCollapsed = selection.isCollapsed;
  const selectedItems = (): HTMLLIElement[] => [...root.querySelectorAll('li')].filter((item) => selection.getRangeAt(0).intersectsNode(item));
  const lastItem = selectedItems()
    .filter((item) => isCollapsed || endOffset > 0 || !item.contains(endNode))
    .at(-1);
  let nextList = lastItem?.nextElementSibling;
  while (isList(nextList) && isList(nextList.nextElementSibling)) nextList = nextList.nextElementSibling;
  // Items nested under the last item move with it.
  if (isCollapsed && isList(nextList)) selection.setBaseAndExtent(anchorNode, anchorOffset, nextList, nextList.childNodes.length);
  else if (!isCollapsed && endOffset === 0 && lastItem !== undefined) selection.setBaseAndExtent(anchorNode, anchorOffset, lastItem, lastItem.childNodes.length);
  const items = selectedItems();
  let outerList: HTMLElement | null = null;
  for (let node = items[0]?.parentElement ?? null; node !== null && node !== root; node = node.parentElement) if (isList(node)) outerList = node;
  if (outerList?.contains(selection.getRangeAt(0).commonAncestorContainer) === true) {
    const depths = items.map((item) => {
      let depth = -1;
      for (let ancestor = item.parentElement; ancestor !== null && ancestor !== root; ancestor = ancestor.parentElement) if (isList(ancestor)) depth++;
      return depth;
    });
    const go = outdent
      ? force || Math.min(...depths) > 0
      : Math.max(...depths) < MAX_LIST_INDENT_LEVEL && (items[0]?.previousElementSibling != null || isList(items[0]?.parentElement?.previousElementSibling));
    if (go) runEditCommand(doc, outdent ? 'outdent' : 'indent');
    if (isCollapsed) selection.collapseToStart();
    return go;
  }
  if (items.length > 0 || !isCollapsed || (anchorNode === root && (outdent || root.textContent !== ''))) return false;
  if (!outdent) {
    if (!fits(INDENT_SPACES)) return false;
    doc.execCommand('insertText', false, INDENT_SPACES);
    return true;
  }
  const line = lineStartToCaretRange(doc);
  const first = line?.startContainer.nodeType === Node.TEXT_NODE ? line.startContainer : line?.startContainer.childNodes[line.startOffset];
  const textNode = first == null || first.nodeType === Node.TEXT_NODE ? (first ?? null) : doc.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
  const spaces = /^[ \u00A0]{1,4}/.exec(textNode?.nodeValue ?? '')?.[0].length ?? 0;
  if (textNode === null || spaces === 0) return false;
  selection.setBaseAndExtent(textNode, 0, textNode, spaces);
  doc.execCommand('delete');
  if (anchorNode.isConnected) selection.collapse(anchorNode, anchorNode === textNode ? Math.max(0, anchorOffset - spaces) : anchorOffset);
  return true;
}

/** Puts the caret back `chars` characters into `target` (after a chip it would land in). */
function collapseAtTextOffset(selection: Selection, target: Node, chars: number): void {
  selection.collapse(target, 0);
  const walker = target.ownerDocument!.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let left = chars;
  for (let node = walker.nextNode(); node !== null && left >= 0; node = walker.nextNode()) {
    const length = (node.nodeValue ?? '').length;
    const chip = node.parentElement?.closest('[contenteditable="false"]');
    if (left <= length && !chip) {
      selection.collapse(node, left);
      return;
    }
    if (left <= length && chip?.parentNode) {
      placeCaretAfter(chip);
      return;
    }
    left -= length;
  }
}

/** Toggles a list on the selected lines, keeping the caret where it was in its line. */
export function toggleListPreservingCaret(kind: ListKind, doc: Document = document): void {
  focusSelectionEditable(doc);
  const selection = doc.getSelection();
  const lineOf = (node: Node | null): Element | null => elementOf(node)?.closest('li') ?? elementOf(node)?.closest('[contenteditable="true"] > *') ?? null;
  let caret = -1;
  if (selection?.isCollapsed && selection.anchorNode) {
    const line = lineOf(selection.anchorNode);
    if (line) {
      const before = doc.createRange();
      before.selectNodeContents(line);
      before.setEnd(selection.anchorNode, selection.anchorOffset);
      caret = before.toString().length;
    }
  }
  runEditCommand(doc, kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
  const item = caret >= 0 && selection?.anchorNode ? lineOf(selection.anchorNode) : null;
  if (item && selection) collapseAtTextOffset(selection, item, caret);
}

/**
 * ⌘⇧8 / ⌘⇧7 and the bullets button: in a list item, switches the whole
 * list it is in (keeping the caret in its item); elsewhere, makes the
 * selected lines a list.
 */
export function toggleListAtCaret(root: HTMLElement, kind: ListKind): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  const caretItem = caretListItem(root);
  const siblings = [...(caretItem?.parentElement?.querySelectorAll('li') ?? [])];
  const first = siblings[0];
  const last = siblings.at(-1);
  if (!selection || caretItem === null || first === undefined || last === undefined) {
    toggleListPreservingCaret(kind, doc);
    return;
  }
  const itemIndex = [...root.querySelectorAll('li')].indexOf(caretItem);
  const caretChars = textBeforeCaret(doc).length;
  selection.setBaseAndExtent(first, 0, last, last.childNodes.length);
  toggleListPreservingCaret(kind, doc);
  // An empty last item the browser split off keeps the old list: switch it too.
  if (last !== first && last.textContent === '' && last.isConnected && last.parentElement?.tagName !== kind.toUpperCase()) {
    selection.collapse(last, 0);
    toggleListPreservingCaret(kind, doc);
  }
  collapseAtTextOffset(selection, root.querySelectorAll('li')[itemIndex] ?? root, caretChars);
}

/* ------------------------------------------------------------------------ */
/* As-you-type lists                                                        */
/* ------------------------------------------------------------------------ */

/** The text a surface had right after a list shortcut removed its marker (for one-step undo). */
const autoformats = new WeakMap<HTMLElement, { intermediate: string; undoArmed: boolean; redoArmed: boolean }>();
let autoformatRunning = false;

/**
 * After an input: a typed space that completes `- `, `* ` or `1. ` (also
 * `• ` and any number) at the start of a line turns the line into a list
 * of the `allowed` kinds; in a list item, into the other kind of list.
 * Undo right after puts the typed marker back (one more undo step, so
 * the space typed stays), redo makes the list again. `read` serializes
 * the surface. Returns whether it made a list.
 */
export function autoformatListShortcut(root: HTMLElement, event: InputEvent, read: (root: HTMLElement) => string, allowed: readonly ListKind[]): boolean {
  if (autoformatRunning) return false;
  const doc = root.ownerDocument;
  const entry = autoformats.get(root);
  autoformats.delete(root);
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    const undo = event.inputType === 'historyUndo';
    if (entry === undefined || !(undo ? entry.undoArmed : entry.redoArmed) || read(root) !== entry.intermediate) return false;
    autoformatRunning = true;
    try {
      doc.execCommand(undo ? 'undo' : 'redo');
    } finally {
      autoformatRunning = false;
    }
    autoformats.set(root, { ...entry, undoArmed: !undo, redoArmed: undo });
    return false;
  }
  if (event.inputType !== 'insertText' || (event.data !== ' ' && event.data !== '\u00A0')) return false;
  const selection = doc.getSelection();
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const caret = selection.getRangeAt(0);
  if (!root.contains(caret.startContainer)) return false;
  let block: Element = root;
  let item: Element | null = null;
  for (let node = elementOf(caret.startContainer); node !== null && node !== root; node = node.parentElement) {
    if (block === root && node.tagName === 'LI') item = block = node;
    else if (/^(LI|UL|OL)$/.test(node.tagName) ? item === null : /^(H[1-6]|BLOCKQUOTE|PRE|TABLE|CODE|A)$/.test(node.tagName)) return false;
    if (block === root && (node.tagName === 'DIV' || node.tagName === 'P')) block = node;
  }
  const range = doc.createRange();
  range.selectNodeContents(block);
  if (item === null) {
    let start: Node | null = caret.startContainer;
    while (start !== null && start.parentNode !== block) start = start.parentNode;
    while (start?.previousSibling != null && !/^(DIV|P|UL|OL|BR)$/.test(start.previousSibling.nodeName)) start = start.previousSibling;
    if (start !== null) range.setStartBefore(start);
  }
  range.setEnd(caret.startContainer, caret.startOffset);
  if (range.cloneContents().querySelector('[contenteditable="false"]')) return false;
  const typed = range.toString();
  const kind = listShortcutOf(typed, true);
  if (kind === null || !allowed.includes(kind)) return false;
  if (item !== null && item.parentElement?.tagName === kind.toUpperCase()) return false;
  const start = kind === 'ol' ? listShortcutStart(typed) : 1;
  selection.removeAllRanges();
  selection.addRange(range);
  doc.execCommand('delete');
  const intermediate = read(root);
  runEditCommand(doc, kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
  if (start > 1) {
    const list = elementOf(doc.getSelection()?.anchorNode)?.closest('li')?.parentElement;
    if (list?.tagName === 'OL' && list.childElementCount === 1) list.setAttribute('start', String(start));
  }
  autoformats.set(root, { intermediate, undoArmed: true, redoArmed: false });
  return true;
}

/* ------------------------------------------------------------------------ */
/* As-you-type arrows                                                       */
/* ------------------------------------------------------------------------ */

/** The text around a collapsed caret ({@link ArrowCaretContext}) with the caret's text node. */
interface CaretText extends ArrowCaretContext {
  node: Text;
  at: number;
}

/** The text around the caret, for arrow planning; `null` unless the caret is collapsed in text. */
function caretTextContext(root: HTMLElement): CaretText | null {
  const selection = root.ownerDocument.getSelection();
  if (selection?.isCollapsed !== true || selection.anchorNode === null || !root.contains(selection.anchorNode)) return null;
  const previous = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode.childNodes[selection.anchorOffset - 1] : undefined;
  const [node, at] = previous?.nodeType === Node.TEXT_NODE ? [previous, (previous.nodeValue ?? '').length] : [selection.anchorNode, selection.anchorOffset];
  if (node.nodeType !== Node.TEXT_NODE) return null;
  let block: Node = node;
  while (block.parentNode !== null && block.parentNode !== root && block.nodeName !== 'LI') block = block.parentNode;
  let lead = '';
  const walker = root.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text !== null && text !== node; text = walker.nextNode()) {
    lead += (text.parentElement?.closest('code') != null ? '' : (text.nodeValue ?? '')) + '\uFDD5';
  }
  return { node: node as Text, at, lead, before: (node.nodeValue ?? '').slice(0, at), line: block.textContent ?? '' };
}

/** Selects the `length` characters before the caret (in its text node). */
function selectBeforeCaret(root: HTMLElement, length: number): void {
  const context = caretTextContext(root);
  if (context) root.ownerDocument.getSelection()?.setBaseAndExtent(context.node, context.at - length, context.node, context.at);
}

/**
 * Draws typed arrows as they are typed (`->` → `→`, `<-` → `←`, `<->` →
 * `←→`; see core `text/text-arrows.ts` and `planArrowInput`): one undo
 * step after an arrow is drawn leaves the typed characters, kept apart.
 * Returns a function that stops.
 */
export function attachTextArrowAutoformat(root: HTMLElement): () => void {
  let lastDrawn: (DrawnArrow & { node: Text; at: number }) | null = null;
  let applying = false;
  const insertedRuns = new Set<string>();

  const onBeforeInput = (event: InputEvent): void => {
    if (applying || isRunningFormatCommand()) return;
    const context = caretTextContext(root);
    const previous =
      lastDrawn !== null && context !== null && lastDrawn.node === context.node && lastDrawn.at === context.at && context.before.endsWith(lastDrawn.drawn)
        ? lastDrawn
        : null;
    lastDrawn = null;
    if (context === null || event.isComposing || !event.cancelable) return;
    const typed = event.inputType === 'insertText' && event.data?.length === 1 ? event.data : null;
    const plan = planArrowInput(context, { typed, deleting: event.inputType === 'deleteContentBackward' }, previous);
    if (plan.steps.length === 0) return;
    event.preventDefault();
    applying = true;
    try {
      for (const [remove, insert] of plan.steps) {
        insertedRuns.add((caretTextContext(root)?.before ?? '').slice(-remove));
        selectBeforeCaret(root, remove);
        root.ownerDocument.execCommand('insertText', false, insert);
      }
      selectBeforeCaret(root, 0);
    } finally {
      applying = false;
    }
    const after = caretTextContext(root);
    if (plan.made !== undefined && after !== null) lastDrawn = { ...plan.made, node: after.node, at: after.at };
    // The surface hears the change through the input events the commands fired.
  };

  // Undoing an arrow selects what it put back; the caret goes after it instead.
  const onInput = (event: Event): void => {
    if (!(event instanceof InputEvent) || event.inputType !== 'historyUndo') return;
    const selection = root.ownerDocument.getSelection();
    if (selection && insertedRuns.has(selection.toString())) selection.collapseToEnd();
  };

  root.addEventListener('beforeinput', onBeforeInput);
  root.addEventListener('input', onInput);
  return () => {
    root.removeEventListener('beforeinput', onBeforeInput);
    root.removeEventListener('input', onInput);
  };
}

/* ------------------------------------------------------------------------ */
/* Paste and copy                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Inserts pasted (or dropped) plain text at the selection, cut to `room`
 * stored characters: as typed text, or as lines and lists when it has
 * list lines (see `planPaste`). Returns whether the text was cut.
 */
export function pastePlainText(root: HTMLElement, text: string, profile: TextProfile, room: number): boolean {
  const doc = root.ownerDocument;
  const plan = planPaste(text, profile, room, textBeforeCaret(doc) === '');
  if (plan.text === '') return plan.cut;
  if (plan.blocks === undefined) {
    doc.execCommand('insertText', false, plan.text);
    return plan.cut;
  }
  const block = (tag: string, content: string): HTMLElement => {
    const element = doc.createElement(tag);
    element.append(content === '' ? doc.createElement('br') : content);
    return element;
  };
  let line = 0;
  const elements = plan.blocks.map((part) => {
    if (part.kind === 'p') return block('div', plan.lines[line++] ?? '');
    line += part.items.length;
    const list = doc.createElement(part.kind);
    if (part.kind === 'ol' && part.start !== 1) list.setAttribute('start', String(part.start));
    list.append(...part.items.map((item) => block('li', item)));
    return list;
  });
  doc.execCommand('insertHTML', false, elements.map((element) => element.outerHTML).join(''));
  return plan.cut;
}

/** Copy and cut: plain text without link sources or arrow joiners (when that differs from the browser's). */
export function copyPlainSelection(event: ClipboardEvent, cut: boolean): void {
  const doc = (event.target as Node | null)?.ownerDocument ?? document;
  const selected = doc.getSelection()?.toString() ?? '';
  const plain = plainCopyText(selected);
  if (plain === selected || !event.clipboardData) return;
  event.preventDefault();
  event.clipboardData.setData('text/plain', plain);
  if (cut) doc.execCommand('delete');
}

/** Marks a selection inside them keeps when it is copied on its own. */
const INLINE_MARK_SELECTOR = `${BOLD_ELEMENT_SELECTOR},${ITALIC_ELEMENT_SELECTOR},a[data-href],code`;

/** The stored text of the part of the surface `range` covers, marks it sits inside included. */
function rangeStoredText(root: HTMLElement, range: Range, profile: TextProfile): string {
  const doc = root.ownerDocument;
  let holder = doc.createElement('div');
  holder.append(range.cloneContents());
  for (let at = elementOf(range.commonAncestorContainer); at && at !== root && root.contains(at); at = at.parentElement) {
    if (!at.matches(INLINE_MARK_SELECTOR)) continue;
    const mark = doc.createElement(at.tagName);
    for (const attribute of at.attributes) mark.setAttribute(attribute.name, attribute.value);
    mark.append(...holder.childNodes);
    holder = doc.createElement('div');
    holder.append(mark);
  }
  return serializeEditorText(holder, profile);
}

/**
 * Copy and cut in a formatted field: a selection with links or marks also
 * goes out as stored text and clean HTML (see `lib/rich-clipboard.ts`);
 * otherwise as {@link copyPlainSelection}.
 */
export function copyEditorSelection(event: ClipboardEvent, root: HTMLElement, profile: TextProfile, cut: boolean): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const stored = range && profile.marks === 'on' && root.contains(range.commonAncestorContainer) ? rangeStoredText(root, range, profile) : '';
  if (!event.clipboardData || !hasInlineFormat(stored)) {
    copyPlainSelection(event, cut);
    return;
  }
  event.preventDefault();
  event.clipboardData.setData('text/plain', plainCopyText(selection?.toString() ?? ''));
  event.clipboardData.setData('text/html', richClipboardHtml(stored));
  event.clipboardData.setData(RICH_TEXT_CLIPBOARD_TYPE, stored);
  if (cut) doc.execCommand('delete');
}

/**
 * Inserts stored text (copied from a formatted field) at the selection,
 * formatted. Returns `false` when it does not fit the field (it holds one
 * line, or has no marks), for the caller to paste it as plain text.
 */
export function pasteStoredText(root: HTMLElement, stored: string, profile: TextProfile): boolean {
  if (profile.marks !== 'on' || stored === '' || (profile.lines === 'one' && stored.includes('\n'))) return false;
  const doc = root.ownerDocument;
  const holder = doc.createElement('div');
  renderIntoEditor(holder, stored, profile);
  // The browser moves atomic chips out of the line it inserts into; they are locked again once in.
  for (const chip of holder.querySelectorAll('[contenteditable]')) chip.removeAttribute('contenteditable');
  // One paragraph goes in as inline content, so it joins the line at the caret.
  const only = holder.childElementCount === 1 && holder.firstElementChild?.tagName === 'DIV' ? holder.firstElementChild : holder;
  doc.execCommand('insertHTML', false, only.innerHTML);
  lockEditorLinks(root);
  return true;
}

/* ------------------------------------------------------------------------ */
/* Links                                                                    */
/* ------------------------------------------------------------------------ */

/** Makes every link of the surface an atomic chip, and moves a caret out of one. */
export function lockEditorLinks(root: HTMLElement): void {
  for (const link of root.querySelectorAll<HTMLElement>('a[data-href]:not([contenteditable="false"])')) {
    link.contentEditable = 'false';
    link.removeAttribute('style');
  }
  describeEditorLinks(root);
  const selection = root.ownerDocument.getSelection();
  const caretLink = elementOf(selection?.isCollapsed ? selection.anchorNode : null)?.closest('a[data-href]');
  if (caretLink && root.contains(caretLink)) placeCaretAfter(caretLink);
}

/** The text nodes a range touches, with the part of each it covers. */
function textRangesInSelection(root: HTMLElement, range: Range): Array<[Text, number, number]> {
  const ranges: Array<[Text, number, number]> = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : (node.nodeValue ?? '').length;
    if (end > start) ranges.push([node, start, end]);
  }
  return ranges;
}

/** The link chips a range covers, when every word it covers is in a link to the same place (else none). */
export function linksCoveringRange(root: HTMLElement, range: Range): HTMLElement[] {
  const links = new Set<HTMLElement | null>();
  for (const [node, start, end] of textRangesInSelection(root, range)) {
    if (/[^\s[\]]/.test((node.nodeValue ?? '').slice(start, end))) links.add(node.parentElement?.closest<HTMLElement>(LINK_CHIP_SELECTOR) ?? null);
  }
  const found = [...links].filter((link): link is HTMLElement => link !== null);
  return found.length === links.size && new Set(found.map((link) => link.dataset.href)).size === 1 ? found : [];
}

/** The run of chips linking to the same place as `link`, with only blanks between them. */
export function linkRunAround(root: HTMLElement, link: HTMLElement): HTMLElement[] {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  const links: Array<HTMLElement | null> = [];
  for (const [node] of textRangesInSelection(root, range)) {
    if (/[^\s[\]]/.test(node.nodeValue ?? '')) links.push(node.parentElement?.closest<HTMLElement>(LINK_CHIP_SELECTOR) ?? null);
  }
  const same = (other: HTMLElement | null | undefined): boolean => other != null && other.dataset.href === link.dataset.href;
  let first = links.indexOf(link);
  let last = links.lastIndexOf(link);
  if (first < 0) return [link];
  while (same(links[first - 1])) first--;
  while (same(links[last + 1])) last++;
  return [...new Set(links.slice(first, last + 1).filter((other): other is HTMLElement => other !== null))];
}

/** Every text node of the surface with its offset in the surface's text and its line. */
function textOffsets(root: HTMLElement): Array<{ node: Text; at: number; line: string }> {
  const offsets: Array<{ node: Text; at: number; line: string }> = [];
  const blocks: Array<Element | null> = [];
  const breaks = new Map<Element, HTMLBRElement[]>();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    let block: Element | null = node.parentElement;
    while (block !== null && block !== root && !BLOCK_TAG_PATTERN.test(block.tagName)) block = block.parentElement;
    if (block === root) block = null;
    if (!blocks.includes(block)) blocks.push(block);
    const container = block ?? root;
    const containerBreaks = breaks.get(container) ?? [...container.querySelectorAll('br')];
    breaks.set(container, containerBreaks);
    const text = node;
    const line = `${blocks.indexOf(block)}:${containerBreaks.filter((br) => (br.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).length}`;
    offsets.push({ node, at: offset, line });
    offset += (node.nodeValue ?? '').length;
  }
  return offsets;
}

/** The range between two offsets of the surface's text. */
function rangeFromTextOffsets(root: HTMLElement, start: number, end: number): Range {
  const range = root.ownerDocument.createRange();
  for (const { node, at } of textOffsets(root)) {
    const length = (node.nodeValue ?? '').length;
    if (start >= at && start < at + length) range.setStart(node, start - at);
    if (end > at && end <= at + length) range.setEnd(node, end - at);
  }
  return range;
}

/** The linkable spans (core `linkableTextSpans`, line by line) a range covers, as surface text offsets. */
function linkableSpansInRange(root: HTMLElement, range: Range): Array<[number, number]> {
  const selected = new Map(textRangesInSelection(root, range).map(([node, start, end]) => [node, [start, end] as const]));
  let text = '';
  const offsets: number[] = [];
  let lastLine: string | undefined;
  for (const entry of textOffsets(root)) {
    const [from, to] = selected.get(entry.node) ?? [0, 0];
    if (to <= from) continue;
    if (lastLine !== undefined && lastLine !== entry.line) {
      text += '\n';
      offsets.push(-1);
    }
    lastLine = entry.line;
    for (let index = from; index < to; index++) {
      text += (entry.node.nodeValue ?? '').charAt(index);
      offsets.push(entry.at + index);
    }
  }
  return linkableTextSpans(text).map(([start, end]) => [offsets[start] ?? 0, (offsets[end - 1] ?? 0) + 1]);
}

/** What linking a range to `href` adds to the stored text (for the cap). */
export function linkEditCostInRange(root: HTMLElement, range: Range, href: string): number {
  return linkEditCost(linkableSpansInRange(root, range).length, href);
}

/** Inserts a link chip for `text` at the selection; returns it. */
function insertEditorLink(root: HTMLElement, text: string, href: string): HTMLElement | undefined {
  const doc = root.ownerDocument;
  const link = doc.createElement('a');
  link.textContent = text;
  link.dataset.href = href;
  link.title = href;
  const before = new Set(root.querySelectorAll('a'));
  const beforeHtml = root.innerHTML;
  runEditCommand(doc, 'insertHTML', link.outerHTML);
  const inserted = [...root.querySelectorAll('a')].find((other) => !before.has(other));
  if (!inserted && root.innerHTML !== beforeHtml) runEditCommand(doc, 'undo');
  lockEditorLinks(root);
  if (inserted) placeCaretAfter(inserted);
  else doc.getSelection()?.collapseToEnd();
  return inserted;
}

/** Keeps a line's break when its whole text is replaced (the browser would drop the line). */
function keepTrailingLineBreak(node: Node, text: string): void {
  const doc = node.ownerDocument!;
  const line = elementOf(node)?.closest('li, div');
  if (!line || line.matches('[contenteditable="true"]')) return;
  const nested = [...line.children].find((child) => /^[UO]L$/.test(child.tagName)) ?? null;
  const range = doc.createRange();
  range.selectNodeContents(line);
  if (nested !== null) range.setEndBefore(nested);
  let lastNode = nested !== null ? nested.previousSibling : line.lastChild;
  while (lastNode?.nodeType === Node.TEXT_NODE && lastNode.nodeValue === '') lastNode = lastNode.previousSibling;
  if (range.toString() === text && lastNode?.nodeName !== 'BR') line.insertBefore(doc.createElement('br'), nested);
}

/** Selects a whole node. */
function selectWholeNode(node: Node): void {
  keepTrailingLineBreak(node, node.textContent ?? '');
  const range = node.ownerDocument!.createRange();
  range.selectNode(node);
  const selection = node.ownerDocument!.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Links the selection to `href`: each linkable span it covers (words, line
 * by line, never `[`, `]` or across lines) becomes a link chip, replacing
 * links it touches; with nothing to link, the address itself is inserted
 * as a link at the end of the selection. Returns whether a link was made.
 */
export function linkSelectionTo(href: string, doc: Document = document): boolean {
  const selection = doc.getSelection();
  const root = editableRootOf(selection?.anchorNode);
  if (!selection || selection.rangeCount === 0 || !root || !isLinkableHref(href)) return false;
  const range = selection.getRangeAt(0).cloneRange();
  const spans = linkableSpansInRange(root, range);
  if (spans.length === 0) {
    selection.collapseToEnd();
    const line = selection.anchorNode === root ? [...root.querySelectorAll('li, :scope > div')].at(-1) : undefined;
    if (line) selection.collapse(line, line.childNodes.length - (line.lastChild?.nodeName === 'BR' ? 1 : 0));
    return insertEditorLink(root, href, href) !== undefined;
  }
  for (const chip of [...root.querySelectorAll<HTMLElement>('[contenteditable="false"]')].filter((chip) => range.intersectsNode(chip))) {
    if (chip.isConnected) unlinkLink(chip);
  }
  let firstLink: HTMLElement | undefined;
  for (const [start, end] of spans.reverse()) {
    const span = rangeFromTextOffsets(root, start, end);
    if (/[[\]\n]/.test(span.toString())) continue;
    selection.removeAllRanges();
    selection.addRange(span);
    if (root.children.length === 1 && root.firstElementChild?.tagName === 'DIV') keepTrailingLineBreak(span.commonAncestorContainer, span.toString());
    firstLink ??= insertEditorLink(root, span.toString(), href);
  }
  if (firstLink?.isConnected === true) placeCaretAfter(firstLink);
  return firstLink !== undefined;
}

/** Points a link chip somewhere else. */
export function relinkLink(link: HTMLElement, href: string, doc: Document = document): boolean {
  const root = editableRootOf(link);
  if (!root || !isLinkableHref(href) || !/[^\s[\]]/.test(link.textContent ?? '')) return false;
  selectWholeNode(link);
  return /[[\]]/.test(link.textContent ?? '') ? linkSelectionTo(href, doc) : insertEditorLink(root, link.textContent ?? '', href) !== undefined;
}

/** Turns a link chip back into its text. */
export function unlinkLink(link: HTMLElement): void {
  selectWholeNode(link);
  runEditCommand(link.ownerDocument, 'insertText', link.textContent ?? '');
}

/** What the link field works on: the selection, the words to link and the links already there. */
export interface LinkTarget {
  /** The selection when the field opened (put back when it closes). */
  range: Range;
  /** The text to link: the selection, or the whole text at a caret outside links. */
  words: Range;
  /** The links being edited. */
  chips: HTMLElement[];
}

/** The links the selection is in or right after (with the run of chips to the same place). */
function selectedLinkChips(doc: Document): HTMLElement[] {
  const selection = doc.getSelection();
  const root = selection && selection.rangeCount > 0 ? editableRootOfRange(selection.getRangeAt(0)) : null;
  if (!selection || root === null) return [];
  const range = selection.getRangeAt(0);
  const covered = linksCoveringRange(root, range)[0];
  if (covered) return linkRunAround(root, covered);
  const chip = chipAtRange(range);
  return chip !== null ? linkRunAround(root, chip) : [];
}

/** The chip a range sits in, or a caret sits right after. */
function chipAtRange(range: Range): HTMLElement | null {
  const { commonAncestorContainer: ancestor, collapsed, startContainer, startOffset } = range;
  const before = !collapsed ? null : startContainer.nodeType === Node.ELEMENT_NODE ? startContainer.childNodes[startOffset - 1] : startOffset === 0 ? startContainer.previousSibling : null;
  return elementOf(ancestor)?.closest<HTMLElement>(LINK_CHIP_SELECTOR) ?? (before instanceof HTMLElement && before.matches(LINK_CHIP_SELECTOR) ? before : null);
}

/** The link chip a collapsed caret rests in or right after, else `null`. */
export function caretLinkChip(doc: Document = document): HTMLElement | null {
  const selection = doc.getSelection();
  if (!selection?.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return editableRootOfRange(range) !== null ? chipAtRange(range) : null;
}

/** The link the selection is in, covers or rests right after, else `null`. */
export function selectedLinkChip(doc: Document = document): HTMLElement | null {
  return selectedLinkChips(doc)[0] ?? null;
}

/** What the link field would work on now; `null` outside an editing surface. */
export function captureLinkTarget(doc: Document = document): LinkTarget | null {
  const selection = doc.getSelection();
  const root = selection && selection.rangeCount > 0 ? editableRootOfRange(selection.getRangeAt(0)) : null;
  if (!selection || root === null) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const chips = selectedLinkChips(doc);
  if (!range.collapsed || chips.length > 0) return { range, words: range, chips };
  const whole = doc.createRange();
  whole.selectNodeContents(root);
  return { range, words: whole, chips: linksCoveringRange(root, whole) };
}
