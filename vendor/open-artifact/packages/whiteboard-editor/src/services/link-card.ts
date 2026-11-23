/**
 * Board links: opening them and their hover card.
 *
 * - A click on a link (`[data-wb-link]`: a link in text, a link card, a
 *   linked picture's corner) opens it after {@link LINK_OPEN_DELAY_MS}
 *   unless a double click follows; Mod-click, a click on an open arrow
 *   (`[data-wb-opens]`) and a viewer's click open at once. A link the
 *   board does not open shows its card instead.
 * - Resting the pointer on a link shows its card ({@link useLinkCard});
 *   it stays while the pointer is on the link or the card, and hides when
 *   the link moves, on scroll, wheel or resize.
 * - While typing, the caret resting in a link shows its card; Tab moves
 *   into it and out again, Escape hides it.
 * - A link opened from the text being typed resumes the typing when the
 *   window gets focus back.
 */

import { isElementLocked, type ElementId } from '@open-artifact/whiteboard-core';
import { writeClipboardText } from '@open-artifact/editor-kit';
import { useAreaPick } from '../collab/area-pick.ts';
import { boardLinkTarget, openBoardLink } from '../elements/links.ts';
import { LINK_CHORD_EVENT, caretLinkChip, editableRootOf, placeCaretAfter } from '../elements/rich-dom.ts';
import {
  LINK_CARD_COOLDOWN_MS,
  LINK_CARD_HIDE_MS,
  LINK_OPEN_DELAY_MS,
  linkBlock,
  linkBoxMoved,
  linkCardShowDelay,
  linkClickAction,
  pressIsClick,
  type ScreenBox,
} from '../lib/link-card.ts';
import { isApplePlatform } from '../lib/tools.ts';
import { useBoard } from '../state/board.ts';
import { useLinkCard } from '../state/link-card.ts';
import { useSelection, type TextEditTarget } from '../state/selection.ts';
import { effectiveTool, useTool } from '../state/tool.ts';
import type { PointerSample } from '../tools/gesture.ts';
import { canEditBoard } from './actions.ts';
import { announce, notify } from './announce.ts';
import { maybeSession } from './session.ts';

/** The same link opening twice within this long (ms) is one open (a ghost click). */
const SAME_OPEN_MS = 700;
/** The window must lose focus this soon (ms) after a link opened for typing to resume on return. */
const LEAVE_WINDOW_MS = 1000;

/** Selector of the card's root. */
export const LINK_CARD_SELECTOR = '[data-wb-link-card]';

/** Told when copying the address fails. */
export const LINK_COPY_FAILED_MESSAGE = "The link couldn't be copied. Try again.";

/* ------------------------------------------------------------------------ */
/* Finding links                                                            */
/* ------------------------------------------------------------------------ */

/** The board link at a DOM node (not a link in the text being typed). */
export function boardLinkNode(node: EventTarget | null): HTMLElement | null {
  if (typeof Element === 'undefined' || !(node instanceof Element)) return null;
  return node.closest<HTMLElement>('[data-wb-link]');
}

function inCard(node: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && node instanceof Element && node.closest(LINK_CARD_SELECTOR) !== null;
}

function boxOf(node: Element): ScreenBox {
  const rect = node.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** Links in words (notes, shapes, texts) can be edited from their card. */
function wordsLinkEditable(node: HTMLElement, id: ElementId | null): boolean {
  const element = id === null ? undefined : useBoard.getState().byId.get(id);
  if (!element || !canEditBoard() || isElementLocked(element) || !node.matches('.wb-text-link')) return false;
  return element.type === 'note' || element.type === 'shape' || element.type === 'text';
}

/** Overlays and tools that own the pointer keep links from opening. */
function pointerTaken(): boolean {
  return useTool.getState().commentMode || effectiveTool() !== 'select' || useAreaPick.getState().rect !== null;
}

/* ------------------------------------------------------------------------ */
/* Opening                                                                  */
/* ------------------------------------------------------------------------ */

let pendingOpen: ReturnType<typeof setTimeout> | undefined;
let lastOpen: { url: string; at: number } | null = null;
let lastOpenedAt: number | null = null;
let stopResume: (() => void) | null = null;

/** Drops a click's delayed open (a double click came instead). */
export function cancelPendingLinkOpen(): void {
  clearTimeout(pendingOpen);
  pendingOpen = undefined;
}

/** Puts typing back into `target` once the window gets focus back after the link took it. */
function resumeTypingOnReturn(target: TextEditTarget): void {
  stopResume?.();
  let left = false;
  const onBlur = (): void => {
    left = true;
  };
  const onFocus = (): void => {
    stop();
    if (!left || useSelection.getState().editing !== null || !canEditBoard() || !useBoard.getState().byId.has(target.id)) return;
    useSelection.getState().select([target.id]);
    useSelection.getState().edit(target);
  };
  const timer = setTimeout(() => {
    if (!left) stop();
  }, LEAVE_WINDOW_MS);
  const stop = (): void => {
    clearTimeout(timer);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    if (stopResume === stop) stopResume = null;
  };
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  stopResume = stop;
}

/**
 * Opens a board link in a new tab, at most once for one click (a ghost
 * click opens nothing more). `resume` is the text being typed it was
 * opened from. Returns `false` for a link the board does not open.
 */
export function openLink(href: string, resume?: TextEditTarget | null): boolean {
  const target = boardLinkTarget(href);
  if (target === undefined || linkBlock(href, target) !== undefined) return false;
  cancelPendingLinkOpen();
  const now = performance.now();
  if (lastOpen !== null && lastOpen.url === target && now - lastOpen.at < SAME_OPEN_MS) return true;
  lastOpen = { url: target, at: now };
  lastOpenedAt = now;
  hideLinkCard();
  openBoardLink(target);
  if (resume) resumeTypingOnReturn(resume);
  return true;
}

/**
 * A click released on the board (from the Select tool's press): opens the
 * link under it as the module comment says. `down` is where the press
 * started, `up` where it ended.
 */
export function clickBoardLink(down: PointerSample, up: PointerSample): void {
  const link = boardLinkNode(down.node);
  if (!link || pointerTaken()) return;
  const moved = Math.hypot(up.screen.x - down.screen.x, up.screen.y - down.screen.y);
  if (!pressIsClick({ pointerType: down.event.pointerType, ms: up.event.timeStamp - down.event.timeStamp, moved })) return;
  const action = linkClickAction(down.event, isApplePlatform());
  if (action === 'none') return;
  const href = link.dataset.wbLink ?? '';
  if (linkBlock(href, boardLinkTarget(href)) !== undefined) {
    showLinkCard(link, 'board');
    return;
  }
  if (action === 'now' || !canEditBoard() || down.node?.closest('[data-wb-opens]')) {
    openLink(href);
    return;
  }
  cancelPendingLinkOpen();
  pendingOpen = setTimeout(() => {
    pendingOpen = undefined;
    if (link.isConnected) openLink(href);
  }, LINK_OPEN_DELAY_MS);
}

/* ------------------------------------------------------------------------ */
/* The card                                                                 */
/* ------------------------------------------------------------------------ */

/** The link the card is shown for. */
let anchor: HTMLElement | null = null;
let serial = 0;
let watchFrame = 0;

/** Hides the card. */
export function hideLinkCard(): void {
  anchor = null;
  cancelAnimationFrame(watchFrame);
  watchFrame = 0;
  if (useLinkCard.getState().card !== null) useLinkCard.setState({ card: null });
}

/** Hides the card when its link moves or goes away. */
function watchAnchor(): void {
  cancelAnimationFrame(watchFrame);
  watchFrame = requestAnimationFrame(() => {
    const card = useLinkCard.getState().card;
    if (card === null || anchor === null) return;
    if (!anchor.isConnected || linkBoxMoved(card.anchor, boxOf(anchor))) return hideLinkCard();
    watchAnchor();
  });
}

/** Shows the card for a link on the board or a chip in the text being typed. */
function showLinkCard(node: HTMLElement, origin: 'board' | 'editor'): void {
  const href = (origin === 'board' ? node.dataset.wbLink : node.dataset.href) ?? '';
  const target = boardLinkTarget(href);
  const blocked = linkBlock(href, target);
  const editing = useSelection.getState().editing;
  const id = origin === 'editor' ? (editing?.id ?? null) : (node.closest<HTMLElement>('[data-wb-id]')?.dataset.wbId ?? null);
  anchor = node;
  serial += 1;
  useLinkCard.setState({
    card: {
      href: target ?? href,
      target: blocked === undefined ? target : undefined,
      blocked,
      anchor: boxOf(node),
      origin,
      id,
      editable: origin === 'editor' ? editing !== null : wordsLinkEditable(node, id),
      serial,
    },
  });
  watchAnchor();
}

/** True while the card shows for the link the caret is in. */
export function linkCardFromEditor(): boolean {
  return useLinkCard.getState().card?.origin === 'editor';
}

/** The card's controls, in order. */
function cardControls(): HTMLElement[] {
  const card = document.querySelector(LINK_CARD_SELECTOR);
  return card ? [...card.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')] : [];
}

/** Tab from the text being typed: focus goes to the card's first control. Returns whether it did. */
export function focusLinkCard(): boolean {
  const [first] = cardControls();
  if (!first || !linkCardFromEditor()) return false;
  first.focus();
  return true;
}

/** Focus in the text a chip is in, the caret right after it. */
function caretAfter(chip: HTMLElement | null): void {
  const root = chip ? editableRootOf(chip) : null;
  if (!chip || !root) return;
  root.focus({ preventScroll: true });
  placeCaretAfter(chip);
}

/** Puts focus back in the text the card's link is in, the caret right after the link. */
export function returnToLinkText(): void {
  caretAfter(anchor);
}

/** Tab within the card: off either end, focus goes back to the text being typed. Returns whether it moved focus. */
export function tabOutOfLinkCard(from: Element, backwards: boolean): boolean {
  if (!linkCardFromEditor()) return false;
  const controls = cardControls();
  const index = controls.findIndex((control) => control === from || control.contains(from));
  if (backwards ? index > 0 : index < controls.length - 1) return false;
  returnToLinkText();
  return true;
}

/** Copies the card's address; says so (or that it failed). Resolves to whether it copied. */
export async function copyLinkAddress(): Promise<boolean> {
  const card = useLinkCard.getState().card;
  if (card === null) return false;
  try {
    await writeClipboardText(card.href, maybeSession()?.shell);
    announce('Link copied');
    return true;
  } catch {
    announce(LINK_COPY_FAILED_MESSAGE);
    notify(LINK_COPY_FAILED_MESSAGE);
    return false;
  }
}

/** Opens the card's link (focus goes back to the text it was typed in, if any). */
export function openCardLink(): void {
  const card = useLinkCard.getState().card;
  if (card?.target === undefined) return;
  const resume = card.origin === 'editor' ? useSelection.getState().editing : null;
  if (card.origin === 'editor') returnToLinkText();
  openLink(card.target, resume);
}

/** Waits a few frames for `find` to give something, then hands it to `then`. */
function whenFound<T>(find: () => T | null, then: (found: T) => void, frames = 30): void {
  const found = find();
  if (found !== null) return then(found);
  if (frames > 0) requestAnimationFrame(() => whenFound(find, then, frames - 1));
}

/** Edit link: opens the typing bar's link field on the card's link (starting to type into its words first). */
export function editCardLink(): void {
  const card = useLinkCard.getState().card;
  const chip = anchor;
  if (card === null || !card.editable || chip === null) return;
  hideLinkCard();
  const openField = (): void => {
    whenFound(
      () => document.querySelector('[data-wb-format-bar]'),
      () => document.dispatchEvent(new CustomEvent(LINK_CHORD_EVENT)),
    );
  };
  if (card.origin === 'editor') {
    caretAfter(chip);
    openField();
    return;
  }
  const id = card.id;
  const view = id === null ? null : chip.closest<HTMLElement>('[data-wb-id]');
  if (id === null || view === null) return;
  const nth = [...view.querySelectorAll('[data-wb-link]')].indexOf(chip);
  const href = chip.dataset.wbLink ?? '';
  useSelection.getState().select([id]);
  useSelection.getState().edit({ kind: 'element', id });
  whenFound(
    () => {
      const root = document.querySelector<HTMLElement>(`[data-wb-id="${CSS.escape(id)}"] [contenteditable="true"]`);
      const chips = root ? [...root.querySelectorAll<HTMLElement>('a[data-href]')] : [];
      return chips[nth]?.dataset.href === href ? chips[nth]! : (chips.find((each) => each.dataset.href === href) ?? null);
    },
    (found) => {
      caretAfter(found);
      openField();
    },
  );
}

/* ------------------------------------------------------------------------ */
/* Wiring                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Runs `show` after `ms`, later still while a click's open is pending or
 * a link opened less than {@link LINK_CARD_COOLDOWN_MS} ago. Returns a
 * function that cancels it.
 */
function showAfter(ms: number, show: () => void): () => void {
  const tick = (): void => {
    const wait = lastOpenedAt === null ? 0 : lastOpenedAt + LINK_CARD_COOLDOWN_MS - performance.now();
    if (pendingOpen !== undefined || wait > 0) timer = setTimeout(tick, Math.max(wait, 50));
    else show();
  };
  let timer = setTimeout(tick, ms);
  return () => clearTimeout(timer);
}

/** Starts showing link cards (hover, caret) and hiding them; returns a function that stops. */
export function installLinkCards(): () => void {
  let cancelShow = (): void => {};
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let hovered: HTMLElement | null = null;
  let caretChip: HTMLElement | null = null;
  let cancelCaret = (): void => {};

  const later = (show: () => void): void => {
    cancelShow();
    cancelShow = showAfter(linkCardShowDelay(performance.now(), lastOpenedAt), show);
  };
  const hideSoon = (): void => {
    if (hideTimer === undefined) hideTimer = setTimeout(() => {
      hideTimer = undefined;
      if (useLinkCard.getState().card?.origin === 'board') hideLinkCard();
    }, LINK_CARD_HIDE_MS);
  };
  const keep = (): void => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || event.buttons !== 0) return;
    if (inCard(event.target)) return keep();
    const link = pointerTaken() ? null : boardLinkNode(event.target);
    if (link !== hovered) {
      hovered = link;
      cancelShow();
      if (link !== null && link !== anchor) later(() => {
        if (hovered === link && link.isConnected && !pointerTaken()) showLinkCard(link, 'board');
      });
    }
    if (link !== null && link === anchor) keep();
    else if (link === null && useLinkCard.getState().card?.origin === 'board') hideSoon();
  };
  const onLeave = (): void => {
    hovered = null;
    cancelShow();
    if (useLinkCard.getState().card?.origin === 'board') hideSoon();
  };
  const onDown = (event: PointerEvent): void => {
    if (inCard(event.target)) return;
    cancelShow();
    hovered = null;
    caretChip = null;
    hideLinkCard();
  };
  const onCaret = (): void => {
    const chip = useSelection.getState().editing !== null ? caretLinkChip(document) : null;
    if (chip === caretChip) return;
    caretChip = chip;
    cancelCaret();
    if (chip !== null) {
      cancelCaret = showAfter(linkCardShowDelay(performance.now(), lastOpenedAt), () => {
        if (caretChip === chip && chip.isConnected) showLinkCard(chip, 'editor');
      });
    } else if (linkCardFromEditor() && !inCard(document.activeElement)) hideLinkCard();
  };
  const onDoubleClick = (): void => cancelPendingLinkOpen();
  const onViewChange = (): void => hideLinkCard();

  document.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('selectionchange', onCaret);
  document.addEventListener('dblclick', onDoubleClick, true);
  window.addEventListener('scroll', onViewChange, true);
  window.addEventListener('wheel', onViewChange, { capture: true, passive: true });
  window.addEventListener('resize', onViewChange);
  const stopSelection = useSelection.subscribe((state, previous) => {
    const card = useLinkCard.getState().card;
    if (card === null) return;
    if (card.origin === 'editor' && state.editing === null && previous.editing !== null) return hideLinkCard();
    // Selecting a linked picture hides its card.
    const picture = card.id !== null && state.ids !== previous.ids && state.ids.includes(card.id) ? useBoard.getState().byId.get(card.id) : undefined;
    if (picture?.type === 'image') hideLinkCard();
  });
  return () => {
    cancelShow();
    clearTimeout(hideTimer);
    cancelCaret();
    cancelPendingLinkOpen();
    stopResume?.();
    stopSelection();
    document.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('selectionchange', onCaret);
    document.removeEventListener('dblclick', onDoubleClick, true);
    window.removeEventListener('scroll', onViewChange, true);
    window.removeEventListener('wheel', onViewChange, { capture: true });
    window.removeEventListener('resize', onViewChange);
    hideLinkCard();
  };
}
