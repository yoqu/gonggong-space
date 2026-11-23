/**
 * Viewport gestures and camera moves: wheel and trackpad (pan; zoom with
 * ⌘/Ctrl or a pinch), two-finger touch pinch, zoom steps, fitting the board
 * or a selection, and remembering this tab's camera.
 */

import { CAMERA_GLIDE_MS, centerOn, fitRect, glideCameraAt, nextZoomStep, panBy, recallCamera, rememberCamera, sameCamera, zoomAround, type Camera, type Point, type Rect } from '../lib/camera.ts';
import { useCamera, zoomRange } from '../state/camera.ts';

/** Wheel zoom factor of one wheel delta (pixels), clamped per event. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.min(1.25, Math.max(0.8, Math.exp(-deltaY * 0.01)));
}

/** A wheel stream pauses this long before its next event decides anew, ms. */
const WHEEL_STREAM_GAP_MS = 150;
/** Pointers silent this long no longer count toward a pinch, ms. */
const POINTER_STALE_TIMEOUT_MS = 1500;

/**
 * Decides what each wheel event of a stream does. The first event of a
 * stream decides between scrolling a scrollable child natively and panning;
 * the rest of the stream follows. ⌘/Ctrl (and trackpad pinches, which
 * browsers report with Ctrl) always zoom.
 */
export function createWheelGestureDecision(gapMs = WHEEL_STREAM_GAP_MS): { decide(time: number, zoom: boolean, moves: boolean, native: () => boolean): 'zoom' | 'pan' | 'native' | 'consume' } {
  let decided: 'native' | 'pan' | undefined;
  let last = -Infinity;
  return {
    decide(time, zoom, moves, native) {
      if (zoom) {
        decided = undefined;
        last = time;
        return 'zoom';
      }
      if (time - last > gapMs) decided = undefined;
      last = time;
      if (decided === undefined) {
        if (!moves) return 'consume';
        decided = native() ? 'native' : 'pan';
      }
      return decided;
    },
  };
}

/** True when the target (or an ancestor up to `root`) scrolls or takes text. */
export function scrollsNatively(target: EventTarget | null, root: Element): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (node as HTMLElement).isContentEditable) return true;
    const style = getComputedStyle(node);
    const scrollsY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
    const scrollsX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth;
    if (scrollsY || scrollsX) return true;
    node = node.parentElement;
  }
  return false;
}

/** Sets the camera. */
export function setCamera(camera: Camera): void {
  useCamera.getState().setCamera(camera);
}

/** The glide under way, if any. */
let glide: number | null = null;

/**
 * Moves the camera to `target` over a moment (at once when the viewer
 * prefers less motion). Any other camera move during the glide ends it.
 */
export function glideCamera(target: Camera): void {
  if (glide !== null) cancelAnimationFrame(glide);
  glide = null;
  const from = useCamera.getState().camera;
  if (sameCamera(from, target)) return;
  if (typeof requestAnimationFrame !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    setCamera(target);
    return;
  }
  const start = performance.now();
  let shown = from;
  const step = (now: number): void => {
    if (!sameCamera(useCamera.getState().camera, shown)) {
      glide = null;
      return;
    }
    const t = (now - start) / CAMERA_GLIDE_MS;
    shown = t >= 1 ? target : glideCameraAt(from, target, t);
    setCamera(shown);
    // The store may round what it was given; follow what it shows.
    shown = useCamera.getState().camera;
    glide = t >= 1 ? null : requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
}

/** Zooms around a screen point (default: the viewport center). */
export function zoomTo(zoom: number, anchor?: Point): void {
  const state = useCamera.getState();
  const { min, max } = zoomRange(state);
  const clamped = Math.min(max, Math.max(min, zoom));
  setCamera(zoomAround(state.camera, clamped, anchor ?? { x: state.width / 2, y: state.height / 2 }));
}

/** Zooms one step in or out around the viewport center. */
export function zoomStep(direction: 1 | -1): void {
  const state = useCamera.getState();
  const { min, max } = zoomRange(state);
  zoomTo(nextZoomStep(state.camera.zoom, direction, min, max));
}

/** Shows a board rectangle, fitted (never past 100%). */
export function fitTo(rect: Rect | null, options: { maxZoom?: number } = {}): void {
  const state = useCamera.getState();
  if (!rect) {
    setCamera(centerOn({ x: 0, y: 0 }, 1, state.width, state.height));
    return;
  }
  const { min } = zoomRange(state);
  setCamera(fitRect(rect, state.width, state.height, { insets: state.insets, minZoom: min, ...(options.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}) }));
}

/** Centers a board point at the current zoom. */
export function panToPoint(point: Point): void {
  const state = useCamera.getState();
  setCamera(centerOn(point, state.camera.zoom, state.width, state.height));
}

/** Restores this tab's last camera on a board; `false` when there is none. */
export function restoreCamera(key: string): boolean {
  const { min, max } = zoomRange();
  const camera = recallCamera(key, min, max);
  if (!camera) return false;
  setCamera(camera);
  return true;
}

/** Remembers the camera on every change (debounced); returns a stop function. */
export function keepCameraRemembered(key: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useCamera.subscribe((state, previous) => {
    if (state.camera === previous.camera) return;
    clearTimeout(timer);
    timer = setTimeout(() => rememberCamera(key, state.camera), 250);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

/** What {@link attachViewportGestures} needs. */
export interface ViewportGestureOptions {
  element: HTMLElement;
  /** Called when a two-finger gesture starts (cancel any one-finger gesture in progress). */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

/**
 * Wires wheel, trackpad and two-finger touch gestures to the camera.
 * One-finger and mouse presses are left to the board's own pointer handling.
 * Returns a detach function.
 */
export function attachViewportGestures(options: ViewportGestureOptions): () => void {
  const { element } = options;
  const wheel = createWheelGestureDecision();
  const local = (clientX: number, clientY: number): Point => {
    const bounds = element.getBoundingClientRect();
    return { x: clientX - bounds.left, y: clientY - bounds.top };
  };

  const onWheel = (event: WheelEvent): void => {
    const decision = wheel.decide(event.timeStamp, event.ctrlKey || event.metaKey, event.deltaX !== 0 || event.deltaY !== 0, () => scrollsNatively(event.target, element));
    if (decision === 'native') return;
    event.preventDefault();
    if (decision === 'consume') return;
    const lineY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const lineX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerWidth : 1;
    const state = useCamera.getState();
    if (decision === 'zoom') {
      const { min, max } = zoomRange(state);
      const zoom = Math.min(max, Math.max(min, state.camera.zoom * wheelZoomFactor(event.deltaY * lineY)));
      setCamera(zoomAround(state.camera, zoom, local(event.clientX, event.clientY)));
    } else {
      setCamera(panBy(state.camera, -event.deltaX * lineX, -event.deltaY * lineY));
    }
  };

  // Two-finger touch: pinch zoom and pan together.
  const touches = new Map<number, { x: number; y: number; at: number }>();
  let pinch: { distance: number; center: Point; camera: Camera } | null = null;
  const activeTouches = (now: number): [Point, Point] | null => {
    const fresh = [...touches.values()].filter((touch) => now - touch.at <= POINTER_STALE_TIMEOUT_MS);
    return fresh.length >= 2 ? [fresh[0]!, fresh[1]!] : null;
  };
  const startPinch = (now: number): void => {
    const pair = activeTouches(now);
    if (!pair) return;
    const [a, b] = pair;
    pinch = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, camera: useCamera.getState().camera };
    element.dataset.wbPinching = '';
    options.onGestureStart?.();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    const point = local(event.clientX, event.clientY);
    touches.set(event.pointerId, { ...point, at: event.timeStamp });
    if (touches.size === 2) startPinch(event.timeStamp);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { ...local(event.clientX, event.clientY), at: event.timeStamp });
    if (!pinch) return;
    const pair = activeTouches(event.timeStamp);
    if (!pair) return;
    const [a, b] = pair;
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { min, max } = zoomRange();
    const zoom = Math.min(max, Math.max(min, pinch.camera.zoom * (distance / pinch.distance)));
    const zoomed = zoomAround(pinch.camera, zoom, pinch.center);
    setCamera(panBy(zoomed, center.x - pinch.center.x, center.y - pinch.center.y));
  };
  const onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    touches.delete(event.pointerId);
    if (pinch && touches.size < 2) {
      pinch = null;
      delete element.dataset.wbPinching;
      options.onGestureEnd?.();
    }
  };
  // Safari's proprietary pinch events; the wheel path handles other browsers.
  const preventGesture = (event: Event): void => event.preventDefault();

  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('pointermove', onPointerMove, { capture: true });
  window.addEventListener('pointerup', onPointerEnd, { capture: true });
  window.addEventListener('pointercancel', onPointerEnd, { capture: true });
  element.addEventListener('gesturestart', preventGesture);
  element.addEventListener('gesturechange', preventGesture);
  return () => {
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('pointermove', onPointerMove, { capture: true });
    window.removeEventListener('pointerup', onPointerEnd, { capture: true });
    window.removeEventListener('pointercancel', onPointerEnd, { capture: true });
    element.removeEventListener('gesturestart', preventGesture);
    element.removeEventListener('gesturechange', preventGesture);
  };
}

/** True while a two-finger gesture runs on the viewport element. */
export function isPinching(element: HTMLElement | null): boolean {
  return element?.dataset.wbPinching !== undefined;
}
