import assert from 'node:assert/strict';
import { it } from 'node:test';
import { menuFit } from '../src/menu-fit.ts';

it('limits a menu to the free height unless its classes set their own limit', () => {
  assert.deepEqual(menuFit(), { maxHeight: 'var(--available-height)', overflowY: 'auto' });
  assert.deepEqual(menuFit('min-w-[220px]'), { maxHeight: 'var(--available-height)', overflowY: 'auto' });
  assert.equal(menuFit('max-h-[360px] w-[240px] overflow-y-auto'), undefined);
});
