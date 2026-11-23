/**
 * Tests of how shared claims are tracked (framing, growing around what the
 * agent adds, idle, expiry, the asker's own claim going once the agent
 * stops) and of how a peer's published color is read. (The palette and the
 * keeper of one page's color: `@open-artifact/editor-kit`.)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_PADDING,
  OUTSIDE_CLAIM_EXPIRE_MS,
  OUTSIDE_CLAIM_IDLE_MS,
  OUTSIDE_CLAIM_JOIN_PX,
  WORKING_QUIET_MS,
  isPageMintedElementId,
  type BoardElement,
  type ClaimedArea,
  type NoteElement,
} from '@open-artifact/whiteboard-core';
import {
  EMPTY_CLAIM_TRACK,
  besideDrops,
  hearClaims,
  markBeside,
  nextClaimDue,
  settleClaims,
  trackedClaimFrame,
  type ClaimHearing,
  type ClaimTrack,
} from '../src/collab/claim-frames.ts';
import { parsePeer, peerColorClaims } from '../src/collab/peers.ts';
import { peerColorFromId } from '@open-artifact/editor-kit';

const note = (id: string, x: number, y: number): NoteElement => ({ type: 'note', id, x, y, w: 100, h: 100, color: 'yellow', text: '', tilt: 0 });

/** Hears `claimed` over `elements` (after `previous`) with defaults. */
function hear(track: ClaimTrack, input: Partial<ClaimHearing> & { claimed: ClaimedArea[]; elements: BoardElement[] }): ClaimTrack {
  return hearClaims(track, { previous: [], changed: true, now: 1000, own: () => false, working: false, ...input });
}

const AREA: ClaimedArea = { key: 'k', x: 0, y: 0, w: 200, h: 200 };

/* ------------------------------------------------------------------------ */
/* Claims                                                                   */
/* ------------------------------------------------------------------------ */

describe('isPageMintedElementId', () => {
  it('tells ids a page mints from ids the agent picks', () => {
    const now = Date.UTC(2026, 5, 1);
    assert.equal(isPageMintedElementId(`${now.toString(36)}-01abc`, now), true);
    assert.equal(isPageMintedElementId('title', now), false);
    assert.equal(isPageMintedElementId('n1', now), false);
    // Pattern, but a time out of range.
    assert.equal(isPageMintedElementId('00000001-01abc', now), false);
    assert.equal(isPageMintedElementId(`${(now + 3 * 86_400_000).toString(36)}-01abc`, now), false);
  });
});

describe('hearClaims', () => {
  it('notes claims seen at load without framing them, and frames those written later', () => {
    const loaded = hear(EMPTY_CLAIM_TRACK, { claimed: [AREA], elements: [], changed: false });
    assert.equal(loaded.claims.get('k')?.framed, false);
    assert.deepEqual(loaded.claims.get('k')?.last, { x: 0, y: 0, w: 200, h: 200 });
    const same = hear(loaded, { claimed: [AREA], elements: [], now: 2000 });
    assert.equal(same.claims.get('k')?.framed, false, 'an unchanged claim stays as it was');
    const written = hear(same, { claimed: [{ ...AREA, w: 300 }], elements: [], now: 3000 });
    assert.equal(written.claims.get('k')?.framed, true);
    assert.equal(written.claims.get('k')?.wrote, 3000);
  });

  it('grows a frame around items the agent adds within reach, chaining through joined items', () => {
    const framed = hear(EMPTY_CLAIM_TRACK, { claimed: [AREA], elements: [] });
    const near = note('a', 200 + OUTSIDE_CLAIM_JOIN_PX, 0);
    const chained = note('b', 300 + 2 * OUTSIDE_CLAIM_JOIN_PX, 0);
    const far = note('c', 5000, 5000);
    const grown = hear(framed, { claimed: [AREA], elements: [near, chained, far], now: 2000 });
    const tracked = grown.claims.get('k')!;
    assert.deepEqual(tracked.joined, ['a', 'b']);
    assert.equal(tracked.wrote, 2000);
    const frame = trackedClaimFrame(tracked, [near, chained, far]);
    assert.equal(frame?.x, 0);
    assert.equal(frame!.x + frame!.w, 400 + 2 * OUTSIDE_CLAIM_JOIN_PX + CLAIM_PADDING);
  });

  it('never grows around items a person adds, nor on local changes', () => {
    const framed = hear(EMPTY_CLAIM_TRACK, { claimed: [AREA], elements: [] });
    const now = Date.UTC(2026, 5, 1);
    const minted = note(`${now.toString(36)}-01abc`, 210, 0);
    assert.deepEqual(hear(framed, { claimed: [AREA], elements: [minted], now }).claims.get('k')?.joined, []);
    assert.deepEqual(hear(framed, { claimed: [AREA], elements: [note('a', 210, 0)], changed: false }).claims.get('k')?.joined, []);
  });

  it('keeps a claim busy while its items change, and forgets claims that are gone', () => {
    const a = note('a', 0, 0);
    const framed = hear(EMPTY_CLAIM_TRACK, { claimed: [{ key: 'k', ids: ['a'] }], elements: [a] });
    const moved = { ...a, x: 10 };
    const busy = hear(framed, { claimed: [{ key: 'k', ids: ['a'] }], elements: [moved], previous: [a], now: 5000 });
    assert.equal(busy.claims.get('k')?.at, 5000);
    assert.equal(busy.claims.get('k')?.wrote, 1000, 'a change to its items is not a write');
    assert.equal(hear(busy, { claimed: [], elements: [moved], now: 6000 }).claims.size, 0);
  });

  it('marks this page’s claim beside the agent’s work while it works', () => {
    const own = (key: string): boolean => key === 'k';
    assert.equal(hear(EMPTY_CLAIM_TRACK, { claimed: [AREA], elements: [], own, working: true }).claims.get('k')?.beside, true);
    assert.equal(hear(EMPTY_CLAIM_TRACK, { claimed: [AREA], elements: [], own }).claims.get('k')?.beside, false);
    assert.equal(hear(EMPTY_CLAIM_TRACK, { claimed: [AREA], elements: [], working: true }).claims.get('k')?.beside, false);
  });
});

describe('settleClaims', () => {
  it('stops framing an idle claim, keeping its last frame, and frames it again on a join', () => {
    const framed = hear(EMPTY_CLAIM_TRACK, { claimed: [AREA], elements: [] });
    assert.equal(nextClaimDue(framed, false), 1000 + OUTSIDE_CLAIM_IDLE_MS);
    const idle = settleClaims(framed, 1000 + OUTSIDE_CLAIM_IDLE_MS, false, []).track;
    assert.equal(idle.claims.get('k')?.framed, false);
    assert.deepEqual(idle.claims.get('k')?.last, { x: 0, y: 0, w: 200, h: 200 });
    const joined = hear(idle, { claimed: [AREA], elements: [note('a', 210, 0)], now: 1000 + OUTSIDE_CLAIM_IDLE_MS + 1 });
    assert.equal(joined.claims.get('k')?.framed, true);
    assert.deepEqual(joined.claims.get('k')?.joined, ['a']);
  });

  it('lists claims nobody wrote for long as expired (dropped by editors), keys alone counting from when seen', () => {
    const track = hear(EMPTY_CLAIM_TRACK, { claimed: [AREA, { key: 'alone' }], elements: [] });
    assert.deepEqual(settleClaims(track, 1000 + OUTSIDE_CLAIM_EXPIRE_MS - 1, true, []).expired, []);
    const viewer = settleClaims(track, 1000 + OUTSIDE_CLAIM_EXPIRE_MS, false, []);
    assert.deepEqual(viewer.expired.sort(), ['alone', 'k']);
    assert.equal(viewer.track.claims.has('k'), true, 'viewers keep tracking');
    const editor = settleClaims(track, 1000 + OUTSIDE_CLAIM_EXPIRE_MS, true, []);
    assert.equal(editor.track.claims.size, 0);
    assert.equal(editor.track.keyedSince.size, 0);
  });
});

describe('besideDrops', () => {
  it('drops this page’s claims written while the agent worked, keeping one written after it stopped', () => {
    const own = (key: string): boolean => key !== 'theirs';
    let track = hear(EMPTY_CLAIM_TRACK, { claimed: [AREA, { key: 'later', x: 0, y: 0, w: 10, h: 10 }, { key: 'theirs', x: 0, y: 0, w: 10, h: 10 }], elements: [], own });
    track = markBeside(track);
    assert.equal(track.claims.get('theirs')?.beside, false);
    const stoppedAt = 900;
    track = hear(track, { claimed: [AREA, { key: 'later', x: 5, y: 0, w: 10, h: 10 }, { key: 'theirs', x: 0, y: 0, w: 10, h: 10 }], elements: [], own, now: stoppedAt + WORKING_QUIET_MS + 1 });
    const { track: after, drops } = besideDrops(track, stoppedAt);
    assert.deepEqual(drops, ['k']);
    assert.equal(after.claims.has('k'), false);
    assert.equal(after.claims.get('later')?.beside, false);
    assert.equal(after.claims.has('theirs'), true);
  });
});

/* ------------------------------------------------------------------------ */
/* Colors                                                                   */
/* ------------------------------------------------------------------------ */

describe('peer colors', () => {
  it('reads a peer’s published color, falling back to its person’s id', () => {
    const peer = parsePeer({ id: 'p1', name: 'Ada', kind: 'person', state: { user: 'ada', color: { c: '#10A122', t: 5 } } }, 0);
    assert.equal(peer.color, '#10a122');
    assert.equal(peer.colorSince, 5);
    const unsettled = parsePeer({ id: 'p2', name: 'Bo', kind: 'person', state: { user: 'bo', color: { c: '#10a122', t: null } } }, 0);
    assert.equal(unsettled.colorSince, undefined);
    assert.equal(parsePeer({ id: 'p3', name: 'Cy', kind: 'person', state: { user: 'cy', color: { c: 'red' } } }, 0).color, peerColorFromId('cy'));
    assert.deepEqual(peerColorClaims([peer, unsettled], 'ada'), [{ key: 'ada', peer: 'p1', own: true, c: '#10a122', t: 5 }]);
  });
});
