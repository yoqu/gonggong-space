/**
 * F6 / ⇧F6 move focus between the page's regions (`lib/regions.ts` has the
 * order). Each region is marked `data-wb-region` in the page; the
 * notifications region is the toasts, while one is up. A region gets back
 * focus on the control it last had, else its pressed or first control.
 *
 * F6 does nothing while an input method composes, or behind a modal
 * overlay (the board is hidden from assistive tech then). The page says how
 * F6 works when the keyboard first reaches a toolbar, and a moment after a
 * selection made from the keyboard, never over another announcement, at
 * most every two minutes (`REGION_HINT_GAP_MS`), and not once F6 has been used.
 */

import {
  BOARD_REGION_ORDER,
  REGION_HINT,
  SELECTION_HINT_DELAY_MS,
  SELECTION_REGION_HINT,
  nextRegion,
  regionHintDue,
  regionKeyStep,
  type BoardRegion,
} from '../lib/regions.ts';
import { useSelection } from '../state/selection.ts';
import { announce, lastAnnouncedAt } from './announce.ts';

/** The attribute that marks a region's root. */
export const REGION_ATTRIBUTE = 'data-wb-region';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function isRegion(value: string | undefined): value is BoardRegion {
  return value !== undefined && (BOARD_REGION_ORDER as readonly string[]).includes(value);
}

/** Whether an element is laid out (not `display: none`, not detached). */
function shown(element: Element): boolean {
  return element.isConnected && element.getClientRects().length > 0;
}

/** The roots of the regions on the page now, by region. */
function regionRoots(doc: Document): Map<BoardRegion, HTMLElement> {
  const roots = new Map<BoardRegion, HTMLElement>();
  for (const element of doc.querySelectorAll<HTMLElement>(`[${REGION_ATTRIBUTE}]`)) {
    const region = element.getAttribute(REGION_ATTRIBUTE) ?? undefined;
    if (isRegion(region) && !roots.has(region) && shown(element)) roots.set(region, element);
  }
  const toast = [...doc.querySelectorAll<HTMLElement>('[data-toast]')].find(shown);
  if (toast) roots.set('notifications', toast.parentElement ?? toast);
  return roots;
}

/** The region an element is in. */
function regionOf(node: Node | null, roots: ReadonlyMap<BoardRegion, HTMLElement>): BoardRegion | undefined {
  if (!node) return undefined;
  for (const [region, root] of roots) if (root.contains(node)) return region;
  return undefined;
}

/** Where focus goes in a region it has not been in: the canvas itself, the first toast, a pressed control, or the first control. */
function entryOf(region: BoardRegion, root: HTMLElement): HTMLElement | undefined {
  if (region === 'canvas' || region === 'ask-status') return root;
  if (region === 'notifications') return root.querySelector<HTMLElement>('[data-toast]') ?? undefined;
  const controls = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
  return controls.find((control) => control.getAttribute('aria-pressed') === 'true' || control.getAttribute('aria-checked') === 'true') ?? controls[0];
}

/** Whether a modal overlay hides the board (a dialog or a modal menu marks the rest of the page hidden). */
function behindOverlay(doc: Document): boolean {
  const board = doc.querySelector('.wb-root');
  return board !== null && board.closest('[aria-hidden="true"], [inert]') !== null;
}

/** Whether an element got focus from the keyboard. */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** Installs F6 and its hints; returns a function that removes them. */
export function installRegions(): () => void {
  if (typeof window === 'undefined') return () => {};
  const doc = document;
  const last = new Map<BoardRegion, HTMLElement>();
  let hintAt: number | undefined;
  /** F6 was used here: no more hints about it. */
  let knowsF6 = false;
  let selectionHint: ReturnType<typeof setTimeout> | undefined;

  const hint = (message: string): void => {
    const now = Date.now();
    if (knowsF6 || !regionHintDue({ hintAt, announcedAt: lastAnnouncedAt() }, now)) return;
    hintAt = now;
    announce(message);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const step = regionKeyStep(event);
    if (step === undefined || behindOverlay(doc)) return;
    const roots = regionRoots(doc);
    const current = regionOf(doc.activeElement, roots);
    const region = nextRegion(new Set(roots.keys()), current, step);
    // The toasts would otherwise take F6 for themselves.
    event.preventDefault();
    event.stopPropagation();
    knowsF6 = true;
    if (region === undefined) return;
    const root = roots.get(region)!;
    const remembered = last.get(region);
    const target = remembered !== undefined && root.contains(remembered) && shown(remembered) ? remembered : entryOf(region, root);
    if (target === undefined) return;
    if (target === root && !root.hasAttribute('tabindex')) root.tabIndex = -1;
    target.focus({ preventScroll: true });
  };

  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const roots = regionRoots(doc);
    const region = regionOf(target, roots);
    if (region === undefined) return;
    last.set(region, target);
    const from = event.relatedTarget instanceof Node ? regionOf(event.relatedTarget, roots) : undefined;
    if (region !== 'canvas' && region !== 'notifications' && from !== region && focusVisible(target)) hint(REGION_HINT);
  };

  const offSelection = useSelection.subscribe((state, previous) => {
    if (state.ids === previous.ids) return;
    clearTimeout(selectionHint);
    selectionHint = undefined;
    const surface = doc.querySelector('.wb-surface');
    if (state.ids.length === 0 || surface === null || doc.activeElement !== surface) return;
    selectionHint = setTimeout(() => {
      selectionHint = undefined;
      if (useSelection.getState().ids.length > 0 && regionRoots(doc).has('selection')) hint(SELECTION_REGION_HINT);
    }, SELECTION_HINT_DELAY_MS);
  });

  window.addEventListener('keydown', onKeyDown, { capture: true });
  doc.addEventListener('focusin', onFocusIn);
  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    doc.removeEventListener('focusin', onFocusIn);
    offSelection();
    clearTimeout(selectionHint);
  };
}
