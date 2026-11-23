/**
 * Cancelling a crop: the crop a picture had when cropping began is kept,
 * so ⌘Z while cropping puts it back (as one undo step) and leaves crop
 * mode. Crops write as they go, so leaving without cancelling keeps them.
 */

import type { ElementId, ImageCrop } from '@open-artifact/whiteboard-core';
import { writeImageCrop } from '../selection/transform.ts';
import { useBoard } from '../state/board.ts';
import { useSelection } from '../state/selection.ts';
import { gestureKey } from '../tools/gesture.ts';
import { announce } from './announce.ts';

/** Said when ⌘Z cancels a crop. */
export const CROP_CANCELLED_MESSAGE = 'Cropping cancelled.';

/** The picture being cropped and its crop when cropping began. */
let started: { id: ElementId; crop: ImageCrop | undefined } | null = null;

function cropOf(id: ElementId): ImageCrop | undefined {
  const element = useBoard.getState().byId.get(id);
  return element?.type === 'image' ? element.crop : undefined;
}

/** Starts remembering each crop's starting point; returns a function that stops. */
export function startCropMemory(): () => void {
  const note = (id: ElementId | null): void => {
    started = id === null ? null : { id, crop: cropOf(id) };
  };
  note(useSelection.getState().cropping);
  const off = useSelection.subscribe((state, previous) => {
    if (state.cropping !== previous.cropping) note(state.cropping);
  });
  return () => {
    off();
    started = null;
  };
}

/** Cancels the crop under way: the picture gets back its starting crop, crop mode ends, and it is said. `false` when nothing is being cropped. */
export function cancelCrop(): boolean {
  const selection = useSelection.getState();
  const id = selection.cropping;
  if (id === null) return false;
  const from = started?.id === id ? started.crop : undefined;
  if (started?.id === id && JSON.stringify(cropOf(id)) !== JSON.stringify(from)) writeImageCrop(id, from, gestureKey('crop-cancel', id));
  selection.setCropping(null);
  announce(CROP_CANCELLED_MESSAGE);
  return true;
}
