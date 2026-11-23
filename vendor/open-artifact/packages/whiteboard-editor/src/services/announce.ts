/**
 * Spoken feedback and refusals.
 *
 * {@link announce} speaks a short message to screen readers through a
 * polite live region (moved, deleted, grouped, the active tool…).
 * {@link refuse} also shows the message as a toast, for edits the board
 * turned down ("Locked: unlock first"). The message builders keep the
 * wording of every announcement in one place.
 *
 * The toast kit is loaded on first use, so this module (and everything that
 * reports through it) also runs where there is no DOM, such as tests.
 */

import { TEXT_SIZE_STYLES, type BoardElement, type ElementType, type TextAlign, type TextSize } from '@open-artifact/whiteboard-core';

/** Receives every announcement (tests and debugging). */
export type AnnouncementListener = (message: string) => void;

const listeners = new Set<AnnouncementListener>();
let region: HTMLElement | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

/** The visually hidden live region, created on first use. */
function liveRegion(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.className = 'wb-announcer';
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  document.body.append(region);
  return region;
}

/** Longest announcement read out, in characters (longer ones are cut at a word). */
export const MAX_ANNOUNCEMENT_CHARS = 200;

/** A message as read out: whitespace collapsed, and cut before {@link MAX_ANNOUNCEMENT_CHARS} at a word boundary with "…". */
export function clipAnnouncement(message: string, max = MAX_ANNOUNCEMENT_CHARS): string {
  const text = message.split(/\s+/).filter(Boolean).join(' ');
  const points = Array.from(text);
  if (points.length <= max) return text;
  const room = points.slice(0, max - 1).join('');
  const wholeWords = room.replace(/\s+\S*$/, '');
  return (wholeWords === '' ? room : wholeWords) + '…';
}

let announcedAt: number | undefined;

/** When the last announcement was made (epoch ms), if ever. */
export function lastAnnouncedAt(): number | undefined {
  return announcedAt;
}

/**
 * Speaks a message to screen readers. The region is cleared first so the
 * same message said twice is read twice.
 */
export function announce(text: string | null | undefined): void {
  if (!text) return;
  const message = clipAnnouncement(text);
  if (message === '') return;
  announcedAt = Date.now();
  for (const listener of listeners) listener(message);
  const element = liveRegion();
  if (!element) return;
  element.textContent = '';
  if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    element.textContent = message;
  }, 40);
}

/** Listens to announcements; returns a function that stops listening. */
export function onAnnouncement(listener: AnnouncementListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows a short notice as a toast (loaded lazily; silently skipped without a page). */
export function notify(title: string, description?: string): void {
  if (typeof document === 'undefined') return;
  void import('@open-artifact/ui')
    .then(({ toast }) => {
      toast.add({ title, ...(description !== undefined ? { description } : {}) });
    })
    .catch(() => {
      /* No toast kit: the announcement is enough. */
    });
}

/** Turns an edit down: speaks the reason and shows it as a toast. Returns `false` for chaining. */
export function refuse(message: string): false {
  announce(message);
  notify(message);
  return false;
}

/* ------------------------------------------------------------------------ */
/* Messages                                                                 */
/* ------------------------------------------------------------------------ */

/** What each kind of element is called when spoken. */
export const ELEMENT_TYPE_LABELS: Readonly<Record<ElementType, string>> = {
  note: 'Sticky note',
  shape: 'Shape',
  text: 'Text',
  container: 'Section',
  arrow: 'Arrow',
  sticker: 'Sticker',
  image: 'Image',
  stroke: 'Sketch',
  timer: 'Timer',
  html: 'Web embed',
  link: 'Link card',
  table: 'Table',
};

/** Plural names of the kinds that cannot be turned. */
export const UNTURNABLE_TYPE_PLURALS: Readonly<Partial<Record<ElementType, string>>> = {
  container: 'sections',
  table: 'tables',
  html: 'web embeds',
  timer: 'shared timers',
  arrow: 'arrows',
};

/** Refusal shown when locked items would change. */
export const LOCKED_MESSAGE = 'Locked: unlock first';
/** Refusal shown to viewers who may only look. */
export const READ_ONLY_MESSAGE = 'You can view this board but not change it';
/** Refusal shown when the board holds as many items as it can. */
export const BOARD_FULL_MESSAGE = 'The board is full.';
/** Said when a command needs a selection. */
export const NOTHING_SELECTED_MESSAGE = 'Nothing selected';
/** Said when an empty board has nothing to fit or select. */
export const EMPTY_BOARD_MESSAGE = 'Nothing on the board yet';
/** Said when aligning moved nothing. */
export const ALREADY_ALIGNED_MESSAGE = 'Already aligned';
/** Said after a cut. */
export const CUT_MESSAGE = 'Cut';
/** Said when an arrow's route handle moved. */
export const ARROW_ROUTE_MOVED_MESSAGE = 'Arrow route moved';
/** Said when a typed key pauses comment mode. */
export const COMMENT_MODE_PAUSED_MESSAGE = 'Comment mode paused';

/** Layer moves and what is said after each. */
export const ARRANGE_MESSAGES = {
  front: 'Brought to front',
  back: 'Sent to back',
  forward: 'Brought forward',
  backward: 'Sent backward',
} as const;

/** Grouping results. */
export const GROUPING_MESSAGES = { group: 'Grouped.', ungroup: 'Ungrouped.' } as const;

/** Lock results. */
export const LOCK_MESSAGES = { on: 'Locked', off: 'Unlocked', why: LOCKED_MESSAGE } as const;

/** Link edit results. */
export const LINK_EDIT_MESSAGES = {
  added: 'Link added',
  changed: 'Link changed',
  removed: 'Link removed',
  kept: 'Link not changed',
} as const;

/** Names of the alignment commands and what is said after each. */
export const ALIGN_ACTION_LABELS = {
  left: { name: 'Align left', said: 'Aligned left' },
  hcenter: { name: 'Align horizontal centers', said: 'Aligned horizontal centers' },
  right: { name: 'Align right', said: 'Aligned right' },
  top: { name: 'Align top', said: 'Aligned top' },
  vcenter: { name: 'Align vertical centers', said: 'Aligned vertical centers' },
  bottom: { name: 'Align bottom', said: 'Aligned bottom' },
} as const;

/** What a color change applies to, as spoken. */
export const COLOR_TARGET_LABELS = { fill: 'Fill', ink: 'Ink', line: 'Line', outline: 'Border', text: 'Text' } as const;

/** A color change target. */
export type ColorTarget = keyof typeof COLOR_TARGET_LABELS;

/** Text alignments as spoken. */
export const TEXT_ALIGN_LABELS: Readonly<Record<TextAlign, string>> = { left: 'Left', center: 'Center', right: 'Right' };

/** `1 item`, `3 items`. */
export function itemCountPhrase(count: number): string {
  return String(count) + (count === 1 ? ' item' : ' items');
}

/** Said after a keyboard nudge. */
export function movedMessage(dx: number, dy: number): string {
  if (dx !== 0 && dy === 0) return dx < 0 ? 'Moved left' : 'Moved right';
  if (dy !== 0 && dx === 0) return dy < 0 ? 'Moved up' : 'Moved down';
  return 'Moved';
}

/** Said after turning: by `delta`, or to an `absolute` turn. */
export function turnedMessage(delta: number, absolute?: number): string {
  const degrees = absolute ?? delta;
  if (degrees === 0) return 'Turned upright';
  const size = Math.abs(degrees);
  return (
    'Turned ' +
    (absolute !== undefined ? 'to ' : '') +
    String(size) +
    (size === 1 ? ' degree' : ' degrees') +
    (degrees === 180 ? '' : degrees < 0 ? ' left' : ' right')
  );
}

/** Refusal for a selection with kinds that cannot be turned. */
export function cannotTurnMessage(types: readonly ElementType[]): string {
  const plurals = types.map((type) => UNTURNABLE_TYPE_PLURALS[type] ?? ELEMENT_TYPE_LABELS[type].toLowerCase() + 's');
  const list = plurals.length < 2 ? plurals.join('') : plurals.slice(0, -1).join(', ') + ' and ' + String(plurals.at(-1));
  return list.charAt(0).toUpperCase() + list.slice(1) + ' can’t be turned.';
}

/** Said after adding one element. */
export function addedMessage(type: ElementType | 'video'): string {
  return (type === 'video' ? 'Video' : ELEMENT_TYPE_LABELS[type]) + ' added';
}

/**
 * Said when an item is offered at an arrow's free end: how to add it
 * (`shortcut` names the key; without one, a tap).
 */
export function freeEndAddHint(type: 'note' | 'shape', shortcut?: string): string {
  return `${shortcut ? `Press ${shortcut}` : 'Tap'} to add a ${type === 'note' ? 'sticky note' : 'block'} at the arrow’s free end`;
}

/** Said after deleting elements (and the arrows that went with them); `null` when nothing went. */
export function deletedMessage(deleted: readonly BoardElement[], arrowCount = 0): string | null {
  if (deleted.length === 0) return null;
  const first = deleted[0]!;
  const what =
    deleted.length > 1 ? itemCountPhrase(deleted.length) : first.type === 'image' && first.video !== undefined ? 'Video' : ELEMENT_TYPE_LABELS[first.type];
  const arrows = arrowCount > 0 ? ' and ' + String(arrowCount) + (arrowCount === 1 ? ' arrow' : ' arrows') : '';
  return what + arrows + ' deleted';
}

/** Said when the selection changes by keyboard. */
export function selectionCountMessage(count: number): string {
  return count === 0 ? NOTHING_SELECTED_MESSAGE : itemCountPhrase(count) + ' selected';
}

/** Said after pasting. */
export function pastedMessage(count: number): string {
  return count === 1 ? 'Pasted' : 'Pasted ' + itemCountPhrase(count);
}

/** Said after duplicating. */
export function duplicatedMessage(count: number): string {
  return count === 1 ? 'Duplicated' : 'Duplicated ' + itemCountPhrase(count);
}

/** Said when an empty new block or text is dropped after editing. */
export function emptyBlockRemovedMessage(type: ElementType): string {
  return type === 'shape' ? 'Empty block removed' : 'Empty text removed';
}

/** Said when a tool is picked. */
export function toolNameMessage(label: string): string {
  return label + ' tool';
}

/** Said when a group is selected by keyboard. */
export function groupSelectedMessage(count: number): string {
  return 'Group of ' + String(count) + ' selected.';
}

/** Said after a color change. */
export function colorUpdatedMessage(target: ColorTarget): string {
  return COLOR_TARGET_LABELS[target] + ' color updated';
}

/** Said after a text size change. */
export function textSizeMessage(size: TextSize): string {
  return 'Text size ' + TEXT_SIZE_STYLES[size].label;
}

/** Said after a text alignment change. */
export function textAlignedMessage(align: TextAlign): string {
  return 'Text aligned ' + TEXT_ALIGN_LABELS[align].toLowerCase();
}

/** Said after a shape kind change. */
export function shapeKindMessage(label: string): string {
  return 'Kind ' + label;
}
