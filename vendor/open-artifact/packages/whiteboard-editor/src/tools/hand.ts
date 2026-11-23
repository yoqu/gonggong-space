/** The hand tool: drag to pan. Also used for Space-drag and middle-button drag. */

import { panBy } from '../lib/camera.ts';
import { useCamera } from '../state/camera.ts';
import { registerTool, type Gesture, type PointerSample } from './gesture.ts';

/** A pan gesture starting at a sample. */
export function panGesture(start: PointerSample): Gesture {
  let last = start.screen;
  const surface = start.node?.closest<HTMLElement>('.wb-surface');
  if (surface) surface.dataset.wbGrabbing = '';
  const end = (): void => {
    if (surface) delete surface.dataset.wbGrabbing;
  };
  return {
    cursor: 'grabbing',
    move(sample) {
      const state = useCamera.getState();
      state.setCamera(panBy(state.camera, sample.screen.x - last.x, sample.screen.y - last.y));
      last = sample.screen;
    },
    up: end,
    cancel: end,
  };
}

registerTool('hand', (sample) => panGesture(sample));
