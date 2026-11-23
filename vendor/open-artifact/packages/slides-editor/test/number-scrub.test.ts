import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCRUBBED, undoesScrub } from '../src/lib/number-scrub.ts';

const field = (scrubbed: boolean) => ({ tagName: 'INPUT', hasAttribute: (name: string) => scrubbed && name === SCRUBBED });
const key = (target: unknown, key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  target,
  key,
  metaKey: Boolean(mods.meta),
  ctrlKey: Boolean(mods.ctrl),
  shiftKey: Boolean(mods.shift),
  altKey: Boolean(mods.alt),
});

describe('undo in a field a drag just set', () => {
  it('reaches the editor for undo and redo', () => {
    assert.equal(undoesScrub(key(field(true), 'z', { meta: true })), true);
    assert.equal(undoesScrub(key(field(true), 'Z', { meta: true, shift: true })), true);
    assert.equal(undoesScrub(key(field(true), 'z', { ctrl: true })), true);
    assert.equal(undoesScrub(key(field(true), 'y', { ctrl: true })), true);
  });

  it('stays with the field once it was typed into, and for other keys', () => {
    assert.equal(undoesScrub(key(field(false), 'z', { meta: true })), false);
    assert.equal(undoesScrub(key(field(true), 'z')), false);
    assert.equal(undoesScrub(key(field(true), 'a', { meta: true })), false);
    assert.equal(undoesScrub(key(field(true), 'z', { meta: true, alt: true })), false);
    assert.equal(undoesScrub(key(null, 'z', { meta: true })), false);
  });
});
