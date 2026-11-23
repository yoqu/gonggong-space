












import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Marks a field whose value was last set by dragging its label. Until it is
 * typed into, undo and redo there are the editor's, so they take the drag
 * back instead of doing nothing in the field.
 */
export const SCRUBBED = 'data-open-artifact-scrubbed';

/** The fields of a keydown {@link undoesScrub} reads. */
export interface ScrubUndoKey {
  target: unknown;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * True for ⌘Z, ⇧⌘Z or ⌘Y (Ctrl elsewhere) in a field marked {@link SCRUBBED}.
 * The caller has already let an input method's keys go by.
 */
export function undoesScrub(event: ScrubUndoKey): boolean {
  const target = event.target as { tagName?: string; hasAttribute?: (name: string) => boolean } | null;
  if (target?.tagName !== 'INPUT' || !target.hasAttribute?.(SCRUBBED)) return false;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  return key === 'z' || (key === 'y' && !event.shiftKey);
}

/** What a scrub reads, at every move (the latest render's values). */
export interface NumberScrubOptions {
  /** The value the scrub starts from. */
  value: number;
  step?: number;
  min?: number;
  max?: number;
  /** The value snapped steps are counted from. */
  origin?: number | null;
  disabled?: boolean;
  /** Each new value while dragging. */
  onScrub: (value: number) => void;
  /** The drag ended (after at least one move). */
  onScrubEnd?: () => void;
}

/** One drag, driven by the pointer's horizontal position. */
interface NumberScrubGesture {
  /** Moves to `clientX`; `large` (Shift) makes each pixel ten steps. */
  move(clientX: number, large: boolean): void;
  up(): void;
  /** The pointer has moved since the gesture started. */
  readonly live: boolean;
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 || text.includes('e') ? 0 : text.length - dot - 1;
}

/** Decimals a scrub keeps for `step` (at least two). */
function scrubPrecision(step: number): number {
  return Math.max(2, decimalPlaces(step), Math.ceil(-Math.log10(Math.max(step, Number.EPSILON))));
}

function roundScrubValue(value: number, step: number): number {
  const scale = 10 ** scrubPrecision(step);
  return Math.round(value * scale) / scale;
}

/** `value` on the grid of `step` (from `origin`, or whole numbers for a whole step). */
export function snapScrubValue(value: number, step: number, origin?: number | null): number {
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(value)) return value + 0;
  const unit = origin == null && Number.isInteger(step) ? 1 : step;
  const from = origin ?? 0;
  const steps = (value - from) / unit;
  const count = Math.round(Number(steps.toPrecision(12)));
  const scale = 10 ** Math.max(scrubPrecision(unit), decimalPlaces(from));
  const snapped = Math.round((count * unit + from) * scale) / scale + 0;
  if (Math.abs(steps) < 1e12 && Number.isFinite(snapped)) return snapped;
  const rounded = roundScrubValue(value, step) + 0;
  return Number.isFinite(rounded) ? rounded : value + 0;
}

function createNumberScrubGesture(read: () => NumberScrubOptions, startX: number): NumberScrubGesture {
  let lastX = startX;
  let running: number | null = null;
  let live = false;
  return {
    move(clientX, large) {
      const options = read();
      const dx = clientX - lastX;
      lastX = clientX;
      if (!live) {
        if (dx === 0) return;
        live = true;
      }
      if (running === null) running = Number.isFinite(options.value) ? options.value : 0;
      const step = options.step ?? 1;
      const clamp = (v: number): number => Math.min(options.max ?? Infinity, Math.max(options.min ?? -Infinity, v));
      running = clamp(running + dx * step * (large ? 10 : 1));
      const shown = running === options.min || running === options.max ? running : clamp(snapScrubValue(running, step, options.origin));
      options.onScrub(shown + 0);
    },
    up() {
      if (live) read().onScrubEnd?.();
    },
    get live() {
      return live;
    },
  };
}

/** The one scrub running (a new one ends it). */
let activeCleanup: (() => void) | null = null;

function attachNumberScrubGesture(gesture: NumberScrubGesture, own: Window = window): () => void {
  activeCleanup?.();
  const onMove = (event: MouseEvent): void => {
    if (event.buttons === 0) {
      end();
      return;
    }
    gesture.move(event.clientX, event.shiftKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (gesture.live) event.preventDefault();
    end();
  };
  const end = (): void => {
    if (activeCleanup === end) activeCleanup = null;
    own.removeEventListener('mousemove', onMove);
    own.removeEventListener('mouseup', end);
    own.removeEventListener('blur', end);
    own.removeEventListener('keydown', onKey, true);
    gesture.up();
  };
  activeCleanup = end;
  own.addEventListener('mousemove', onMove);
  own.addEventListener('mouseup', end);
  own.addEventListener('blur', end);
  own.addEventListener('keydown', onKey, true);
  return end;
}

/** Keeps a mouse scrub's moves coming when the pointer leaves the window (`onPointerDown` of the handle). */
export function captureNumberScrubPointer(event: ReactPointerEvent<HTMLElement>): void {
  if (event.button !== 0 || event.pointerType === 'touch') return;
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // The pointer is already gone.
  }
}

/** The `onMouseDown` of a scrub handle: starts a scrub with the options of the latest render. */
export function useNumberScrubGesture(options: NumberScrubOptions): (event: ReactMouseEvent<HTMLElement>) => void {
  const latest = useRef(options);
  latest.current = options;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (cleanup.current && cleanup.current === activeCleanup) cleanup.current();
    },
    [],
  );
  return (event) => {
    if (latest.current.disabled || event.button !== 0) return;
    event.preventDefault();
    // A field being typed into commits first (its blur).
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== event.currentTarget && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
    cleanup.current = attachNumberScrubGesture(createNumberScrubGesture(() => latest.current, event.clientX));
  };
}
