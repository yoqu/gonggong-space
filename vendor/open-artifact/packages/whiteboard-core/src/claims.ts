/**
 * The agent's claims on the board: while it works it marks the area or the
 * items it is about to change, so people see where it is busy.
 *
 * Two layers:
 * - shared records (`content.claimed`, stored as `board/claim-<key>`): one per
 *   asker, keyed by the claim key of that asker's view; any editor drops a
 *   record when it expires;
 * - a local claim store: the claims one agent turn makes, with their bounds,
 *   so the editor can frame them and fade them out.
 *
 * Geometry is injected (`ClaimBoundsOf`), so this module needs no layout.
 */

import type { SyncTimers, TimerHandle } from './sync/transport.ts';
import { SYSTEM_TIMERS } from './sync/transport.ts';
import { COORDINATE_LIMIT, type BoardContent, type BoardElement, type ClaimedArea, type ElementId } from './schema.ts';

/**
 * Ids a page mints for new elements (`createElementId`): eight base-36
 * digits of the time, a dash and five more characters. The agent picks its
 * own ids, so an element with such an id was added by a person.
 */
export const PAGE_MINTED_ID_PATTERN = /^([0-9a-z]{8})-[0-9a-z]{5}$/;

/** Earliest time a page-minted id can carry. */
const PAGE_MINTED_EPOCH = Date.UTC(2024, 0, 1);

/**
 * True when `id` looks minted by a page (see {@link PAGE_MINTED_ID_PATTERN}):
 * the pattern matches and its time lies between 2024 and a day from `now`.
 * Items a person adds this way never grow the agent's claims.
 */
export function isPageMintedElementId(id: string, now: number = Date.now()): boolean {
  const time = parseInt(PAGE_MINTED_ID_PATTERN.exec(id)?.[1] ?? '', 36);
  return time >= PAGE_MINTED_EPOCH && time <= now + 86_400_000;
}

/** How long after the agent stops it still counts as working (its last writes may land late), ms. */
export const WORKING_QUIET_MS = 2000;

/** Serial numbers of claims start here (so they never clash with list indexes). */
export const CLAIM_SERIAL_BASE = 1e6;
/** How long an ended claim fades. */
export const CLAIM_FADE_MS = 420;
/** Space around claimed items. */
export const CLAIM_PADDING = 12;
/** The size of an area claim that gives only a point. */
export const DEFAULT_CLAIM_SIZE = { w: 480, h: 320 } as const;
/** The smallest side of a claimed area. */
export const MIN_CLAIM_SIDE = 48;
/** The largest side of a claimed area. */
export const MAX_CLAIM_SIDE = 8000;
/** Claims one turn may make. */
export const MAX_CLAIMS_PER_TURN = 8;
/** A claim key: a letter then seven letters or digits. */
export const CLAIM_KEY_PATTERN = /^[a-z][a-z0-9]{7}$/;
/** A shared claim nobody touched for this long stops being framed. */
export const OUTSIDE_CLAIM_IDLE_MS = 240_000;
/** A shared claim nobody rewrote for this long is dropped. */
export const OUTSIDE_CLAIM_EXPIRE_MS = 600_000;
/** How long the asker's own claim stays once the agent stopped working. */
export const OUTSIDE_CLAIM_BESIDE_MS = 5000;
/** New items this close to a shared claim count as landing in it. */
export const OUTSIDE_CLAIM_JOIN_PX = 160;
/** Claim keys remembered for whose-claim lookups. */
export const MAX_CLAIM_ONLY_KEYS = 64;

/** An area of the board. */
export interface ClaimBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isClaimRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withinCoordinateLimit(box: ClaimBox): boolean {
  return Math.max(-box.x, -box.y, box.x + box.w, box.y + box.h) <= COORDINATE_LIMIT;
}

/** A claimed side, rounded and clamped; `fallback` when absent, `undefined` when invalid. */
export function clampClaimSide(side: unknown, fallback: number): number | undefined {
  if (side === undefined) return fallback;
  return isFiniteCoordinate(side) && side > 0 ? Math.min(Math.max(Math.round(side), MIN_CLAIM_SIDE), MAX_CLAIM_SIDE) : undefined;
}

/** The area an agent asked for (`{x, y, w?, h?}`), or `undefined` when it is not one. */
export function parseClaimArea(area: unknown): ClaimBox | undefined {
  if (!isClaimRecord(area)) return undefined;
  const w = clampClaimSide(area.w, DEFAULT_CLAIM_SIZE.w);
  const h = clampClaimSide(area.h, DEFAULT_CLAIM_SIZE.h);
  if (!isFiniteCoordinate(area.x) || !isFiniteCoordinate(area.y) || w === undefined || h === undefined) return undefined;
  const box = { x: Math.round(area.x), y: Math.round(area.y), w, h };
  return withinCoordinateLimit(box) ? box : undefined;
}

/** `box` when it is a finite, non-empty area within the board. */
export function validClaimBox<T extends Partial<ClaimBox>>(box: T | undefined): (T & ClaimBox) | undefined {
  if (box === undefined) return undefined;
  const { x, y, w, h } = box;
  if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y) || !isFiniteCoordinate(w) || !isFiniteCoordinate(h) || w <= 0 || h <= 0) return undefined;
  return withinCoordinateLimit({ x, y, w, h }) ? (box as T & ClaimBox) : undefined;
}

/** The element ids a claim names: an id, `{id}`, or a list of those. */
export function claimTargetIds(target: unknown): ElementId[] {
  return (Array.isArray(target) ? target : [target]).flatMap((item: unknown) => {
    const id = isClaimRecord(item) ? item.id : item;
    return typeof id === 'string' ? [id] : [];
  });
}

/** The distance between two boxes (0 when they touch or overlap). */
export function claimRectGap(a: ClaimBox, b: ClaimBox): number {
  return Math.hypot(Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w), Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h));
}

/** The smallest box around all `boxes`. */
export function unionClaimBoxes(boxes: readonly ClaimBox[]): ClaimBox | undefined {
  if (boxes.length === 0) return undefined;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    x0 = Math.min(x0, box.x);
    y0 = Math.min(y0, box.y);
    x1 = Math.max(x1, box.x + box.w);
    y1 = Math.max(y1, box.y + box.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A fresh claim key: `c` and seven base-36 characters. */
export function createClaimKey(randomBytes: (count: number) => Uint8Array = (count) => globalThis.crypto.getRandomValues(new Uint8Array(count))): string {
  return `c${Array.from(randomBytes(7), (byte) => (byte % 36).toString(36)).join('')}`;
}

/** The content with other claims (`undefined` drops the field). */
export function withClaimed(content: BoardContent, claimed: readonly ClaimedArea[] | undefined): BoardContent {
  const { claimed: _previous, ...rest } = content;
  return claimed === undefined ? rest : { ...rest, claimed: [...claimed] };
}

/** A document whose content can be read and replaced. */
export interface ClaimContentStore<R = unknown> {
  content(): BoardContent;
  setContent(content: BoardContent): R;
  updateContent(updater: (content: BoardContent) => BoardContent): R;
}

/** What {@link addDropClaimed} adds. */
export interface DropClaimed<R = unknown> {
  /** Removes the claims with these keys (a no-op when none is there). */
  dropClaimed(keys: readonly string[]): R;
}

/**
 * Makes a content store keep the current claims on every content write (only
 * the agent and expiry change them), and adds {@link DropClaimed.dropClaimed}.
 * Changes the store in place and returns it; wrapping twice is a no-op.
 */
export function addDropClaimed<R, S extends ClaimContentStore<R>>(doc: S): S & DropClaimed<R> {
  const wrapped = doc as S & Partial<DropClaimed<R>>;
  if (wrapped.dropClaimed !== undefined) return wrapped as S & DropClaimed<R>;
  const setContent = doc.setContent.bind(doc);
  const updateContent = doc.updateContent.bind(doc);
  wrapped.setContent = (next) => setContent(next === doc.content() ? next : withClaimed(next, doc.content().claimed));
  wrapped.updateContent = (updater) =>
    updateContent((current) => {
      const next = updater(current);
      return next === current ? next : withClaimed(next, current.claimed);
    });
  wrapped.dropClaimed = (keys) =>
    updateContent((current) =>
      current.claimed?.some((claim) => keys.includes(claim.key)) === true
        ? withClaimed(
            current,
            current.claimed.filter((claim) => !keys.includes(claim.key)),
          )
        : current,
    );
  return wrapped as S & DropClaimed<R>;
}

/* -------------------------------------------------------------------------- */
/* The local claim store                                                      */
/* -------------------------------------------------------------------------- */

/** The bounds of one element on the board (`undefined` when it has none). */
export type ClaimBoundsOf = (element: BoardElement, elements: readonly BoardElement[]) => ClaimBox | undefined;

/** One claim an agent turn made. */
export interface AgentClaim {
  /** `items` claims elements; `empty` claims an empty area. */
  kind: 'items' | 'empty';
  /** The agent said where it works (the claim is shown). */
  said: boolean;
  /** The claimed area. */
  ground?: ClaimBox;
  /** An area given up front by the asker (fixed for the turn). */
  given?: ClaimBox;
  /** The claimed elements. */
  named: ElementId[];
  /** Elements the turn created inside the claim. */
  landed: ElementId[];
  /** Extra state the editor keeps with the claim. */
  held?: unknown;
}

/** A shown claim: the claim, its serial, its desk and its last bounds. */
export interface PlacedClaim extends AgentClaim {
  desk: number;
  n: number;
  last: ClaimBox;
}

/** The claims shown now, and those fading out. */
export interface ClaimState {
  /** The newest claim. */
  now?: PlacedClaim;
  all: PlacedClaim[];
  fading: PlacedClaim[];
}

/** The claims one agent turn makes. */
export interface ClaimSession {
  /** Claims ids (`id`, `{id}`, a list) or an area (`{x, y, w?, h?}`). */
  claim(target: unknown): void;
  /** The area claimed, when the claim is an area. */
  ground(): ClaimBox | undefined;
  /** The claim's current bounds. */
  at?(): ClaimBox | undefined;
  /** Adds elements the turn created. */
  landed(ids: readonly ElementId[]): void;
  hold?(held: unknown): void;
  /** Ends the turn's claim (it fades out). */
  end(): void;
}

/** A session that does nothing (read-only views and disposed stores). */
export const INERT_CLAIM: ClaimSession = {
  claim: () => undefined,
  ground: () => undefined,
  landed: () => undefined,
  end: () => undefined,
};

/** Options of {@link createClaimStore}. */
export interface ClaimStoreOptions {
  /** The current elements. */
  board(): { elements: readonly BoardElement[] };
  boundsOf: ClaimBoundsOf;
  /** Called when a claim is placed or moved, with its bounds and serial. */
  arrive?(bounds: ClaimBox, n: number): void;
  timers?: Pick<SyncTimers, 'setTimeout' | 'clearTimeout'>;
  /** Told when drawing a claim failed (default: `console.error`). */
  onError?(error: unknown): void;
}

/** The local claim store. */
export interface ClaimStore {
  state(): ClaimState;
  subscribe(listener: () => void): () => void;
  /** Starts a turn's claim on `desk` (ending the previous one there). */
  begin(inert: boolean, given?: Partial<ClaimBox>, desk?: number): ClaimSession;
  dispose(): void;
}

/** The padded bounds of the claimed items. */
export function claimItemsBounds(ids: readonly ElementId[], elements: readonly BoardElement[], boundsOf: ClaimBoundsOf): ClaimBox | undefined {
  if (ids.length === 0) return undefined;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const bounds = unionClaimBoxes(
    ids.flatMap((id) => {
      const element = byId.get(id);
      const box = element === undefined ? undefined : boundsOf(element, elements);
      return box === undefined ? [] : [box];
    }),
  );
  return bounds === undefined
    ? undefined
    : { x: bounds.x - CLAIM_PADDING, y: bounds.y - CLAIM_PADDING, w: bounds.w + 2 * CLAIM_PADDING, h: bounds.h + 2 * CLAIM_PADDING };
}

/** The bounds of a claim: its area and its items. */
export function claimBounds(claim: Pick<AgentClaim, 'ground' | 'named' | 'landed'>, elements: readonly BoardElement[], boundsOf: ClaimBoundsOf): ClaimBox | undefined {
  const items = claimItemsBounds([...claim.named, ...claim.landed], elements, boundsOf);
  return unionClaimBoxes([...(claim.ground !== undefined ? [claim.ground] : []), ...(items !== undefined ? [items] : [])]);
}

/** {@link claimBounds}, or the last bounds when the items are gone. */
export function claimBoundsOrLast(claim: PlacedClaim, elements: readonly BoardElement[], boundsOf: ClaimBoundsOf): ClaimBox {
  return claimBounds(claim, elements, boundsOf) ?? claim.last;
}

/** Creates the local claim store. */
export function createClaimStore(options: ClaimStoreOptions): ClaimStore {
  const timers = options.timers ?? SYSTEM_TIMERS;
  let state: ClaimState = { all: [], fading: [] };
  const listeners = new Set<() => void>();
  const pending = new Set<TimerHandle>();
  const sessions = new Map<number, ClaimSession>();
  let serial = 0;
  let disposed = false;
  const setState = (next: ClaimState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const afterDelay = (ms: number, run: () => void): void => {
    const handle = timers.setTimeout(() => {
      pending.delete(handle);
      run();
    }, ms);
    pending.add(handle);
  };
  const withNow = (all: PlacedClaim[], fading: PlacedClaim[] = state.fading): ClaimState => {
    const now = all.at(-1);
    return { ...(now !== undefined ? { now } : {}), all, fading };
  };
  const guard = (run: () => void): void => {
    try {
      run();
    } catch (error) {
      (options.onError ?? ((failure: unknown) => console.error('[whiteboard] a claim could not be drawn', failure instanceof Error ? failure.name : typeof failure)))(error);
    }
  };
  const placeClaim = (claim: AgentClaim, desk: number, n: number | undefined): number | undefined => {
    const { elements } = options.board();
    const existing = state.all.find((entry) => entry.n === n);
    const last = claimBounds(claim, elements, options.boundsOf) ?? existing?.last;
    if (last === undefined) return n;
    const entry: PlacedClaim = { ...claim, desk, n: n ?? CLAIM_SERIAL_BASE + ++serial, last };
    setState(withNow(existing === undefined ? [...state.all, entry] : state.all.map((item) => (item === existing ? entry : item))));
    guard(() => options.arrive?.(last, entry.n));
    return entry.n;
  };
  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    begin(inert, given, desk = 0) {
      sessions.get(desk)?.end();
      if (inert || disposed) return INERT_CLAIM;
      let claims = 0;
      let claim: AgentClaim = { kind: 'items', said: false, named: [], landed: [] };
      let n: number | undefined;
      const update = (next: AgentClaim): void => {
        claim = next;
        n = placeClaim(next, desk, n);
      };
      const session: ClaimSession = {
        claim: (target) =>
          guard(() => {
            if (sessions.get(desk) !== session || claims >= MAX_CLAIMS_PER_TURN || claim.given !== undefined) return;
            const ids = new Set(options.board().elements.map((element) => element.id));
            const named = [...new Set(claimTargetIds(target).filter((id) => ids.has(id)))];
            const ground = named.length > 0 ? undefined : parseClaimArea(target);
            if (named.length === 0 && ground === undefined) return;
            const namedKey = (list: readonly ElementId[]): string => JSON.stringify(list.filter((id) => ids.has(id)).sort());
            if (claim.said && JSON.stringify(claim.ground) === JSON.stringify(ground) && namedKey(claim.named) === namedKey(named)) return;
            claims += 1;
            update({
              kind: ground !== undefined ? 'empty' : 'items',
              said: true,
              ...(ground !== undefined ? { ground } : {}),
              named,
              landed: claim.said ? [] : claim.landed,
            });
          }),
        ground: () => (sessions.get(desk) === session && claim.given === undefined ? claim.ground : undefined),
        at: () => {
          const entry = state.all.find((item) => item.n === n);
          return entry === undefined ? undefined : claimBoundsOrLast(entry, options.board().elements, options.boundsOf);
        },
        landed: (ids) =>
          guard(() => {
            if (sessions.get(desk) === session) update({ ...claim, landed: [...new Set([...claim.landed, ...ids])] });
          }),
        hold: (held) =>
          guard(() => {
            if (sessions.get(desk) === session) update({ ...claim, held });
          }),
        end: () =>
          guard(() => {
            if (sessions.get(desk) !== session) return;
            sessions.delete(desk);
            const match = state.all.find((item) => item.n === n);
            if (match === undefined) return;
            afterDelay(CLAIM_FADE_MS, () => setState({ ...state, fading: state.fading.filter((item) => item !== match) }));
            setState(
              withNow(
                state.all.filter((item) => item !== match),
                [...state.fading, match],
              ),
            );
          }),
      };
      sessions.set(desk, session);
      if (given !== undefined) {
        guard(() => {
          const box = validClaimBox(given);
          if (box !== undefined) {
            const area = { x: box.x, y: box.y, w: box.w, h: box.h };
            update({ ...claim, kind: 'empty', said: true, given: area, ground: area });
          }
        });
      }
      return session;
    },
    dispose() {
      disposed = true;
      sessions.clear();
      for (const handle of pending) timers.clearTimeout(handle);
      pending.clear();
      state = { all: [], fading: [] };
      listeners.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Expiry of shared claims                                                    */
/* -------------------------------------------------------------------------- */

/** Options of {@link createClaimExpiry}. */
export interface ClaimExpiryOptions {
  /** Drops expired claims from the board (editors only). */
  drop(keys: string[]): void;
  timers?: SyncTimers;
}

/** Watches the shared claims and drops those nobody rewrote for a while. */
export interface ClaimExpiry {
  /** Call with the content whenever it changes (and once after loading). */
  heard(content: BoardContent): void;
  /** Keys being tracked, with the time each expires. */
  due(): ReadonlyMap<string, number>;
  dispose(): void;
}

/**
 * Drops a shared claim {@link OUTSIDE_CLAIM_EXPIRE_MS} after it was last
 * written (an agent that crashed or lost its connection never deletes its
 * claim, so every editor sweeps). Claims without an area or ids count from
 * when they were first seen.
 */
export function createClaimExpiry(options: ClaimExpiryOptions): ClaimExpiry {
  const timers = options.timers ?? SYSTEM_TIMERS;
  const wrote = new Map<string, { at: number; json: string }>();
  let timer: TimerHandle | undefined;
  let disposed = false;
  const isPlaced = (claim: ClaimedArea): boolean => claim.x !== undefined || claim.ids !== undefined;
  const schedule = (): void => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    if (disposed || wrote.size === 0) return;
    const next = Math.min(...[...wrote.values()].map((entry) => entry.at)) + OUTSIDE_CLAIM_EXPIRE_MS;
    timer = timers.setTimeout(expire, Math.max(0, next - timers.now()));
  };
  const expire = (): void => {
    timer = undefined;
    const now = timers.now();
    const expired = [...wrote].flatMap(([key, entry]) => (now - entry.at >= OUTSIDE_CLAIM_EXPIRE_MS ? [key] : []));
    for (const key of expired) wrote.delete(key);
    if (expired.length > 0) options.drop(expired);
    schedule();
  };
  return {
    heard(content) {
      if (disposed) return;
      const now = timers.now();
      const claimed = content.claimed ?? [];
      const keys = new Set(claimed.map((claim) => claim.key));
      for (const key of [...wrote.keys()]) if (!keys.has(key)) wrote.delete(key);
      for (const claim of claimed) {
        const json = isPlaced(claim) ? JSON.stringify(claim) : '';
        const known = wrote.get(claim.key);
        if (known === undefined || known.json !== json) wrote.set(claim.key, { at: now, json });
      }
      schedule();
    },
    due: () => new Map([...wrote].map(([key, entry]) => [key, entry.at + OUTSIDE_CLAIM_EXPIRE_MS])),
    dispose() {
      disposed = true;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
      wrote.clear();
    },
  };
}
