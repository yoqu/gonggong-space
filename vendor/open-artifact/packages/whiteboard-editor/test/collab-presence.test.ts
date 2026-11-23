/**
 * Tests of presence: the sender that paces `room.presence` calls, the
 * defensive parse of what other viewers publish, and the follow rules.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Peer } from '@open-artifact/runtime';
import { allowAutoFollow, AUTO_FOLLOW_WINDOW_MS, MAX_AUTO_FOLLOWS, peerViewArea } from '../src/collab/follow-rules.ts';
import { cleanPeerText, MAX_PEER_NAME, parseIds, parsePeer, parsePeers, parseSharedAsk, toBoardPeer } from '../src/collab/peers.ts';
import { createPresenceSender, type PresencePatch, type SenderTimers } from '../src/collab/presence-sender.ts';

/** Manual timers: `advance` runs what is due. */
function fakeTimers(): SenderTimers & { advance(ms: number): void; pending(): number } {
  let now = 1000;
  let next = 1;
  const queue = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      const id = next++;
      queue.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout(handle) {
      queue.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, entry] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at > now) continue;
        queue.delete(id);
        entry.callback();
      }
    },
    pending: () => queue.size,
  };
}

/** Lets settled promise callbacks run. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('createPresenceSender', () => {
  it('sends the first patch at once and merges what comes meanwhile', async () => {
    const timers = fakeTimers();
    const sent: PresencePatch[] = [];
    const sender = createPresenceSender(async (patch) => void sent.push(patch), { timers, minGapMs: 40 });
    sender.send({ pointer: { x: 1, y: 1 } });
    sender.send({ pointer: { x: 2, y: 2 } });
    sender.send({ selection: ['a'] });
    assert.deepEqual(sent, [{ pointer: { x: 1, y: 1 } }]);
    await settle();
    // In flight finished, but the gap holds the merged patch back.
    assert.equal(sent.length, 1);
    timers.advance(40);
    await settle();
    assert.deepEqual(sent[1], { pointer: { x: 2, y: 2 }, selection: ['a'] });
  });

  it('flushes without waiting for the gap, and drops patches once disposed', async () => {
    const timers = fakeTimers();
    const sent: PresencePatch[] = [];
    const sender = createPresenceSender(async (patch) => void sent.push(patch), { timers, minGapMs: 40 });
    sender.send({ a: 1 });
    await settle();
    sender.send({ b: 2 });
    assert.equal(sent.length, 1);
    sender.flush();
    assert.deepEqual(sent[1], { b: 2 });
    await settle();
    sender.send({ c: 3 });
    sender.dispose();
    assert.equal(timers.pending(), 0);
    timers.advance(100);
    await settle();
    assert.equal(sent.length, 2);
  });

  it('keeps going after a failed call', async () => {
    const timers = fakeTimers();
    const sent: PresencePatch[] = [];
    let fail = true;
    const sender = createPresenceSender(
      async (patch) => {
        sent.push(patch);
        if (fail) {
          fail = false;
          throw new Error('offline');
        }
      },
      { timers, minGapMs: 0 },
    );
    sender.send({ a: 1 });
    await settle();
    sender.send({ a: 2 });
    await settle();
    assert.deepEqual(sent, [{ a: 1 }, { a: 2 }]);
  });
});

describe('cleanPeerText', () => {
  it('collapses control characters and drops bidi overrides', () => {
    assert.equal(cleanPeerText('a\nb c', 50), 'a b c');
    assert.equal(cleanPeerText('‮evil⁦', 50), 'evil');
    assert.equal(cleanPeerText('   ', 50), undefined);
    assert.equal(cleanPeerText(42, 50), undefined);
  });

  it('cuts by characters, not code units', () => {
    assert.equal(cleanPeerText('😀😀😀', 2), '😀😀');
  });
});

describe('parsePeer', () => {
  const peer = (id: string, state: unknown, extra: Partial<Peer> = {}): Peer => ({ id, name: `Person ${id}`, kind: 'person', state, ...extra }) as Peer;

  it('keeps well-formed state and drops the rest', () => {
    const parsed = parsePeer(
      peer('p1', {
        user: 'u1',
        camera: { x: 10, y: 20, zoom: 2 },
        viewport: { w: 800, h: 600 },
        pointer: { x: Number.NaN, y: 3 },
        selection: ['a', 'a', 'bad id', 'b'],
        chat: 'hello\nthere',
        chatAsk: true,
        leading: 1234,
        asks: [{ key: 'abcdefgh', status: 'working', text: 'add risks' }, { key: 'NOPE' }],
      }),
      5000,
    );
    assert.equal(parsed.user, 'u1');
    assert.deepEqual(parsed.camera, { x: 10, y: 20, zoom: 2 });
    assert.deepEqual(parsed.viewport, { w: 800, h: 600 });
    assert.equal(parsed.pointer, undefined);
    assert.deepEqual(parsed.selection, ['a', 'b']);
    assert.deepEqual(parsed.chat, { text: 'hello there', asking: true, at: 5000 });
    assert.equal(parsed.leading, 1234);
    assert.deepEqual(parsed.asks, [{ key: 'abcdefgh', status: 'working', text: 'add risks' }]);
  });

  it('names unnamed peers and cuts long names', () => {
    assert.equal(parsePeer(peer('p', {}, { name: '' }), 0).name, 'Someone');
    assert.equal(parsePeer(peer('p', {}, { name: '', kind: 'agent' }), 0).name, 'Agent');
    assert.equal([...parsePeer(peer('p', {}, { name: 'x'.repeat(200) }), 0).name].length, MAX_PEER_NAME);
  });

  it('carries the pointer and chat times while they stay the same', () => {
    const first = parsePeer(peer('p', { pointer: { x: 1, y: 1 }, chat: 'hi' }), 100);
    const same = parsePeer(peer('p', { pointer: { x: 1, y: 1 }, chat: 'hi' }), 200, first);
    assert.equal(same.movedAt, 100);
    assert.equal(same.chat, first.chat);
    const moved = parsePeer(peer('p', { pointer: { x: 2, y: 1 }, chat: 'hi!' }), 300, same);
    assert.equal(moved.movedAt, 300);
    assert.equal(moved.chat?.at, 300);
  });

  it('leaves this page and duplicates out of the list', () => {
    const parsed = parsePeers([peer('me', {}), peer('a', {}), peer('a', { user: 'other' }), peer('b', {})], 'me', 0);
    assert.deepEqual([...parsed.keys()], ['a', 'b']);
    assert.equal(parsed.get('a')?.user, 'a');
  });

  it('gives the presence store the shared subset', () => {
    const board = toBoardPeer(parsePeer(peer('p', { selection: ['a'], leading: 7 }), 0));
    assert.deepEqual(board, { id: 'p', name: 'Person p', kind: 'person', presence: { selection: ['a'], leading: true } });
  });
});

describe('parseSharedAsk and parseIds', () => {
  it('needs a valid claim key and falls back to queued', () => {
    assert.equal(parseSharedAsk({ key: 'short' }), undefined);
    assert.deepEqual(parseSharedAsk({ key: 'abcdefgh', status: 'bogus', rect: { x: 0, y: 0, w: 0, h: 5 } }), { key: 'abcdefgh', status: 'queued' });
  });

  it('caps the number of ids', () => {
    assert.deepEqual(parseIds(['a', 'b', 'c'], 2), ['a', 'b']);
    assert.deepEqual(parseIds('a', 2), []);
  });
});

describe('follow rules', () => {
  it('prefers the published view, else derives it from camera and viewport', () => {
    const base = parsePeer({ id: 'p', name: 'P', kind: 'person', state: { camera: { x: 100, y: 50, zoom: 2 }, viewport: { w: 800, h: 600 } } } as Peer, 0);
    assert.deepEqual(peerViewArea(base), { x: 100, y: 50, w: 400, h: 300 });
    assert.deepEqual(peerViewArea({ ...base, view: { x: 1, y: 2, w: 3, h: 4 } }), { x: 1, y: 2, w: 3, h: 4 });
    assert.equal(peerViewArea({ ...base, camera: undefined }), undefined);
  });

  it(`follows at most ${MAX_AUTO_FOLLOWS} new requests a minute`, () => {
    let times: number[] = [];
    for (let index = 0; index < MAX_AUTO_FOLLOWS; index += 1) {
      const decision = allowAutoFollow(times, 1000 + index);
      assert.equal(decision.allowed, true);
      times = decision.times;
    }
    assert.equal(allowAutoFollow(times, 2000).allowed, false);
    assert.equal(allowAutoFollow(times, 1000 + AUTO_FOLLOW_WINDOW_MS).allowed, true);
  });
});
