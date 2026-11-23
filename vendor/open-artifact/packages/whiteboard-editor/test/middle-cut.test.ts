import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { middleCut } from '../src/lib/middle-cut.ts';
import { REFOCUS_WINDOW_MS, shouldRefocus } from '../src/lib/refocus.ts';

describe('file names cut in the middle', () => {
  it('keeps names that fit', () => {
    assert.equal(middleCut('notes.txt', 24), 'notes.txt');
    assert.equal(middleCut('', 24), '');
  });

  it('keeps the start and the extension of a long name', () => {
    const cut = middleCut('quarterly-planning-notes-final-v2.txt', 20);
    assert.equal(cut, 'quarterly-pl…-v2.txt');
    assert.equal([...cut].length, 20);
  });

  it('keeps a long extension only up to a point', () => {
    const cut = middleCut('a-very-long-file-name.averyveryverylongextension', 20);
    assert.equal([...cut].length, 20);
    assert.ok(cut.startsWith('a-very-long'));
    assert.ok(cut.includes('…'));
  });

  it('counts characters, not code units', () => {
    const cut = middleCut('🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂.csv', 10);
    assert.equal([...cut].length, 10);
    assert.ok(cut.endsWith('.csv'));
  });
});

describe('focus back after a short disable', () => {
  it('takes focus back within the window while nothing else has it', () => {
    assert.equal(shouldRefocus(1000, 1000 + REFOCUS_WINDOW_MS, true), true);
    assert.equal(shouldRefocus(1000, 1200, true), true);
  });

  it('does not after the window, when focus moved on, or when it had none', () => {
    assert.equal(shouldRefocus(1000, 1001 + REFOCUS_WINDOW_MS, true), false);
    assert.equal(shouldRefocus(1000, 1200, false), false);
    assert.equal(shouldRefocus(null, 1200, true), false);
  });
});
