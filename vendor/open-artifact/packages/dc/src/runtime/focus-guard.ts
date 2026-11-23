/**
 * Keeps a board from taking focus it was not given.
 *
 * Every artboard is its own frame, and a component in one (an open modal
 * dialog, say, whose focus scope pulls focus back when it leaves) can call
 * `focus()` while the person is working elsewhere: on the canvas, or in a
 * text edit on another board. That would end the edit. While this frame's
 * document does not have focus, a component's `focus()` does nothing; the
 * runtime's own calls (a text edit's field, made with `ownFocus`) still go
 * through. Once the person clicks into the board (interacting with it),
 * the document has focus and components focus as usual.
 */

let own = 0;

/** Runs `run` with the runtime's own focus calls let through. */
export function ownFocus<T>(run: () => T): T {
  own += 1;
  try {
    return run();
  } finally {
    own -= 1;
  }
}

/** Focuses an element for the runtime itself. */
export function focusElement(element: HTMLElement | SVGElement, options?: FocusOptions): void {
  ownFocus(() => element.focus(options));
}

/** Installs the guard; only inside a frame. */
export function guardFocus(): void {
  if (window.parent === window) return;
  for (const proto of [HTMLElement.prototype, SVGElement.prototype]) {
    const focus = proto.focus;
    proto.focus = function guardedFocus(this: HTMLElement | SVGElement, options?: FocusOptions): void {
      if (own === 0 && !document.hasFocus()) return;
      focus.call(this, options);
    };
  }
}
