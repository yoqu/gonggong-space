/**
 * Polite screen-reader announcements of collaboration events ("Following
 * Priya", "The agent is writing on the board."). They go through the
 * editor's own live region (`services/announce.ts`), so one region speaks
 * for the whole board.
 */

import { announce as announceToBoard } from '../services/announce.ts';

/** Announces a collaboration event to screen readers. */
export function announce(message: string): void {
  const text = message.trim();
  if (text !== '') announceToBoard(text);
}
