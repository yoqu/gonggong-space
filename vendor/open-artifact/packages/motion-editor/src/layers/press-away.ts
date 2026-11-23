/**
 * A press outside the picture and the panel's controls lets the picked layer go. The picture, the side panel, any
 * control (a button, a field, the timeline's slider, a tab) and an open menu or dialog keep it. Pure;
 * `layers/install.ts` listens.
 */

/** Where a press keeps the pick: on the picture and its overlays, in the side panel, and on any control. */
export const KEEPS_PICK =
  '[data-video-stage], [data-video-stage-overlay], [data-video-panel], button, a, input, select, textarea, [role="slider"], [role="tab"], [role="menu"], [role="dialog"], [role="listbox"]';
/** While one of these is open anywhere, a press outside it closes it and nothing more. */
export const OPEN_POPUP = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Whether a press lets the pick go: the main button, outside where the pick is kept, and no popup open. Pure. */
export function pressLetsGo(press: { button: number; target: { closest(selectors: string): unknown } | null }, popupOpen: boolean): boolean {
  if (press.button !== 0 || popupOpen || press.target === null) return false;
  return press.target.closest(KEEPS_PICK) === null;
}
