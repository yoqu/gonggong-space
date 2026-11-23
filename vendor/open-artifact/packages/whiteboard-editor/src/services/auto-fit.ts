/**
 * Auto-fit: until the viewer first presses, types or scrolls on the page,
 * or something other than a fit moves the view, the camera keeps the whole
 * board in view. That covers the first open and the agent's claimed areas
 * and new items as it adds them. A tab that restored its own remembered
 * camera never auto-fits, and neither does one following someone.
 *
 * A fit happens only when the content outgrows the box last fitted or the
 * view changed its size or zoom range since, so a board that only changes
 * inside its bounds keeps a steady view, and a page that opened in a pane
 * still settling its size ends up fitted to the size it settles on.
 */

import { unionBounds, type Box } from '@open-artifact/whiteboard-core';
import { claimFrame } from '../collab/claim-frames.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { usePresence } from '../state/presence.ts';
import { contentBounds } from './navigation.ts';
import { fitTo } from './viewport.ts';

/** A view's size and layout. */
interface ViewShape {
  width: number;
  height: number;
  compact: boolean;
}

/** Whether `inner` lies within `outer`. */
function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Whether the view's size or its zoom range (the compact layout) differs. */
function viewChanged(a: ViewShape, b: ViewShape): boolean {
  return a.width !== b.width || a.height !== b.height || a.compact !== b.compact;
}

/** The box that holds everything on the board, the agent's claimed areas included. */
function boardBox(): Box | undefined {
  const content = useBoard.getState().board.content;
  const measures = currentMeasures();
  const claims = (content.claimed ?? []).map((claim) => claimFrame(claim, content.elements, measures));
  return unionBounds([contentBounds(content.elements, measures), ...claims].filter((box): box is Box => box !== undefined));
}

/**
 * Starts fitting the view to the board. `ownView`: this tab restored a
 * camera of its own, which it keeps. Returns a function that stops.
 */
export function startAutoFit({ ownView }: { ownView: boolean }): () => void {
  /** The box last fitted; undefined until the first fit. */
  let fitted: Box | undefined;
  /** The view's size and layout at the last fit. */
  let fittedView = { width: 0, height: 0, compact: false };
  /** A fit has been made with elements on the board (not only claims). */
  let fittedElements = false;
  /** The viewer pressed, typed or scrolled, or the view was moved: it is theirs from now on. */
  let interacted = false;
  /** A fit is moving the camera right now. */
  let fitting = false;

  const fit = (): void => {
    const camera = useCamera.getState();
    if (camera.width <= 1 || camera.height <= 1) return;
    if (usePresence.getState().following !== null) return;
    const hasElements = useBoard.getState().board.content.elements.length > 0;
    // Once a fit covered elements, only the viewer's own input stops fitting;
    // before that, a remembered view does.
    if (fitted !== undefined && (fittedElements || !hasElements) ? interacted : ownView) return;
    const box = boardBox();
    if (box === undefined) return;
    fittedElements ||= hasElements;
    if (fitted !== undefined && contains(fitted, box) && !viewChanged(camera, fittedView)) return;
    fitted = box;
    fittedView = { width: camera.width, height: camera.height, compact: camera.compact };
    fitting = true;
    try {
      fitTo(box);
    } finally {
      fitting = false;
    }
  };

  const stopCamera = useCamera.subscribe((state, previous) => {
    if (viewChanged(state, previous)) fit();
    else if (state.camera !== previous.camera && !fitting && fitted !== undefined) interacted = true;
  });
  const takeOver = (): void => {
    interacted = true;
  };
  const viewerInput = ['pointerdown', 'keydown', 'wheel'] as const;
  for (const type of viewerInput) window.addEventListener(type, takeOver, { capture: true, passive: true });
  const stopBoard = useBoard.subscribe((state, previous) => {
    if (state.board.content !== previous.board.content) fit();
  });
  fit();
  return () => {
    for (const type of viewerInput) window.removeEventListener(type, takeOver, { capture: true });
    stopCamera();
    stopBoard();
  };
}
