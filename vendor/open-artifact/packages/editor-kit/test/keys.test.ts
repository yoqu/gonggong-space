import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getToolbarKeyTarget } from '../src/keys.ts';

describe('toolbar keyboard navigation', () => {
  it('steps and wraps with arrows, jumps with Home and End, and ignores other keys', () => {
    assert.equal(getToolbarKeyTarget('ArrowRight', 0, 4), 1);
    assert.equal(getToolbarKeyTarget('ArrowRight', 3, 4), 0);
    assert.equal(getToolbarKeyTarget('ArrowDown', 1, 4), 2);
    assert.equal(getToolbarKeyTarget('ArrowLeft', 0, 4), 3);
    assert.equal(getToolbarKeyTarget('ArrowUp', 2, 4), 1);
    assert.equal(getToolbarKeyTarget('Home', 2, 4), 0);
    assert.equal(getToolbarKeyTarget('End', 0, 4), 3);
    assert.equal(getToolbarKeyTarget('Tab', 0, 4), null);
    assert.equal(getToolbarKeyTarget('ArrowRight', -1, 4), null);
    assert.equal(getToolbarKeyTarget('ArrowRight', 0, 0), null);
  });
});
