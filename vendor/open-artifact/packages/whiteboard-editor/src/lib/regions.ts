/**
 * The page's regions for F6 / ⇧F6: which come in what order, which key
 * moves between them, and when the page may say how.
 */

/** A part of the page F6 moves focus to. */
export type BoardRegion = 'toolbar' | 'canvas' | 'ask' | 'ask-status' | 'selection' | 'document' | 'zoom' | 'notifications';

/** The order F6 walks the regions in (⇧F6 walks it backwards); absent ones are skipped. */
export const BOARD_REGION_ORDER: readonly BoardRegion[] = ['toolbar', 'canvas', 'ask', 'ask-status', 'selection', 'document', 'zoom', 'notifications'];

/** Least time between two spoken F6 hints, ms. */
export const REGION_HINT_GAP_MS = 120_000;

/** How long a selection stays before the page says F6 reaches its toolbar, ms. */
export const SELECTION_HINT_DELAY_MS = 2000;

/** A hint waits this long after any other announcement, ms (so it never talks over one). */
export const REGION_HINT_QUIET_MS = 1500;

/** Said when the keyboard first reaches one of the page's toolbars. */
export const REGION_HINT = 'Press F6 to move between the toolbars and the board.';

/** Said a moment after something is selected from the keyboard. */
export const SELECTION_REGION_HINT = 'Press F6 to reach the selection toolbar.';

/** The parts of a key press {@link regionKeyStep} reads. */
export interface RegionKeyPress {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

/** Which way F6 (`1`) or ⇧F6 (`-1`) moves; `undefined` for other keys, modifiers or input-method composition. */
export function regionKeyStep(event: RegionKeyPress): 1 | -1 | undefined {
  if (event.key !== 'F6' || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return undefined;
  return event.shiftKey ? -1 : 1;
}

/**
 * The region F6 moves to from `current` (`undefined`: focus is in none of
 * them, so it starts at either end), going `step` along
 * {@link BOARD_REGION_ORDER} among the `present` ones and wrapping around.
 * `undefined` when no other region is there.
 */
export function nextRegion(present: ReadonlySet<BoardRegion>, current: BoardRegion | undefined, step: 1 | -1): BoardRegion | undefined {
  const order = BOARD_REGION_ORDER.filter((region) => present.has(region) || region === current);
  if (order.length === 0) return undefined;
  if (current === undefined) return step === 1 ? order[0] : order.at(-1);
  const at = order.indexOf(current);
  const next = order[(at + step + order.length) % order.length];
  return next === current ? undefined : next;
}

/** When hints were last said and announcements last made (epoch ms). */
export interface RegionHintClock {
  /** The last hint, if any. */
  hintAt: number | undefined;
  /** The last announcement of any kind, if any. */
  announcedAt: number | undefined;
}

/** Whether a hint may be said at `now`: none in the last {@link REGION_HINT_GAP_MS}, and nothing else said just before. */
export function regionHintDue(clock: RegionHintClock, now: number): boolean {
  if (clock.hintAt !== undefined && now - clock.hintAt < REGION_HINT_GAP_MS) return false;
  return clock.announcedAt === undefined || now - clock.announcedAt >= REGION_HINT_QUIET_MS;
}
