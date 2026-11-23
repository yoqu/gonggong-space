import { toast } from '@open-artifact/ui';
import { useUi } from '../stores/ui.ts';
import { FULLSCREEN_REFUSED } from './words.ts';

let target: HTMLElement | null = null;

/** The element that goes full screen (the player with its toolbar). */
export function setFullscreenTarget(element: HTMLElement | null): void {
  target = element;
}

/** Full screen can be asked for here (a frame may not allow it). */
export const fullscreenAvailable = (): boolean => typeof document !== 'undefined' && document.fullscreenEnabled === true;

export function toggleFullscreen(): void {
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (target === null || !fullscreenAvailable()) return;
  target.requestFullscreen().catch(() => toast.add({ title: FULLSCREEN_REFUSED }));
}

/** Follows the document's full-screen state into the ui store; returns a stop function. */
export function watchFullscreen(): () => void {
  const sync = (): void => useUi.setState({ fullscreen: document.fullscreenElement !== null && document.fullscreenElement === target });
  document.addEventListener('fullscreenchange', sync);
  sync();
  return () => document.removeEventListener('fullscreenchange', sync);
}
