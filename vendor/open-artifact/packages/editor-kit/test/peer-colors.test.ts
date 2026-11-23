/**
 * Tests of people's colors that never clash: the palette, ink, claim order,
 * and the keeper of one page's color.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NEVER_GIVEN_PEER_COLORS,
  PEER_COLOR_PALETTE,
  PEER_COLOR_RELEASE_MS,
  PEER_COLOR_SETTLE_MS,
  createPeerColorKeeper,
  inkOnPeerColor,
  leastUsedPeerColor,
  normalizePeerColor,
  peerColorClaimPrecedes,
  peerColorFromId,
  rotatePeerColors,
  sortPeerColorClaims,
  type PeerColorClaim,
  type PublishedPeerColor,
} from '../src/index.ts';

describe('peer colors', () => {
  it('hashes an id to a palette color, never the reserved one', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `user-${index}`);
    const colors = new Set(ids.map(peerColorFromId));
    for (const color of colors) assert.ok((PEER_COLOR_PALETTE as readonly string[]).includes(color));
    for (const reserved of NEVER_GIVEN_PEER_COLORS) assert.equal(colors.has(reserved), false);
    assert.equal(colors.size, PEER_COLOR_PALETTE.length - NEVER_GIVEN_PEER_COLORS.length);
    assert.equal(peerColorFromId('ada'), peerColorFromId('ada'));
  });

  it('rotates, normalizes and picks the least used color', () => {
    assert.deepEqual(rotatePeerColors('#257de0', []), ['#257de0', '#d25f25', '#785ee8', '#dc3c3d', '#019c7f', '#fbb315', '#ce447d', '#10a122']);
    assert.equal(rotatePeerColors('#257de0').includes('#785ee8'), false);
    assert.equal(normalizePeerColor('#DC3C3D'), '#dc3c3d');
    assert.equal(normalizePeerColor('#123456'), undefined);
    assert.equal(leastUsedPeerColor('#dc3c3d', []), '#dc3c3d');
    assert.equal(leastUsedPeerColor('#dc3c3d', ['#dc3c3d']), '#019c7f');
    assert.equal(leastUsedPeerColor('#dc3c3d', ['#dc3c3d', '#019c7f']), '#fbb315');
    assert.equal(leastUsedPeerColor('#785ee8', []), '#dc3c3d', 'the reserved color is never given');
  });

  it('writes near-black on the light yellow and white on the others', () => {
    for (const color of PEER_COLOR_PALETTE) assert.equal(inkOnPeerColor(color), color === '#fbb315' ? '#0b0b0b' : '#ffffff');
  });

  it('orders claims by time, then by key', () => {
    assert.equal(peerColorClaimPrecedes({ t: 1 }, 'b', { t: 2 }, 'a'), true);
    assert.equal(peerColorClaimPrecedes({ t: 2 }, 'a', { t: 2 }, 'b'), true);
    assert.equal(peerColorClaimPrecedes({ t: 2 }, 'b', { t: 2 }, 'b'), false);
    const sorted = sortPeerColorClaims([
      { key: 'c', t: 3 },
      { key: 'b', t: 1 },
      { key: 'a', t: 1 },
    ]);
    assert.deepEqual(
      sorted.map((claim) => claim.key),
      ['a', 'b', 'c'],
    );
  });
});

/** A keeper on manual time: `advance` runs timers due. */
function keeperHarness(id: string, claims: () => PeerColorClaim[], kept: string | null = null) {
  let now = 10_000;
  const timers: Array<{ at: number; every?: number; run: () => void; on: boolean }> = [];
  const published: PublishedPeerColor[] = [];
  let store = kept;
  const schedule = (run: () => void, ms: number, every?: number): (() => void) => {
    const timer = { at: now + ms, run, on: true, ...(every !== undefined ? { every } : {}) };
    timers.push(timer);
    return () => void (timer.on = false);
  };
  const keeper = createPeerColorKeeper({
    id,
    peer: `${id}-page`,
    publish: (claim) => published.push(claim),
    claims,
    kept: { read: () => store, write: (color) => void (store = color) },
    now: () => now,
    after: (run, ms) => schedule(run, ms),
    every: (run, ms) => schedule(run, ms, ms),
  });
  return {
    keeper,
    published,
    kept: () => store,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.on && timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        now = due.at;
        if (due.every !== undefined) due.at += due.every;
        else due.on = false;
        due.run();
      }
      now = end;
    },
    now: () => now,
  };
}

describe('createPeerColorKeeper', () => {
  it('alone, wears its id’s color and settles on it once the page shows', () => {
    const run = keeperHarness('ada', () => []);
    assert.equal(run.keeper.worn(), peerColorFromId('ada'));
    assert.deepEqual(run.published[0], { c: peerColorFromId('ada'), t: null });
    run.keeper.here();
    run.advance(PEER_COLOR_SETTLE_MS);
    assert.equal(run.published.at(-1)?.c, peerColorFromId('ada'));
    assert.equal(typeof run.published.at(-1)?.t, 'number');
    assert.equal(run.kept(), peerColorFromId('ada'));
  });

  it('settles on a free color when someone else already wears its own', () => {
    const color = peerColorFromId('ada');
    const run = keeperHarness('ada', () => [{ key: 'bo', peer: 'bo-page', own: false, c: color, t: 1 }]);
    run.keeper.here();
    run.advance(PEER_COLOR_SETTLE_MS);
    assert.notEqual(run.keeper.worn(), color);
    assert.equal(run.keeper.worn(), leastUsedPeerColor(color, [color]));
  });

  it('adopts the color of the same person’s earlier page', () => {
    const run = keeperHarness('ada', () => [{ key: 'ada', peer: 'ada-other', own: true, c: '#ce447d', t: 1 }]);
    run.keeper.here();
    run.advance(PEER_COLOR_SETTLE_MS);
    assert.equal(run.keeper.worn(), '#ce447d');
    assert.deepEqual(run.published.at(-1), { c: '#ce447d', t: 1 });
  });

  it('moves on when an earlier claim of its color turns up, and keeps it when its own came first', () => {
    let others: PeerColorClaim[] = [];
    const run = keeperHarness('ada', () => others);
    run.keeper.here();
    run.advance(PEER_COLOR_SETTLE_MS);
    const settled = run.keeper.worn();
    const since = run.published.at(-1)!.t!;
    others = [{ key: 'bo', peer: 'bo-page', own: false, c: settled, t: since + 5 }];
    run.keeper.heard();
    assert.equal(run.keeper.worn(), settled, 'a later claim does not move it');
    others = [{ key: 'bo', peer: 'bo-page', own: false, c: settled, t: since - 5 }];
    run.keeper.heard();
    assert.notEqual(run.keeper.worn(), settled);
    assert.equal(run.published.at(-1)?.t, since, 'moving keeps its time');
  });

  it('gives its claim up after the page stays hidden, and settles again when shown', () => {
    const run = keeperHarness('ada', () => []);
    run.keeper.here();
    run.advance(PEER_COLOR_SETTLE_MS);
    run.advance(70_000);
    run.keeper.away();
    run.advance(PEER_COLOR_RELEASE_MS);
    assert.equal(run.published.at(-1)?.t, null);
    run.keeper.here();
    run.advance(PEER_COLOR_SETTLE_MS);
    assert.equal(typeof run.published.at(-1)?.t, 'number');
    run.keeper.dispose();
  });
});
