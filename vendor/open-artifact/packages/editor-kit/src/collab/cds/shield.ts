/**
 * Keeps the comments layer's events away from the editor runtime, which listens on window and document (its
 * shortcuts, outside-click and wheel handlers) and would act on a key typed in a comment.
 *
 * A window capture listener, installed before the runtime starts so it runs first, takes each event that happens
 * inside the layer: it stops the original there, then dispatches a copy at the same target that is not `composed`, so
 * the copy stays inside the shadow root, where React (and Base UI) handle it. If a handler cancels the copy, the
 * original is cancelled too, so default actions (typing, focus on mousedown) follow what the handlers decided.
 *
 * Events the runtime does not watch for shortcuts (click, input, focus…) pass as they are and stop at the layer.
 *
 * `mouseup` goes through untouched, out to the document: Base UI's menu trigger arms its press-drag-release on
 * mousedown and disarms it from a one-time mouseup listener on the document; without that mouseup every menu item
 * click would fire twice. The runtime's own mouseup handlers only finish drags it started, and the mousedown that
 * would start one is shielded.
 *
 * Open Artifact: one shield per window, installed when the editor kit's views load (before an editor's own listeners);
 * every comments layer's shadow host joins it (`addHost`, layer.tsx).
 */

const SHIELDED = [
  'keydown',
  'keyup',
  'keypress',
  'pointerdown',
  'pointerup',
  'pointermove',
  'mousedown',
  'mousemove',
  'touchstart',
  'touchend',
  'touchmove',
  'wheel',
  'paste',
  'copy',
  'cut',
  'contextmenu',
  'dblclick',
  'compositionstart',
  'compositionupdate',
  'compositionend',
] as const;

const STOPPED_AT_LAYER = ['click', 'auxclick', 'input', 'change', 'beforeinput', 'focusin', 'focusout'] as const;

const MOUSE_KEYS = ['clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'movementX', 'movementY', 'detail'] as const;
const POINTER_KEYS = ['pointerId', 'pointerType', 'isPrimary', 'width', 'height', 'pressure', 'tangentialPressure', 'tiltX', 'tiltY', 'twist'] as const;
const KEY_KEYS = ['key', 'code', 'location', 'repeat', 'isComposing', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'keyCode', 'charCode', 'which'] as const;
const WHEEL_KEYS = ['deltaX', 'deltaY', 'deltaZ', 'deltaMode'] as const;
const TOUCH_KEYS = ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'] as const;

function pick(event: Event, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = (event as unknown as Record<string, unknown>)[key];
  return out;
}

/** The same event, not composed: it stays in the shadow root it is dispatched in. */
function copyOf(event: Event, win: Window & typeof globalThis): Event | null {
  const base = { bubbles: true, cancelable: event.cancelable, composed: false, view: win };
  if (win.PointerEvent && event instanceof win.PointerEvent) {
    return new win.PointerEvent(event.type, { ...base, ...pick(event, MOUSE_KEYS), ...pick(event, POINTER_KEYS) });
  }
  if (win.WheelEvent && event instanceof win.WheelEvent) return new win.WheelEvent(event.type, { ...base, ...pick(event, MOUSE_KEYS), ...pick(event, WHEEL_KEYS) });
  if (event instanceof win.MouseEvent) return new win.MouseEvent(event.type, { ...base, ...pick(event, MOUSE_KEYS) });
  if (event instanceof win.KeyboardEvent) return new win.KeyboardEvent(event.type, { ...base, ...pick(event, KEY_KEYS) });
  if (win.TouchEvent && event instanceof win.TouchEvent) {
    return new win.TouchEvent(event.type, {
      ...base,
      ...pick(event, TOUCH_KEYS),
      touches: [...event.touches],
      targetTouches: [...event.targetTouches],
      changedTouches: [...event.changedTouches],
    });
  }
  if (win.ClipboardEvent && event instanceof win.ClipboardEvent) return new win.ClipboardEvent(event.type, { ...base, clipboardData: event.clipboardData });
  if (event instanceof win.CompositionEvent) return new win.CompositionEvent(event.type, { ...base, data: event.data });
  return null;
}

export interface ShieldOptions {
  /** Called for every pointerdown, with whether it happened inside the layer (before the copy is dispatched). */
  onPointerDown?: (inside: boolean, event: PointerEvent) => void;
}

export interface Shield {
  /** Shield another shadow host as part of the layer (a seat in the page's toolbar); the returned function stops. */
  addHost(host: Element): () => void;
}

export function installShield(win: Window & typeof globalThis, options: ShieldOptions = {}): Shield {
  const hosts = new Set<EventTarget>();
  const stop = (event: Event) => event.stopPropagation();
  for (const type of SHIELDED) {
    win.addEventListener(
      type,
      event => {
        const path = event.composedPath();
        const inside = path.some(node => hosts.has(node));
        if (type === 'pointerdown') options.onPointerDown?.(inside, event as PointerEvent);
        if (!inside) return;
        event.stopImmediatePropagation();
        const target = path[0];
        const copy = copyOf(event, win);
        if (!copy || !target) return;
        target.dispatchEvent(copy);
        if (copy.defaultPrevented && event.cancelable) event.preventDefault();
      },
      { capture: true, passive: false },
    );
  }
  return {
    addHost(extra) {
      hosts.add(extra);
      for (const type of STOPPED_AT_LAYER) extra.addEventListener(type, stop);
      return () => {
        hosts.delete(extra);
        for (const type of STOPPED_AT_LAYER) extra.removeEventListener(type, stop);
      };
    },
  };
}
