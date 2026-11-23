/**
 * Cropping a picture someone else changes (
 * `media/image-crop.tsx`): when a change from elsewhere takes the picture
 * away, swaps it, or resizes it, cropping stops, its gestures with it, and
 * a notice says why. Crops write as they go, so what was cropped so far
 * stays.
 *
 * Pure: unit-tested. The crop frame (`SelectionOverlay.tsx`) listens.
 */

import type { Board, BoardElement, ElementId } from '@open-artifact/whiteboard-core';

/** Said when cropping stops because someone else changed the picture. */
export const CROP_IMAGE_CHANGED_ELSEWHERE = 'Someone else changed this picture, so cropping stopped.';

/** Whether a change from elsewhere, `previous` → `next`, changed the picture being cropped: removed it, or changed its source or size. */
export function cropPictureChanged(previous: BoardElement | undefined, next: BoardElement | undefined): boolean {
  if (previous === next) return false;
  if (next?.type !== 'image') return true;
  if (previous?.type !== 'image') return true;
  return next.src !== previous.src || next.w !== previous.w || next.h !== previous.h;
}

/** Whether the remote change `previous` → `next` changed image `id` being cropped. */
export function cropTargetChanged(id: ElementId, next: Board, previous: Board): boolean {
  const find = (board: Board): BoardElement | undefined => board.content.elements.find((element) => element.id === id);
  return cropPictureChanged(find(previous), find(next));
}
