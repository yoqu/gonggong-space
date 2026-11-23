import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { snapToStep, stepStart } from '../src/numbers.ts';

describe('number field steps', () => {
  it('snaps a scrubbed value to the nearest multiple of the step', () => {
    assert.equal(snapToStep(14.7, 1), 15);
    assert.equal(snapToStep(-2.4, 1), -2);
    assert.equal(snapToStep(23, 5), 25);
    assert.ok(Math.abs(snapToStep(1.23, 0.1) - 1.2) < 1e-9);
  });

  it('leaves the value alone without a usable step', () => {
    assert.equal(snapToStep(14.7, 0), 14.7);
    assert.equal(snapToStep(14.7, Number.NaN), 14.7);
  });

  it('steps an empty field from 0, kept within the bounds', () => {
    assert.equal(stepStart(), 0);
    assert.equal(stepStart(-100, 100), 0);
    assert.equal(stepStart(10, 100), 10);
    assert.equal(stepStart(-50, -10), -10);
  });
});
