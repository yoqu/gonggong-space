import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { objectAlign, objectFitAspect } from '../src/capture.ts';

describe('object-fit as preserveAspectRatio', () => {
  it('maps each fit', () => {
    assert.equal(objectFitAspect('fill', '50% 50%'), 'none');
    assert.equal(objectFitAspect('cover', '50% 50%'), 'xMidYMid slice');
    assert.equal(objectFitAspect('contain', '50% 50%'), 'xMidYMid meet');
    assert.equal(objectFitAspect('scale-down', '50% 50%'), 'xMidYMid meet');
    assert.equal(objectFitAspect('none', '50% 50%'), null);
  });

  it('aligns to the object position', () => {
    assert.equal(objectAlign('0% 100%'), 'xMinYMax');
    assert.equal(objectAlign('0px 0px'), 'xMinYMin');
    assert.equal(objectAlign('left top'), 'xMinYMin');
    assert.equal(objectAlign('100% 50%'), 'xMaxYMid');
    assert.equal(objectAlign('20% 12px'), 'xMidYMid');
  });
});
