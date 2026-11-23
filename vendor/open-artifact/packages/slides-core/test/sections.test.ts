import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moveSectionToGap, moveSectionsToGap, reconcileSections, sectionGroups, type SectionedDeck } from '../src/index.ts';

/** Three sections of two slides each: A = s1 s2, B = s3 s4, C = s5 s6. */
function deck(): SectionedDeck {
  return {
    order: ['s1', 's2', 's3', 's4', 's5', 's6'],
    sections: [
      { key: 'A', description: 'a', start: 's1' },
      { key: 'B', description: 'b', start: 's3' },
      { key: 'C', description: 'c', start: 's5' },
    ],
  };
}

/** The outline as "KEY:slides" rows. */
function rows(d: SectionedDeck): string[] {
  return sectionGroups(reconcileSections(d.sections, d.order), d.order).map((g) => `${g.section?.key ?? '-'}:${g.ids.join(',')}`);
}

describe('moving sections', () => {
  it('moves one section to a gap between rows', () => {
    const next = moveSectionToGap(deck(), 'C', 0)!;
    assert.deepEqual(rows(next), ['C:s5,s6', 'A:s1,s2', 'B:s3,s4']);
  });

  it('moves several sections together, keeping their order', () => {
    const next = moveSectionsToGap(deck(), ['C', 'A'], 2)!;
    assert.deepEqual(rows(next), ['B:s3,s4', 'A:s1,s2', 'C:s5,s6']);
    assert.deepEqual(next.order, ['s3', 's4', 's1', 's2', 's5', 's6']);
  });

  it('moves several sections to the end', () => {
    const next = moveSectionsToGap(deck(), ['A', 'B'], 3)!;
    assert.deepEqual(rows(next), ['C:s5,s6', 'A:s1,s2', 'B:s3,s4']);
  });

  it('does nothing when the sections already sit at the gap', () => {
    assert.equal(moveSectionsToGap(deck(), ['A', 'B'], 0), undefined);
    assert.equal(moveSectionsToGap(deck(), ['B'], 2), undefined);
    assert.equal(moveSectionsToGap(deck(), ['nope'], 0), undefined);
  });
});
