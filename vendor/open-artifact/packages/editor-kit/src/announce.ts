/**
 * The screen-reader announcer core, free of any editor store: a polite live
 * region's message and a serial. {@link announce} queues a message; a
 * component renders `useAnnouncer` in a `role="status"` region (see
 * `Announcer.tsx`). Repeating the same message re-announces it.
 */

import { create } from 'zustand';

/** Longest message read out (longer ones are cut, at a word where they can be). */
export const ANNOUNCE_LIMIT = 200;
/** A cut at a word keeps at least this many characters; one that would keep fewer cuts at the limit instead. */
const SHORTEST_WORD_CUT = 119;

export interface AnnouncerState {
  message: string;
  /** Bumped per announcement, so the same text is read again. */
  serial: number;
}

export const useAnnouncer = create<AnnouncerState>()(() => ({ message: '', serial: 0 }));

/**
 * The text read out for a message, whitespace collapsed; empty: nothing. Past {@link ANNOUNCE_LIMIT} it is cut at the
 * last word break within that many characters, or mid-word when that break comes early, and ends with an ellipsis.
 */
export function announcementText(message: string): string {
  const text = message.replace(/\s+/g, ' ').trim();
  if (text.length <= ANNOUNCE_LIMIT) return text;
  const wordBreak = text.slice(0, ANNOUNCE_LIMIT).search(/\s+\S*$/);
  // A cut mid-word leaves room for the ellipsis and no half of a surrogate pair.
  const kept = wordBreak >= SHORTEST_WORD_CUT ? text.slice(0, wordBreak) : text.slice(0, ANNOUNCE_LIMIT - 1).replace(/[\uD800-\uDBFF]$/, '');
  return `${kept}…`;
}

/** Reads a message out to screen readers. */
export function announce(message: string): void {
  const text = announcementText(message);
  if (text) useAnnouncer.setState((s) => ({ message: text, serial: s.serial + 1 }));
}
