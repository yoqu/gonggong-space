import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REGION_HINT_GAP_MS, REGION_HINT_QUIET_MS, nextRegion, regionHintDue, regionKeyStep, type BoardRegion, type RegionKeyPress } from '../src/lib/regions.ts';
import { clipAnnouncement } from '../src/services/announce.ts';

function key(name: string, options: Partial<RegionKeyPress> = {}): RegionKeyPress {
  return { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...options };
}

describe('F6 regions', () => {
  const all = new Set<BoardRegion>(['toolbar', 'canvas', 'ask', 'selection', 'zoom']);

  it('reads F6 forwards and ⇧F6 backwards', () => {
    assert.equal(regionKeyStep(key('F6')), 1);
    assert.equal(regionKeyStep(key('F6', { shiftKey: true })), -1);
  });

  it('leaves F6 alone with modifiers and while composing', () => {
    assert.equal(regionKeyStep(key('F6', { ctrlKey: true })), undefined);
    assert.equal(regionKeyStep(key('F6', { altKey: true })), undefined);
    assert.equal(regionKeyStep(key('F6', { isComposing: true })), undefined);
    assert.equal(regionKeyStep(key('F6', { keyCode: 229 })), undefined);
    assert.equal(regionKeyStep(key('F7')), undefined);
  });

  it('walks toolbar, canvas, ask panel, selection toolbar and zoom bar in order, skipping absent ones', () => {
    assert.equal(nextRegion(all, 'toolbar', 1), 'canvas');
    assert.equal(nextRegion(all, 'canvas', 1), 'ask');
    assert.equal(nextRegion(all, 'ask', 1), 'selection');
    assert.equal(nextRegion(all, 'selection', 1), 'zoom');
    assert.equal(nextRegion(new Set<BoardRegion>(['toolbar', 'canvas', 'zoom']), 'canvas', 1), 'zoom');
  });

  it('wraps around both ways', () => {
    assert.equal(nextRegion(all, 'zoom', 1), 'toolbar');
    assert.equal(nextRegion(all, 'toolbar', -1), 'zoom');
    assert.equal(nextRegion(all, 'canvas', -1), 'toolbar');
  });

  it('puts notifications last, and starts at an end from outside every region', () => {
    const withToast = new Set<BoardRegion>([...all, 'notifications']);
    assert.equal(nextRegion(withToast, 'zoom', 1), 'notifications');
    assert.equal(nextRegion(withToast, undefined, 1), 'toolbar');
    assert.equal(nextRegion(withToast, undefined, -1), 'notifications');
  });

  it('goes nowhere when no other region is there', () => {
    assert.equal(nextRegion(new Set<BoardRegion>(['canvas']), 'canvas', 1), undefined);
    assert.equal(nextRegion(new Set<BoardRegion>(), undefined, 1), undefined);
  });

  it('moves on from a region that just went away', () => {
    assert.equal(nextRegion(new Set<BoardRegion>(['toolbar', 'canvas', 'zoom']), 'selection', 1), 'zoom');
  });

  it('hints at most every two minutes and never right after another announcement', () => {
    const now = 1_000_000;
    assert.equal(regionHintDue({ hintAt: undefined, announcedAt: undefined }, now), true);
    assert.equal(regionHintDue({ hintAt: now - REGION_HINT_GAP_MS + 1, announcedAt: undefined }, now), false);
    assert.equal(regionHintDue({ hintAt: now - REGION_HINT_GAP_MS, announcedAt: undefined }, now), true);
    assert.equal(regionHintDue({ hintAt: undefined, announcedAt: now - 10 }, now), false);
    assert.equal(regionHintDue({ hintAt: undefined, announcedAt: now - REGION_HINT_QUIET_MS }, now), true);
  });
});

describe('announcement length', () => {
  it('keeps short messages, with whitespace collapsed', () => {
    assert.equal(clipAnnouncement('  Two   notes\nselected '), 'Two notes selected');
    assert.equal(clipAnnouncement('a'.repeat(200)), 'a'.repeat(200));
  });

  it('cuts long ones at a word boundary with an ellipsis', () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
    const clipped = clipAnnouncement(words);
    assert.ok([...clipped].length <= 200);
    assert.ok(clipped.endsWith('…'));
    assert.ok(words.startsWith(clipped.slice(0, -1)));
    assert.match(clipped, /word\d+…$/);
  });

  it('cuts a message without spaces where it must', () => {
    assert.equal(clipAnnouncement('x'.repeat(250)), 'x'.repeat(199) + '…');
  });
});
