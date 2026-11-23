/**
 * The rules of following, without side effects (unit-tested): the board
 * area a peer sees, and how often another page's "Follow me" is followed
 * on its own.
 */

import { followViewArea, type Box } from '@open-artifact/whiteboard-core';
import type { CollabPeer } from './peers.ts';

/** How often a leader publishes its serial again (ms), for late joiners. */
export const LEADING_REBROADCAST_MS = 3000;

/** Most automatic follows of new "Follow me" requests in {@link AUTO_FOLLOW_WINDOW_MS}. */
export const MAX_AUTO_FOLLOWS = 3;

/** The window {@link MAX_AUTO_FOLLOWS} counts over (ms). */
export const AUTO_FOLLOW_WINDOW_MS = 60_000;

/** The board area a peer sees: their published view, else their camera and viewport. */
export function peerViewArea(peer: CollabPeer): Box | undefined {
  if (peer.view) return peer.view;
  if (peer.camera && peer.viewport) return followViewArea(peer.camera, { w: peer.viewport.w, h: peer.viewport.h, top: 0, bottom: 0 });
  return undefined;
}

/**
 * Decides whether a new "Follow me" serial is followed automatically:
 * at most {@link MAX_AUTO_FOLLOWS} in the window. Returns the kept times.
 */
export function allowAutoFollow(times: readonly number[], now: number): { allowed: boolean; times: number[] } {
  const recent = times.filter((time) => now - time < AUTO_FOLLOW_WINDOW_MS);
  if (recent.length >= MAX_AUTO_FOLLOWS) return { allowed: false, times: recent };
  return { allowed: true, times: [...recent, now] };
}
