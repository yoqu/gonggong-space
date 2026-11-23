import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inlineSlides, isInlineView, pagerText, slideAfterChange } from '../src/lib/inline-view.ts';

describe('inline view', () => {
  it('needs both a framing page and the inline fragment', () => {
    const parent = {};
    assert.equal(isInlineView({ parent, location: { hash: '#view-inline' } }), true);
    assert.equal(isInlineView({ parent, location: { hash: '#slide-~3' } }), false);
    const top = { parent: null as unknown, location: { hash: '#view-inline' } };
    top.parent = top;
    assert.equal(isInlineView(top), false);
  });

  it('leaves skipped slides out unless every slide is skipped', () => {
    assert.deepEqual(inlineSlides(['a', 'b', 'c'], (id) => id === 'b'), ['a', 'c']);
    assert.deepEqual(inlineSlides(['a', 'b'], () => true), ['a', 'b']);
    assert.deepEqual(inlineSlides([], () => false), []);
  });

  it('keeps its slide, or the place it was at, when the deck changes', () => {
    assert.equal(slideAfterChange(['a', 'b', 'c'], 'b', 1), 'b');
    assert.equal(slideAfterChange(['a', 'c'], 'b', 1), 'c');
    assert.equal(slideAfterChange(['a'], 'c', 2), 'a');
    assert.equal(slideAfterChange([], 'a', 0), null);
    assert.equal(slideAfterChange(['a', 'b'], null, 0), 'a');
  });

  it('counts from one and names the slide for screen readers', () => {
    assert.deepEqual(pagerText(0, 3, 'Plan'), { counter: '1 / 3', announcement: 'Slide 1 of 3: Plan' });
    assert.deepEqual(pagerText(2, 3, undefined), { counter: '3 / 3', announcement: 'Slide 3 of 3' });
  });
});
