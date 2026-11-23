/**
 * Peer hands: how other people's gestures in progress are drawn here.
 *
 * Each peer gesturing has a *hand*: its latest frame (`gesture-wire.ts`),
 * which carries the elements as the peer's page has them right now. The
 * element layer draws those elements in place of the stored ones (see
 * `state/shown.ts`), so a note a peer drags moves here too and the arrows
 * joined to it re-route as it goes. Between frames the elements glide from
 * where they were drawn to the new frame over {@link PEER_GLIDE_MS}, so a
 * drag reads as smooth motion, not 20 jumps a second. A frame of more than
 * {@link PEER_EASED_MAX} elements is drawn as it comes.
 *
 * When drawn places jump instead (a hand going without its edit landing
 * where it was drawn, someone else's edit arriving), the elements that
 * moved without changing size slide into place from where they were drawn
 * ({@link settleGlides}), unless more than {@link SETTLE_GLIDE_MAX} moved.
 *
 * A pen stroke or an arrow being drawn has no element yet: those come as
 * *sketches* ({@link handSketches}), drawn in the ink they will have.
 *
 * Pure: unit-tested. `live-gestures.ts` keeps the hands and the timing.
 */

import { cachedStrokePath, type BoardElement, type InkColor } from '@open-artifact/whiteboard-core';
import type { SettleGlide } from '../state/shown.ts';
import type { GestureFrame } from './gesture-wire.ts';

/** How long elements take to glide to a new frame, ms. */
export const PEER_GLIDE_MS = 80;
/** Most elements of a frame that glide to it; a bigger frame is drawn as it comes. */
export const PEER_EASED_MAX = 60;
/** Most elements that slide into place at once; when more moved, they all jump. */
export const SETTLE_GLIDE_MAX = 60;
/** Smallest jump (either axis, board units) worth a settle glide. */
export const SETTLE_GLIDE_MIN = 1;

/** A peer's gesture as this page last heard it. */
export interface PeerHand {
  /** The peer (page) id. */
  peer: string;
  /** The gesture's number. */
  n: number;
  /** The latest frame. */
  frame: GestureFrame;
  /** When the latest frame arrived (epoch ms). */
  heardAt: number;
  /** When the gesture closed (epoch ms), if it did. */
  endedAt?: number;
  /** The board's elements when the gesture closed (a change means its element arrived). */
  boardAtEnd?: unknown;
  /** Elements of the frame as drawn when it arrived: where their glide starts. */
  from: ReadonlyMap<string, BoardElement>;
  /** When the glide toward the frame started (a `performance.now()` time). */
  glideAt: number;
}

/** Ids of the elements a hand holds: those its frame carries or takes off the board. */
export function handIds(hand: Pick<PeerHand, 'frame'>): string[] {
  return [...hand.frame.elements.map((element) => element.id), ...(hand.frame.gone ?? [])];
}

/* ------------------------------------------------------------------------ */
/* Easing between frames                                                    */
/* ------------------------------------------------------------------------ */

/** The fields that glide: position and size. */
const EASED_FIELDS = ['x', 'y', 'w', 'h'] as const;

/**
 * Where each element of `frame` starts gliding from: as `drawn` has it now.
 * Arrows never glide (they follow their ends), nor elements that change
 * type, nor any element of a frame over {@link PEER_EASED_MAX}.
 */
export function glideStart(frame: GestureFrame, drawn: (id: string) => BoardElement | undefined): Map<string, BoardElement> {
  const from = new Map<string, BoardElement>();
  if (frame.elements.length > PEER_EASED_MAX) return from;
  for (const element of frame.elements) {
    if (element.type === 'arrow') continue;
    const before = drawn(element.id);
    if (before !== undefined && before !== element && before.type === element.type) from.set(element.id, before);
  }
  return from;
}

/** `to` with its position and size `k` (0..1) of the way from `from`'s. */
export function easeElement(from: BoardElement, to: BoardElement, k: number): BoardElement {
  if (k >= 1) return to;
  const fromFields = from as unknown as Record<string, unknown>;
  const toFields = to as unknown as Record<string, unknown>;
  let eased: Record<string, unknown> | undefined;
  for (const field of EASED_FIELDS) {
    const a = fromFields[field];
    const b = toFields[field];
    if (typeof a !== 'number' || typeof b !== 'number' || a === b) continue;
    eased ??= { ...toFields };
    eased[field] = a + (b - a) * Math.max(0, k);
  }
  return eased ? (eased as unknown as BoardElement) : to;
}

/** Whether a hand's elements are still gliding toward its frame at `now` (a `performance.now()` time). */
export function handGliding(hand: Pick<PeerHand, 'from' | 'glideAt'>, now: number): boolean {
  return hand.from.size > 0 && now - hand.glideAt < PEER_GLIDE_MS;
}

/**
 * The elements the hands draw at `now`: each carried element (eased toward
 * its frame), `null` for those taken off the board. A later hand wins over
 * an earlier one; elements `keep` names (this page's own gesture) are left
 * as stored.
 */
export function handsOverrides(hands: Iterable<PeerHand>, now: number, keep: (id: string) => boolean): Map<string, BoardElement | null> {
  const overrides = new Map<string, BoardElement | null>();
  for (const hand of hands) {
    const k = hand.from.size === 0 ? 1 : (now - hand.glideAt) / PEER_GLIDE_MS;
    for (const element of hand.frame.elements) {
      if (keep(element.id)) continue;
      const from = k < 1 ? hand.from.get(element.id) : undefined;
      overrides.delete(element.id);
      overrides.set(element.id, from ? easeElement(from, element, k) : element);
    }
    for (const id of hand.frame.gone ?? []) {
      if (keep(id)) continue;
      overrides.delete(id);
      overrides.set(id, null);
    }
  }
  return overrides;
}

/** Whether two override maps hold the same entries (by identity). */
export function sameOverrides(a: ReadonlyMap<string, BoardElement | null>, b: ReadonlyMap<string, BoardElement | null>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, element] of a) if (b.get(id) !== element || !b.has(id)) return false;
  return true;
}

/* ------------------------------------------------------------------------ */
/* Settling                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The glides of elements `ids` whose drawn place jumped from `before` to
 * `after`: those that moved at least {@link SETTLE_GLIDE_MIN} without
 * changing size or type, arrows and `held` elements (still in a peer's
 * hand) aside. None when more than {@link SETTLE_GLIDE_MAX} would glide.
 */
export function settleGlides(
  ids: Iterable<string>,
  before: (id: string) => BoardElement | undefined,
  after: (id: string) => BoardElement | undefined,
  held: ReadonlySet<string>,
): SettleGlide[] {
  const glides: SettleGlide[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id) || held.has(id)) continue;
    seen.add(id);
    const a = before(id);
    const b = after(id);
    if (a === undefined || b === undefined || a === b || a.type !== b.type || a.type === 'arrow' || b.type === 'arrow') continue;
    if (('w' in a ? a.w : undefined) !== ('w' in b ? b.w : undefined) || ('h' in a ? a.h : undefined) !== ('h' in b ? b.h : undefined)) continue;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.abs(dx) < SETTLE_GLIDE_MIN && Math.abs(dy) < SETTLE_GLIDE_MIN) continue;
    glides.push({ id, dx, dy });
    if (glides.length > SETTLE_GLIDE_MAX) return [];
  }
  return glides;
}

/* ------------------------------------------------------------------------ */
/* Sketches                                                                 */
/* ------------------------------------------------------------------------ */

/** A pen stroke or an arrow a peer is drawing (no element yet). */
export type HandSketch =
  /** The pen stroke being drawn, absolute board coordinates. */
  | { kind: 'ink'; d: string; color: InkColor; width: number }
  /** The arrow being drawn. */
  | { kind: 'draft'; x1: number; y1: number; x2: number; y2: number; color: InkColor };

/** The sketches of a frame. */
export function handSketches(frame: GestureFrame): HandSketch[] {
  const sketches: HandSketch[] = [];
  if (frame.ink && frame.ink.points.length >= 2) sketches.push({ kind: 'ink', d: cachedStrokePath(frame.ink.points), color: frame.ink.color, width: frame.ink.width });
  if (frame.draft) {
    const { from, to, color } = frame.draft;
    sketches.push({ kind: 'draft', x1: from[0], y1: from[1], x2: to[0], y2: to[1], color });
  }
  return sketches;
}
