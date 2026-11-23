/**
 * Keyboard guards shared by the kit's controls.
 *
 * A key held down auto-repeats: without a guard, holding Enter on a button,
 * a menu row that keeps its menu open or a switch presses it again and again,
 * and a press that moves focus (closing a toast, opening a dialog) lands the
 * repeats on whatever gets focus next.
 */

/** The fields of a keyboard event the guards read. */
export interface KeyLike {
  key: string;
  repeat: boolean;
}

/** The fields of a keyboard event that tell an input method is composing. */
export interface ComposingLike {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * True while an input method composes (Chinese, Japanese, Korean…): the
 * Enter or Escape it sees picks or drops the candidate, so a field must not
 * also commit or cancel on it. Safari reports the end of a composition as
 * key code 229 with `isComposing` already false.
 */
export function isComposingKey(event: ComposingLike): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229;
}

/** True for an auto-repeated Enter or Space. */
export function isRepeatedActivation(event: KeyLike): boolean {
  return event.repeat && (event.key === 'Enter' || event.key === ' ');
}

/** A keydown event as the guards see it. */
export type GuardedKeyEvent = KeyLike & { target: unknown; currentTarget: unknown; preventDefault(): void };

/**
 * A keydown handler that keeps a held Enter or Space from pressing the
 * focused control again: the repeats have their default (the native click,
 * or Base UI's activation) prevented.
 */
export function preventRepeatedActivation(event: GuardedKeyEvent): void {
  if (isRepeatedActivation(event) && event.target === event.currentTarget) event.preventDefault();
}

/**
 * Wraps a keydown handler so a held Enter or Space presses the control once:
 * the repeats have their default (the native click, or Base UI's activation)
 * prevented. The wrapped handler still runs (and sees `defaultPrevented`).
 */
export function withRepeatGuard<E extends GuardedKeyEvent>(handler?: (event: E) => void): (event: E) => void {
  if (!handler) return preventRepeatedActivation;
  return (event) => {
    preventRepeatedActivation(event);
    handler(event);
  };
}

/** The parts of a window {@link guardHeldActivation} listens on. */
export interface KeyGuardWindow {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyGuardEvent) => void, capture: boolean): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyGuardEvent) => void, capture: boolean): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** The parts of a keyboard event {@link guardHeldActivation} reads. */
export interface KeyGuardEvent extends KeyLike {
  type: string;
  target: unknown;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/** How long the guard stays after the first key is released. */
export const HELD_KEY_SETTLE_MS = 200;
/** The guard never lasts longer than this. */
export const HELD_KEY_GUARD_MAX_MS = 2000;

/**
 * After an Enter or Space press that closes something (a toast's close
 * button), keeps the activation keys from pressing what gets focus next:
 * until the pressed key is released, plus a short settle, Enter and Space
 * keydowns outside `isInside` are swallowed at the window, and so are Space
 * keyups (a native button acts on Space's keyup). Lasts at most 2 s.
 * Returns a function that ends the guard early.
 */
export function guardHeldActivation(
  win: KeyGuardWindow,
  firstKey: string,
  isInside: (target: unknown) => boolean,
): () => void {
  let settling: number | null = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('keyup', onKey, true);
    win.clearTimeout(limit);
    if (settling !== null) win.clearTimeout(settling);
  };
  const onKey = (event: KeyGuardEvent) => {
    const activation = event.key === 'Enter' || event.key === ' ';
    if (event.type === 'keyup') {
      if (event.key === ' ' && !isInside(event.target)) event.preventDefault();
      if (event.key === firstKey && settling === null) settling = win.setTimeout(end, HELD_KEY_SETTLE_MS);
      return;
    }
    if (activation && !isInside(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const limit = win.setTimeout(end, HELD_KEY_GUARD_MAX_MS);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('keyup', onKey, true);
  return end;
}
