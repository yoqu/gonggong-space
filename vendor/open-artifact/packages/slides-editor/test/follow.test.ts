import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followOnPeers, followPeer, followPresence, NO_FOLLOW, setLead } from '../src/services/follow.ts';
import { parseCursor } from '../src/services/cursors.ts';

const peer = (id: string, state: Record<string, unknown> = {}) => ({ id, state });

describe('following', () => {
  it('follows a leader, counts followers, and forgets a leader who stops', () => {
    const peers = [peer('me'), peer('ana', { lead: true }), peer('bo', { following: 'me' })];
    const first = followOnPeers(NO_FOLLOW, peers, 'me');
    assert.equal(first.joinedLeader, 'ana');
    assert.equal(first.followers, 1);
    assert.deepEqual(first.state, { following: 'ana', followingLead: true, leading: false, dismissedLead: null });
    const stopped = followOnPeers(first.state, [peer('me'), peer('ana')], 'me');
    assert.equal(stopped.state.following, null);
    assert.equal(stopped.joinedLeader, null);
  });

  it('does not follow a dismissed leader again until they ask anew', () => {
    const led = followOnPeers(NO_FOLLOW, [peer('ana', { lead: true })], 'me').state;
    const left = followPeer(led, null);
    assert.equal(left.dismissedLead, 'ana');
    assert.equal(followOnPeers(left, [peer('ana', { lead: true })], 'me').state.following, null);
    const cleared = followOnPeers(left, [peer('ana')], 'me').state;
    assert.equal(cleared.dismissedLead, null);
    assert.equal(followOnPeers(cleared, [peer('ana', { lead: true })], 'me').state.following, 'ana');
  });

  it('keeps own keys, drops peers who left, and leading stops following', () => {
    const agent = followPeer(NO_FOLLOW, '@agent');
    assert.equal(followOnPeers(agent, [], 'me', ['@agent']).state.following, '@agent');
    assert.equal(followOnPeers(followPeer(NO_FOLLOW, 'bo'), [], 'me').state.following, null);
    const leading = setLead(followPeer(NO_FOLLOW, 'bo'), true);
    assert.deepEqual(followPresence(leading), { following: null, lead: true });
    assert.deepEqual(followPresence(agent, ['@agent']), { following: null, lead: null });
    assert.equal(followOnPeers(leading, [peer('ana', { lead: true })], 'me').state.following, null);
  });
});

describe('grid cursors', () => {
  it('reads cursor messages from other pages defensively', () => {
    assert.deepEqual(parseCursor({ slideId: 's1', x: 0.5, y: 1.4 }, 7), { slideId: 's1', x: 0.5, y: 1, at: 7 });
    assert.equal(parseCursor({ slideId: 1, x: 0, y: 0 }, 0), null);
    assert.equal(parseCursor({ slideId: 's', x: Number.NaN, y: 0 }, 0), null);
    assert.equal(parseCursor(null, 0), null);
  });
});
