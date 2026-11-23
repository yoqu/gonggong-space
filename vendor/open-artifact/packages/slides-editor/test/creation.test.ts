import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CREATION_TIPS, nextTipDelay, plannedIds, tipIndexAt, tipText, turnAnnouncement } from '../src/services/creation-plan.ts';

describe('planned slides', () => {
  it('lists outline ids with no file, once, in outline order', () => {
    assert.deepEqual(plannedIds(['a', 'b', 'c', 'b', 'd'], { a: 1, c: 1 }), ['b', 'd']);
    assert.deepEqual(plannedIds(['a', 'b'], new Set(['a', 'b'])), []);
    assert.deepEqual(plannedIds([], {}), []);
  });

  it('does not take inherited keys for files', () => {
    assert.deepEqual(plannedIds(['toString', 'x'], {}), ['toString', 'x']);
  });
});

describe('tip rotation', () => {
  const timing = { tipInitialDelay: 3000, tipRotation: 5000 };
  it('shows the writing line first, then rotates', () => {
    assert.equal(tipIndexAt(0, timing), -1);
    assert.equal(tipIndexAt(2999, timing), -1);
    assert.equal(tipIndexAt(3000, timing), 0);
    assert.equal(tipIndexAt(7999, timing), 0);
    assert.equal(tipIndexAt(8000, timing), 1);
  });

  it('waits until the next tip is due', () => {
    assert.equal(nextTipDelay(1000, timing), 2000);
    assert.equal(nextTipDelay(3000, timing), 5000);
    assert.equal(nextTipDelay(9500, timing), 3500);
  });
});

describe('turn announcements', () => {
  it('announces a new deck as ready', () => {
    assert.equal(turnAnnouncement({ creating: true, touched: 8, before: 0, after: 8 }), 'Presentation ready, 8 slides');
    assert.equal(turnAnnouncement({ creating: true, touched: 1, before: 0, after: 1 }), 'Presentation ready, 1 slide');
  });

  it('counts updated slides', () => {
    assert.equal(turnAnnouncement({ creating: false, touched: 3, before: 10, after: 10 }), '3 slides updated');
    assert.equal(turnAnnouncement({ creating: false, touched: 1, before: 10, after: 11 }), '1 slide updated');
  });

  it('tells outline-only changes and silence', () => {
    assert.equal(turnAnnouncement({ creating: false, touched: 0, before: 10, after: 8 }), 'Presentation updated, 8 slides in all');
    assert.equal(turnAnnouncement({ creating: false, touched: 0, before: 2, after: 0 }), 'Presentation updated, no slides left');
    assert.equal(turnAnnouncement({ creating: false, touched: 0, before: 4, after: 4 }), null);
    assert.equal(turnAnnouncement({ creating: true, touched: 0, before: 0, after: 0 }), null);
  });
});
