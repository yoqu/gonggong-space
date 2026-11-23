/**
 * Tests of where comments sit: drafts at a clicked point or on a dragged
 * area, and the place of a saved anchor as the board changes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NoteElement } from '@open-artifact/whiteboard-core';
import { anchorPlace, areaCommentDraft, elementCommentLabel, pointCommentDraft } from '../src/collab/comment-places.ts';

const note = (id: string, x: number, y: number, text = 'Q3 goals'): NoteElement => ({ type: 'note', id, x, y, w: 100, h: 100, color: 'yellow', text, tilt: 0 });

describe('elementCommentLabel', () => {
  it('names the kind and quotes the text', () => {
    assert.equal(elementCommentLabel(note('a', 0, 0)), 'Note "Q3 goals"');
    assert.equal(elementCommentLabel(note('a', 0, 0, '')), 'Note');
  });
});

describe('pointCommentDraft', () => {
  it('anchors to the element under the point, following it when it moves', () => {
    const elements = [note('a', 0, 0)];
    const draft = pointCommentDraft({ x: 25, y: 75 }, elements);
    assert.equal(draft.label, 'Note "Q3 goals"');
    assert.deepEqual(draft.location, { x: 25, y: 75, ids: ['a'] });
    assert.ok(draft.detail.length > 0);
    // Anchors store fractions of the element's box, slightly quantized.
    const moved = anchorPlace(draft.anchor, [note('a', 1000, 500)]);
    assert.equal(moved?.id, 'a');
    assert.ok(Math.abs((moved?.point.x ?? 0) - 1025) < 0.05 && Math.abs((moved?.point.y ?? 0) - 575) < 0.05, JSON.stringify(moved));
    assert.equal(anchorPlace(draft.anchor, []), undefined);
  });

  it('anchors to the board on empty space', () => {
    const draft = pointCommentDraft({ x: 500.4, y: -20.6 }, [note('a', 0, 0)]);
    assert.equal(draft.label, 'Board');
    assert.deepEqual(draft.location, { x: 500, y: -21 });
    assert.deepEqual(anchorPlace(draft.anchor, []), { point: { x: 500, y: -21 } });
  });
});

describe('areaCommentDraft', () => {
  it('lists the items it covers and pins at the corner nearest the release', () => {
    const elements = [note('a', 0, 0), note('b', 1000, 1000)];
    const rect = { x: -10, y: -10, w: 200, h: 200 };
    const draft = areaCommentDraft(rect, { x: 190, y: 190 }, elements);
    assert.deepEqual(draft.location, { x: -10, y: -10, w: 200, h: 200, ids: ['a'] });
    assert.equal(draft.at, rect);
    const place = anchorPlace(draft.anchor, elements);
    assert.ok(place?.rect, 'an area comment has a rect');
    assert.ok(place.point.x > place.rect.x + place.rect.w / 2 && place.point.y > place.rect.y + place.rect.h / 2, 'pinned at the bottom-right corner');
  });
});

describe('anchorPlace', () => {
  it('ignores empty and unreadable anchors', () => {
    assert.equal(anchorPlace('', []), undefined);
    assert.equal(anchorPlace('not an anchor', []), undefined);
  });
});
