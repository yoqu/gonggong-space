/**
 * Moving the view to things on the board: fit the whole board, zoom to the
 * selection, bring a box into view, and the board point at the middle of
 * the view (where new things go when nothing says otherwise).
 */

import {
  centerCameraOn,
  elementBoundsWithTitle,
  elementsBounds,
  fitsInViewport,
  panCameraToReveal,
  unionBounds,
  type Box,
  type BoardElement,
  type ElementMeasures,
} from '@open-artifact/whiteboard-core';
import { screenToBoard, type Point } from '../lib/camera.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { fitTo, glideCamera, setCamera } from './viewport.ts';

/** Most a selection is zoomed to (a small sticker should not fill the screen). */
const SELECTION_MAX_ZOOM = 2;

/** The bounds of elements as drawn, section titles included. */
export function contentBounds(elements: readonly BoardElement[], measures: ElementMeasures = currentMeasures()): Box | undefined {
  const titles = elements.filter((element) => element.type === 'container').map((element) => elementBoundsWithTitle(element, measures, true));
  return unionBounds([elementsBounds(elements, measures), ...titles].filter((box): box is Box => box !== undefined));
}

/** Fits the whole board in the view (an empty board centers on the origin at 100%). */
export function fitBoard(): void {
  fitTo(contentBounds(useBoard.getState().board.content.elements) ?? null);
}

/** Zooms to the selected elements. */
export function fitSelection(): void {
  const ids = new Set(useSelection.getState().ids);
  if (ids.size === 0) return;
  const selected = useBoard.getState().board.content.elements.filter((element) => ids.has(element.id));
  const bounds = contentBounds(selected);
  if (bounds) fitTo(bounds, { maxZoom: SELECTION_MAX_ZOOM });
}

/** The view's size and the chrome insets, in the shape the core geometry takes. */
function viewGeometry() {
  const state = useCamera.getState();
  return { camera: state.camera, viewport: { w: state.width, h: state.height }, insets: { top: state.insets.top, bottom: state.insets.bottom } };
}

/**
 * Brings a board box into view: the least pan that shows it when it fits at
 * this zoom, else centered on it.
 */
export function revealBox(box: Box): void {
  const { camera, viewport, insets } = viewGeometry();
  setCamera(fitsInViewport(camera, box, viewport, insets) ? panCameraToReveal(camera, box, viewport, insets) : centerCameraOn(camera, box, viewport, insets));
}

/** Glides the view just far enough to show a board box (no centring, no zoom). */
export function glideToReveal(box: Box): void {
  const { camera, viewport, insets } = viewGeometry();
  glideCamera(panCameraToReveal(camera, box, viewport, insets));
}

/** Brings elements into view. */
export function revealElements(elements: readonly BoardElement[]): void {
  const bounds = contentBounds(elements);
  if (bounds) revealBox(bounds);
}

/** The board point at the middle of the view (between the chrome insets). */
export function viewCenter(): Point {
  const state = useCamera.getState();
  return screenToBoard(state.camera, {
    x: state.insets.left + (state.width - state.insets.left - state.insets.right) / 2,
    y: state.insets.top + (state.height - state.insets.top - state.insets.bottom) / 2,
  });
}
