/**
 * The board's typefaces. Generic system stacks: every viewer (and the PNG
 * exporter, which measures with canvas) resolves the same family locally.
 */

/** Sans stack for body text. */
export const BOARD_SANS_FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Stack for large text (titles, huge). */
export const BOARD_DISPLAY_FONT_STACK = BOARD_SANS_FONT_STACK;
/** Monospace stack for inline code. */
export const BOARD_MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Text above this size uses the display face. */
export function isDisplayFontSize(px: number): boolean {
  return px > 16;
}

/** The family stack for a font size. */
export function boardFontFamily(px: number): string {
  return isDisplayFontSize(px) ? BOARD_DISPLAY_FONT_STACK : BOARD_SANS_FONT_STACK;
}

/** A CSS `font` shorthand for canvas measuring. */
export function boardFont(px: number, options: { weight?: number; italic?: boolean } = {}): string {
  return `${options.italic ? 'italic ' : ''}${options.weight ?? 400} ${px}px ${boardFontFamily(px)}`;
}

/** Runs `onLoaded` whenever web fonts finish loading (text must be re-measured). */
export function onBoardFontsLoaded(onLoaded: () => void, doc: Document = document): () => void {
  const fonts = doc.fonts;
  if (!fonts?.addEventListener) return () => undefined;
  let active = true;
  fonts.addEventListener('loadingdone', onLoaded);
  void fonts.ready.then(() => active && onLoaded());
  return () => {
    active = false;
    fonts.removeEventListener('loadingdone', onLoaded);
  };
}
