/**
 * Upload placeholders: while pictures or videos upload, everyone sees
 * where they will land.
 *
 * This page draws its own uploads as the picture itself, faded, with a
 * spinner ({@link showUpload} … {@link endUpload}); other pages draw a box
 * with a spinner, told over the room (`upload-wire.ts`).
 *
 * Telling (`startUploads`, with a room):
 * - the list goes out {@link UPLOAD_SEND_DELAY_MS} after it changes, and
 *   again every {@link UPLOAD_BEAT_MS} while it is not empty (so a page
 *   that joins late sees it, and one that went away stops showing it);
 * - an upload that ends saved stays listed, naming its element, for
 *   {@link UPLOAD_STORED_BEATS} more beats, and the board is saved at once;
 *   one that failed is dropped from the list;
 * - an upload listed for {@link UPLOAD_MAX_AGE_MS} is dropped.
 */

import { create } from 'zustand';
import type { JsonValue, RoomCapability } from '@open-artifact/runtime';
import { maybeSession } from '../services/session.ts';
import { flushSync } from '../services/sync.ts';
import { onRemoteChange, useBoard } from '../state/board.ts';
import { GESTURE_TOPIC } from './gesture-wire.ts';
import { encodeUploads, hearUploads, nextUploadExpiry, readUploads, sweepUploads, type HeardUploads, type UploadBox } from './upload-wire.ts';

/** How long after a change the list is told, ms. */
export const UPLOAD_SEND_DELAY_MS = 100;
/** How often the list is told again while not empty, ms. */
export const UPLOAD_BEAT_MS = 1000;
/** Beats a saved upload stays listed (naming its element). */
export const UPLOAD_STORED_BEATS = 2;
/** Longest an upload stays listed, ms. */
export const UPLOAD_MAX_AGE_MS = 300_000;

/** One of this page's uploads in progress. */
export interface OwnUpload extends UploadBox {
  /** The picture itself (an object URL), when known. */
  preview?: string;
}

interface UploadsState {
  /** This page's uploads in progress. */
  own: readonly OwnUpload[];
  /** Other pages' uploads, as heard. */
  heard: HeardUploads;
}

const NO_HEARD: HeardUploads = new Map();

/** Upload placeholders: this page's and those heard. */
export const useUploads = create<UploadsState>()(() => ({ own: [], heard: NO_HEARD }));

/* ------------------------------------------------------------------------ */
/* Telling                                                                  */
/* ------------------------------------------------------------------------ */

/** An upload being told. */
interface Told {
  box: UploadBox;
  since: number;
  /** Beats left for a saved upload. */
  beats?: number;
}

const told = new Map<string, Told>();
let room: RoomCapability | null = null;
let lastSent = '[]';
let sendTimer: ReturnType<typeof setTimeout> | undefined;
let beatTimer: ReturnType<typeof setInterval> | undefined;

/** Tells the room the list (unless it is the same as last time and `force` is off). */
function send(force = false): void {
  if (sendTimer !== undefined) clearTimeout(sendTimer);
  sendTimer = undefined;
  if (room === null) return;
  const message = encodeUploads([...told.values()].map((entry) => entry.box));
  const json = JSON.stringify(message.uploads);
  if (!force && json === lastSent) return;
  lastSent = json;
  void room.emit(GESTURE_TOPIC, message as unknown as JsonValue).catch(() => {});
}

function scheduleSend(): void {
  sendTimer ??= setTimeout(send, UPLOAD_SEND_DELAY_MS);
}

/** One beat: saved uploads count down, old ones go, and the list is told again. */
function beat(): void {
  const now = Date.now();
  for (const [id, entry] of told) {
    if (entry.beats !== undefined) entry.beats -= 1;
    if ((entry.beats !== undefined && entry.beats < 0) || now - entry.since >= UPLOAD_MAX_AGE_MS) told.delete(id);
  }
  if (told.size === 0 && beatTimer !== undefined) {
    clearInterval(beatTimer);
    beatTimer = undefined;
  }
  send(true);
}

/** Shows upload `box` here (with `preview`, the picture itself) and tells the room where it will land. */
export function showUpload(box: UploadBox, preview?: string): void {
  useUploads.setState({ own: [...useUploads.getState().own.filter((upload) => upload.id !== box.id), { ...box, ...(preview !== undefined ? { preview } : {}) }] });
  told.set(box.id, { box, since: Date.now() });
  scheduleSend();
  beatTimer ??= setInterval(beat, UPLOAD_BEAT_MS);
}

/**
 * Ends upload `id`: `stored` names the element it became (then the board
 * is saved at once, so others get it soon); without it the upload failed.
 */
export function endUpload(id: string, stored?: string): void {
  const own = useUploads.getState().own;
  if (own.some((upload) => upload.id === id)) useUploads.setState({ own: own.filter((upload) => upload.id !== id) });
  const entry = told.get(id);
  if (stored !== undefined) flushSync();
  if (entry === undefined || entry.box.stored !== undefined) return;
  if (stored === undefined) {
    told.delete(id);
    scheduleSend();
    return;
  }
  told.set(id, { ...entry, box: { ...entry.box, stored }, beats: UPLOAD_STORED_BEATS });
  send();
}

/* ------------------------------------------------------------------------ */
/* Hearing                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Tells and hears upload placeholders over the session's room; a no-op
 * without one. Returns a function that stops.
 */
export function startUploads(): () => void {
  const current = maybeSession()?.room;
  if (!current) return () => {};
  room = current;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  const refresh = (heard: HeardUploads): void => {
    const { byId } = useBoard.getState();
    const swept = sweepUploads(heard, Date.now(), (id) => byId.has(id));
    if (swept !== useUploads.getState().heard) useUploads.setState({ heard: swept.size === 0 ? NO_HEARD : swept });
    if (expiry !== undefined) clearTimeout(expiry);
    const next = nextUploadExpiry(swept);
    expiry = next === undefined ? undefined : setTimeout(() => refresh(useUploads.getState().heard), Math.max(0, next - Date.now()) + 1);
  };

  const offMessages = current.onMessage(({ from, topic, data }) => {
    if (topic !== GESTURE_TOPIC) return;
    const boxes = readUploads(data);
    if (boxes === undefined) return;
    refresh(hearUploads(useUploads.getState().heard, from, boxes, Date.now()));
  });
  // A saved upload's element arriving hides its box.
  const offRemote = onRemoteChange(() => {
    if (useUploads.getState().heard.size > 0) refresh(useUploads.getState().heard);
  });

  return () => {
    offMessages();
    offRemote();
    if (expiry !== undefined) clearTimeout(expiry);
    if (beatTimer !== undefined) clearInterval(beatTimer);
    beatTimer = undefined;
    if (told.size > 0) {
      told.clear();
      send();
    }
    if (sendTimer !== undefined) clearTimeout(sendTimer);
    sendTimer = undefined;
    room = null;
    lastSent = '[]';
    useUploads.setState({ heard: NO_HEARD });
  };
}
