/**
 * The wire format of live gestures.
 *
 * While someone drags, resizes, turns, draws a shape, bends or reconnects
 * an arrow, draws an arrow or draws with the pen, their page sends what the
 * gesture looks like right now (a *frame*) to the other pages over the
 * room's {@link GESTURE_TOPIC} topic. The other pages draw it as a
 * translucent ghost, so nobody waits for the edit to be saved to see it.
 *
 * A frame is JSON split into parts of at most
 * {@link GESTURE_PART_BUDGET_BYTES} bytes (UTF-8), at most
 * {@link GESTURE_MAX_PARTS} of them; a bigger frame is not sent. Each part
 * carries the gesture's number `n` (new for every gesture), the frame's
 * serial `s` within the gesture and its place `i` of `of`. An `end`
 * message closes the gesture.
 *
 * Pure (no DOM, no stores): unit-tested.
 */

import { COORDINATE_LIMIT, INK_COLOR_NAMES, normalizeElement, type BoardElement, type InkColor } from '@open-artifact/whiteboard-core';

/** The room topic live gestures travel on. */
export const GESTURE_TOPIC = 'gesture';
/** Largest part of a frame, in UTF-8 bytes (room messages carry at most 16 KB). */
export const GESTURE_PART_BUDGET_BYTES = 3500;
/** Most parts of one frame; a frame that needs more is not sent. */
export const GESTURE_MAX_PARTS = 24;
/** Most elements one frame carries (a bigger drag is not shown live). */
export const GESTURE_MAX_ELEMENTS = 400;
/** Most pen points (x, y pairs) one frame carries; a longer stroke sends its tail. */
export const GESTURE_MAX_INK_POINTS = 4000;
/** Widest pen accepted from a peer, board units. */
export const GESTURE_MAX_INK_WIDTH = 64;

/** A point as `[x, y]`, board units. */
export type WirePoint = readonly [number, number];

/** What one person's gesture looks like right now. */
export interface GestureFrame {
  /** Elements as they are mid-gesture: moved, resized, turned, bent, or being drawn. */
  elements: BoardElement[];
  /** Ids of elements the gesture took off the board (a drawn shape dragged back to nothing). */
  gone?: string[];
  /** The pen stroke being drawn: its ink, pen width and flat `x, y` points (board units). */
  ink?: { color: InkColor; width: number; points: number[] };
  /** The arrow being drawn: where it starts and ends, and its ink. */
  draft?: { from: WirePoint; to: WirePoint; color: InkColor };
}

/** One part of a frame. */
export interface GesturePart {
  /** The gesture's number. */
  n: number;
  /** The frame's serial within the gesture (later frames have higher serials). */
  s: number;
  /** This part's index. */
  i: number;
  /** How many parts the frame has. */
  of: number;
  /** This part's slice of the frame's JSON. */
  d: string;
}

/** The message that closes a gesture. */
export interface GestureEnd {
  n: number;
  end: 1;
}

/** A message on the gesture topic. */
export type GestureMessage = GesturePart | GestureEnd;

/** Rounds a board coordinate to a tenth (enough for a ghost; keeps messages small). */
export function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

/** UTF-8 length of one UTF-16 code point starting at `code`. */
function utf8Length(code: number): number {
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdbff ? 4 : 3;
}

/**
 * Splits text into slices of at most `budget` UTF-8 bytes, never inside a
 * surrogate pair.
 */
export function splitByBytes(text: string, budget: number): string[] {
  const slices: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let index = 0; index < text.length; ) {
    const code = text.charCodeAt(index);
    const size = utf8Length(code);
    const width = size === 4 ? 2 : 1;
    if (bytes + size > budget && index > start) {
      slices.push(text.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += size;
    index += width;
  }
  if (start < text.length || slices.length === 0) slices.push(text.slice(start));
  return slices;
}

/**
 * The parts of frame `s` of gesture `n`, or `undefined` when the frame is
 * too big to send.
 */
export function encodeGestureFrame(n: number, s: number, frame: GestureFrame): GesturePart[] | undefined {
  if (frame.elements.length > GESTURE_MAX_ELEMENTS) return undefined;
  const ink = frame.ink && frame.ink.points.length > GESTURE_MAX_INK_POINTS * 2 ? { ...frame.ink, points: frame.ink.points.slice(-GESTURE_MAX_INK_POINTS * 2) } : frame.ink;
  const body: GestureFrame = {
    elements: frame.elements,
    ...(frame.gone && frame.gone.length > 0 ? { gone: frame.gone } : {}),
    ...(ink ? { ink: { color: ink.color, width: ink.width, points: ink.points.map(roundCoord) } } : {}),
    ...(frame.draft
      ? { draft: { from: [roundCoord(frame.draft.from[0]), roundCoord(frame.draft.from[1])], to: [roundCoord(frame.draft.to[0]), roundCoord(frame.draft.to[1])], color: frame.draft.color } }
      : {}),
  };
  const slices = splitByBytes(JSON.stringify(body), GESTURE_PART_BUDGET_BYTES);
  if (slices.length > GESTURE_MAX_PARTS) return undefined;
  return slices.map((d, i) => ({ n, s, i, of: slices.length, d }));
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                  */
/* ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown, most: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= most;

const isCoord = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT;

/** A pen color, or `undefined` for anything else. */
function readInkColor(value: unknown): InkColor | undefined {
  if (typeof value !== 'string') return undefined;
  if ((INK_COLOR_NAMES as readonly string[]).includes(value)) return value as InkColor;
  return /^#[0-9a-f]{6}$/i.test(value) ? (value.toLowerCase() as InkColor) : undefined;
}

function readPoint(value: unknown): WirePoint | undefined {
  return Array.isArray(value) && value.length === 2 && isCoord(value[0]) && isCoord(value[1]) ? [value[0], value[1]] : undefined;
}

/** A message from the gesture topic, or `undefined` when it is not one. */
export function readGestureMessage(value: unknown): GestureMessage | undefined {
  if (!isRecord(value) || !isCount(value.n, Number.MAX_SAFE_INTEGER)) return undefined;
  if (value.end === 1) return { n: value.n, end: 1 };
  const { s, i, of, d } = value;
  if (!isCount(s, Number.MAX_SAFE_INTEGER) || !isCount(of, GESTURE_MAX_PARTS) || of < 1 || !isCount(i, of - 1) || typeof d !== 'string') return undefined;
  return { n: value.n, s, i, of, d };
}

/** A frame from its JSON, cleaned (elements normalized, points checked), or `undefined`. */
export function readGestureFrame(json: string): GestureFrame | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || !Array.isArray(raw.elements) || raw.elements.length > GESTURE_MAX_ELEMENTS) return undefined;
  const elements = raw.elements.flatMap((element) => normalizeElement(element) ?? []);
  const gone = Array.isArray(raw.gone) ? raw.gone.filter((id): id is string => typeof id === 'string').slice(0, GESTURE_MAX_ELEMENTS) : [];
  const frame: GestureFrame = { elements, ...(gone.length > 0 ? { gone } : {}) };
  if (isRecord(raw.ink)) {
    const color = readInkColor(raw.ink.color);
    const { width, points } = raw.ink;
    const widthOk = typeof width === 'number' && width > 0 && width <= GESTURE_MAX_INK_WIDTH;
    if (color && widthOk && Array.isArray(points) && points.length % 2 === 0 && points.length <= GESTURE_MAX_INK_POINTS * 2 && points.every(isCoord))
      frame.ink = { color, width, points: points as number[] };
  }
  if (isRecord(raw.draft)) {
    const color = readInkColor(raw.draft.color);
    const from = readPoint(raw.draft.from);
    const to = readPoint(raw.draft.to);
    if (color && from && to) frame.draft = { from, to, color };
  }
  return frame;
}

/** What a heard message amounts to. */
export type HeardGesture = { kind: 'frame'; n: number; frame: GestureFrame } | { kind: 'end'; n: number };

/** Puts frames back together from their parts, per peer. */
export interface GestureAssembler {
  /** Takes one message from `peer`; returns a whole frame or an end once there is one. */
  hear(peer: string, message: GestureMessage): HeardGesture | undefined;
  /** Forgets a peer's unfinished frame. */
  forget(peer: string): void;
}

/** A frame being gathered. */
interface Gathering {
  n: number;
  s: number;
  parts: (string | undefined)[];
  have: number;
}

/**
 * Creates an assembler. A part of a newer frame (or another gesture)
 * drops an unfinished older one; parts of an older frame are ignored.
 */
export function createGestureAssembler(): GestureAssembler {
  const gathering = new Map<string, Gathering>();
  /** The last whole frame per peer, so a late older frame is ignored. */
  const latest = new Map<string, { n: number; s: number }>();
  return {
    hear(peer, message) {
      if ('end' in message) {
        gathering.delete(peer);
        latest.delete(peer);
        return { kind: 'end', n: message.n };
      }
      const last = latest.get(peer);
      if (last && last.n === message.n && message.s <= last.s) return undefined;
      let current = gathering.get(peer);
      if (current && current.n === message.n && message.s < current.s) return undefined;
      if (!current || current.n !== message.n || current.s !== message.s || current.parts.length !== message.of) {
        current = { n: message.n, s: message.s, parts: Array.from({ length: message.of }, () => undefined), have: 0 };
        gathering.set(peer, current);
      }
      if (current.parts[message.i] === undefined) {
        current.parts[message.i] = message.d;
        current.have += 1;
      }
      if (current.have < current.parts.length) return undefined;
      gathering.delete(peer);
      latest.set(peer, { n: message.n, s: message.s });
      const frame = readGestureFrame(current.parts.join(''));
      return frame ? { kind: 'frame', n: message.n, frame } : undefined;
    },
    forget(peer) {
      gathering.delete(peer);
      latest.delete(peer);
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Landing                                                                  */
/* ------------------------------------------------------------------------ */

/** How far (board units) a stored number may be from a frame's and still match. */
export const GESTURE_MATCH_TOLERANCE = 1;

/**
 * Whether two JSON values are the same, ignoring key order, with numbers
 * matching within `tolerance`.
 */
export function nearlySame(a: unknown, b: unknown, tolerance = GESTURE_MATCH_TOLERANCE): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tolerance;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => nearlySame(value, b[index], tolerance));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  if (keys.length !== Object.keys(b).filter((key) => b[key] !== undefined).length) return false;
  return keys.every((key) => nearlySame(a[key], b[key], tolerance));
}

/**
 * True when the board shows what the frame shows: every element of the
 * frame is stored as drawn and every gone element is gone. A closed
 * gesture's ghost goes once its frame has landed.
 */
export function frameLanded(frame: GestureFrame, byId: ReadonlyMap<string, BoardElement>): boolean {
  return frame.elements.every((element) => nearlySame(byId.get(element.id), element)) && (frame.gone ?? []).every((id) => !byId.has(id));
}
