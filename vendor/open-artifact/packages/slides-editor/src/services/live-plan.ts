/**
 * The pure half of thumbnail virtualization (services/live.ts): what a
 * snapshot is keyed by, which thumbnails should be live, and the order
 * snapshots are taken in. No DOM here, so it is unit-tested directly.
 */

import type { DeckFace, Slide } from '@open-artifact/slides-core';

/** A rectangle in screen px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A thumbnail on screen: its slide, its box, and the box of the view it scrolls in. */
export interface PlacedThumb {
  id: string;
  rect: Rect;
  view: Rect;
}

/** FNV-1a of a string, as 8 hex digits. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const slideHashes = new WeakMap<Slide, string>();

/**
 * Hash of what a slide draws: its style and children (the compiled model the
 * renderer consumes). Its id, notes, section, transition and skip flag do not
 * change the picture. Models are immutable, so the hash is cached per object.
 */
export function slideHash(slide: Slide): string {
  let hash = slideHashes.get(slide);
  if (hash === undefined) {
    hash = hashText(JSON.stringify([slide.style, slide.children, slide.flat ?? false]));
    slideHashes.set(slide, hash);
  }
  return hash;
}

/** What every snapshot of the deck shares: the canvas size, the typefaces and how far fonts have loaded. */
export interface DeckLook {
  /** Slide canvas width (1920, or 1440 in a 4:3 deck). */
  width: number;
  faces: Readonly<Record<string, DeckFace>>;
  /** Bumped when one of the deck's fonts finishes loading. */
  fontEpoch: number;
}

/** The deck part of a snapshot key. */
export function lookKey(look: DeckLook): string {
  return `${look.width}:${hashText(JSON.stringify(look.faces))}:${look.fontEpoch}`;
}

/** What a snapshot of `slide` must have been taken with to be current. */
export function snapshotKey(slide: Slide, look: DeckLook | string): string {
  return `${slideHash(slide)}:${typeof look === 'string' ? look : lookKey(look)}`;
}

/** Options of {@link wantedLive}. */
export interface WantedOptions {
  /** Most thumbnails live for being on screen (pinned ones come on top). */
  max: number;
  /** Fraction of the view's size counted as "near" on every side. */
  margin: number;
  /** Thumbnails drawn narrower than this (px) stay snapshots: their content cannot be read anyway. */
  minWidth: number;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Which slides should have live thumbnails: the ones in or near their view
 * (on screen first, then nearest the middle of the view), at most `max`,
 * plus every pinned slide. Also returns the slides actually on screen.
 */
export function wantedLive(thumbs: readonly PlacedThumb[], pinned: Iterable<string>, options: WantedOptions): { live: Set<string>; visible: Set<string> } {
  const visible = new Set<string>();
  const near: { id: string; on: boolean; d: number }[] = [];
  for (const { id, rect, view } of thumbs) {
    if (view.w <= 0 || view.h <= 0) continue;
    const on = overlaps(rect, view);
    if (on) visible.add(id);
    const mx = view.w * options.margin;
    const my = view.h * options.margin;
    if (!on && !overlaps(rect, { x: view.x - mx, y: view.y - my, w: view.w + mx * 2, h: view.h + my * 2 })) continue;
    if (rect.w < options.minWidth) continue;
    const d = Math.hypot(rect.x + rect.w / 2 - (view.x + view.w / 2), rect.y + rect.h / 2 - (view.y + view.h / 2));
    near.push({ id, on, d });
  }
  near.sort((a, b) => (a.on === b.on ? a.d - b.d : a.on ? -1 : 1));
  const live = new Set<string>();
  for (const { id } of near) {
    if (live.size >= options.max) break;
    live.add(id);
  }
  for (const id of pinned) live.add(id);
  return { live, visible };
}

/**
 * The order snapshots are taken in: slides on screen first, then by their
 * distance in the deck from the nearest slide on screen (the next ones a
 * scroll reaches), earlier slides first on a tie. With nothing on screen,
 * deck order.
 */
export function captureOrder(due: readonly string[], order: readonly string[], visible: ReadonlySet<string>): string[] {
  const index = new Map(order.map((id, i) => [id, i]));
  const anchors = [...visible].map((id) => index.get(id)).filter((i): i is number => i !== undefined).sort((a, b) => a - b);
  const distance = (i: number): number => {
    if (!anchors.length) return i;
    // Binary search for the nearest anchor.
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid]! < i) lo = mid + 1;
      else hi = mid;
    }
    let d = Math.abs(anchors[lo]! - i);
    if (lo > 0) d = Math.min(d, Math.abs(anchors[lo - 1]! - i));
    return d;
  };
  return due
    .filter((id) => index.has(id))
    .map((id) => ({ id, i: index.get(id)!, d: distance(index.get(id)!) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ id }) => id);
}

/** Size of a snapshot image for a canvas of `width` × `height`: `scale` of it, rounded, at least 1 px. */
export function snapshotSize(width: number, height: number, scale: number): { w: number; h: number } {
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}
