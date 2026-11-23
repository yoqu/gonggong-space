/**
 * Avatars drawn from a person's id and name: initials on a color picked
 * from the id, so every page shows the same person the same way (cursors,
 * face stickers, comment pins, presence). The colors are the people's
 * palette (`PEER_COLOR_PALETTE`, `@open-artifact/editor-kit`); while someone is online, the color their
 * page settled on (which avoids clashes) wins over the id's.
 */

import { PEER_COLOR_PALETTE, inkOnPeerColor, peerColorFromId } from '@open-artifact/editor-kit';

/** Avatar backgrounds: the people's palette. Text on them takes {@link avatarInk}. */
export const AVATAR_COLORS: readonly string[] = PEER_COLOR_PALETTE;

/** A stable 32-bit hash of a string (FNV-1a). */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The avatar color of a person id (as {@link peerColorFromId}: never the color reserved for the agent). */
export function avatarColor(id: string): string {
  return peerColorFromId(id);
}

/** The text color on an avatar color: near-black on light colors, else white. */
export function avatarInk(color: string): string {
  return inkOnPeerColor(color);
}

/** One or two initials of a display name (`?` when it has none). */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s._@-]+/u)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}
