/**
 * The rules behind board links and their hover card: when a click opens a
 * link, when a press counts as a click, what the card shows and where it
 * sits. Pure; `services/link-card.ts` runs them.
 */

/** A plain click opens its link after this long (ms), unless a double click follows. */
export const LINK_OPEN_DELAY_MS = 250;
/** The card shows this long (ms) after the pointer rests on a link (or the caret in one). */
export const LINK_CARD_SHOW_MS = 300;
/** The card hides this long (ms) after the pointer leaves the link and the card. */
export const LINK_CARD_HIDE_MS = 300;
/** After a link opened, its card shows again only after this long (ms). */
export const LINK_CARD_COOLDOWN_MS = 700;
/** A touch counts as a tap when it lasts at most this long (ms)… */
export const TAP_MAX_MS = 400;
/** …and moves at most this far (screen pixels). */
export const TAP_MAX_MOVE_PX = 10;
/** A mouse or pen press becomes a drag past this distance (screen pixels). */
export const CLICK_MAX_MOVE_PX = 4;
/** Room between the link and its card (screen pixels). */
export const LINK_CARD_GAP_PX = 6;
/** Closest the card comes to the viewport's edges (screen pixels). */
export const LINK_CARD_MARGIN_PX = 8;
/** The longest address the card shows; longer ones are cut. */
export const MAX_SHOWN_ADDRESS_CHARS = 300;
/** How long "Link copied" stays (ms). */
export const LINK_COPIED_MS = 1500;

/** What a click on a link does: open it now, after the double-click delay, or nothing. */
export type LinkClickAction = 'now' | 'later' | 'none';

/** The modifier keys of a click. */
export interface ClickModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * What a click on a board link does: Mod (⌘ on Apple platforms, Ctrl
 * elsewhere) without Shift or Alt opens at once; a click without any
 * modifier opens after {@link LINK_OPEN_DELAY_MS}; anything else (Shift
 * picks, Alt copies, Ctrl on a Mac opens the context menu) leaves it.
 */
export function linkClickAction(click: ClickModifiers, apple: boolean): LinkClickAction {
  const mod = apple ? click.metaKey : click.ctrlKey;
  const other = apple ? click.ctrlKey : click.metaKey;
  if (click.shiftKey || click.altKey || other) return 'none';
  return mod ? 'now' : 'later';
}

/** One press, from going down to coming up. */
export interface PressSpan {
  pointerType: string;
  /** How long it lasted, ms. */
  ms: number;
  /** How far it got from where it went down, screen pixels. */
  moved: number;
}

/** Whether a press counts as a click: a short, still tap on touch; a press that never became a drag otherwise. */
export function pressIsClick(press: PressSpan): boolean {
  if (press.pointerType === 'touch') return press.ms <= TAP_MAX_MS && press.moved <= TAP_MAX_MOVE_PX;
  return press.moved <= CLICK_MAX_MOVE_PX;
}

/** Why a link on the board does not open. */
export type LinkBlock = 'credentials' | 'unsupported';

/** True when an address carries a user name or password (`user:pass@host`). */
export function hasLinkCredentials(href: string): boolean {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(href.trim());
  return scheme?.[1]?.includes('@') ?? false;
}

/** Why a link does not open (`undefined` when it does), given what the board would open. */
export function linkBlock(href: string, target: string | undefined): LinkBlock | undefined {
  if (hasLinkCredentials(href)) return 'credentials';
  return target === undefined ? 'unsupported' : undefined;
}

/** An address as the card shows it. */
export interface LinkAddressParts {
  /** The site: the host of a web address, else the whole address. */
  host: string;
  /** The rest (path, query and fragment), `''` when there is none. */
  path: string;
  /** The whole address, cut at {@link MAX_SHOWN_ADDRESS_CHARS}. */
  full: string;
}

/** Cuts text at `max` characters (whole code points), ending it with an ellipsis. */
function capChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** Control and format characters, shown as the replacement character. */
function visible(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '�');
}

/** The site and the path of an address, for the card. Credentials never show. */
export function linkAddressParts(href: string): LinkAddressParts {
  const full = capChars(visible(href), MAX_SHOWN_ADDRESS_CHARS);
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
      return { host: url.host, path: capChars(visible(rest), MAX_SHOWN_ADDRESS_CHARS), full: capChars(visible(`${url.protocol}//${url.host}${rest}`), MAX_SHOWN_ADDRESS_CHARS) };
    }
  } catch {
    /* Not a URL: shown whole. */
  }
  return { host: full, path: '', full };
}

/** A box on screen (viewport pixels). */
export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the card goes. */
export interface LinkCardPlace {
  x: number;
  y: number;
  side: 'above' | 'below';
}

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  const separated = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  return !separated;
}

/**
 * Where a card of `card` size sits for a link at `link`: above it when it
 * fits there (inside the viewport and clear of `avoid`, the selection
 * bar), else below it, {@link LINK_CARD_GAP_PX} away, starting at the
 * link's left edge and kept inside the viewport. Below, it moves past
 * `avoid` when the two would overlap.
 */
export function linkCardPlace(link: ScreenBox, card: { w: number; h: number }, viewport: { w: number; h: number }, avoid: ScreenBox | null = null): LinkCardPlace {
  const margin = LINK_CARD_MARGIN_PX;
  const x = Math.max(margin, Math.min(link.x, viewport.w - card.w - margin));
  const aboveY = link.y - LINK_CARD_GAP_PX - card.h;
  const above = { x, y: aboveY, w: card.w, h: card.h };
  if (aboveY >= margin && (avoid === null || !overlaps(above, avoid))) return { x, y: aboveY, side: 'above' };
  let y = link.y + link.h + LINK_CARD_GAP_PX;
  if (avoid !== null && overlaps({ x, y, w: card.w, h: card.h }, avoid)) y = avoid.y + avoid.h + LINK_CARD_GAP_PX;
  return { x, y: Math.max(margin, y), side: 'below' };
}

/** True when a link's box moved or resized by more than half a pixel. */
export function linkBoxMoved(before: ScreenBox, after: ScreenBox): boolean {
  return Math.abs(before.x - after.x) > 0.5 || Math.abs(before.y - after.y) > 0.5 || Math.abs(before.w - after.w) > 0.5 || Math.abs(before.h - after.h) > 0.5;
}

/** How long to wait before showing a card, given when a link last opened (ms timestamps). */
export function linkCardShowDelay(now: number, lastOpened: number | null): number {
  if (lastOpened === null) return LINK_CARD_SHOW_MS;
  return Math.max(LINK_CARD_SHOW_MS, lastOpened + LINK_CARD_COOLDOWN_MS - now);
}

/** Told when the selected item holds several links (the controls offer one). */
export function severalLinksMessage(touch: boolean): string {
  return `Several links: open one with a ${touch ? 'tap' : 'click'}`;
}
