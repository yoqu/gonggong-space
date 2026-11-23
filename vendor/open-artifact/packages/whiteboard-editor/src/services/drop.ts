/**
 * Dropping onto the board. {@link installDrop} takes picture and video
 * files dropped on the surface (they land where they were dropped), text
 * files (attached to the Ask panel, which opens for them; see
 * `services/files.ts`). While files the board can take are dragged over
 * the surface, the surface carries {@link DROP_HIGHLIGHT_CLASS}. Viewers
 * and commenters are told the board is read-only. Anywhere else on the
 * page a dragged file shows the no-drop pointer. (Stickers are dragged
 * out of the picker with the pointer, `ui/sticker-drag.ts`.)
 */

import { screenToBoard, type Point } from '../lib/camera.ts';
import { useCamera } from '../state/camera.ts';
import { canEditBoard } from './actions.ts';
import { READ_ONLY_MESSAGE, refuse } from './announce.ts';
import { insertFiles } from './files.ts';

/** Class on the surface while a drop it can take hovers over it. */
export const DROP_HIGHLIGHT_CLASS = 'wb-drop-over';

/** Whether a drag carries files (the only drops the board takes). */
export function dragHasFiles(types: readonly string[]): boolean {
  return types.includes('Files');
}

/** The board point under a drop at client coordinates over a surface whose box is `rect`. */
export function dropBoardPoint(client: Point, rect: Pick<DOMRect, 'left' | 'top'>): Point {
  return screenToBoard(useCamera.getState().camera, { x: client.x - rect.left, y: client.y - rect.top });
}

/** Installs dropping on the surface; returns a function that removes it. */
export function installDrop(surface: HTMLElement): () => void {
  let depth = 0;
  const highlight = (on: boolean): void => {
    surface.classList.toggle(DROP_HIGHLIGHT_CLASS, on);
  };
  const kindOf = (event: DragEvent): boolean => dragHasFiles([...(event.dataTransfer?.types ?? [])]);

  const onEnter = (event: DragEvent): void => {
    if (!kindOf(event)) return;
    event.preventDefault();
    depth += 1;
    if (canEditBoard()) highlight(true);
  };
  const onOver = (event: DragEvent): void => {
    if (!kindOf(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = canEditBoard() ? 'copy' : 'none';
  };
  const onLeave = (event: DragEvent): void => {
    if (!kindOf(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) highlight(false);
  };
  const onDrop = (event: DragEvent): void => {
    const kind = kindOf(event);
    depth = 0;
    highlight(false);
    if (!kind || !event.dataTransfer) return;
    event.preventDefault();
    if (!canEditBoard()) {
      refuse(READ_ONLY_MESSAGE);
      return;
    }
    const at = dropBoardPoint({ x: event.clientX, y: event.clientY }, surface.getBoundingClientRect());
    const files = [...event.dataTransfer.files];
    if (files.length > 0) void insertFiles(files, at);
  };

  // A file dropped beside the surface must not open in this tab, and the
  // pointer shows it cannot land there (places that take files, such as
  // the surface or the Ask panel, have already answered the drag).
  const onWindowOver = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    const taken = event.defaultPrevented;
    event.preventDefault();
    if (!taken) event.dataTransfer.dropEffect = 'none';
  };
  const onWindowDrop = (event: DragEvent): void => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  };

  surface.addEventListener('dragenter', onEnter);
  surface.addEventListener('dragover', onOver);
  surface.addEventListener('dragleave', onLeave);
  surface.addEventListener('drop', onDrop);
  window.addEventListener('dragover', onWindowOver);
  window.addEventListener('drop', onWindowDrop);
  return () => {
    surface.removeEventListener('dragenter', onEnter);
    surface.removeEventListener('dragover', onOver);
    surface.removeEventListener('dragleave', onLeave);
    surface.removeEventListener('drop', onDrop);
    window.removeEventListener('dragover', onWindowOver);
    window.removeEventListener('drop', onWindowDrop);
    highlight(false);
  };
}
