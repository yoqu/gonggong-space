/**
 * Tests of how the agent's claims are drawn: when they go idle, their
 * frame, and whose request they answer (tracking: `collab-claims-colors.test.ts`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_PADDING, OUTSIDE_CLAIM_IDLE_MS, type NoteElement } from '@open-artifact/whiteboard-core';
import { AGENT_COLOR, claimFrame, claimOwner, isClaimIdle, type ClaimAsk } from '../src/collab/claim-frames.ts';
import type { CollabPeer } from '../src/collab/peers.ts';

const note = (id: string, x: number, y: number): NoteElement => ({ type: 'note', id, x, y, w: 100, h: 100, color: 'yellow', text: '', tilt: 0 });

describe('isClaimIdle', () => {
  it('goes idle once a claim saw no work for long enough', () => {
    assert.equal(isClaimIdle(undefined, 1e9), false);
    assert.equal(isClaimIdle(0, OUTSIDE_CLAIM_IDLE_MS - 1), false);
    assert.equal(isClaimIdle(0, OUTSIDE_CLAIM_IDLE_MS), true);
  });
});

describe('claimFrame', () => {
  it('joins the claimed area with the padded bounds of the claimed items', () => {
    const frame = claimFrame({ key: 'k', x: 0, y: 0, w: 50, h: 50, ids: ['a'] }, [note('a', 200, 0)]);
    assert.deepEqual(frame, { x: 0, y: -CLAIM_PADDING, w: 300 + CLAIM_PADDING, h: 100 + 2 * CLAIM_PADDING });
    assert.deepEqual(claimFrame({ key: 'k', x: 10, y: 20, w: 30, h: 40 }, []), { x: 10, y: 20, w: 30, h: 40 });
  });

  it('has no frame without an area or items still on the board', () => {
    assert.equal(claimFrame({ key: 'k' }, []), undefined);
    assert.equal(claimFrame({ key: 'k', ids: ['gone'] }, [note('a', 0, 0)]), undefined);
  });
});

describe('claimOwner', () => {
  const peer = { id: 'p', name: 'Grace', kind: 'person', user: 'u2', color: '#123456', movedAt: 0, selection: [], asks: [{ key: 'peerkey1', status: 'working' }] } satisfies CollabPeer;
  const peers = new Map([['p', peer]]);
  const asks = new Map<string, ClaimAsk>([['minekey1', { activity: 'Adding' }]]);

  it('colors this page’s requests in its own color', () => {
    assert.deepEqual(claimOwner('minekey1', asks, 'tabkey11', '#abcdef', peers), { color: '#abcdef', mine: true, activity: 'Adding' });
    assert.deepEqual(claimOwner('tabkey11', asks, 'tabkey11', '#abcdef', peers), { color: '#abcdef', mine: true });
  });

  it('names the peer whose request it answers, else falls back to the agent', () => {
    assert.deepEqual(claimOwner('peerkey1', asks, 'tabkey11', '#abcdef', peers), { color: '#123456', mine: false, name: 'Grace' });
    assert.deepEqual(claimOwner('otherkey', asks, 'tabkey11', '#abcdef', peers), { color: AGENT_COLOR, mine: false });
  });
});
