/**
 * The next-item offer.
 *
 * After an arrow is drawn from an item into empty board (or one of its ends
 * is dragged off into empty board), a faint item waits at the arrow's free
 * end: a note after a note, a shape like the shape it came from, otherwise
 * a shape of the Shape tool's kind. Return or a click (a tap) on it adds it,
 * joins the arrow to it and starts typing into it, as one undo step. Should
 * the item be deleted (by someone else) during that first edit, the arrow
 * comes back with its end free rather than going with it.
 *
 * Anything else withdraws the offer: another key, a press elsewhere (or a
 * drag starting on the offer, which then works as a press on empty board),
 * focus moving to the toolbar, the selection moving off the arrow, or a
 * change that moves the arrow or puts something where the item would go.
 *
 * The placement is core's {@link arrowEndNextOffer}; `NextItemOffer.tsx`
 * draws the offer and runs {@link watchNextOffer} while it is shown.
 */

import { create } from 'zustand';
import {
  appendElement,
  arrowEndNextOffer,
  defaultShapeSize,
  isArrowEndOfferCurrent,
  nextNoteBeside,
  nextShapeBeside,
  setArrowEnd,
  wouldExceedElementLimit,
  type ArrowElement,
  type ArrowEndOffer,
  type BoardElement,
  type ElementId,
  type NextItem,
} from '@open-artifact/whiteboard-core';
import { cancelBoardGesture, surfaceRef } from '../canvas/surface.ts';
import { screenToBoard } from '../lib/camera.ts';
import { isApplePlatform } from '../lib/tools.ts';
import { canEditBoard, editContent, viewerAuthor } from '../services/actions.ts';
import { addedMessage, announce, freeEndAddHint } from '../services/announce.ts';
import { isChromePopupTarget, isChromeTarget, isTypingTarget } from '../services/keyboard.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures, useMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { DRAG_THRESHOLD_PX } from '../tools/gesture.ts';
import { hitContext, hitElementAt } from '../tools/hit.ts';
import { createShape, ensureRoom, randomNoteTilt } from '../tools/place.ts';
import { movedPastTouchSlop } from '../tools/touch.ts';

/** The offer on show, if any. */
export interface NextOfferState {
  offer: ArrowEndOffer | null;
}

/** The offer store (one offer at a time). */
export const useNextOffer = create<NextOfferState>()(() => ({ offer: null }));

/** Withdraws the offer. */
export function clearNextOffer(): void {
  if (useNextOffer.getState().offer !== null) useNextOffer.setState({ offer: null });
}

/** The name of the Return key on this platform, as hints spell it. */
export function enterKeyLabel(): string {
  return isApplePlatform() ? 'Return' : 'Enter';
}

/** True when the main pointer is coarse (a finger): the hint says “Tap”. */
export function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** The item to offer after an arrow from `source`: one like it, or a shape of the Shape tool's kind. */
function nextItemFor(source: BoardElement): NextItem {
  if (source.type === 'note') return nextNoteBeside(source, viewerAuthor(), randomNoteTilt());
  if (source.type === 'shape') return nextShapeBeside(source);
  const kind = useTool.getState().shapeKind;
  return createShape(kind, { x: 0, y: 0, ...defaultShapeSize(kind) });
}

/** Whether a box shows at least partly in the viewport. */
function onScreen(next: NextItem): boolean {
  const { camera, width, height } = useCamera.getState();
  return next.x < camera.x + width / camera.zoom && next.x + next.w > camera.x && next.y < camera.y + height / camera.zoom && next.y + next.h > camera.y;
}

/**
 * Offers an item at the free end of `arrow` (as stored now), when it has
 * one, the spot is clear and on screen, and the board has room.
 */
export function offerNextItem(arrow: ArrowElement): void {
  clearNextOffer();
  if (!canEditBoard() || useTool.getState().commentMode) return;
  const { board, byId } = useBoard.getState();
  const source = board.content.elements.find((element) => element.id === arrow.from || element.id === arrow.to);
  if (!source || wouldExceedElementLimit(board.content)) return;
  const offer = arrowEndNextOffer(arrow, nextItemFor(source), board.content.elements, currentMeasures(), byId);
  if (!offer || !onScreen(offer.next)) return;
  useNextOffer.setState({ offer });
  announce(freeEndAddHint(offer.next.type, coarsePointer() ? undefined : enterKeyLabel()));
}

/**
 * Adds the offered item, joins the arrow's free end to it, selects it and
 * starts typing into it. Returns `false` when the arrow is gone or the
 * board cannot take the item.
 */
export function acceptNextOffer(offer: ArrowEndOffer): boolean {
  clearNextOffer();
  const arrow = useBoard.getState().byId.get(offer.arrow.id);
  if (arrow?.type !== 'arrow') return false;
  const joined = setArrowEnd(arrow, offer.end, { end: offer.next.id, side: offer.side });
  if (!joined || !ensureRoom()) return false;
  const label = offer.next.type === 'note' ? 'Add note' : 'Add shape';
  const added = editContent(
    (content) => appendElement({ ...content, elements: content.elements.map((element) => (element.id === joined.id ? joined : element)) }, offer.next),
    { label },
  );
  if (!added) return false;
  useTool.getState().pick({ tool: 'select' });
  useSelection.getState().select([offer.next.id]);
  useSelection.getState().edit({ kind: 'element', id: offer.next.id, selectAll: true });
  watchFirstEdit({ item: offer.next.id, arrow, end: offer.end });
  announce(addedMessage(offer.next.type));
  return true;
}

/* ------------------------------------------------------------------------ */
/* The added item's first edit                                              */
/* ------------------------------------------------------------------------ */

/** An arrow joined to an item added from an offer, while that item's first edit lasts. */
interface PendingJoin {
  /** The added item. */
  item: ElementId;
  /** The arrow as it was before it was joined (that end still free). */
  arrow: ArrowElement;
  /** The end that was joined to the item. */
  end: 'from' | 'to';
}

/** Stops watching the pending join, if one is watched. */
let stopPendingJoin: (() => void) | null = null;

/**
 * Watches the first edit of an item added from an offer. When it ends with
 * the item gone (someone else deleted it meanwhile, taking the arrow with
 * it), the arrow comes back with its end free; see {@link restoreFreedArrow}.
 */
function watchFirstEdit(join: PendingJoin): void {
  stopPendingJoin?.();
  const stop = useSelection.subscribe((state) => {
    if (state.editing?.kind === 'element' && state.editing.id === join.item) return;
    stop();
    if (stopPendingJoin === stop) stopPendingJoin = null;
    // After the change that ended the edit has settled (it may be a remote board change still being shown).
    queueMicrotask(() => restoreFreedArrow(join));
  });
  stopPendingJoin = stop;
}

/**
 * Puts the arrow of a pending join back as it was before it was joined,
 * when both the added item and the arrow are gone but the item the arrow
 * comes from is still there. Like the removal it answers, it is not an undo
 * step of its own.
 */
function restoreFreedArrow(join: PendingJoin): void {
  const { byId } = useBoard.getState();
  const source = join.arrow[join.end === 'to' ? 'from' : 'to'];
  if (byId.has(join.item) || byId.has(join.arrow.id) || typeof source !== 'string' || !byId.has(source) || !canEditBoard()) return;
  editContent((content) => appendElement(content, join.arrow), { history: false });
}

/* ------------------------------------------------------------------------ */
/* While an offer shows                                                     */
/* ------------------------------------------------------------------------ */

/** A press that started on the offer and has not moved yet. */
interface OfferPress {
  pointerId: number;
  x: number;
  y: number;
  offer: ArrowEndOffer;
}

/** Keys that never touch the offer on their own. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/** Whether an item (other than the offer drawn over it) is under a pointer event. */
function itemUnder(event: PointerEvent): boolean {
  const surface = surfaceRef.current;
  if (!surface) return false;
  const bounds = surface.getBoundingClientRect();
  const point = screenToBoard(useCamera.getState().camera, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  return hitElementAt(hitContext(), point, event.pointerType) !== undefined;
}

/**
 * Runs the offer's rules while `offer` shows; returns the cleanup. A press
 * on the offer starts the active tool's gesture as usual: released without
 * moving, that gesture is cancelled and the item added; moved, the offer
 * goes and the gesture carries on.
 */
export function watchNextOffer(offer: ArrowEndOffer): () => void {
  let press: OfferPress | null = null;
  /** A press began somewhere else: withdraw at the next pointer event. */
  let pressedElsewhere = false;

  const withdraw = (): void => {
    press = null;
    pressedElsewhere = false;
    clearNextOffer();
  };

  /** Withdraws the offer when the board no longer supports it. */
  const check = (): void => {
    if (useNextOffer.getState().offer !== offer) return;
    const ids = useSelection.getState().ids;
    const arrowSelected = ids.length === 1 && ids[0] === offer.arrow.id;
    const { board, byId } = useBoard.getState();
    if (
      (press === null && !arrowSelected) ||
      !canEditBoard() ||
      useTool.getState().commentMode ||
      !isArrowEndOfferCurrent(offer, board.content.elements, currentMeasures(), byId)
    ) {
      withdraw();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (MODIFIER_KEYS.has(event.key) || event.defaultPrevented || isChromePopupTarget(event.target)) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.isComposing && !isTypingTarget(event.target);
    const ours = plain && (event.key === 'Enter' || event.key === 'Escape');
    if (ours && press !== null) cancelBoardGesture();
    if (plain && event.key === 'Enter') {
      press = null;
      acceptNextOffer(offer);
    } else {
      withdraw();
    }
    if (!ours) return;
    // Return and Escape are the offer's: they neither edit nor deselect the arrow.
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (isChromeTarget(event.target)) withdraw();
  };

  const onPointerDownCapture = (event: PointerEvent): void => {
    const onOffer =
      event.isPrimary !== false &&
      event.button === 0 &&
      !(event.ctrlKey && isApplePlatform()) &&
      event.target instanceof Element &&
      event.target.closest('[data-wb-offer]') !== null &&
      !itemUnder(event);
    press = onOffer ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offer } : null;
    pressedElsewhere = !onOffer;
  };

  const onPointerDown = (): void => {
    if (pressedElsewhere) withdraw();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pressedElsewhere) return withdraw();
    if (press === null || press.pointerId !== event.pointerId) return;
    const start = { x: press.x, y: press.y };
    const at = { x: event.clientX, y: event.clientY };
    const moved = event.pointerType === 'touch' ? movedPastTouchSlop(start, at) : Math.hypot(at.x - start.x, at.y - start.y) >= DRAG_THRESHOLD_PX;
    if (moved) withdraw();
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (pressedElsewhere) return withdraw();
    if (press === null || press.pointerId !== event.pointerId) return;
    const pressed = press;
    press = null;
    if (event.type === 'pointerup' && useNextOffer.getState().offer === pressed.offer) {
      cancelBoardGesture();
      acceptNextOffer(pressed.offer);
      return;
    }
    withdraw();
  };

  const listeners: [string, EventListener, boolean][] = [
    ['keydown', onKeyDown as EventListener, true],
    ['focusin', onFocusIn as EventListener, true],
    ['pointerdown', onPointerDownCapture as EventListener, true],
    ['pointerdown', onPointerDown as EventListener, false],
    ['pointermove', onPointerMove as EventListener, true],
    ['pointerup', onPointerEnd as EventListener, true],
    ['pointercancel', onPointerEnd as EventListener, true],
  ];
  for (const [type, listener, capture] of listeners) window.addEventListener(type, listener, capture);
  const unsubscribe = [
    useBoard.subscribe((state, previous) => {
      if (state.byId !== previous.byId) check();
    }),
    useSelection.subscribe((state, previous) => {
      if (state.ids !== previous.ids) check();
    }),
    useMeasures.subscribe(check),
    useTool.subscribe((state, previous) => {
      if (state.commentMode !== previous.commentMode) check();
    }),
  ];
  check();
  return () => {
    for (const [type, listener, capture] of listeners) window.removeEventListener(type, listener, capture);
    for (const stop of unsubscribe) stop();
  };
}
