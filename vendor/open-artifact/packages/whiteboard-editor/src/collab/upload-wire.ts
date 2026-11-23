/**
 * Upload placeholders on the wire, and how a page keeps the ones it hears.
 *
 * While a page uploads pictures or videos, it tells the room where each
 * will land: `{ uploads: [[id, x, y, w, h, stored?], …] }` on the gesture
 * topic, the whole list each time (board units, rounded). Other pages draw
 * a box with a spinner there until the picture is saved. A row with
 * `stored` names the element the upload became; the box stays until that
 * element is on the board.
 *
 * Hearing (as {@link hearUploads} and {@link sweepUploads} keep it):
 * - a box lasts {@link UPLOAD_KEEP_MS} past the last message naming it, or
 *   {@link UPLOAD_STORED_KEEP_MS} once it names its stored element;
 * - a message drops the sender's boxes it no longer lists, except stored
 *   ones still waiting for their element;
 * - a box whose stored element arrived is hidden for good;
 * - at most {@link MAX_UPLOAD_PLACEHOLDERS} boxes per page are kept.
 *
 * Pure: unit-tested. `uploads.ts` does the telling, timing and drawing.
 */

import { COORDINATE_LIMIT, ELEMENT_ID_PATTERN, MAX_ELEMENT_SIZE, type Box } from '@open-artifact/whiteboard-core';

/** Most placeholders a page tells about (and keeps per page heard). */
export const MAX_UPLOAD_PLACEHOLDERS = 8;
/** How long a heard placeholder lasts past the last message naming it, ms. */
export const UPLOAD_KEEP_MS = 3000;
/** How long a heard placeholder waits for its stored element, ms. */
export const UPLOAD_STORED_KEEP_MS = 10_000;

/** A placeholder: where upload `id` will land. */
export interface UploadBox extends Box {
  id: string;
  /** The element the upload became, once saved. */
  stored?: string;
}

/** The message telling the room about `boxes` (the first {@link MAX_UPLOAD_PLACEHOLDERS}). */
export function encodeUploads(boxes: readonly UploadBox[]): { uploads: Array<Array<string | number>> } {
  return {
    uploads: boxes.slice(0, MAX_UPLOAD_PLACEHOLDERS).map((box) => [box.id, ...[box.x, box.y, box.w, box.h].map(Math.round), ...(box.stored !== undefined ? [box.stored] : [])]),
  };
}

/** The placeholders of a message; `undefined` when it is not an uploads message. Bad rows are skipped. */
export function readUploads(data: unknown): UploadBox[] | undefined {
  const rows = typeof data === 'object' && data !== null ? (data as { uploads?: unknown }).uploads : undefined;
  if (!Array.isArray(rows)) return undefined;
  const within = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
  return rows.slice(0, MAX_UPLOAD_PLACEHOLDERS).flatMap((row: unknown): UploadBox[] => {
    const [id, x, y, w, h, stored] = Array.isArray(row) ? (row as unknown[]) : [];
    if (typeof id !== 'string' || !ELEMENT_ID_PATTERN.test(id)) return [];
    if (!within(x, COORDINATE_LIMIT) || !within(y, COORDINATE_LIMIT) || !within(w, MAX_ELEMENT_SIZE) || !within(h, MAX_ELEMENT_SIZE) || w <= 0 || h <= 0) return [];
    return [{ id, x, y, w, h, ...(typeof stored === 'string' && ELEMENT_ID_PATTERN.test(stored) ? { stored } : {}) }];
  });
}

/* ------------------------------------------------------------------------ */
/* Hearing                                                                  */
/* ------------------------------------------------------------------------ */

/** A placeholder heard from a page. */
export interface HeardUpload extends UploadBox {
  /** The page that told it. */
  peer: string;
  /** When it goes (epoch ms). */
  until: number;
  /** Whether its stored element arrived (it is hidden). */
  landed?: boolean;
}

/** Heard placeholders by `peer + ' ' + id`. */
export type HeardUploads = ReadonlyMap<string, HeardUpload>;

/** The heard placeholders after `peer` told `boxes` at `now`. */
export function hearUploads(heard: HeardUploads, peer: string, boxes: readonly UploadBox[], now: number): Map<string, HeardUpload> {
  const next = new Map(heard);
  const keyOf = (id: string): string => `${peer} ${id}`;
  const fresh = new Set(boxes.map((box) => keyOf(box.id)));
  for (const [key, upload] of heard) {
    if (upload.peer === peer && !fresh.has(key) && (upload.stored === undefined || upload.landed)) next.delete(key);
  }
  for (const box of boxes) {
    const key = keyOf(box.id);
    const before = next.get(key);
    next.delete(key);
    next.set(key, {
      ...box,
      peer,
      ...(before?.landed ? { landed: true } : {}),
      until: before?.stored !== undefined ? before.until : now + (box.stored !== undefined ? UPLOAD_STORED_KEEP_MS : UPLOAD_KEEP_MS),
    });
  }
  // Keep the newest few of this page (those it just listed last to go).
  const own = [...next.keys()].filter((key) => next.get(key)!.peer === peer).sort((a, b) => Number(fresh.has(a)) - Number(fresh.has(b)));
  for (const key of own.slice(0, Math.max(0, own.length - MAX_UPLOAD_PLACEHOLDERS))) next.delete(key);
  return next;
}

/** The heard placeholders at `now`: expired ones gone, those whose element `stored` names arrived marked landed. */
export function sweepUploads(heard: HeardUploads, now: number, onBoard: (id: string) => boolean): HeardUploads {
  let next: Map<string, HeardUpload> | undefined;
  for (const [key, upload] of heard) {
    if (now >= upload.until) {
      next ??= new Map(heard);
      next.delete(key);
    } else if (upload.stored !== undefined && !upload.landed && onBoard(upload.stored)) {
      next ??= new Map(heard);
      next.set(key, { ...upload, landed: true });
    }
  }
  return next ?? heard;
}

/** The placeholders to draw: heard ones not landed. */
export function visibleUploads(heard: HeardUploads): HeardUpload[] {
  return [...heard.values()].filter((upload) => !upload.landed);
}

/** The time the next heard placeholder expires (epoch ms), if any. */
export function nextUploadExpiry(heard: HeardUploads): number | undefined {
  let soonest: number | undefined;
  for (const upload of heard.values()) if (soonest === undefined || upload.until < soonest) soonest = upload.until;
  return soonest;
}
