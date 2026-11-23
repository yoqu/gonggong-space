/**
 * How the page is shown. `inline`: framed by another page with `#view-inline` on its initial address, such as a
 * film embedded in a conversation; the film plays and stays live, read-only, without the full page's comments, agent
 * requests and edit keys. `full` otherwise; a page opened on its own (no parent) is always full, whatever its address
 * says. Read once per window and mirrored onto the root as `data-display-inline`.
 */

export type DisplayMode = 'inline' | 'full';

/** The parts of a window the mode is read from. */
export interface DisplayView {
  readonly parent: unknown;
  readonly location?: { readonly hash: string } | null;
  readonly document?: { readonly documentElement?: { toggleAttribute(name: string, force?: boolean): boolean } | null } | null;
}

/** The attribute on `<html>` that says the page is shown inline. */
export const DISPLAY_INLINE_ATTR = 'data-display-inline';

/** The address fragment that asks for the inline view. */
export const VIEW_INLINE_HASH = '#view-inline';

/** Framed by another page and asked for the inline view. */
export function isFramedInlineView(view: DisplayView): boolean {
  return view.parent !== view && view.location?.hash === VIEW_INLINE_HASH;
}

const modes = new WeakMap<DisplayView, DisplayMode>();

const thisWindow = (): DisplayView | null => (typeof window === 'undefined' ? null : window);

/** The mode `view` (this window by default) was opened in, read the first time it is asked. */
export function displayMode(view: DisplayView | null = thisWindow()): DisplayMode {
  if (view === null) return 'full';
  let mode = modes.get(view);
  if (mode === undefined) {
    mode = isFramedInlineView(view) ? 'inline' : 'full';
    modes.set(view, mode);
    view.document?.documentElement?.toggleAttribute(DISPLAY_INLINE_ATTR, mode === 'inline');
  }
  return mode;
}

/** The page is shown inline. */
export const isInlineDisplay = (view: DisplayView | null = thisWindow()): boolean => displayMode(view) === 'inline';
