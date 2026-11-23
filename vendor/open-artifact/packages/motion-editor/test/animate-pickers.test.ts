import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_CHANGE_ITEM, WRAP_SPILL, layersUpdating, menuKept, menuUnder, pickerWrite, spillOf } from '../src/layers/animate.ts';

test('a picker writes a new option; the picked segment again lets it go, unless the picker holds', () => {
  assert.equal(pickerWrite(null, 'fade', 'segments', false), 'fade');
  assert.equal(pickerWrite<string>('fade', 'pop', 'segments', false), 'pop');
  assert.equal(pickerWrite('fade', 'fade', 'segments', false), null);
  // A direction holds: Right picked again stays Right (nothing written), and another side is taken.
  assert.equal(pickerWrite('right', 'right', 'segments', true), undefined);
  assert.equal(pickerWrite<string>('right', 'top', 'segments', true), 'top');
});

test('in the menu, "No change" lets the pick go and the picked item again keeps it', () => {
  assert.equal(pickerWrite('fade', NO_CHANGE_ITEM, 'menu', false), null);
  assert.equal(pickerWrite(null, NO_CHANGE_ITEM, 'menu', false), undefined);
  assert.equal(pickerWrite('fade', 'fade', 'menu', false), undefined);
  assert.equal(pickerWrite<string>('fade', 'slide', 'menu', false), 'slide');
  assert.equal(pickerWrite('left', 'left', 'menu', true), undefined);
  assert.equal(pickerWrite<string>('left', 'bottom', 'menu', true), 'bottom');
});

test('segments that reach past the picker go in a menu, until the picker is wide enough again', () => {
  const box = { left: 100, right: 300 };
  assert.equal(spillOf(box, [{ left: 102, right: 200 }, { left: 200, right: 298 }], false), 0);
  assert.equal(spillOf(box, [{ left: 102, right: 220 }, { left: 220, right: 340 }], false), 40);
  assert.equal(spillOf(box, [{ left: 90, right: 200 }], false), 10);
  assert.equal(spillOf(box, [{ left: 102, right: 200 }], true), WRAP_SPILL);
  assert.equal(spillOf(box, [], false), 0);

  assert.equal(menuUnder(200, 0), null);
  assert.equal(menuUnder(200, 0.4), null);
  assert.equal(menuUnder(200, 40), 240);
  assert.equal(menuKept(220, 240), 240);
  assert.equal(menuKept(240, 240), null);
  assert.equal(menuKept(260, null), null);
});

test('Ask waits while the layers are read again, or were read before the film changed', () => {
  assert.equal(layersUpdating('read', 3, 3), false);
  assert.equal(layersUpdating('reading', 3, 3), true);
  assert.equal(layersUpdating('read', 2, 3), true);
  assert.equal(layersUpdating('failed', 2, 3), true);
  assert.equal(layersUpdating('failed', 3, 3), false);
});
