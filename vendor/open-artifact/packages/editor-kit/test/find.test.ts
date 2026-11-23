/** Tests of find's matching and stepping. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFind, excerpt, occurrences, stepIndex } from '../src/find.ts';

describe('find', () => {
  it('counts case-insensitive occurrences without overlaps', () => {
    assert.deepEqual(occurrences('Aaaa', 'aa'), [0, 2]);
    assert.deepEqual(occurrences('abc', ''), []);
  });

  it('steps around', () => {
    assert.equal(stepIndex(6, 7, 1), 0);
    assert.equal(stepIndex(0, 7, -1), 6);
    assert.equal(stepIndex(-1, 7, -1), 6);
    assert.equal(stepIndex(-1, 7, 1), 0);
    assert.equal(stepIndex(3, 0, 1), -1);
  });

  it('cuts excerpts around a match', () => {
    assert.equal(excerpt('a'.repeat(40) + 'XY' + 'b'.repeat(40), 40, 2, 3), '…aaaXYbbb…');
  });

  it('searches, starts where the editor says, searches again on each step and resets on close', () => {
    let words = ['one', 'two', 'one more', 'none'];
    const shown: string[] = [];
    let empty = 0;
    let closed = 0;
    const useFind = createFind<string>({
      search: (query) => (query.trim() ? words.filter((word) => word.includes(query.trim())) : []),
      start: (matches) => matches.length - 1,
      reveal: (match, index, count) => void shown.push(`${match} ${index + 1}/${count}`),
      noResults: () => void empty++,
      onClose: () => void closed++,
    });
    useFind.getState().setQuery('one');
    assert.deepEqual(useFind.getState().matches, ['one', 'one more', 'none']);
    assert.equal(useFind.getState().index, 2);
    useFind.getState().step(1);
    assert.equal(useFind.getState().index, 0);
    words = ['one'];
    useFind.getState().step(-1);
    assert.deepEqual(useFind.getState().matches, ['one']);
    assert.equal(useFind.getState().index, 0);
    assert.deepEqual(shown, ['none 3/3', 'one 1/3', 'one 1/1']);
    useFind.getState().setQuery('zzz');
    assert.equal(useFind.getState().index, -1);
    assert.equal(empty, 1);
    useFind.getState().setQuery('  ');
    assert.equal(empty, 1);
    useFind.getState().close();
    assert.deepEqual([useFind.getState().query, useFind.getState().index, closed], ['', -1, 1]);
  });
});
