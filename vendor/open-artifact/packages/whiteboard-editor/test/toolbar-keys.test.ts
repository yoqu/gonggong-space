import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barKeyTarget, type BarKeyPress } from '../src/lib/toolbar-keys.ts';

function key(name: string, options: Partial<BarKeyPress> = {}): BarKeyPress {
  return { key: name, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...options };
}

describe('bar arrow keys', () => {
  const enabled = [true, false, true, true, false];

  it('steps to the next or previous enabled control', () => {
    assert.equal(barKeyTarget(key('ArrowRight'), 0, enabled), 2);
    assert.equal(barKeyTarget(key('ArrowLeft'), 2, enabled), 0);
    assert.equal(barKeyTarget(key('ArrowRight'), 3, enabled), undefined);
    assert.equal(barKeyTarget(key('ArrowLeft'), 0, enabled), undefined);
  });

  it('goes to the first and last enabled control with Home and End', () => {
    assert.equal(barKeyTarget(key('Home'), 3, enabled), 0);
    assert.equal(barKeyTarget(key('End'), 0, enabled), 3);
    assert.equal(barKeyTarget(key('End'), 3, enabled), undefined);
  });

  it('leaves up and down, modifiers and input-method composition alone', () => {
    assert.equal(barKeyTarget(key('ArrowDown'), 0, enabled), undefined);
    assert.equal(barKeyTarget(key('ArrowRight', { metaKey: true }), 0, enabled), undefined);
    assert.equal(barKeyTarget(key('ArrowRight', { isComposing: true }), 0, enabled), undefined);
    assert.equal(barKeyTarget(key('ArrowRight', { keyCode: 229 }), 0, enabled), undefined);
  });
});
