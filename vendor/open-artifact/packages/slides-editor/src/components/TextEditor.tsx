/**
 * In-place text editing. While a text element (or a table cell) is being
 * typed into, the stage draws it through this editor instead of the normal
 * renderer: the same tag, classes and style, made contentEditable, with its
 * content owned by the browser rather than React. Typing is read back into
 * runs and saved as one coalesced undo step per editing session.
 */

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  DEFAULT_TEXT,
  normalizeRuns,
  pathKey,
  runsEqual,
  setCellRuns,
  updateNodeAt,
  type ListNode,
  type NodePath,
  type SlideNode,
  type TableNode,
  type TextBoxNode,
  type TextNode,
} from '@open-artifact/slides-core';
import { toReactStyle, withItemMargin } from '../render/css.ts';
import { useTextFit } from '../render/fit.ts';
import { RunsView, useRenderOptions } from '../render/SlideView.tsx';
import { blocksToHtml, indentItems, itemsToHtml, readBlocks, readItems, readRuns, runsToHtml } from '../lib/richtext.ts';
import { useView } from '../state/view.ts';
import { changeSlide } from '../services/commands.ts';

/* -------------------------------------------------------------------------- */
/* The active editor                                                           */
/* -------------------------------------------------------------------------- */

/** The element being typed into, for the format bar. */
let active: HTMLElement | null = null;
/** The selection inside it, kept while a format popover has the focus. */
let savedRange: Range | null = null;
/** Where the next editor puts the caret (client coordinates of the double click). */
let pendingCaret: { x: number; y: number } | null = null;

/** Sets where the next editing session puts the caret. */
export function setPendingCaret(point: { x: number; y: number } | null): void {
  pendingCaret = point;
}

/** The element being typed into, if any. */
export function activeEditor(): HTMLElement | null {
  return active && active.isConnected ? active : null;
}

/** Focuses the editor again with the selection it had when it lost the focus. */
export function focusEditor(): void {
  const el = activeEditor();
  if (!el) return;
  el.focus({ preventScroll: true });
  if (savedRange) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange);
  }
}

/** True when the selection inside the editor is collapsed (nothing selected). */
export function editorSelectionCollapsed(): boolean {
  const range = savedRange ?? (window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null);
  return !range || range.collapsed;
}

/** Runs a formatting command on the editor's selection. */
export function formatEditor(command: 'bold' | 'italic' | 'underline' | 'foreColor' | 'createLink' | 'unlink' | 'removeFormat', value?: string): void {
  const el = activeEditor();
  if (!el) return;
  focusEditor();
  document.execCommand('styleWithCSS', false, command === 'foreColor' ? 'true' : 'false');
  document.execCommand(command, false, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** True when the editor's selection has a mark. */
export function editorHasMark(command: 'bold' | 'italic' | 'underline'): boolean {
  if (!activeEditor()) return false;
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

/** Marks the card of the link the caret is in (`TextLinkCard`). */
export const LINK_CARD = 'data-open-artifact-link-card';

/** Moves the focus to the link card, when one is showing. */
function focusLinkCard(): boolean {
  const first = document.querySelector<HTMLElement>(`[${LINK_CARD}] button`);
  first?.focus();
  return Boolean(first);
}

/** True when a focus change stays within the editing session (format bar, its popovers, the link card). */
function staysInSession(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`[data-open-artifact-format-bar],[${LINK_CARD}]`));
}

/* -------------------------------------------------------------------------- */
/* Committing                                                                  */
/* -------------------------------------------------------------------------- */

/** Reads the edited element back into a node. Returns null when nothing changed. */
function readNode(node: SlideNode, el: HTMLElement, cell?: readonly [number, number]): SlideNode | null {
  switch (node.kind) {
    case 'text': {
      const runs = readRuns(el);
      return runsEqual(runs, node.runs) ? null : { ...node, runs };
    }
    case 'list': {
      const items = readItems(el);
      const same = items.length === node.items.length && items.every((item, i) => runsEqual(item.runs, node.items[i]!.runs) && (item.level ?? 0) === (node.items[i]!.level ?? 0));
      return same ? null : { ...node, items };
    }
    case 'textbox': {
      const blocks = readBlocks(el, node.blocks);
      const before = JSON.stringify(node.blocks);
      return JSON.stringify(blocks) === before ? null : { ...node, blocks };
    }
    case 'table': {
      if (!cell) return null;
      const target = el.querySelector<HTMLElement>(`[data-open-artifact-cell="${cell[0]}:${cell[1]}"]`);
      const current = node.rows[cell[0]]?.cells[cell[1]];
      if (!target || !current) return null;
      const runs = readRuns(target);
      return runsEqual(runs, current.runs) ? null : setCellRuns(node, cell[0], cell[1], normalizeRuns(runs));
    }
    default:
      return null;
  }
}

/** Saves the editor's content into the slide (one coalesced step per session). */
function commit(slideId: string, path: NodePath, el: HTMLElement, cell: readonly [number, number] | undefined, session: string): void {
  changeSlide(
    slideId,
    'Edit text',
    (slide) => {
      let changed = false;
      const next = updateNodeAt(slide, path, (node) => {
        const updated = readNode(node, el, cell);
        if (!updated) return node;
        changed = true;
        return updated;
      });
      return changed ? next : null;
    },
    { coalesce: session },
  );
}

/* -------------------------------------------------------------------------- */
/* The editor                                                                  */
/* -------------------------------------------------------------------------- */

/** Props of {@link TextEditor}. */
export interface TextEditorProps {
  node: TextNode | ListNode | TextBoxNode | TableNode;
  path: NodePath;
  slideId: string;
  cell?: readonly [number, number];
}

/** Places the caret: at the pending point, else selects placeholder text, else at the end. */
function placeCaret(el: HTMLElement, placeholder: boolean): void {
  const selection = window.getSelection();
  if (!selection) return;
  let range: Range | null = null;
  if (pendingCaret) {
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    const pos = doc.caretPositionFromPoint?.(pendingCaret.x, pendingCaret.y);
    if (pos && el.contains(pos.offsetNode)) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    } else {
      const legacy = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(pendingCaret.x, pendingCaret.y);
      if (legacy && el.contains(legacy.startContainer)) range = legacy;
    }
    pendingCaret = null;
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(el);
    if (!placeholder) range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Wires one contentEditable element: content, focus, input, keys and blur. */
function useEditable(
  ref: RefObject<HTMLElement | null>,
  props: TextEditorProps,
  html: () => string,
  options: { lineBreakOnEnter: boolean; placeholder: boolean },
): void {
  const { slideId, path, cell } = props;
  const session = useRef(`text:${slideId}:${pathKey(path)}:${cell?.join(':') ?? ''}:${Date.now()}`);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html();
    active = el;
    savedRange = null;
    el.focus({ preventScroll: true });
    placeCaret(el, options.placeholder);
    const flush = (): void => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      commit(slideId, path, el, cell, session.current);
    };
    const onInput = (): void => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 400);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        flush();
        useView.getState().endTextEdit();
        return;
      }
      if (event.key === 'Enter' && (options.lineBreakOnEnter || event.shiftKey) && !event.isComposing) {
        event.preventDefault();
        document.execCommand('insertLineBreak');
        return;
      }
      // Tab goes to the card of the link the caret is in, where Tab does not already nest items or move between cells.
      if (event.key === 'Tab' && !event.shiftKey && !event.isComposing && props.node.kind !== 'list' && props.node.kind !== 'table') {
        const list = window.getSelection()?.anchorNode?.parentElement?.closest('ul,ol');
        if (!(list && el.contains(list)) && focusLinkCard()) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === 'Tab' && !event.isComposing && (props.node.kind === 'list' || props.node.kind === 'textbox')) {
        // Tab / Shift+Tab nest list items (up to nine levels).
        const list = props.node.kind === 'list' ? el : (window.getSelection()?.anchorNode?.parentElement?.closest('ul,ol') as HTMLElement | null);
        if (list && el.contains(list) && indentItems(list, event.shiftKey ? -1 : 1)) {
          event.preventDefault();
          onInput();
        }
        return;
      }
      if (event.key === 'Tab' && cell && props.node.kind === 'table') {
        event.preventDefault();
        flush();
        const table = props.node;
        const cols = table.rows[0]?.cells.length ?? 1;
        const flat = cell[0] * cols + cell[1] + (event.shiftKey ? -1 : 1);
        const total = table.rows.length * cols;
        if (flat < 0 || flat >= total) {
          useView.getState().endTextEdit();
          return;
        }
        useView.getState().startTextEdit({ slideId, path, cell: [Math.floor(flat / cols), flat % cols] });
      }
    };
    const onPaste = (event: ClipboardEvent): void => {
      // Paste plain text only: formatting from elsewhere is not part of the subset.
      event.preventDefault();
      event.stopPropagation();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    };
    const onBlur = (event: FocusEvent): void => {
      const selection = window.getSelection();
      if (selection?.rangeCount && el.contains(selection.getRangeAt(0).startContainer)) savedRange = selection.getRangeAt(0).cloneRange();
      if (staysInSession(event.relatedTarget)) return;
      flush();
    };
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
    el.addEventListener('blur', onBlur);
    document.execCommand('defaultParagraphSeparator', false, 'p');
    return () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('paste', onPaste);
      el.removeEventListener('blur', onBlur);
      // The element may already be detached; its content is still readable.
      flush();
      if (active === el) active = null;
      savedRange = null;
    };
    // The editor mounts once per session; later model changes must not reset the typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const editableProps = {
  contentEditable: true,
  suppressContentEditableWarning: true,
  spellCheck: true,
  'data-open-artifact-editing': '',
} as const;

function TextNodeEditor(props: TextEditorProps & { node: TextNode }): ReactNode {
  const { node, path } = props;
  const ref = useRef<HTMLElement>(null);
  const options = useRenderOptions();
  // The content goes in first: fitting an editor that is still empty finds that it fits, and drops the fit.
  useEditable(ref, props, () => runsToHtml(node.runs), { lineBreakOnEnter: true, placeholder: runsText(node) === DEFAULT_TEXT });
  useTextFit(ref, node.fit, [node]);
  const Tag = node.tag;
  const style = toReactStyle(node.style, { resolveUrl: options.resolveSrc });
  return <Tag ref={ref as RefObject<HTMLHeadingElement>} className="open-artifact-text" data-open-artifact-path={pathKey(path)} data-open-artifact-kind="text" style={style} {...editableProps} />;
}

function ListEditor(props: TextEditorProps & { node: ListNode }): ReactNode {
  const { node, path } = props;
  const ref = useRef<HTMLElement>(null);
  const options = useRenderOptions();
  useEditable(ref, props, () => itemsToHtml(node), { lineBreakOnEnter: false, placeholder: false });
  useTextFit(ref, node.fit, [node]);
  const Tag = node.tag;
  return <Tag ref={ref as RefObject<never>} className="open-artifact-list" data-open-artifact-path={pathKey(path)} data-open-artifact-kind="list" style={withItemMargin(toReactStyle(node.style, { resolveUrl: options.resolveSrc }), node.itemMargin)} start={node.start} reversed={node.reversed} {...editableProps} />;
}

function TextBoxEditor(props: TextEditorProps & { node: TextBoxNode }): ReactNode {
  const { node, path } = props;
  const ref = useRef<HTMLDivElement>(null);
  const options = useRenderOptions();
  const placeholder = node.blocks.length === 1 && node.blocks[0]!.kind === 'text' && runsText(node.blocks[0]!) === DEFAULT_TEXT;
  useEditable(ref, props, () => blocksToHtml(node.blocks), { lineBreakOnEnter: false, placeholder });
  useTextFit(ref, node.fit, [node]);
  const style = toReactStyle(node.style, { resolveUrl: options.resolveSrc }) as CSSProperties & Record<string, string | number>;
  if (node.indent !== undefined) style['--open-artifact-indent'] = `${node.indent}px`;
  return <div ref={ref} className="open-artifact-textbox" data-open-artifact-path={pathKey(path)} data-open-artifact-kind="textbox" style={style} {...editableProps} />;
}

/** One table cell being typed into. */
function CellEditor(props: TextEditorProps & { node: TableNode; cell: readonly [number, number] }): ReactNode {
  const { node, cell } = props;
  const ref = useRef<HTMLTableCellElement>(null);
  const data = node.rows[cell[0]]!.cells[cell[1]]!;
  useEditable(ref, props, () => runsToHtml(data.runs), { lineBreakOnEnter: true, placeholder: false });
  const Cell = data.tag;
  return <Cell ref={ref} data-open-artifact-cell={`${cell[0]}:${cell[1]}`} style={toReactStyle(data.style)} {...editableProps} />;
}

function TableEditor(props: TextEditorProps & { node: TableNode }): ReactNode {
  const { node, path, cell } = props;
  const ref = useRef<HTMLDivElement>(null);
  const options = useRenderOptions();
  useTextFit(ref, node.fit, [node]);
  return (
    <div ref={ref} className="open-artifact-tablebox" data-open-artifact-path={pathKey(path)} data-open-artifact-kind="table" style={toReactStyle(node.style, { resolveUrl: options.resolveSrc })}>
      <table className="open-artifact-table">
        <tbody>
          {node.rows.map((row, r) => (
            <tr key={r} style={toReactStyle(row.style)}>
              {row.cells.map((c, k) => {
                if (cell && cell[0] === r && cell[1] === k) {
                  // Keyed per edited cell, so switching cells remounts (React never reuses browser-owned content).
                  return <CellEditor key={`edit-${r}-${k}`} {...props} node={node} cell={[r, k]} />;
                }
                const Cell = c.tag;
                return (
                  <Cell key={`view-${r}-${k}`} data-open-artifact-cell={`${r}:${k}`} style={toReactStyle(c.style)}>
                    <RunsView runs={c.runs} linkable={false} />
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function runsText(node: { runs: readonly { text: string }[] }): string {
  return node.runs.map((r) => r.text).join('');
}

/** Draws the node being edited. */
export function TextEditor(props: TextEditorProps): ReactNode {
  switch (props.node.kind) {
    case 'text':
      return <TextNodeEditor {...props} node={props.node} />;
    case 'list':
      return <ListEditor {...props} node={props.node} />;
    case 'textbox':
      return <TextBoxEditor {...props} node={props.node} />;
    case 'table':
      return <TableEditor {...props} node={props.node} />;
  }
}
