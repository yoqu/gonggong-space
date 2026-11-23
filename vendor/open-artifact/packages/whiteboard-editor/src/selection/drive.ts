/**
 * Runs a {@link Gesture} from a press on an overlay handle. Handles opt out
 * of the surface's press routing (`data-no-pan`), so they capture their own
 * pointer and route its moves and release here; Escape cancels. An abort
 * signal ends the gesture where it is, without its release or cancel (crop
 * mode ending because someone else changed the picture).
 */

import { sampleOf, type Gesture, type PointerSample } from '../tools/gesture.ts';

/** The board surface around a node. */
export function surfaceOf(node: Element): HTMLElement | null {
  return node.closest<HTMLElement>('.wb-surface');
}

/** A pointer sample for a press on an overlay node (`null` outside the surface). */
export function overlaySample(event: PointerEvent, node: Element): PointerSample | null {
  const surface = surfaceOf(node);
  return surface ? sampleOf(event, surface) : null;
}

/**
 * Starts driving `start(sample)`'s gesture from a handle press: captures
 * the pointer on `handle` and routes the rest of the press to the gesture,
 * until `signal` (if any) aborts it.
 */
export function driveFromHandle(event: PointerEvent, handle: Element, start: (sample: PointerSample) => Gesture | null, signal?: AbortSignal): void {
  if (event.button !== 0 || signal?.aborted) return;
  const surface = surfaceOf(handle);
  if (!surface) return;
  const gesture = start(sampleOf(event, surface));
  event.preventDefault();
  event.stopPropagation();
  if (!gesture) return;
  const pointerId = event.pointerId;
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    /* synthetic events cannot be captured */
  }
  let done = false;
  const stop = (): void => {
    done = true;
    handle.removeEventListener('pointermove', onMove as EventListener);
    handle.removeEventListener('pointerup', onUp as EventListener);
    handle.removeEventListener('pointercancel', onCancel as EventListener);
    handle.removeEventListener('lostpointercapture', onCancel as EventListener);
    window.removeEventListener('keydown', onKey, { capture: true });
    signal?.removeEventListener('abort', onAbort);
  };
  const onMove = (move: PointerEvent): void => {
    if (done || move.pointerId !== pointerId) return;
    const events = typeof move.getCoalescedEvents === 'function' ? move.getCoalescedEvents() : [];
    for (const each of events.length ? events : [move]) gesture.move?.(sampleOf(each, surface));
  };
  const onUp = (up: PointerEvent): void => {
    if (done || up.pointerId !== pointerId) return;
    stop();
    gesture.up?.(sampleOf(up, surface));
  };
  const onCancel = (cancel: PointerEvent): void => {
    if (done || cancel.pointerId !== pointerId) return;
    stop();
    gesture.cancel?.();
  };
  const onAbort = (): void => {
    if (done) return;
    stop();
    try {
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  };
  const onKey = (key: KeyboardEvent): void => {
    if (done || key.key !== 'Escape') return;
    key.stopPropagation();
    stop();
    gesture.cancel?.();
  };
  handle.addEventListener('pointermove', onMove as EventListener);
  handle.addEventListener('pointerup', onUp as EventListener);
  handle.addEventListener('pointercancel', onCancel as EventListener);
  handle.addEventListener('lostpointercapture', onCancel as EventListener);
  window.addEventListener('keydown', onKey, { capture: true });
  signal?.addEventListener('abort', onAbort, { once: true });
}
