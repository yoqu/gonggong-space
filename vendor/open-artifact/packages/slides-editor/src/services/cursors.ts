/**
 * Peer cursors in the grid view. Each viewer's pointer over a slide tile is
 * sent to the other pages of the artifact as an ephemeral room message: the
 * slide under it and where on the tile, as fractions of its box (viewers lay
 * the grid out with different column counts, so screen positions would not
 * match). Nothing is stored; a cursor not heard from for a while goes away.
 */

import { create } from 'zustand';

/** The part of a room cursors use (the runtime's RoomCapability fits). */
export interface CursorRoom {
  emit(topic: string, data: unknown): Promise<unknown>;
  onMessage(listener: (message: { from: string; topic: string; data: unknown }) => void): unknown;
}

/** Who is in the room: the ids of the peers here, and a way to hear when that changes. */
export interface CursorPeers {
  ids(): Iterable<string>;
  subscribe(listener: () => void): unknown;
}

/** Room message topic. */
const TOPIC = 'slides.grid-cursor';
/** Least time between two messages, ms. */
const SEND_MS = 50;
/** A cursor not moved for this long is hidden, ms. */
const STALE_MS = 8000;

/** A peer's pointer on a slide tile. */
export interface PeerCursor {
  slideId: string;
  /** Position on the tile, 0–1. */
  x: number;
  y: number;
  at: number;
}

/** Peer cursors by peer id. */
export const useCursors = create<{ cursors: Readonly<Record<string, PeerCursor>> }>(() => ({ cursors: {} }));

/** Reads a cursor message; null for anything malformed (it comes from another page). */
export function parseCursor(data: unknown, at: number): PeerCursor | null {
  if (typeof data !== 'object' || data === null) return null;
  const { slideId, x, y } = data as Record<string, unknown>;
  if (typeof slideId !== 'string' || slideId.length > 200 || typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { slideId, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), at };
}

let room: CursorRoom | null = null;
let pending: { slideId: string; x: number; y: number } | null | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSent: string | null = null;

function flush(): void {
  timer = undefined;
  if (!room || pending === undefined) return;
  const data = pending;
  pending = undefined;
  const text = JSON.stringify(data);
  if (text === lastSent) return;
  lastSent = text;
  room.emit(TOPIC, data).catch(() => undefined);
}

/** Sends this viewer's pointer on a tile (null: it left the tiles). */
export function sendGridCursor(cursor: { slideId: string; x: number; y: number } | null): void {
  if (!room) return;
  pending = cursor ? { slideId: cursor.slideId, x: Math.round(cursor.x * 1000) / 1000, y: Math.round(cursor.y * 1000) / 1000 } : null;
  if (cursor === null) {
    clearTimeout(timer);
    flush();
    return;
  }
  timer ??= setTimeout(flush, SEND_MS);
}

/** Listens for peer cursors in `target` and sends this viewer's there. Call once. */
export function startCursors(target: CursorRoom, peers: CursorPeers): void {
  if (room) return;
  room = target;
  target.onMessage((message) => {
    if (message.topic !== TOPIC) return;
    const { cursors } = useCursors.getState();
    const cursor = parseCursor(message.data, Date.now());
    if (!cursor) {
      if (!cursors[message.from]) return;
      const next = { ...cursors };
      delete next[message.from];
      useCursors.setState({ cursors: next });
      return;
    }
    useCursors.setState({ cursors: { ...cursors, [message.from]: cursor } });
  });
  // Peers who left, and cursors gone quiet, disappear.
  const sweep = (): void => {
    const { cursors } = useCursors.getState();
    const here = new Set(peers.ids());
    const now = Date.now();
    const kept = Object.entries(cursors).filter(([id, cursor]) => here.has(id) && now - cursor.at < STALE_MS);
    if (kept.length !== Object.keys(cursors).length) useCursors.setState({ cursors: Object.fromEntries(kept) });
  };
  setInterval(sweep, 2000);
  peers.subscribe(sweep);
}
