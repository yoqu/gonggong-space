/**
 * The board's tools: what a press on empty board does. Tool picks, their
 * single-key shortcuts (active only when the viewer turns them on) and the
 * shape tray's order.
 */

import { SHAPE_KIND_LABELS, type ShapeKind } from '@open-artifact/whiteboard-core';

/** Every tool. `shape` carries a kind in {@link ToolPick}. */
export type ToolName = 'select' | 'hand' | 'text' | 'note' | 'pen' | 'arrow' | 'sticker' | 'container' | 'shape' | 'table';

/** A tool choice: a tool, plus the shape kind for `shape`. */
export interface ToolPick {
  tool: ToolName;
  kind?: ShapeKind;
}

/** A single-key tool shortcut. */
export interface ToolShortcut extends ToolPick {
  /** `V`, `shift+T`… (letters compared case-insensitively). */
  key: string;
  label: string;
}

/** Tools a read-only viewer has. */
export const READ_ONLY_TOOLS: readonly ToolName[] = ['select', 'hand'];

/** Tools that type text where the person clicks. */
export const TEXT_BEARING_TOOLS: readonly ToolName[] = ['text', 'shape'];

/** Tools in the Draw tray. */
export const DRAW_TOOLS: readonly ToolName[] = ['pen', 'arrow'];

/** Single-key shortcuts, first match wins (the first entry per tool is the one shown). */
export const TOOL_SHORTCUTS: readonly ToolShortcut[] = [
  { key: 'V', tool: 'select', label: 'Select' },
  { key: 'H', tool: 'hand', label: 'Hand' },
  { key: 'T', tool: 'text', label: 'Text' },
  { key: 'S', tool: 'note', label: 'Note' },
  { key: 'P', tool: 'pen', label: 'Pen' },
  { key: 'E', tool: 'sticker', label: 'Sticker' },
  { key: 'A', tool: 'container', label: 'Section' },
  { key: 'R', tool: 'shape', kind: 'rounded', label: SHAPE_KIND_LABELS.rounded },
  { key: 'O', tool: 'shape', kind: 'ellipse', label: SHAPE_KIND_LABELS.ellipse },
  { key: 'D', tool: 'shape', kind: 'diamond', label: 'Diamond' },
  { key: 'L', tool: 'arrow', label: 'Arrow' },
  { key: 'shift+T', tool: 'table', label: 'Table' },
  { key: 'N', tool: 'note', label: 'Note' },
  { key: 'shift+L', tool: 'arrow', label: 'Arrow' },
  { key: 'X', tool: 'arrow', label: 'Arrow' },
  { key: 'F', tool: 'container', label: 'Section' },
  { key: 'shift+S', tool: 'container', label: 'Section' },
  { key: 'M', tool: 'pen', label: 'Pen' },
  { key: 'shift+P', tool: 'pen', label: 'Pen' },
];

/** The shortcut shown for a tool (when single keys are on). */
export function toolShortcutKey(tool: ToolName, keysOn: boolean, kind?: ShapeKind): string | undefined {
  return keysOn ? TOOL_SHORTCUTS.find((shortcut) => shortcut.tool === tool && shortcut.kind === kind)?.key : undefined;
}

/** The tool a key press picks, if single keys are on and the viewer may use it. */
export function toolShortcutOf(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>, options: { enabled: boolean; readOnly: boolean }): ToolShortcut | undefined {
  if (!options.enabled || event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const combo = (event.shiftKey ? 'shift+' : '') + event.key.toLowerCase();
  const shortcut = TOOL_SHORTCUTS.find((candidate) => candidate.key.toLowerCase() === combo);
  if (shortcut === undefined) return undefined;
  return !options.readOnly || READ_ONLY_TOOLS.includes(shortcut.tool) ? shortcut : undefined;
}

/** Shape kinds offered first in the Shapes tray (after Text). */
export const BASIC_SHAPE_KINDS: readonly ShapeKind[] = ['rounded', 'ellipse'];

/** The rest of the Shapes tray. */
export const MORE_SHAPE_KINDS: readonly ShapeKind[] = ['pill', 'diamond', 'rect', 'hexagon', 'parallelogram', 'database', 'queue', 'document', 'cloud', 'person'];

/** Tools grouped under the Shapes button (the section moves there on touch). */
export function shapesButtonTools(touch: boolean): readonly ToolName[] {
  return touch ? ['shape', 'table', 'container'] : ['shape', 'table'];
}

/** The pick a shape-tray entry makes (`text` is the text tool). */
export function toolPickForShapeKind(kind: ShapeKind | 'text'): ToolPick {
  return kind === 'text' ? { tool: 'text' } : { tool: 'shape', kind };
}

/** Same pick. */
export function samePick(a: ToolPick, b: ToolPick): boolean {
  return a.tool === b.tool && (a.tool !== 'shape' || a.kind === b.kind);
}

/** Alignment edges and their ⌥ shortcut letters. */
export const ALIGN_SHORTCUT_LETTERS = { left: 'A', hcenter: 'H', right: 'D', top: 'W', vcenter: 'V', bottom: 'S' } as const;

/** An alignment edge. */
export type AlignEdge = keyof typeof ALIGN_SHORTCUT_LETTERS;

/** The alignment a ⌥-letter press asks for. */
export function alignShortcutOf(event: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): AlignEdge | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  const letter = /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.code.replace('Key', '');
  return (Object.keys(ALIGN_SHORTCUT_LETTERS) as AlignEdge[]).find((edge) => ALIGN_SHORTCUT_LETTERS[edge] === letter);
}

/** Layer moves: one step or all the way. */
export type LayerMove = 'front' | 'back' | 'forward' | 'backward';

/**
 * The layer move a key press asks for: `]`/`[` (single keys on) to front or
 * back; ⌘]/⌘[ one step; ⌘⌥] / ⌘⌥[ (Ctrl+Shift on other platforms) all the way.
 */
export function layerOrderShortcutOf(event: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, keysOn: boolean): LayerMove | undefined {
  const bracket = event.key === ']' ? 1 : event.key === '[' ? -1 : 0;
  if (!event.metaKey && (!event.ctrlKey || event.altKey)) return bracket !== 0 && keysOn ? (bracket === 1 ? 'front' : 'back') : undefined;
  const bracketCode = event.code === 'BracketRight' ? 1 : event.code === 'BracketLeft' ? -1 : 0;
  if (event.metaKey ? event.altKey && !event.shiftKey : event.shiftKey) return bracketCode === 0 ? undefined : bracketCode === 1 ? 'front' : 'back';
  return bracket === 0 || event.shiftKey || event.altKey ? undefined : bracket === 1 ? 'forward' : 'backward';
}

/** The zoom a Shift+digit press asks for (single keys on). */
export function zoomShortcutOf(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, keysOn: boolean): 'actual' | 'board' | 'selection' | undefined {
  if (!keysOn || !event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return undefined;
  return event.code === 'Digit0' ? 'actual' : event.code === 'Digit1' ? 'board' : event.code === 'Digit2' ? 'selection' : undefined;
}

/** Platform key labels (`@open-artifact/editor-kit`). */
export { isApplePlatform, modKey } from '@open-artifact/editor-kit';
