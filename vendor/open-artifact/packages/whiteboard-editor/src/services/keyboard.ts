/**
 * Board keyboard shortcuts. {@link installKeyboard} listens on the window
 * and maps keys to the shared commands:
 *
 * - ⌘Z / ⇧⌘Z / ⌘Y undo and redo; ⌘A selects all; ⌘D duplicates;
 *   Delete / Backspace deletes.
 * - ⌘G / ⇧⌘G group and ungroup; ⇧⌘L locks or unlocks; ⌥A/H/D/W/V/S align;
 *   ] / [ and ⌘] / ⌘[ change the layer order.
 * - ⌘B / ⌘I bold or italicize the whole text of the selected notes,
 *   shapes and texts (`text-marks.ts`).
 * - ⌘F opens the find bar; while it is open ⌘G / ⇧⌘G steps through matches
 *   unless items are selected (then it groups), F3 / ⇧F3 always
 *   (`find/FindBar.tsx`).
 * - C (single keys on) toggles comment mode; the Menu key or ⇧F10 opens
 *   the context menu. (⌘K, which asks the agent, belongs to the Ask panel.)
 * - ⇧0 / ⇧1 / ⇧2 (single keys on) zoom to 100%, the board or the selection;
 *   ⌘0 fits the board; ⌘= / ⌘- zoom in and out.
 * - Arrows nudge the selection (⇧: ×10) or pan the view when nothing is
 *   selected; ⌥← / ⌥→ turn it (⇧: by 1°).
 * - Tab / ⇧Tab walk the board in reading order (Home / End jump to the
 *   ends) and bring each item into view.
 * - Enter or F2 edits the selected item (opens a link card). Enter on a
 *   video plays or pauses it; on an embed it uses it instead (its frame gets the keyboard until Escape inside
 *   it), or runs one stopped for taking the keyboard again. Enter on a
 *   group selected as a whole steps into it; ⇧Enter selects the group
 *   around the item (`group-keys.ts`). With nothing selected and a placing
 *   tool armed, Enter places one in the middle of the view.
 * - Escape leaves editing, then the selection, then the tool; from a
 *   control in one of the page's bars it also brings focus back to the
 *   board. An expanded control (its menu is open) and a toast keep their
 *   Escape.
 * - ⌘Z while a picture is cropped cancels the crop (`crop.ts`).
 * - Space held is the hand; single letters pick tools when they are on.
 *
 * Keys are left alone while text is being typed (inputs, text areas,
 * contenteditable) and inside chrome popups (`[data-wb-chrome]` menus and
 * dialogs), which handle their own keys. Undo is held back only in text
 * fields and selects: a number field with nothing typed since its last
 * commit (`data-wb-committed`) lets it reach the board.
 */

import { isElementLocked, orderElementsForReading, tableColumnIds, tableRowIds, type BoardElement, type ElementId } from '@open-artifact/whiteboard-core';
import { panBy, type Point } from '../lib/camera.ts';
import { alignShortcutOf, layerOrderShortcutOf, toolShortcutOf, zoomShortcutOf } from '../lib/tools.ts';
import { embedEnterAction, enterEmbed, focusBoardHome, runEmbedAgain } from '../elements/embed-control.ts';
import { toggleVideo } from '../elements/video-playback.ts';
import { openLink } from './link-card.ts';
import { describeElement } from '../elements/describe.ts';
import { markShortcutOf } from '../elements/mark-across.ts';
import { useContextMenu } from '../selection/menu-store.ts';
import { useInteraction } from '../selection/store.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { usePreferences } from '../state/preferences.ts';
import { useSelection, type TextEditTarget } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { createNoteAt, createShapeAt, createTableAt, createTextAt, placeElement } from '../tools/place.ts';
import { placeSticker } from '../tools/sticker.ts';
import {
  alignSelectionTo,
  arrangeSelection,
  boardElements,
  canEditBoard,
  deleteSelection,
  duplicateSelectionNow,
  groupSelection,
  nudgeSelection,
  rotateSelectionBy,
  selectAll,
  selectedIds,
  toggleLockSelection,
  ungroupSelection,
} from './actions.ts';
import { NOTHING_SELECTED_MESSAGE, announce, groupSelectedMessage, selectionCountMessage, toolNameMessage } from './announce.ts';
import { redo, undo } from './commands.ts';
import { cancelCrop } from './crop.ts';
import { toggleSelectionMark } from './text-marks.ts';
import { maybeSession } from './session.ts';
import { groupKeyStep } from './group-keys.ts';
import { contentBounds, fitBoard, fitSelection, revealElements, viewCenter } from './navigation.ts';
import { setCamera, zoomStep, zoomTo } from './viewport.ts';

/* ------------------------------------------------------------------------ */
/* Pure key readers                                                         */
/* ------------------------------------------------------------------------ */

/** The parts of a key event the readers look at. */
export interface KeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Whether a modifier such as `AltGraph` is held (a key event has it). */
  getModifierState?(key: string): boolean;
}

/** True when `event` is the letter (by key, or by physical key on non-Latin layouts). */
function isLetter(event: Pick<KeyPress, 'key' | 'code'>, letter: string): boolean {
  return event.key.toLowerCase() === letter || event.code === 'Key' + letter.toUpperCase();
}

/** The primary modifier (⌘ or Ctrl) is down. */
function hasMod(event: Pick<KeyPress, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey;
}

/** ⌘Z undoes; ⇧⌘Z, ⌘Y and Ctrl+Y redo. */
export function undoKeyCommand(event: KeyPress): 'undo' | 'redo' | undefined {
  if (!hasMod(event) || event.altKey) return undefined;
  if (isLetter(event, 'z')) return event.shiftKey ? 'redo' : 'undo';
  if (isLetter(event, 'y') && !event.shiftKey) return 'redo';
  return undefined;
}

/** ⌘G groups; ⇧⌘G ungroups. */
export function groupingKeyCommand(event: KeyPress): 'group' | 'ungroup' | undefined {
  if (!hasMod(event) || event.altKey || !isLetter(event, 'g')) return undefined;
  return event.shiftKey ? 'ungroup' : 'group';
}

/** ⇧⌘L locks or unlocks. */
export function isLockShortcut(event: KeyPress): boolean {
  return hasMod(event) && event.shiftKey && !event.altKey && isLetter(event, 'l');
}

/** ⌘D duplicates. */
export function isDuplicateShortcut(event: KeyPress): boolean {
  return hasMod(event) && !event.shiftKey && !event.altKey && isLetter(event, 'd');
}

/** ⌘A selects everything. */
export function isSelectAllShortcut(event: KeyPress): boolean {
  return hasMod(event) && !event.shiftKey && !event.altKey && isLetter(event, 'a');
}

/** The Menu key or ⇧F10 opens the context menu. */
export function isContextMenuKey(event: Pick<KeyPress, 'key' | 'shiftKey'>): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/** C (single keys on, no modifiers) toggles comment mode. */
export function isCommentModeShortcut(event: KeyPress, keysOn: boolean): boolean {
  return keysOn && !hasMod(event) && !event.altKey && !event.shiftKey && isLetter(event, 'c');
}

/** ⌥← / ⌥→ turn by 15°, or by 1° with ⇧; `undefined` for other keys. */
export function rotationKeyStep(event: KeyPress): number | undefined {
  if (!event.altKey || hasMod(event)) return undefined;
  const way = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  return way === 0 ? undefined : way * (event.shiftKey ? 1 : 15);
}

/** The unit direction of an arrow key, if it is one. */
export function arrowKeyDirection(key: string): readonly [number, number] | undefined {
  switch (key) {
    case 'ArrowLeft':
      return [-1, 0];
    case 'ArrowRight':
      return [1, 0];
    case 'ArrowUp':
      return [0, -1];
    case 'ArrowDown':
      return [0, 1];
    default:
      return undefined;
  }
}

/** The board offset an arrow key nudges by (1, or 10 with ⇧); `undefined` for other keys or with modifiers. */
export function nudgeOffset(event: KeyPress): { dx: number; dy: number } | undefined {
  if (hasMod(event) || event.altKey) return undefined;
  const direction = arrowKeyDirection(event.key);
  if (!direction) return undefined;
  const step = event.shiftKey ? 10 : 1;
  return { dx: direction[0] * step, dy: direction[1] * step };
}

/** What a zoom key asks for: ⇧0 / ⇧1 / ⇧2 (single keys on), ⌘0, ⌘= / ⌘+ and ⌘-; nothing with AltGraph held. */
export function zoomKeyCommand(event: KeyPress, keysOn: boolean): 'actual' | 'board' | 'selection' | 'fit' | 'in' | 'out' | undefined {
  if (event.getModifierState?.('AltGraph') === true) return undefined;
  const preset = zoomShortcutOf(event, keysOn);
  if (preset) return preset;
  if (!hasMod(event) || event.altKey) return undefined;
  if (event.key === '0' || (event.code === 'Digit0' && !event.shiftKey)) return 'fit';
  if (event.key === '=' || event.key === '+' || event.code === 'Equal' || event.code === 'NumpadAdd') return 'in';
  if (event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract') return 'out';
  return undefined;
}

/**
 * The next item when walking the reading order from the selection: the one
 * after (or before, `backwards`) the selected item furthest along that way,
 * the first (or last) when nothing in the order is selected, and
 * `undefined` past either end (focus leaves the board).
 */
export function nextInReadingOrder(order: readonly ElementId[], selected: readonly ElementId[], backwards: boolean): ElementId | undefined {
  if (order.length === 0) return undefined;
  const positions = selected.map((id) => order.indexOf(id)).filter((index) => index >= 0);
  if (positions.length === 0) return backwards ? order.at(-1) : order[0];
  const from = backwards ? Math.min(...positions) : Math.max(...positions);
  return order[from + (backwards ? -1 : 1)];
}

/** True when a DOM node takes typing (its keys belong to the text, not the board). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]') !== null;
}

/** What {@link fieldTakesUndo} reads of the focused element. */
export interface FieldFacts {
  /** Lower-case tag name. */
  tag: string;
  /** An input's `type` (lower case; `''` for none). */
  type: string;
  role: string | null;
  /** Content-editable, or a text box by role. */
  editable: boolean;
  /** A number field with nothing typed since its value was last committed. */
  committed: boolean;
}

/** Input types that take text (their undo is the browser's). */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password']);

/** Whether the board's undo may run with focus on this element: everywhere but text fields, selects and number fields being typed in. */
export function fieldTakesUndo(field: FieldFacts): boolean {
  if (field.editable || field.tag === 'textarea' || field.tag === 'select') return false;
  if (field.tag !== 'input') return true;
  if (field.role === 'spinbutton' || field.type === 'number') return field.committed;
  return !TEXT_INPUT_TYPES.has(field.type);
}

/** {@link FieldFacts} of a DOM node (the typing target itself, or the field it is in). */
function fieldFactsOf(target: EventTarget | null): FieldFacts | undefined {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return undefined;
  const field = target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]');
  if (field === null) return undefined;
  return {
    tag: field.tagName.toLowerCase(),
    type: field instanceof HTMLInputElement ? (field.getAttribute('type') ?? '').toLowerCase() : '',
    role: field.getAttribute('role'),
    editable: field.matches('[contenteditable=""], [contenteditable="true"], [role="textbox"]'),
    committed: field.hasAttribute('data-wb-committed'),
  };
}

/** Whether Escape on a DOM node belongs to it: an expanded control (its menu is open) or a toast. */
export function keepsOwnEscape(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return target.closest('[aria-expanded="true"], [data-toast]') !== null;
}

/** Whether a DOM node is in one of the page's bars (an F6 region other than the board). */
function inPageBar(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const region = target.closest('[data-wb-region]');
  return region !== null && region.getAttribute('data-wb-region') !== 'canvas';
}

/** True when a DOM node is inside a chrome popup (a menu, popover or dialog that handles its own keys). */
export function isChromePopupTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const popup = target.closest('[role="menu"], [role="menubar"], [role="dialog"], [role="listbox"], [role="radiogroup"], [data-wb-popup]');
  return popup !== null && popup.closest('[data-wb-chrome]') !== null;
}

/** True when a DOM node is a chrome control (its Enter, Space, Tab and arrows stay native). */
export function isChromeTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return target.closest('[data-wb-chrome]') !== null;
}

/* ------------------------------------------------------------------------ */
/* Arrow-key panning                                                        */
/* ------------------------------------------------------------------------ */

/** Screen pixels per second while an arrow key pans the view (×3 with ⇧). */
export const ARROW_PAN_SPEED = 800;

/** Pans the view smoothly while arrow keys are held. */
function createArrowPanner(): { press(code: string, key: string, fast: boolean): void; release(code: string): void; stop(): void } {
  const held = new Map<string, { way: readonly [number, number]; fast: boolean }>();
  let frame: number | undefined;
  let last = 0;
  const step = (time: number): void => {
    const elapsed = Math.max(0, Math.min(time - last, 50)) / 1000;
    last = time;
    let dx = 0;
    let dy = 0;
    for (const entry of held.values()) {
      const distance = (entry.fast ? ARROW_PAN_SPEED * 3 : ARROW_PAN_SPEED) * elapsed;
      dx += entry.way[0] * distance;
      dy += entry.way[1] * distance;
    }
    if (dx !== 0 || dy !== 0) setCamera(panBy(useCamera.getState().camera, -dx, -dy));
    frame = held.size > 0 ? requestAnimationFrame(step) : undefined;
  };
  return {
    press(code, key, fast) {
      const way = arrowKeyDirection(key);
      if (!way) return;
      held.set(code, { way, fast });
      if (frame === undefined) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    },
    release(code) {
      held.delete(code);
    },
    stop() {
      held.clear();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Commands the keys run                                                    */
/* ------------------------------------------------------------------------ */

/** What editing a selected element's words starts (`undefined`: it has none, or cannot be edited). */
export function editTargetFor(element: BoardElement): TextEditTarget | undefined {
  switch (element.type) {
    case 'note':
    case 'shape':
    case 'text':
    case 'container':
    case 'html':
      return { kind: 'element', id: element.id };
    case 'arrow':
      return { kind: 'arrow-label', id: element.id };
    case 'table': {
      const row = tableRowIds(element)[0];
      const col = tableColumnIds(element)[0];
      return row !== undefined && col !== undefined ? { kind: 'cell', id: element.id, row, col } : undefined;
    }
    default:
      return undefined;
  }
}

/** Selects one item, brings it into view and says what it is. */
export function focusItem(id: ElementId): void {
  const state = useBoard.getState();
  const element = state.byId.get(id);
  if (!element) return;
  useSelection.getState().select([id]);
  revealElements([element]);
  announce(describeElement(element, state.byId, currentMeasures()));
}

/** Walks the reading order; `false` past either end (the key then does its native thing). */
function walkReadingOrder(backwards: boolean): boolean {
  const order = orderElementsForReading(boardElements(), currentMeasures()).map((element) => element.id);
  const next = nextInReadingOrder(order, useSelection.getState().ids, backwards);
  if (next === undefined) {
    if (useSelection.getState().ids.length > 0) useSelection.getState().clear();
    return false;
  }
  focusItem(next);
  return true;
}

/** Jumps to the first or last item in reading order. */
function jumpReadingOrder(last: boolean): boolean {
  const order = orderElementsForReading(boardElements(), currentMeasures());
  const target = last ? order.at(-1) : order[0];
  if (!target) return false;
  focusItem(target.id);
  return true;
}

/** What Enter (`enter`), or F2, does to an item selected alone. */
export type ItemKeyAction = 'open' | 'play' | 'use' | 'run-again' | 'edit';

/**
 * What Enter (`enter`) or F2 does to an item selected alone: open a link
 * card; on Enter, play or pause a video, use an embed that runs or run one stopped for taking the
 * keyboard again (on any board, even locked); edit its words (`editable`
 * board, unlocked); or nothing.
 */
export function itemKeyAction(element: BoardElement, enter: boolean, editable: boolean): ItemKeyAction | undefined {
  if (element.type === 'link') return 'open';
  if (element.type === 'image' && element.video !== undefined && enter) return 'play';
  if (element.type === 'html' && enter) {
    const embed = embedEnterAction(element);
    if (embed !== undefined) return embed;
  }
  if (!editable || isElementLocked(element) || editTargetFor(element) === undefined) return undefined;
  return 'edit';
}

/** Enter / F2 on an item selected alone: does its {@link itemKeyAction}. */
function actOnSelection(enter: boolean): boolean {
  const ids = selectedIds();
  if (ids.size !== 1) return false;
  const [id] = ids;
  const element = id === undefined ? undefined : useBoard.getState().byId.get(id);
  if (!element) return false;
  switch (itemKeyAction(element, enter, canEditBoard())) {
    case 'open':
      if (element.type === 'link') openLink(element.href);
      return true;
    case 'play':
      toggleVideo(element.id);
      return true;
    case 'use':
      return enterEmbed(element.id);
    case 'run-again':
      runEmbedAgain(element.id);
      return true;
    case 'edit': {
      const target = editTargetFor(element);
      if (!target) return false;
      useSelection.getState().edit(target);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Enter / ⇧Enter / F2 on the selection: first steps into or out of groups
 * (`group-keys.ts`; not in comment mode), then acts on the item selected
 * alone.
 */
function enterSelection(event: KeyboardEvent): boolean {
  const enter = event.key === 'Enter';
  if (!useTool.getState().commentMode) {
    const byId = useBoard.getState().byId;
    const ids = useSelection.getState().ids.filter((id) => byId.has(id));
    const focus = ids[0] === undefined ? undefined : byId.get(ids[0]);
    const acts = focus !== undefined && itemKeyAction(focus, enter, canEditBoard()) !== undefined;
    const step = groupKeyStep(boardElements(), ids, { enter, shift: event.shiftKey, repeat: event.repeat, acts });
    if (step !== undefined) {
      if ('select' in step) useSelection.getState().select([...step.select]);
      if (step.done) {
        if ('announce' in step) announce(step.announce === 'group' ? groupSelectedMessage(step.select.size) : selectionCountMessage(1));
        return true;
      }
    }
  }
  return actOnSelection(enter);
}

/** Enter with a placing tool armed: places one in the middle of the view. */
function placeWithTool(): boolean {
  const tool = useTool.getState();
  const center = viewCenter();
  switch (tool.tool) {
    case 'note':
      return placeElement(createNoteAt(center), { label: 'Add note' });
    case 'text':
      return placeElement(createTextAt(center), { label: 'Add text' });
    case 'shape':
      return placeElement(createShapeAt(tool.shapeKind, center), { label: 'Add shape' });
    case 'table':
      return placeElement(createTableAt(center), { label: 'Add table' });
    case 'sticker':
      return tool.sticker !== undefined && placeSticker(tool.sticker, center) !== undefined;
    default:
      return false;
  }
}

/** Escape: leaves editing, then cropping, then the selection, then the tool or comment mode. */
function escapeStep(): boolean {
  const selection = useSelection.getState();
  if (selection.editing !== null) {
    selection.edit(null);
    return true;
  }
  if (selection.cropping !== null) {
    selection.setCropping(null);
    return true;
  }
  if (selection.ids.length > 0) {
    selection.clear();
    announce(NOTHING_SELECTED_MESSAGE);
    return true;
  }
  const tool = useTool.getState();
  if (tool.commentMode) {
    tool.setCommentMode(false);
    return true;
  }
  if (tool.tool !== 'select') {
    tool.pick({ tool: 'select' });
    announce(toolNameMessage('Select'));
    return true;
  }
  return false;
}

/** Opens the context menu from the keyboard: at the selection, else in the middle of the view. */
export function openContextMenuFromKeyboard(): void {
  const camera = useCamera.getState();
  const surface = typeof document !== 'undefined' ? document.querySelector('.wb-surface') : null;
  const rect = surface?.getBoundingClientRect();
  const left = rect?.left ?? 0;
  const top = rect?.top ?? 0;
  const selected = boardElements().filter((element) => selectedIds().has(element.id));
  const bounds = selected.length > 0 ? contentBounds(selected) : undefined;
  const boardPoint: Point = bounds ? { x: bounds.x + Math.min(40 / camera.camera.zoom, bounds.w / 2), y: bounds.y + Math.min(24 / camera.camera.zoom, bounds.h / 2) } : viewCenter();
  const screen = { x: (boardPoint.x - camera.camera.x) * camera.camera.zoom, y: (boardPoint.y - camera.camera.y) * camera.camera.zoom };
  const clamp = (value: number, size: number): number => Math.min(Math.max(value, 8), Math.max(8, size - 8));
  const at = { x: left + clamp(screen.x, camera.width), y: top + clamp(screen.y, camera.height) };
  useContextMenu.getState().show({ at, kind: selected.length > 0 ? 'items' : 'board', board: boardPoint });
}

/** ⌘A and the menu's Select all: every unlocked item (every item on a read-only board). */
export function selectEverything(): void {
  if (canEditBoard()) {
    selectAll();
    return;
  }
  const ids = boardElements().map((element) => element.id);
  useSelection.getState().select(ids);
  announce(selectionCountMessage(ids.length));
}

/* ------------------------------------------------------------------------ */
/* Install                                                                  */
/* ------------------------------------------------------------------------ */

/** Installs the board's keyboard shortcuts; returns a function that removes them. */
export function installKeyboard(): () => void {
  if (typeof window === 'undefined') return () => {};
  const panner = createArrowPanner();

  const releaseHand = (): void => {
    useTool.getState().setHandOverride(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target;
    const selection = useSelection.getState();
    const history = undoKeyCommand(event);
    const field = fieldFactsOf(target);
    const undoHeld = field !== undefined && !fieldTakesUndo(field);

    if (history === 'undo' && selection.cropping !== null && selection.editing === null && !undoHeld) {
      event.preventDefault();
      cancelCrop();
      return;
    }

    // Text being typed keeps its keys (⌘D still must not bookmark the page).
    if ((isTypingTarget(target) && (history === undefined || undoHeld)) || selection.editing !== null) {
      if (isDuplicateShortcut(event)) event.preventDefault();
      if (event.key === 'Escape' && selection.editing !== null && !isTypingTarget(target)) {
        selection.edit(null);
        event.preventDefault();
      }
      return;
    }
    // A committed number field in a popup still hands undo to the board.
    if (isChromePopupTarget(target) && !(history !== undefined && field !== undefined)) return;
    const onChrome = isChromeTarget(target);
    const keysOn = usePreferences.getState().letterKeys;
    const editable = canEditBoard();
    const run = (done: boolean | void = true): void => {
      if (done !== false) event.preventDefault();
    };

    if (history) {
      run();
      if (history === 'undo') undo();
      else redo();
      return;
    }
    const mark = markShortcutOf(event);
    if (mark && toggleSelectionMark(mark, event.repeat)) {
      run();
      return;
    }
    if (isContextMenuKey(event)) {
      run();
      openContextMenuFromKeyboard();
      return;
    }
    if (isSelectAllShortcut(event)) {
      run();
      selectEverything();
      return;
    }
    if (isDuplicateShortcut(event)) {
      run();
      if (!event.repeat && selection.ids.length > 0) duplicateSelectionNow();
      return;
    }
    const grouping = groupingKeyCommand(event);
    if (grouping) {
      run();
      if (grouping === 'group') groupSelection();
      else ungroupSelection();
      return;
    }
    if (isLockShortcut(event)) {
      if (selection.ids.length === 0) return;
      run();
      toggleLockSelection();
      return;
    }
    const edge = alignShortcutOf(event);
    if (edge && selection.ids.length > 0) {
      run();
      alignSelectionTo(edge);
      return;
    }
    const layer = layerOrderShortcutOf(event, keysOn);
    if (layer && selection.ids.length > 0) {
      run();
      arrangeSelection(layer);
      return;
    }
    const zoom = zoomKeyCommand(event, keysOn);
    if (zoom) {
      run();
      if (zoom === 'actual') zoomTo(1);
      else if (zoom === 'board' || zoom === 'fit') fitBoard();
      else if (zoom === 'selection') fitSelection();
      else zoomStep(zoom === 'in' ? 1 : -1);
      return;
    }

    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        if (hasMod(event) || event.altKey || selection.ids.length === 0) return;
        run();
        if (!event.repeat) deleteSelection();
        return;
      case 'Escape': {
        if (keepsOwnEscape(target)) return;
        const stepped = escapeStep();
        if (inPageBar(target)) {
          focusBoardHome();
          run();
        } else if (stepped) run();
        return;
      }
      case 'Enter':
      case 'F2':
        if (onChrome || hasMod(event) || event.altKey) return;
        if (selection.ids.length > 0) run(enterSelection(event));
        else if (event.key === 'Enter' && editable) run(placeWithTool());
        return;
      case 'Tab':
        if (onChrome || hasMod(event) || event.altKey) return;
        run(walkReadingOrder(event.shiftKey));
        return;
      case 'Home':
      case 'End':
        if (onChrome || hasMod(event) || event.altKey || event.shiftKey) return;
        run(jumpReadingOrder(event.key === 'End'));
        return;
      case ' ':
        if (onChrome || hasMod(event) || event.altKey) return;
        run();
        if (useInteraction.getState().transform === null) useTool.getState().setHandOverride(true);
        return;
      default:
        break;
    }

    if (arrowKeyDirection(event.key) && !onChrome) {
      const turn = rotationKeyStep(event);
      if (turn !== undefined) {
        if (selection.ids.length === 0 || !editable) return;
        run();
        rotateSelectionBy(turn, 'turn-keys');
        return;
      }
      const nudge = nudgeOffset(event);
      if (!nudge) return;
      run();
      if (selection.ids.length === 0 || !editable) panner.press(event.code, event.key, event.shiftKey);
      else nudgeSelection(nudge.dx, nudge.dy, 'nudge-keys');
      return;
    }

    if (isCommentModeShortcut(event, keysOn)) {
      const session = maybeSession();
      if (!session?.comments || !session.canComment) return;
      run();
      const tool = useTool.getState();
      if (session.shell) session.shell.requestCommentMode(!tool.commentMode);
      else tool.setCommentMode(!tool.commentMode);
      return;
    }

    const shortcut = toolShortcutOf(event, { enabled: keysOn, readOnly: !editable });
    if (shortcut) {
      run();
      const tool = useTool.getState();
      const same = tool.tool === shortcut.tool && (shortcut.tool !== 'shape' || shortcut.kind === undefined || shortcut.kind === tool.shapeKind);
      if (same && shortcut.tool !== 'select') {
        tool.pick({ tool: 'select' });
        announce(toolNameMessage('Select'));
        return;
      }
      if (shortcut.tool === 'sticker') tool.armSticker(tool.sticker);
      else tool.pick(shortcut.kind !== undefined ? { tool: shortcut.tool, kind: shortcut.kind } : { tool: shortcut.tool });
      announce(toolNameMessage(shortcut.label));
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') releaseHand();
    if (arrowKeyDirection(event.key)) panner.release(event.code);
  };
  const onBlur = (): void => {
    releaseHand();
    panner.stop();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') onBlur();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    onBlur();
  };
}
