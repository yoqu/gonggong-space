/**
 * How the agent's shared claims are tracked and drawn, without side
 * effects (unit-tested): which claims are framed, how a frame grows around
 * what the agent adds near it, when a claim goes idle or expires, its frame
 * on the board, and whose request it answers (which sets its color).
 *
 * The rules ({@link hearClaims}, {@link settleClaims}, {@link besideDrops}):
 * - a claim seen when the board loads (or changed by this page) is noted
 *   but not framed; one the agent writes afterwards is framed;
 * - while framed, items the agent adds within {@link OUTSIDE_CLAIM_JOIN_PX}
 *   of the frame join it (the frame grows around them, and a joined item
 *   can bring the next one within reach); a person's new items never join;
 * - a write, a join or a change to its items keeps it busy; one that saw
 *   no work for {@link OUTSIDE_CLAIM_IDLE_MS} stops being framed (a later
 *   write or join frames it again);
 * - editors drop a claim nobody wrote for {@link OUTSIDE_CLAIM_EXPIRE_MS};
 * - this page's own claim, written while the agent worked for it, is
 *   dropped {@link OUTSIDE_CLAIM_BESIDE_MS} after the agent stops.
 */

import {
  OUTSIDE_CLAIM_EXPIRE_MS,
  OUTSIDE_CLAIM_IDLE_MS,
  OUTSIDE_CLAIM_JOIN_PX,
  WORKING_QUIET_MS,
  arrowBoundsBox,
  claimItemsBounds,
  claimRectGap,
  elementBounds,
  indexElementsById,
  isPageMintedElementId,
  unionClaimBoxes,
  validClaimBox,
  type BoardElement,
  type Box,
  type ClaimBox,
  type ClaimedArea,
  type ElementId,
  type ElementMeasures,
} from '@open-artifact/whiteboard-core';
import type { CollabPeer } from './peers.ts';

/** What {@link claimOwner} needs of a request made on this page. */
export interface ClaimAsk {
  /** What the request said it was about ("Adding"). */
  activity?: string;
}

/** The agent's own color, for claims nobody here asked for. */
export const AGENT_COLOR = '#6e56cf';

/* ------------------------------------------------------------------------ */
/* Frames                                                                   */
/* ------------------------------------------------------------------------ */

/** The bounds of one element as a claim frames it (arrows by their drawn line). */
function claimElementBounds(element: BoardElement, elements: readonly BoardElement[], measures?: ElementMeasures): Box | undefined {
  return element.type === 'arrow' ? arrowBoundsBox(element, indexElementsById(elements), measures) : elementBounds(element, measures);
}

/**
 * The frame of a claim (board units): its area as written, together with
 * the bounds of its elements (and of `joined`, items that landed near it)
 * padded by `CLAIM_PADDING`. `undefined` when it has neither (or its
 * elements are gone).
 */
export function claimFrame(claim: ClaimedArea, elements: readonly BoardElement[], measures?: ElementMeasures, joined: readonly ElementId[] = []): Box | undefined {
  const boxes: ClaimBox[] = [];
  const area = validClaimBox(claim.x !== undefined ? { x: claim.x, y: claim.y, w: claim.w, h: claim.h } : undefined);
  if (area) boxes.push({ x: area.x, y: area.y, w: area.w, h: area.h });
  const ids = [...new Set([...(claim.ids ?? []), ...joined])];
  if (ids.length > 0) {
    const items = claimItemsBounds(ids, elements, (element) => claimElementBounds(element, elements, measures));
    if (items) boxes.push(items);
  }
  const union = unionClaimBoxes(boxes);
  return union ? { x: union.x, y: union.y, w: union.w, h: union.h } : undefined;
}

/** True when a claim saw no work for long enough to stop framing it. */
export function isClaimIdle(at: number | undefined, now: number): boolean {
  return at !== undefined && now - at >= OUTSIDE_CLAIM_IDLE_MS;
}

/* ------------------------------------------------------------------------ */
/* Tracking                                                                 */
/* ------------------------------------------------------------------------ */

/** One shared claim as this page tracks it. */
export interface TrackedClaim {
  /** The claim as last heard. */
  claim: ClaimedArea;
  /** `claim` as JSON, to tell a rewrite. */
  json: string;
  /** When the agent last wrote it or added an item that joined it (epoch ms). */
  wrote: number;
  /** When it last saw work: a write, a join or a change to its items (epoch ms). */
  at: number;
  /** It is framed: the agent wrote it since this page loaded, and it has not gone idle. */
  framed: boolean;
  /** Items the agent added near it while framed; its frame grows around them. */
  joined: readonly ElementId[];
  /** Its frame when last worked out, kept for when its items are gone. */
  last?: Box;
  /** It answers this page's request. */
  own: boolean;
  /** This page's claim written while the agent worked: it goes soon after the agent stops. */
  beside: boolean;
}

/** The shared claims as this page tracks them. */
export interface ClaimTrack {
  /** Claims with an area or items, by key. */
  claims: ReadonlyMap<string, TrackedClaim>;
  /** Claims with neither (a key alone), by key, with when each was first seen. */
  keyedSince: ReadonlyMap<string, number>;
}

/** No claims tracked. */
export const EMPTY_CLAIM_TRACK: ClaimTrack = { claims: new Map(), keyedSince: new Map() };

/** What {@link hearClaims} reads of the board and the agent. */
export interface ClaimHearing {
  /** The board's claims now. */
  claimed: readonly ClaimedArea[] | undefined;
  /** The board's elements now. */
  elements: readonly BoardElement[];
  /** The elements when claims were last heard. */
  previous: readonly BoardElement[];
  /**
   * The board took a remote change after it loaded: only then do claims
   * start framing and new items join them.
   */
  changed: boolean;
  /** Epoch ms. */
  now: number;
  measures?: ElementMeasures;
  /** Whether a claim key answers a request made on this page. */
  own(key: string): boolean;
  /** The agent is working for this page now, or stopped within {@link WORKING_QUIET_MS}. */
  working: boolean;
}

/** True when a claim has an area or items (else it is a key alone). */
function isPlaced(claim: ClaimedArea): boolean {
  return claim.x !== undefined || claim.ids !== undefined;
}

/** The part of a claim that says where it is (its area and items). */
function claimTarget(claim: ClaimedArea): string {
  return JSON.stringify([claim.x, claim.y, claim.w, claim.h, claim.ids]);
}

/** The frame of a tracked claim: as {@link claimFrame}, or its last frame when its items are gone. */
export function trackedClaimFrame(tracked: TrackedClaim, elements: readonly BoardElement[], measures?: ElementMeasures): Box | undefined {
  return claimFrame(tracked.claim, elements, measures, tracked.joined) ?? tracked.last;
}

/**
 * The claims after hearing the board (see the module comment): new and
 * rewritten claims, items that join a frame, work on a claim's items, and
 * claims that are gone.
 */
export function hearClaims(track: ClaimTrack, heard: ClaimHearing): ClaimTrack {
  const { now, changed, elements, measures } = heard;
  const claimed = heard.claimed ?? [];
  if (claimed.length === 0 && track.claims.size === 0 && track.keyedSince.size === 0) return track;

  // Keys alone count from when first seen.
  const keyedOnly = claimed.filter((claim) => !isPlaced(claim)).map((claim) => claim.key);
  const keyedSince = new Map(keyedOnly.map((key) => [key, track.keyedSince.get(key) ?? now] as const));

  // New and rewritten claims.
  const claims = new Map<string, TrackedClaim>();
  for (const claim of claimed) {
    if (!isPlaced(claim) || claims.has(claim.key)) continue;
    const json = JSON.stringify(claim);
    const known = track.claims.get(claim.key);
    if (known !== undefined && known.json === json) {
      claims.set(claim.key, known);
      continue;
    }
    const base: TrackedClaim = known ?? { claim, json, wrote: now, at: now, framed: false, joined: [], own: heard.own(claim.key), beside: false };
    if (!changed && !base.framed) {
      const last = claimFrame(claim, elements, measures) ?? base.last;
      claims.set(claim.key, { ...base, claim, json, ...(last !== undefined ? { last } : {}) });
      continue;
    }
    const sameTarget = base.framed && claimTarget(base.claim) === claimTarget(claim);
    claims.set(claim.key, {
      ...base,
      claim,
      json,
      wrote: now,
      at: now,
      framed: true,
      joined: sameTarget ? base.joined : [],
      beside: base.beside || (base.own && heard.working),
    });
  }
  if (!changed) return { claims, keyedSince };

  // Items the agent added join the nearest frame within reach; a frame that grew can reach the next.
  const before = new Map(heard.previous.map((element) => [element.id, element]));
  const added = elements.filter((element) => !before.has(element.id) && !isPageMintedElementId(element.id, now));
  const reach: Array<{ key: string; rect: Box }> = [];
  if (added.length > 0) {
    for (const [key, tracked] of claims) {
      const rect = trackedClaimFrame(tracked, elements, measures);
      if (rect !== undefined) reach.push({ key, rect });
    }
  }
  const joins = new Map<string, ElementId[]>();
  let waiting = (reach.length > 0 ? added : []).flatMap((element) => {
    const box = claimElementBounds(element, elements, measures);
    return box === undefined ? [] : [{ id: element.id, box }];
  });
  for (let count = -1; count !== waiting.length; ) {
    count = waiting.length;
    waiting = waiting.filter(({ id, box }) => {
      let nearest: { key: string; rect: Box } | undefined;
      let nearestGap = Infinity;
      for (const entry of reach) {
        const gap = claimRectGap(box, entry.rect);
        if (gap < nearestGap) [nearest, nearestGap] = [entry, gap];
      }
      if (nearest === undefined || nearestGap > OUTSIDE_CLAIM_JOIN_PX) return true;
      nearest.rect = unionClaimBoxes([nearest.rect, box]) ?? box;
      joins.set(nearest.key, [...(joins.get(nearest.key) ?? []), id]);
      return false;
    });
  }

  // Work on a framed claim's items keeps it busy.
  const after = new Map(elements.map((element) => [element.id, element]));
  const touched = (id: ElementId): boolean => {
    const a = before.get(id);
    const b = after.get(id);
    return a !== undefined && b !== undefined && a !== b && JSON.stringify(a) !== JSON.stringify(b);
  };
  for (const [key, tracked] of claims) {
    if (tracked.framed && tracked.at !== now && [...(tracked.claim.ids ?? []), ...tracked.joined].some(touched)) claims.set(key, { ...tracked, at: now });
  }
  for (const [key, ids] of joins) {
    const tracked = claims.get(key)!;
    claims.set(key, { ...tracked, wrote: now, at: now, framed: true, joined: tracked.framed ? [...new Set([...tracked.joined, ...ids])] : ids });
  }
  return { claims, keyedSince };
}

/** {@link settleClaims}'s result. */
export interface SettledClaims {
  track: ClaimTrack;
  /** Keys of claims nobody wrote for {@link OUTSIDE_CLAIM_EXPIRE_MS} (editors drop them). */
  expired: string[];
}

/**
 * The claims at `now`: those idle for {@link OUTSIDE_CLAIM_IDLE_MS} stop
 * being framed (keeping their last frame), and those nobody wrote for
 * {@link OUTSIDE_CLAIM_EXPIRE_MS} are listed as expired (and, with
 * `drop`, left out of the track).
 */
export function settleClaims(track: ClaimTrack, now: number, drop: boolean, elements: readonly BoardElement[], measures?: ElementMeasures): SettledClaims {
  const expired: string[] = [];
  let claims: Map<string, TrackedClaim> | undefined;
  let keyedSince: Map<string, number> | undefined;
  for (const [key, tracked] of track.claims) {
    if (now - tracked.wrote >= OUTSIDE_CLAIM_EXPIRE_MS) {
      expired.push(key);
      if (drop) {
        claims ??= new Map(track.claims);
        claims.delete(key);
        continue;
      }
    }
    if (tracked.framed && isClaimIdle(tracked.at, now)) {
      claims ??= new Map(track.claims);
      const last = trackedClaimFrame(tracked, elements, measures);
      claims.set(key, { ...tracked, framed: false, ...(last !== undefined ? { last } : {}) });
    }
  }
  for (const [key, since] of track.keyedSince) {
    if (now - since < OUTSIDE_CLAIM_EXPIRE_MS) continue;
    expired.push(key);
    if (drop) {
      keyedSince ??= new Map(track.keyedSince);
      keyedSince.delete(key);
    }
  }
  return { track: claims === undefined && keyedSince === undefined ? track : { claims: claims ?? track.claims, keyedSince: keyedSince ?? track.keyedSince }, expired };
}

/** When {@link settleClaims} next has something to do (epoch ms), if ever. */
export function nextClaimDue(track: ClaimTrack, drop: boolean): number | undefined {
  const due: number[] = [];
  for (const tracked of track.claims.values()) {
    if (tracked.framed) due.push(tracked.at + OUTSIDE_CLAIM_IDLE_MS);
    if (drop) due.push(tracked.wrote + OUTSIDE_CLAIM_EXPIRE_MS);
  }
  if (drop) for (const since of track.keyedSince.values()) due.push(since + OUTSIDE_CLAIM_EXPIRE_MS);
  return due.length > 0 ? Math.min(...due) : undefined;
}

/** The track with this page's claims marked `beside` (the agent is working for it). */
export function markBeside(track: ClaimTrack): ClaimTrack {
  let claims: Map<string, TrackedClaim> | undefined;
  for (const [key, tracked] of track.claims) {
    if (!tracked.own || tracked.beside) continue;
    claims ??= new Map(track.claims);
    claims.set(key, { ...tracked, beside: true });
  }
  return claims === undefined ? track : { ...track, claims };
}

/** {@link besideDrops}'s result. */
export interface BesideDrops {
  /** The track without the dropped claims (and with `beside` cleared on those written again). */
  track: ClaimTrack;
  /** Keys of the claims to drop from the board. */
  drops: string[];
}

/**
 * This page's claims to drop once the agent stopped working at `stoppedAt`
 * (called {@link OUTSIDE_CLAIM_BESIDE_MS} later): those written while it
 * worked. One written again after it stopped (a new turn) stays, no longer
 * `beside`.
 */
export function besideDrops(track: ClaimTrack, stoppedAt: number): BesideDrops {
  const drops: string[] = [];
  let claims: Map<string, TrackedClaim> | undefined;
  for (const [key, tracked] of track.claims) {
    if (!tracked.own || !tracked.beside) continue;
    claims ??= new Map(track.claims);
    if (tracked.wrote <= stoppedAt + WORKING_QUIET_MS) {
      drops.push(key);
      claims.delete(key);
    } else {
      claims.set(key, { ...tracked, beside: false });
    }
  }
  return { track: claims === undefined ? track : { ...track, claims }, drops };
}

/* ------------------------------------------------------------------------ */
/* Owners                                                                   */
/* ------------------------------------------------------------------------ */

/** Who a claim belongs to, as the board shows it. */
export interface ClaimOwner {
  /** Frame color. */
  color: string;
  /** The request was made on this page. */
  mine: boolean;
  /** The asker's name, for someone else's request. */
  name?: string;
  /** What the request said it was about ("Adding"), when known. */
  activity?: string;
}

/** Works out whose request a claim answers: this page's, a peer's, or nobody's here. */
export function claimOwner(key: string, asks: ReadonlyMap<string, ClaimAsk>, tabKey: string, myColor: string, peers: ReadonlyMap<string, CollabPeer>): ClaimOwner {
  const mine = asks.get(key);
  if (mine) return { color: myColor, mine: true, ...(mine.activity ? { activity: mine.activity } : {}) };
  if (key === tabKey) return { color: myColor, mine: true };
  for (const peer of peers.values()) {
    if (peer.asks.some((ask) => ask.key === key)) return { color: peer.color, mine: false, name: peer.name };
  }
  return { color: AGENT_COLOR, mine: false };
}
