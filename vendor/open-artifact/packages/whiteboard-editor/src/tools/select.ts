/**
 * The Select tool's press: pick what is under the pointer (or the section
 * around an empty spot), move it (snapping to neighbours, carrying stickers
 * on moving hosts and free arrow ends; ⌥ drags a copy, ⌘ moves freely),
 * rubber-band select on empty board (Shift toggles; ⌘ asks the agent about
 * the area), and double-tap: into a group, into an item's words, into an
 * image's crop, open a link, or new text on empty board. A click on a link
 * opens it (see `services/link-card.ts`).
 *
 * Moves write the board on every frame under one coalesced undo step.
 */

import {
  applyMoveDrag,
  carriedArrowEnds,
  collectMovingSet,
  elementBounds,
  expandSelectionToGroups,
  groupSelectionFor,
  hitSlop,
  isElementLocked,
  marqueeSelection,
  outermostGroupOf,
  showsTextPlaceholder,
  snapRectToGuidesStraight,
  straightDragAxis,
  tableColumnIds,
  tableRowIds,
  topLevelSelectedIds,
  unionBounds,
  withoutLockedIds,
  withoutLockedIdsUnlessAll,
  type BoardElement,
  type Box,
  type CarriedArrowEnds,
  type ElementId,
} from '@open-artifact/whiteboard-core';
import type { Point, Rect } from '../lib/camera.ts';
import { announce, duplicatedMessage, movedMessage } from '../services/announce.ts';
import { boardElements, canEditBoard, duplicateIds, editContent, selectedIds } from '../services/actions.ts';
import { cancelPendingLinkOpen, clickBoardLink, openLink } from '../services/link-card.ts';
import { useAsk } from '../state/ask.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { useInteraction } from '../selection/store.ts';
import { setLiftedElements } from '../elements/view-state.ts';
import { videoClickedRecently } from '../elements/video-playback.ts';
import { gestureKey, pastThreshold, type Gesture, type PointerSample } from './gesture.ts';
import { panGesture } from './hand.ts';
import { containerAtPoint, hitContext, pressTargetAt, type HitContext } from './hit.ts';
import { DOUBLE_TAP, MARQUEE_START_SLOP_PX, createTextAt, placeElement } from './place.ts';
import { guideLines, snapCandidatesNear, snapDistanceFor, stillBoxes } from './snap.ts';
import { TOUCH_LONG_PRESS_MS, isQuickTap, reduceTouchPress, type TouchPress } from './touch.ts';

/* ------------------------------------------------------------------------ */
/* Shared bits                                                              */
/* ------------------------------------------------------------------------ */

/** True when the event asks for the platform's primary modifier (⌘ on Apple platforms, Ctrl elsewhere). */
export function hasModifier(event: Pick<PointerEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey;
}

/** True when a DOM node takes typing (the press belongs to the text, not to the board). */
export function isTypingTarget(node: Element | null): boolean {
  return node?.closest('[contenteditable="true"],[contenteditable=""],input,textarea,select') != null;
}

/** Ends in-place typing elsewhere: blurs the editor so it commits, then clears the editing state. */
export function stopTyping(): void {
  if (useSelection.getState().editing === null) return;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (active instanceof HTMLElement && isTypingTarget(active)) active.blur();
  useSelection.getState().edit(null);
}

/** The table cell under a DOM node, if the table view marks its cells with `data-wb-row` and `data-wb-col`. */
export function tableCellAt(node: Element | null): { row: string; col: string } | undefined {
  const cell = node?.closest<HTMLElement>('[data-wb-row][data-wb-col]');
  const row = cell?.dataset.wbRow;
  const col = cell?.dataset.wbCol;
  return row !== undefined && col !== undefined ? { row, col } : undefined;
}

/* ------------------------------------------------------------------------ */
/* Double tap                                                               */
/* ------------------------------------------------------------------------ */

/** The last completed tap, for double-tap detection. */
let lastTap: { at: number; screen: Point; id: ElementId | null } | null = null;

/** Remembers a completed tap (a press released without dragging). */
function rememberTap(sample: PointerSample, id: ElementId | null): void {
  lastTap = { at: sample.event.timeStamp, screen: sample.screen, id };
}

/** True when this press completes a double tap on the same target. */
function isSecondTap(sample: PointerSample, id: ElementId | null): boolean {
  const tap = lastTap;
  if (!tap || tap.id !== id) return false;
  const slop = sample.event.pointerType === 'touch' ? DOUBLE_TAP.px * 3 : DOUBLE_TAP.px;
  return sample.event.timeStamp - tap.at <= DOUBLE_TAP.ms && Math.hypot(sample.screen.x - tap.screen.x, sample.screen.y - tap.screen.y) <= slop;
}

/** Forgets the last tap (another tool ran in between). */
export function forgetTap(): void {
  lastTap = null;
}

/**
 * What a double tap on an element does: enter its group, start typing into
 * it (a table cell, an arrow label), crop an image, or open a link.
 * Returns `true` when it did something.
 */
export function openElement(element: BoardElement, node: Element | null): boolean {
  const elements = boardElements();
  const selection = selectedIds();
  if (outermostGroupOf(elements, element.id) !== undefined) {
    // Entering a group: the tap picks the next group down (or the item itself).
    const inner = groupSelectionFor(elements, element.id, selection);
    if (inner.size !== selection.size || [...inner].some((id) => !selection.has(id))) {
      useSelection.getState().select([...inner]);
      return true;
    }
  }
  if (element.type === 'link') {
    if (typeof window !== 'undefined') openLink(element.href);
    return true;
  }
  if (!canEditBoard() || isElementLocked(element)) return false;
  switch (element.type) {
    case 'note':
    case 'shape':
    case 'text':
    case 'container':
    case 'html':
      useSelection.getState().edit({ kind: 'element', id: element.id });
      return true;
    case 'arrow':
      useSelection.getState().edit({ kind: 'arrow-label', id: element.id });
      return true;
    case 'table': {
      const cell = tableCellAt(node);
      const row = cell?.row ?? tableRowIds(element)[0];
      const col = cell?.col ?? tableColumnIds(element)[0];
      if (row === undefined || col === undefined) return false;
      useSelection.getState().edit({ kind: 'cell', id: element.id, row, col });
      return true;
    }
    case 'image':
      // A double click on a video that just started or paused it does not crop it.
      if (element.video !== undefined && videoClickedRecently()) return false;
      useSelection.getState().select([element.id]);
      useSelection.getState().setCropping(element.id);
      return true;
    default:
      return false;
  }
}

/**
 * Whether a click released on `element`, now the only selection, starts
 * typing into it: a text showing only its placeholder does.
 */
export function clickStartsTyping(element: BoardElement): boolean {
  const { ids } = useSelection.getState();
  return showsTextPlaceholder(element) && !isElementLocked(element) && canEditBoard() && ids.length === 1 && ids[0] === element.id;
}

/* ------------------------------------------------------------------------ */
/* Marquee                                                                  */
/* ------------------------------------------------------------------------ */

/** The rectangle between two board points. */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/**
 * The selection a marquee gives: what it touches (grown to whole groups),
 * toggled against `base` with Shift, without locked items unless only
 * locked items are touched.
 */
export function marqueePick(context: HitContext, rect: Rect, base: ReadonlySet<ElementId>, toggle: boolean, editable: boolean): ReadonlySet<ElementId> {
  const candidates = editable ? context.elements.filter((element) => !isElementLocked(element)) : context.elements;
  const hits = expandSelectionToGroups(context.elements, new Set(marqueeSelection(candidates, rect, context.measures, context.byId, context.zoom)), base);
  const picked = new Set<ElementId>([...[...base].filter((id) => !hits.has(id) && context.byId.has(id)), ...[...hits].filter((id) => !toggle || !base.has(id))]);
  return editable ? withoutLockedIdsUnlessAll(context.elements, picked) : picked;
}

function sameSet(a: ReadonlySet<ElementId>, b: readonly ElementId[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

/** The rubber band over empty board. */
function marqueeGesture(sample: PointerSample, base: ReadonlySet<ElementId>, toggle: boolean, asks: boolean): Gesture {
  const was = useSelection.getState().ids;
  const start = sample.board;
  const startScreen = sample.screen;
  let armed = false;
  let rect: Rect | null = null;
  const editable = canEditBoard();
  return {
    cursor: 'crosshair',
    move(next) {
      if (!armed && Math.hypot(next.screen.x - startScreen.x, next.screen.y - startScreen.y) < MARQUEE_START_SLOP_PX) return;
      armed = true;
      rect = rectBetween(start, next.board);
      useSelection.getState().setMarquee(rect);
      const picked = marqueePick(hitContext(), rect, base, toggle, editable);
      if (!sameSet(picked, useSelection.getState().ids)) useSelection.getState().select([...picked]);
    },
    up(end) {
      useSelection.getState().setMarquee(null);
      if (!armed) {
        if (!toggle) useSelection.getState().clear();
        rememberTap(end, null);
        return;
      }
      if (asks && rect && !end.event.altKey) useAsk.getState().show({ kind: 'area', rect });
    },
    cancel() {
      useSelection.getState().setMarquee(null);
      useSelection.getState().select(was);
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Move                                                                     */
/* ------------------------------------------------------------------------ */

/** A move in progress. */
export interface MoveState {
  /** The element the press was on. */
  hit: ElementId;
  /** Coalescing key of the move's undo step. */
  key: string;
  /** Undo label (`Move`, or `Duplicate` for an ⌥-drag). */
  label: string;
  /** Board point the drag started at. */
  start: Point;
  /** Everything that moves (arrows with carried ends included). */
  ids: Set<ElementId>;
  /** Stickers riding on moving hosts. */
  riders: Set<ElementId>;
  /** Where each moving element (not arrows) started. */
  origins: Map<ElementId, Point>;
  /** Free arrow ends that move along. */
  freeEnds: CarriedArrowEnds;
  /** Boxes of the moving items at the start (riders and arrows left out), for snapping. */
  startBoxes: Box[];
  /** Boxes of the items staying put. */
  still: Box[];
  /** How many top-level items were copied (an ⌥-drag), for the announcement. */
  copies: number;
}

/**
 * Starts a move of the item under the press: its group, or the selection
 * when it is part of it (Shift adds it to the selection; ⌥ copies first).
 * Returns `undefined` when nothing can move (locked, or a refused copy).
 */
export function startMove(hit: ElementId, start: Point, options: { additive: boolean; duplicate: boolean }): MoveState | undefined {
  let elements = boardElements();
  const measures = currentMeasures();
  const selection = selectedIds();
  const group = expandSelectionToGroups(elements, new Set([hit]), selection);
  let ids: ReadonlySet<ElementId> = options.additive ? new Set([...selection, ...group]) : selection.has(hit) ? selection : group;
  const hitElement = elements.find((element) => element.id === hit);
  if (!options.duplicate) ids = isElementLocked(hitElement) ? new Set() : withoutLockedIds(elements, ids);
  if (ids.size === 0) return undefined;
  useSelection.getState().select([...ids]);
  const key = gestureKey(options.duplicate ? 'duplicate' : 'move', hit);
  let copyIds: Set<ElementId> | undefined;
  let copies = 0;
  if (options.duplicate) {
    const made = duplicateIds(ids, 0, 'Duplicate', key);
    if (made === undefined) return undefined;
    copyIds = new Set(made);
    elements = boardElements();
    ids = topLevelSelectedIds(elements, copyIds, measures);
    copies = ids.size;
    useSelection.getState().select([...ids]);
  }
  const moving = collectMovingSet(elements, ids, measures, copyIds ? { among: (id) => copyIds.has(id) } : {});
  const origins = new Map<ElementId, Point>();
  const startBoxes: Box[] = [];
  for (const element of elements) {
    if (!moving.ids.has(element.id) || element.type === 'arrow') continue;
    origins.set(element.id, { x: element.x, y: element.y });
    if (moving.riders.has(element.id)) continue;
    const box = elementBounds(element, measures);
    if (box) startBoxes.push(box);
  }
  const freeEnds = carriedArrowEnds(copyIds ? elements.filter((element) => copyIds.has(element.id)) : elements, moving.ids, moving.frames);
  if (origins.size === 0 && freeEnds.size === 0) return undefined;
  for (const id of freeEnds.keys()) moving.ids.add(id);
  return {
    hit,
    key,
    label: options.duplicate ? 'Duplicate' : 'Move',
    start,
    ids: moving.ids,
    riders: moving.riders,
    origins,
    freeEnds,
    startBoxes,
    still: stillBoxes(elements, moving.ids, measures),
    copies,
  };
}

/**
 * Moves to a pointer position: snaps the moving items' box to its
 * neighbours (unless `free`), shows the matched guides, and writes the
 * board. A `straight` (Shift) move holds still the axis the pointer moved
 * less along. A snapped lone note straightens. Returns the applied offset.
 */
export function stepMove(move: MoveState, point: Point, free: boolean, straight = false): Point {
  const axis = straight ? straightDragAxis(point.x - move.start.x, point.y - move.start.y) : undefined;
  let dx = axis === 'x' ? 0 : point.x - move.start.x;
  let dy = axis === 'y' ? 0 : point.y - move.start.y;
  const context = hitContext();
  const union = unionBounds(move.startBoxes.map((box) => ({ ...box, x: box.x + dx, y: box.y + dy })));
  let snappedGuides = false;
  if (union && !free) {
    const candidates = snapCandidatesNear(move.still, union, context.view, context.zoom);
    const snap = snapRectToGuidesStraight(union, candidates, snapDistanceFor(union, context.zoom), axis);
    dx += snap.dx;
    dy += snap.dy;
    snappedGuides = snap.guides.length > 0;
    useInteraction.getState().setGuides(guideLines(snap.guides, move.still, { ...union, x: union.x + snap.dx, y: union.y + snap.dy }, context.view, context.zoom));
  } else useInteraction.getState().setGuides([]);
  const lone = move.ids.size - move.riders.size === 1 ? move.hit : undefined;
  editContent(
    (content) => {
      const moved = applyMoveDrag(content, { dx, dy, origins: move.origins, freeEnds: move.freeEnds });
      if (!snappedGuides || lone === undefined) return moved;
      return {
        ...moved,
        elements: moved.elements.map((element) => (element.id === lone && element.type === 'note' && element.tilt !== 0 ? { ...element, tilt: 0 } : element)),
      };
    },
    { label: move.label, coalesce: move.key },
  );
  return { x: dx, y: dy };
}

/**
 * A move gesture: writes each frame, announces at the end, undoes on
 * cancel. Pressing or letting go of Shift mid-drag locks or frees the axis
 * at once, without waiting for the pointer to move.
 */
function moveGesture(move: MoveState): Gesture {
  let offset: Point = { x: 0, y: 0 };
  let last: { board: Point; free: boolean; straight: boolean } | undefined;
  const step = (): void => {
    if (last) offset = stepMove(move, last.board, last.free, last.straight);
  };
  const onShift = (event: KeyboardEvent): void => {
    if (event.key !== 'Shift' || !last || last.straight === event.shiftKey) return;
    last = { ...last, straight: event.shiftKey };
    step();
  };
  const stop = (): void => {
    window.removeEventListener('keydown', onShift, true);
    window.removeEventListener('keyup', onShift, true);
    useInteraction.getState().reset();
  };
  window.addEventListener('keydown', onShift, true);
  window.addEventListener('keyup', onShift, true);
  useInteraction.getState().setTransform('move');
  return {
    cursor: 'grabbing',
    move(next) {
      last = { board: next.board, free: hasModifier(next.event), straight: next.event.shiftKey };
      step();
    },
    up() {
      stop();
      if (move.copies > 0) announce(duplicatedMessage(move.copies));
      else if (offset.x !== 0 || offset.y !== 0) announce(movedMessage(offset.x, offset.y));
    },
    cancel() {
      stop();
      editContent((content) => applyMoveDrag(content, { dx: 0, dy: 0, origins: move.origins, freeEnds: move.freeEnds }), { label: move.label, coalesce: move.key });
    },
  };
}

/* ------------------------------------------------------------------------ */
/* The press                                                                */
/* ------------------------------------------------------------------------ */

/** A gesture that swallows the rest of a press. */
const SWALLOW: Gesture = {};

/** The Select tool's press (also used by other tools when the press lands on an item). */
export function selectPress(sample: PointerSample): Gesture | null {
  const { event } = sample;
  if (useTool.getState().commentMode) return null;
  if (isTypingTarget(sample.node)) return null;
  const editing = useSelection.getState().editing;
  const context = hitContext();
  const editable = canEditBoard();
  const mod = hasModifier(event);
  const hit = pressTargetAt(context, sample.board, event.pointerType, editable && !event.shiftKey && !mod);
  if (editing && editing.id !== hit?.id) stopTyping();

  if (isSecondTap(sample, hit?.id ?? null)) {
    lastTap = null;
    cancelPendingLinkOpen();
    if (hit) openElement(hit, sample.node);
    else if (editable) placeElement(createTextAt(sample.board), { label: 'Add text', keepTool: true });
    return SWALLOW;
  }

  // One finger on a touch screen pans first (see `tools/touch.ts`).
  if (event.pointerType === 'touch' && !event.shiftKey && !mod) {
    const pressed = hit ?? null;
    return touchGesture(sample, pressed, editable && pressed !== null && !isElementLocked(pressed), (end) => {
      if (pressed === null) useSelection.getState().clear();
      else useSelection.getState().select([...expandSelectionToGroups(boardElements(), new Set([pressed.id]), useSelection.getState().ids)]);
      rememberTap(end, pressed?.id ?? null);
      if (pressed !== null && isQuickTap(sample.screen, sample.event.timeStamp, end.screen, end.event.timeStamp) && clickStartsTyping(pressed)) {
        useSelection.getState().edit({ kind: 'element', id: pressed.id });
        return;
      }
      clickBoardLink(sample, end);
    });
  }

  if (!hit) {
    const selection = useSelection.getState().ids;
    return marqueeGesture(sample, event.shiftKey ? new Set(selection) : new Set(), event.shiftKey, mod);
  }

  const elements = context.elements;
  const selection = selectedIds();
  if (!editable) {
    useSelection.getState().select([...expandSelectionToGroups(elements, new Set([hit.id]), selection)]);
    return {
      up(end) {
        rememberTap(end, hit.id);
        clickBoardLink(sample, end);
      },
    };
  }

  const boxSelect = (mod || isElementLocked(hit)) && !event.altKey;
  const fresh = !event.shiftKey && !selection.has(hit.id);
  if (fresh && !boxSelect) useSelection.getState().select([...expandSelectionToGroups(elements, new Set([hit.id]), selection)]);

  if (boxSelect) {
    // A press on a locked item (or with ⌘) selects it on release; dragging draws a marquee instead.
    const marquee = marqueeGesture(sample, event.shiftKey ? selection : new Set(), event.shiftKey, mod);
    let dragging = false;
    return {
      cursor: 'default',
      move(next) {
        if (!dragging && !pastThreshold(sample.screen, next.screen, next.event)) return;
        dragging = true;
        marquee.move?.(next);
      },
      up(end) {
        if (dragging) return marquee.up?.(end);
        const picked = expandSelectionToGroups(elements, new Set([hit.id]), selection);
        if (event.shiftKey) togglePicked(picked, selection);
        else useSelection.getState().select([...picked]);
        rememberTap(end, hit.id);
        clickBoardLink(sample, end);
      },
      cancel() {
        if (dragging) marquee.cancel?.();
      },
    };
  }

  let move: Gesture | null = null;
  return {
    move(next) {
      if (move) return move.move?.(next);
      if (!pastThreshold(sample.screen, next.screen, next.event)) return;
      const state = startMove(hit.id, sample.board, { additive: event.shiftKey && !event.altKey, duplicate: event.altKey });
      if (!state) {
        move = SWALLOW;
        return;
      }
      move = moveGesture(state);
      move.move?.(next);
    },
    up(end) {
      if (move) return move.up?.(end);
      if (event.shiftKey) togglePicked(expandSelectionToGroups(elements, new Set([hit.id]), selection), selection);
      else {
        useSelection.getState().select([...expandSelectionToGroups(elements, new Set([hit.id]), useSelection.getState().ids)]);
        if (clickStartsTyping(hit)) useSelection.getState().edit({ kind: 'element', id: hit.id });
        // A click on an untitled section's title band starts typing its title.
        else if (
          hit.type === 'container' &&
          hit.text.trim() === '' &&
          useSelection.getState().ids.length === 1 &&
          containerAtPoint([hit], sample.board, hitSlop(event.pointerType, context.zoom), context.measures, context.zoom, true)
        )
          useSelection.getState().edit({ kind: 'element', id: hit.id });
      }
      rememberTap(end, hit.id);
      clickBoardLink(sample, end);
    },
    cancel() {
      move?.cancel?.();
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Touch                                                                    */
/* ------------------------------------------------------------------------ */

/** Draws `ids` with the touch lift look (scaled up, see-through), or none with `null`. */
function touchLift(surface: HTMLElement | null | undefined, ids: ReadonlySet<ElementId> | null): void {
  setLiftedElements(ids ?? new Set());
  if (!surface) return;
  if (ids !== null && ids.size > 0) surface.dataset.wbTouchLift = '';
  else delete surface.dataset.wbTouchLift;
}

/**
 * The Select tool's one-finger touch press: pans, drags what is already
 * selected, picks the item up on a long press (then drags it), and runs
 * `tap` on a quick tap. `movable` is whether the pressed item can move.
 */
function touchGesture(sample: PointerSample, hit: BoardElement | null, movable: boolean, tap: (end: PointerSample) => void): Gesture {
  const surface = sample.node?.closest<HTMLElement>('.wb-surface');
  let press: TouchPress | null = { start: sample.screen, selected: hit !== null && movable && selectedIds().has(hit.id), popped: false };
  let then: Gesture | null = null;
  const timer =
    hit !== null && movable
      ? setTimeout(() => {
          if (press === null) return;
          const decided = reduceTouchPress(press, { kind: 'hold' });
          press = decided.press;
          if (decided.outcome !== 'pop') return;
          const elements = boardElements();
          const picked = expandSelectionToGroups(elements, new Set([hit.id]), selectedIds());
          useSelection.getState().select([...picked]);
          touchLift(surface, withoutLockedIds(elements, picked));
        }, TOUCH_LONG_PRESS_MS)
      : undefined;
  const settle = (): void => clearTimeout(timer);
  return {
    move(next) {
      if (then) return then.move?.(next);
      if (press === null) return;
      const decided = reduceTouchPress(press, { kind: 'move', at: next.screen });
      press = decided.press;
      if (decided.outcome === 'none') return;
      settle();
      const state = decided.outcome === 'drag' && hit !== null ? startMove(hit.id, sample.board, { additive: false, duplicate: false }) : undefined;
      if (state) {
        touchLift(surface, state.ids);
        then = moveGesture(state);
      } else {
        // Panning, or nothing could move after all.
        touchLift(surface, null);
        then = panGesture(sample);
      }
      then.move?.(next);
    },
    up(end) {
      settle();
      touchLift(surface, null);
      if (then) return then.up?.(end);
      const current = press;
      press = null;
      // A picked-up item lifted without moving: the context menu opens (ui/ContextMenu).
      if (current !== null && reduceTouchPress(current, { kind: 'up' }).outcome === 'tap') tap(end);
    },
    cancel() {
      settle();
      touchLift(surface, null);
      press = null;
      then?.cancel?.();
    },
  };
}

/** Shift-click: removes a picked item (or group) from the selection, or adds it. */
function togglePicked(picked: ReadonlySet<ElementId>, selection: ReadonlySet<ElementId>): void {
  const has = [...picked].every((id) => selection.has(id));
  useSelection.getState().select(has ? [...selection].filter((id) => !picked.has(id)) : [...selection, ...picked]);
}
