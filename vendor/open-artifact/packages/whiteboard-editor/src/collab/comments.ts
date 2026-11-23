/**
 * Comments on the board. The host stores the threads (the `comments`
 * capability); the board works out where each one sits.
 *
 * A thread's anchor is a core comment anchor (`comment-anchors.ts`): a point
 * on an element (as fractions of its box, so the pin follows the element),
 * a point on the board, or an area (on the board, or relative to the section
 * it is about). Clicking in comment mode drops a pin; dragging comments on
 * an area.
 *
 * The threads, the open card, the draft and the thread actions are the
 * editor kit's (`createComments`); the board adds its anchors, its limits
 * ({@link MAX_COMMENT_BYTES}, {@link MAX_THREADS}), who may delete, and
 * requests to the agent (`asks.ts`).
 *
 * The comment state is reported to the Shell (its Comments button and
 * count) through `services/shell.ts`, which also brings the Shell's
 * `comments_mode` and `comments_list` commands here.
 */

import { create } from 'zustand';
import { toast } from '@open-artifact/ui';
import type { CommentThread } from '@open-artifact/runtime';
import { createComments, openMessageCount } from '@open-artifact/editor-kit';
import { boardPointTarget, elementBounds, type Box } from '@open-artifact/whiteboard-core';
import { surfaceRef } from '../canvas/BoardSurface.tsx';
import { screenToBoard, type Point } from '../lib/camera.ts';
import { revealBox } from '../services/navigation.ts';
import { maybeSession } from '../services/session.ts';
import { panToPoint } from '../services/viewport.ts';
import { onShellCommand, setShellReport } from '../services/shell.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useTool } from '../state/tool.ts';
import { noteThreadChanged, sendThreadToAgent, type AskTarget } from './asks.ts';
import { anchorPlace, areaCommentDraft, isCommentDraft, pointCommentDraft, type BoardAnchor } from './comment-places.ts';

export {
  anchorPlace,
  areaCommentDraft,
  elementCommentLabel,
  isCommentDraft,
  pointCommentDraft,
  type BoardAnchor,
  type CommentDraft,
  type ThreadPlace,
} from './comment-places.ts';

/** Most UTF-8 bytes of one comment. */
export const MAX_COMMENT_BYTES = 4096;

/** Most threads on one board. */
export const MAX_THREADS = 500;

/** Screen pixels a press must move in comment mode to comment on an area. */
const AREA_DRAG_PX = 6;

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Checks a comment's text; tells the person when it is too long. */
function checkedText(text: string): string | undefined {
  const body = text.trim();
  if (!body) return undefined;
  if (utf8Length(body) > MAX_COMMENT_BYTES) {
    toast.add({ title: 'This comment is too long', description: 'Comments can hold about 4,000 characters.' });
    return undefined;
  }
  return body;
}

/** Where an anchor sits on the board now (see {@link anchorPlace}). */
function placeNow(anchor: string) {
  return anchorPlace(anchor, useBoard.getState().board.content.elements, currentMeasures(), useCamera.getState().camera.zoom);
}

/**
 * The board's comments: the editor kit's controller, with the board's
 * anchors (the encoded core anchor, plus what a new comment's draft worked
 * out about it), limits, permissions and agent requests. Its store is
 * {@link useComments}.
 */
export const boardComments = createComments<BoardAnchor>({
  notify: (message) => toast.add(message),
  parse: (anchor) => ({ anchor }),
  serialize: (anchor) => anchor.anchor,
  label: (anchor) => anchor.label ?? 'Board',
  detail: (anchor) => anchor.detail,
  location: (anchor) => anchor.location ?? {},
  canComment: () => maybeSession()?.canComment ?? false,
  canSendToAgent: () => maybeSession()?.canAsk ?? false,
  canRemove: () => maybeSession()?.canRemoveComments ?? false,
  sendToAgent: (thread) => sendThreadToAgent(thread, threadTarget(thread)),
  heard: (threads) => {
    for (const thread of threads) noteThreadChanged(thread);
  },
  checkText: checkedText,
  noun: 'board',
  maxThreads: MAX_THREADS,
  // A row of the "All comments" panel: the thread's place comes into view.
  reveal: (anchor) => {
    const place = anchorPlace(anchor.anchor, useBoard.getState().board.content.elements, currentMeasures(), useCamera.getState().camera.zoom);
    if (place?.rect) revealBox(place.rect);
    else if (place) panToPoint(place.point);
  },
});

/** The comments store (threads, the open card, the draft, the list). */
export const useComments = boardComments.store;

/**
 * Comment mode under the pointer (board units): the area being dragged, and
 * the box of the element a click would comment on (outlined, as in every
 * editor).
 */
export const useCommentDrag = create<{ dragging: Box | null; hover: Box | null }>()(() => ({ dragging: null, hover: null }));

/** The box of the element under a board point, or null (the board itself). */
function elementBoxAt(point: Point): Box | null {
  const elements = useBoard.getState().board.content.elements;
  const measures = currentMeasures();
  const id = boardPointTarget(point.x, point.y, elements, measures).selected[0];
  const element = id === undefined ? undefined : elements.find((other) => other.id === id);
  const box = element ? elementBounds(element, measures) : undefined;
  return box && box.w > 0 && box.h > 0 ? box : null;
}

const sameBox = (a: Box | null, b: Box | null): boolean => a === b || Boolean(a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Moves a thread's pin to a board point (re-anchoring it to what is there). */
export function moveThread(id: string, point: Point): Promise<void> {
  return boardComments.move(id, pointCommentDraft(point, useBoard.getState().board.content.elements, currentMeasures(), useCamera.getState().camera.zoom));
}

/** What a thread is about, as a request target. */
export function threadTarget(thread: CommentThread): AskTarget {
  const place = placeNow(thread.anchor);
  if (!place) return { kind: 'board' };
  if (place.rect) return { kind: 'area', rect: place.rect };
  return { kind: 'point', point: place.point };
}

/** The open (unresolved) threads. */
export function openThreads(threads: readonly CommentThread[]): CommentThread[] {
  return threads.filter((thread) => thread.status === 'open');
}

/** Where the open comment card is attached, for the view context. */
export function activeCommentPin(): { thread?: string; x: number; y: number; w?: number; h?: number } | undefined {
  const { active, draft, threads } = useComments.getState();
  const round = (value: number): number => Math.round(value);
  if (draft && isCommentDraft(draft)) {
    const at = draft.at;
    return 'w' in at ? { x: round(at.x), y: round(at.y), w: round(at.w), h: round(at.h) } : { x: round(at.x), y: round(at.y) };
  }
  const thread = active ? threads.find((other) => other.id === active) : undefined;
  if (!thread) return undefined;
  const place = placeNow(thread.anchor);
  if (!place) return undefined;
  return place.rect
    ? { thread: thread.id, x: round(place.rect.x), y: round(place.rect.y), w: round(place.rect.w), h: round(place.rect.h) }
    : { thread: thread.id, x: round(place.point.x), y: round(place.point.y) };
}

/** The board point under a client position. */
function boardPointAt(clientX: number, clientY: number, surface: HTMLElement): Point {
  const bounds = surface.getBoundingClientRect();
  return screenToBoard(useCamera.getState().camera, { x: clientX - bounds.left, y: clientY - bounds.top });
}

/**
 * Comment mode's presses: a click drops a draft pin, a drag drafts an area
 * comment. Listens in the capture phase so the tools never see the press.
 */
function watchCommentPresses(): () => void {
  let press: { pointerId: number; start: Point; startClient: Point } | null = null;
  let hoverFrame = 0;
  const setHover = (hover: Box | null): void => {
    if (!sameBox(useCommentDrag.getState().hover, hover)) useCommentDrag.setState({ hover });
  };
  /** Outlines the element under a resting pointer (one pick per frame). */
  const trackHover = (event: PointerEvent): void => {
    const surface = surfaceRef.current;
    const over =
      useTool.getState().commentMode &&
      !event.buttons &&
      surface &&
      event.target instanceof Element &&
      surface.contains(event.target) &&
      !event.target.closest('[data-wb-chrome],[data-no-pan]') &&
      boardComments.canComment();
    cancelAnimationFrame(hoverFrame);
    if (!over) {
      setHover(null);
      return;
    }
    const { clientX, clientY } = event;
    hoverFrame = requestAnimationFrame(() => setHover(elementBoxAt(boardPointAt(clientX, clientY, surface))));
  };
  const onDown = (event: PointerEvent): void => {
    const surface = surfaceRef.current;
    if (!useTool.getState().commentMode || event.button !== 0 || !surface || !(event.target instanceof Element)) return;
    if (!surface.contains(event.target) || event.target.closest('[data-wb-chrome],[data-no-pan]')) return;
    if (!boardComments.canComment()) return;
    event.preventDefault();
    event.stopPropagation();
    press = { pointerId: event.pointerId, start: boardPointAt(event.clientX, event.clientY, surface), startClient: { x: event.clientX, y: event.clientY } };
  };
  const onMove = (event: PointerEvent): void => {
    const surface = surfaceRef.current;
    if (!press) {
      trackHover(event);
      return;
    }
    if (event.pointerId !== press.pointerId || !surface) return;
    if (Math.hypot(event.clientX - press.startClient.x, event.clientY - press.startClient.y) < AREA_DRAG_PX) return;
    const point = boardPointAt(event.clientX, event.clientY, surface);
    useCommentDrag.setState({
      dragging: { x: Math.min(press.start.x, point.x), y: Math.min(press.start.y, point.y), w: Math.abs(point.x - press.start.x), h: Math.abs(point.y - press.start.y) },
    });
  };
  const onUp = (event: PointerEvent): void => {
    const surface = surfaceRef.current;
    if (!press || event.pointerId !== press.pointerId || !surface) return;
    const start = press.start;
    press = null;
    const rect = useCommentDrag.getState().dragging;
    useCommentDrag.setState({ dragging: null });
    const elements = useBoard.getState().board.content.elements;
    const measures = currentMeasures();
    const zoom = useCamera.getState().camera.zoom;
    const release = boardPointAt(event.clientX, event.clientY, surface);
    useComments.getState().setDraft(rect && rect.w > 0 && rect.h > 0 ? areaCommentDraft(rect, release, elements, measures, zoom) : pointCommentDraft(start, elements, measures, zoom));
  };
  const onCancel = (event: PointerEvent): void => {
    if (!press || event.pointerId !== press.pointerId) return;
    press = null;
    useCommentDrag.setState({ dragging: null });
  };
  // The camera moves under a still pointer: the next move picks again.
  const onWheel = (): void => {
    cancelAnimationFrame(hoverFrame);
    setHover(null);
  };
  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('wheel', onWheel, { passive: true });
  return () => {
    cancelAnimationFrame(hoverFrame);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };
}

/** Reports the comment state to the Shell. */
function reportToShell(): void {
  const { available, listOpen, threads } = useComments.getState();
  setShellReport({
    comments: { available, on: useTool.getState().commentMode, open: listOpen, count: openMessageCount(threads), pageButton: false },
  });
}

/**
 * Starts comments: loads the threads and follows changes, handles comment
 * mode's presses and the Shell's comment commands. Returns a stop function.
 */
export function startComments(): () => void {
  const comments = maybeSession()?.comments ?? null;
  const stops: Array<() => void> = [];
  useComments.setState({ on: useTool.getState().commentMode });
  if (comments) {
    void boardComments.start(comments);
    stops.push(() => boardComments.stop());
    stops.push(watchCommentPresses());
  }

  // Leaving comment mode drops an unsent draft.
  stops.push(
    useTool.subscribe((state, previous) => {
      if (state.commentMode !== previous.commentMode) {
        useComments.setState({ on: state.commentMode, ...(!state.commentMode && useComments.getState().draft ? { draft: null } : {}) });
        if (!state.commentMode) useCommentDrag.setState({ hover: null });
        reportToShell();
      }
    }),
  );
  // Comment mode turned on from the comments views (a row of the "All comments" panel) is the board's comment tool.
  stops.push(
    useComments.subscribe((state, previous) => {
      if (state.on !== previous.on && state.on !== useTool.getState().commentMode) useTool.getState().setCommentMode(state.on);
    }),
  );
  stops.push(
    useComments.subscribe((state, previous) => {
      if (state.threads !== previous.threads || state.listOpen !== previous.listOpen || state.available !== previous.available) reportToShell();
    }),
  );
  stops.push(
    onShellCommand((command) => {
      if (command.cmd === 'comments_mode') {
        const on = command.on ?? !useTool.getState().commentMode;
        if (on && !boardComments.canComment()) return;
        useTool.getState().setCommentMode(on);
      } else if (command.cmd === 'comments_list') {
        useComments.getState().setListOpen(command.open ?? !useComments.getState().listOpen);
      }
    }),
  );
  reportToShell();
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
