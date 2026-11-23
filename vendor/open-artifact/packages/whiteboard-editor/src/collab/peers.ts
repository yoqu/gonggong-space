/**
 * Other viewers as this page sees them: the room's peer list, parsed
 * defensively into what the board draws (cursors, chat bubbles, selection
 * rings, shared requests, follow areas).
 *
 * Everything a peer publishes is untrusted: values are type-checked,
 * clamped and cut here, and the UI renders every string as text.
 *
 * The keys this page publishes (and so reads from peers) are:
 * - `user`: the person's id, so one person keeps one color across tabs;
 * - `camera` `{x, y, zoom}`, `viewport` `{w, h}` and `view` (the board area
 *   in sight, clear of chrome, for followers);
 * - `pointer` `{x, y}` in board units, or `null` off the board;
 * - `selection`: selected element ids;
 * - `chat` (cursor chat text) and `chatAsk` (the text is a request to the agent);
 * - `leading`: a serial while the peer asks everyone to follow it;
 * - `asks`: requests to the agent the peer is waiting on;
 * - `color` `{c, t}`: the color the page wears and when it settled on it
 *   (`t` is `null` while it has not; see `peer-colors.ts` in `@open-artifact/editor-kit`);
 * - `viewContext`: what the agent reads (see `view-context.ts`).
 */

import { create } from 'zustand';
import type { Peer } from '@open-artifact/runtime';
import { CLAIM_KEY_PATTERN, readFollowArea, type Box } from '@open-artifact/whiteboard-core';
import { normalizePeerColor, peerColorFor, type PeerColorClaim } from '@open-artifact/editor-kit';
import type { Camera, Point } from '../lib/camera.ts';
import type { BoardPeer } from '../state/presence.ts';
import { ASK_STATUSES, MAX_SHARED_ASK_TEXT, type AskStatus } from './ask-status.ts';

/** Most characters of a peer's display name kept. */
export const MAX_PEER_NAME = 64;

/** Most characters of cursor chat a peer can show (requests to the agent). */
export const MAX_PEER_CHAT = 500;

/** Most selected ids kept per peer. */
export const MAX_PEER_SELECTION = 200;

/** Most shared requests kept per peer. */
export const MAX_PEER_ASKS = 8;

/** Largest coordinate accepted from a peer (board units). */
const COORDINATE_LIMIT = 1e7;

/** Element ids as stored (`elements/<id>` path segments). */
const ELEMENT_ID_PATTERN = /^[A-Za-z0-9_.~:@+-]{1,64}$/;

/** A request to the agent a peer shares, so everyone sees it on the board. */
export interface SharedAsk {
  /** The request's claim key. */
  key: string;
  status: AskStatus;
  /** The first words of the request. */
  text?: string;
  /** The area it is about (board units). */
  rect?: Box;
  /** The point it was made at (cursor chat). */
  point?: Point;
  /** The elements it is about. */
  ids?: string[];
}

/** A peer's cursor chat. */
export interface PeerChat {
  text: string;
  /** The text is a request to the agent. */
  asking: boolean;
  /** When this page saw the text change (epoch ms). */
  at: number;
}

/** Another page on the board, parsed. */
export interface CollabPeer {
  /** Peer (page) id. */
  id: string;
  name: string;
  kind: 'person' | 'agent';
  /** The person's id (the peer id when the peer did not say). */
  user: string;
  /** The person's color: the one the page published, else the one their id hashes to. */
  color: string;
  /** When the page settled on its color (epoch ms); unset while it has not. */
  colorSince?: number;
  camera?: Camera;
  viewport?: { w: number; h: number };
  /** The board area in sight, clear of chrome. */
  view?: Box;
  /** Pointer in board units. */
  pointer?: Point;
  /** When this page saw the pointer move (epoch ms). */
  movedAt: number;
  selection: string[];
  chat?: PeerChat;
  /** Serial of the peer's current "follow me", while it asks. */
  leading?: number;
  asks: SharedAsk[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, limit = COORDINATE_LIMIT): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

/** A clean single-line string of at most `max` characters, or `undefined`. */
export function cleanPeerText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Control characters (newlines included) collapse to spaces; bidi overrides go.
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  if (text === '') return undefined;
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** A peer's published color: `{c}` with `t` when it settled, or `undefined`. */
export function parsePeerColor(value: unknown): { c: string; t?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const c = normalizePeerColor(value.c);
  const t = finite(value.t, Number.MAX_SAFE_INTEGER);
  return c === undefined ? undefined : { c, ...(t !== undefined ? { t } : {}) };
}

/** A board point, or `undefined`. */
export function parsePoint(value: unknown): Point | undefined {
  if (!isRecord(value)) return undefined;
  const x = finite(value.x);
  const y = finite(value.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

/** A camera, or `undefined`. */
export function parseCamera(value: unknown): Camera | undefined {
  if (!isRecord(value)) return undefined;
  const x = finite(value.x);
  const y = finite(value.y);
  const zoom = finite(value.zoom, 100);
  return x === undefined || y === undefined || zoom === undefined || zoom <= 0 ? undefined : { x, y, zoom };
}

/** A box with a positive size, or `undefined`. */
export function parseBox(value: unknown): Box | undefined {
  if (!isRecord(value)) return undefined;
  const x = finite(value.x);
  const y = finite(value.y);
  const w = finite(value.w);
  const h = finite(value.h);
  return x === undefined || y === undefined || w === undefined || h === undefined || w <= 0 || h <= 0 ? undefined : { x, y, w, h };
}

/** Element ids (valid, unique, at most `max`). */
export function parseIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (ids.length >= max) break;
    if (typeof item === 'string' && ELEMENT_ID_PATTERN.test(item) && !ids.includes(item)) ids.push(item);
  }
  return ids;
}

/** One shared request, or `undefined`. */
export function parseSharedAsk(value: unknown): SharedAsk | undefined {
  if (!isRecord(value) || typeof value.key !== 'string' || !CLAIM_KEY_PATTERN.test(value.key)) return undefined;
  const status = (ASK_STATUSES as readonly unknown[]).includes(value.status) ? (value.status as AskStatus) : 'queued';
  const text = cleanPeerText(value.text, MAX_SHARED_ASK_TEXT);
  const rect = parseBox(value.rect);
  const point = parsePoint(value.point);
  const ids = parseIds(value.ids, MAX_PEER_SELECTION);
  return {
    key: value.key,
    status,
    ...(text !== undefined ? { text } : {}),
    ...(rect !== undefined ? { rect } : {}),
    ...(point !== undefined ? { point } : {}),
    ...(ids.length > 0 ? { ids } : {}),
  };
}

function samePoint(a: Point | undefined, b: Point | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y);
}

/**
 * Parses one peer's published state. `previous` (this page's last parse of
 * the same peer) carries the times the pointer and chat last changed.
 */
export function parsePeer(peer: Peer, now: number, previous?: CollabPeer): CollabPeer {
  const state = isRecord(peer.state) ? peer.state : {};
  const user = typeof state.user === 'string' && state.user.length > 0 && state.user.length <= 128 ? state.user : peer.id;
  const name = cleanPeerText(peer.name, MAX_PEER_NAME) ?? (peer.kind === 'agent' ? 'Agent' : 'Someone');
  const camera = parseCamera(state.camera);
  const viewportBox = isRecord(state.viewport) ? { x: 0, y: 0, w: state.viewport.w, h: state.viewport.h } : undefined;
  const viewport = parseBox(viewportBox);
  const view = readFollowArea(state.view);
  const pointer = parsePoint(state.pointer);
  const chatText = cleanPeerText(state.chat, MAX_PEER_CHAT);
  const asking = state.chatAsk === true;
  const leading = finite(state.leading, Number.MAX_SAFE_INTEGER);
  const color = parsePeerColor(state.color);
  const asks = (Array.isArray(state.asks) ? state.asks : []).slice(0, MAX_PEER_ASKS).flatMap((item: unknown) => parseSharedAsk(item) ?? []);
  const chat: PeerChat | undefined =
    chatText === undefined
      ? undefined
      : previous?.chat !== undefined && previous.chat.text === chatText && previous.chat.asking === asking
        ? previous.chat
        : { text: chatText, asking, at: now };
  return {
    id: peer.id,
    name,
    kind: peer.kind === 'agent' ? 'agent' : 'person',
    user,
    color: peerColorFor(color?.c, user),
    ...(color?.t !== undefined ? { colorSince: color.t } : {}),
    ...(camera !== undefined ? { camera } : {}),
    ...(viewport !== undefined ? { viewport: { w: viewport.w, h: viewport.h } } : {}),
    ...(view !== undefined ? { view } : {}),
    ...(pointer !== undefined ? { pointer } : {}),
    movedAt: previous !== undefined && samePoint(previous.pointer, pointer) ? previous.movedAt : now,
    selection: parseIds(state.selection, MAX_PEER_SELECTION),
    ...(chat !== undefined ? { chat } : {}),
    ...(leading !== undefined && leading > 0 ? { leading } : {}),
    asks,
  };
}

/**
 * Parses the room's peer list: this page itself (`selfId`) is left out, and
 * `previous` carries per-peer times across updates.
 */
export function parsePeers(peers: readonly Peer[], selfId: string, now: number, previous: ReadonlyMap<string, CollabPeer> = new Map()): Map<string, CollabPeer> {
  const parsed = new Map<string, CollabPeer>();
  for (const peer of peers) {
    if (!isRecord(peer) || typeof peer.id !== 'string' || peer.id === selfId || parsed.has(peer.id)) continue;
    parsed.set(peer.id, parsePeer(peer, now, previous.get(peer.id)));
  }
  return parsed;
}

/**
 * The color claims of the people among `peers` (settled ones only), for
 * this page's color keeper: `own` marks the pages of `self` (this person).
 */
export function peerColorClaims(peers: Iterable<CollabPeer>, self: string): PeerColorClaim[] {
  const claims: PeerColorClaim[] = [];
  for (const peer of peers) {
    if (peer.kind !== 'person' || peer.colorSince === undefined) continue;
    claims.push({ key: peer.user, peer: peer.id, own: peer.user === self, c: peer.color, t: peer.colorSince });
  }
  return claims;
}

/** The shape the editor's presence store keeps of a parsed peer. */
export function toBoardPeer(peer: CollabPeer): BoardPeer {
  return {
    id: peer.id,
    name: peer.name,
    kind: peer.kind,
    presence: {
      ...(peer.camera !== undefined ? { camera: peer.camera } : {}),
      ...(peer.viewport !== undefined ? { viewport: peer.viewport } : {}),
      ...(peer.pointer !== undefined ? { pointer: peer.pointer } : {}),
      ...(peer.selection.length > 0 ? { selection: peer.selection } : {}),
      ...(peer.chat !== undefined ? { chat: peer.chat.text } : {}),
      ...(peer.leading !== undefined ? { leading: true } : {}),
    },
  };
}

/** Parsed peers, by peer id. */
interface CollabPeersState {
  peers: ReadonlyMap<string, CollabPeer>;
}

/** The parsed peers (the editor's `usePresence` holds the shared subset). */
export const useCollabPeers = create<CollabPeersState>()(() => ({ peers: new Map() }));
