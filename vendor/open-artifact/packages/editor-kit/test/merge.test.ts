import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeLines } from '../src/merge.ts';

const base = ['<section id="s1">', '  <h1>Title</h1>', '  <p>One</p>', '  <p>Two</p>', '  <p>Three</p>', '</section>'].join('\n');
const edit = (text: string, from: string, to: string): string => {
  assert.ok(text.includes(from));
  return text.replace(from, to);
};

/** Slides passes `adjacent: 'conflict'`: a slide's HTML reads as one unit. */
describe("mergeLines, adjacent: 'conflict'", () => {
  const conflict = { adjacent: 'conflict' } as const;
  it('keeps both sides when they changed different lines', () => {
    const mine = edit(base, '<h1>Title</h1>', '<h1>New title</h1>');
    const theirs = edit(base, '<p>Three</p>', '<p>Three!</p>');
    const merged = mergeLines(base, mine, theirs, conflict);
    assert.equal(merged, edit(mine, '<p>Three</p>', '<p>Three!</p>'));
  });

  it('keeps insertions and deletions from both sides', () => {
    const mine = edit(base, '  <p>One</p>\n', '');
    const theirs = edit(base, '  <p>Three</p>', '  <p>Three</p>\n  <p>Four</p>');
    assert.equal(mergeLines(base, mine, theirs, conflict), ['<section id="s1">', '  <h1>Title</h1>', '  <p>Two</p>', '  <p>Three</p>', '  <p>Four</p>', '</section>'].join('\n'));
  });

  it('gives up when both changed the same line', () => {
    const mine = edit(base, '<p>Two</p>', '<p>Mine</p>');
    const theirs = edit(base, '<p>Two</p>', '<p>Theirs</p>');
    assert.equal(mergeLines(base, mine, theirs, conflict), null);
  });

  it('gives up on changes to adjacent lines', () => {
    const mine = edit(base, '<p>One</p>', '<p>1</p>');
    const theirs = edit(base, '<p>Two</p>', '<p>2</p>');
    assert.equal(mergeLines(base, mine, theirs, conflict), null);
  });

  it('accepts the same change made on both sides', () => {
    const both = edit(base, '<p>Two</p>', '<p>2</p>');
    assert.equal(mergeLines(base, both, both, conflict), both);
    const mine = edit(both, '<h1>Title</h1>', '<h1>T</h1>');
    assert.equal(mergeLines(base, mine, both, conflict), mine);
  });

  it('returns the side that changed when the other did not', () => {
    const theirs = edit(base, '<p>One</p>', '<p>Uno</p>');
    assert.equal(mergeLines(base, base, theirs, conflict), theirs);
    assert.equal(mergeLines(base, theirs, base, conflict), theirs);
  });

  it('merges edits at the very start and end', () => {
    const mine = `<!-- note -->\n${base}`;
    const theirs = `${base}\n`;
    assert.equal(mergeLines(base, mine, theirs, conflict), `<!-- note -->\n${base}\n`);
  });
});

describe('mergeLines, default', () => {
  const base = 'a\nb\nc\nd\ne\n';

  it('keeps both sides when they change different lines', () => {
    assert.equal(mergeLines(base, 'A\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n'), 'A\nb\nc\nd\nE\n');
  });

  it('merges insertions at different places and a deletion', () => {
    assert.equal(mergeLines(base, 'a\nnew\nb\nc\nd\ne\n', 'a\nb\nc\ne\n'), 'a\nnew\nb\nc\ne\n');
  });

  it('refuses changes to the same line', () => {
    assert.equal(mergeLines(base, 'a\nB1\nc\nd\ne\n', 'a\nB2\nc\nd\ne\n'), null);
  });

  it('refuses two insertions at the same place', () => {
    assert.equal(mergeLines(base, 'a\nx\nb\nc\nd\ne\n', 'a\ny\nb\nc\nd\ne\n'), null);
  });

  it('takes an identical change once', () => {
    assert.equal(mergeLines(base, 'a\nB\nc\nd\ne\n', 'a\nB\nc\nd\nE\n'), 'a\nB\nc\nd\nE\n');
  });

  it('returns the side that changed when only one did', () => {
    assert.equal(mergeLines(base, base, 'z\n'), 'z\n');
    assert.equal(mergeLines(base, 'z\n', base), 'z\n');
  });

  it('merges adjacent but separate line changes', () => {
    assert.equal(mergeLines(base, 'a\nB\nc\nd\ne\n', 'a\nb\nC\nd\ne\n'), 'a\nB\nC\nd\ne\n');
  });
});
