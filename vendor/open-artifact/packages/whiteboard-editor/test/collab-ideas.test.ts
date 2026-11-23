/**
 * Tests of putting an idea's option on the board and taking it off again:
 * edits against a board that changed since the agent read it are skipped,
 * and undoing leaves what others touched since.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement, IdeaVersion, NoteElement } from '@open-artifact/whiteboard-core';
import {
  applyIdeaVersion,
  canonicalJson,
  conflictingIdeaOptions,
  ideaEditKind,
  ideaVersionTouches,
  previewIdeaVersion,
  restoreIdeaVersion,
} from '../src/collab/idea-edits.ts';

const note = (id: string, text: string, x = 0): NoteElement => ({ type: 'note', id, x, y: 0, w: 100, h: 100, color: 'yellow', text, tilt: 0 });

const board: BoardElement[] = [note('a', 'Alpha'), note('b', 'Beta', 200)];

describe('idea option bookkeeping', () => {
  it('sorts keys so equal values compare equal', () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] }), '{"a":[{"d":2}],"b":1}');
  });

  it('tells edit kinds apart', () => {
    assert.equal(ideaEditKind({ id: 'x', type: 'note' }), 'create');
    assert.equal(ideaEditKind({ id: 'x', text: 'y' }), 'change');
    assert.equal(ideaEditKind({ id: 'x', remove: true }), 'remove');
  });

  it('finds options that fight over the same element', () => {
    const versions: IdeaVersion[] = [{ edits: [{ id: 'a', text: '1' }] }, { edits: [{ id: 'b', remove: true }] }, { edits: [{ id: 'a', remove: true }, { id: 'new', type: 'note' }] }];
    assert.deepEqual([...ideaVersionTouches(versions[2])], ['a']);
    assert.deepEqual(conflictingIdeaOptions(versions, 0), [2]);
    assert.deepEqual(conflictingIdeaOptions(versions, 1), []);
  });
});

describe('applyIdeaVersion', () => {
  it('creates, changes and removes, and counts what it did', () => {
    const version: IdeaVersion = {
      edits: [
        { id: 'c', type: 'note', x: 400, y: 0, w: 100, h: 100, color: 'green', text: 'Gamma', tilt: 0 },
        { id: 'a', text: 'Alpha 2' },
        { id: 'b', remove: true },
      ],
    };
    const result = applyIdeaVersion(board, version, board);
    assert.equal(result.applied, 3);
    assert.equal(result.skipped, 0);
    assert.deepEqual(
      result.elements.map((element) => element.id),
      ['a', 'c'],
    );
    assert.equal((result.elements[0] as NoteElement).text, 'Alpha 2');
    assert.equal((result.elements[1] as NoteElement).by, 'agent');
  });

  it('skips edits to elements that changed since the agent read them', () => {
    const now: BoardElement[] = [note('a', 'Edited by someone'), note('b', 'Beta', 200)];
    const result = applyIdeaVersion(now, { edits: [{ id: 'a', text: 'Alpha 2' }] }, board);
    assert.equal(result.skipped, 1);
    assert.equal(result.elements, now);
  });

  it('accepts a change whose `was` values still hold', () => {
    const now: BoardElement[] = [note('a', 'Alpha', 50)];
    const result = applyIdeaVersion(now, { edits: [{ id: 'a', text: 'Alpha 2', was: { text: 'Alpha' } }] }, []);
    assert.equal(result.applied, 1);
    assert.equal((result.elements[0] as NoteElement).text, 'Alpha 2');
  });

  it('never creates over an existing id', () => {
    const result = applyIdeaVersion(board, { edits: [{ id: 'a', type: 'note', text: 'Again' }] }, board);
    assert.equal(result.skipped, 1);
    assert.equal(result.elements, board);
  });
});

describe('restoreIdeaVersion', () => {
  it('undoes an untouched option completely', () => {
    const version: IdeaVersion = {
      edits: [
        { id: 'c', type: 'note', x: 400, y: 0, w: 100, h: 100, color: 'green', text: 'Gamma', tilt: 0 },
        { id: 'a', text: 'Alpha 2' },
        { id: 'b', remove: true },
      ],
    };
    const applied = applyIdeaVersion(board, version, board);
    const restored = restoreIdeaVersion(applied.elements, applied.restore);
    assert.equal(restored.restored, 3);
    assert.equal(restored.kept, 0);
    assert.deepEqual(restored.elements, board);
  });

  it('leaves what someone edited since', () => {
    const applied = applyIdeaVersion(board, { edits: [{ id: 'a', text: 'Alpha 2' }] }, board);
    const touched = applied.elements.map((element) => (element.id === 'a' ? { ...element, text: 'Mine now' } : element));
    const restored = restoreIdeaVersion(touched, applied.restore);
    assert.equal(restored.restored, 0);
    assert.equal(restored.kept, 1);
    assert.equal(restored.elements, touched);
  });
});

describe('previewIdeaVersion', () => {
  it('lists what would be added, changed and removed', () => {
    const preview = previewIdeaVersion(board, { edits: [{ id: 'a', text: 'Alpha 2' }, { id: 'b', remove: true }] }, board);
    assert.deepEqual(
      preview.changed.map((element) => element.id),
      ['a'],
    );
    assert.deepEqual(
      preview.removed.map((element) => element.id),
      ['b'],
    );
    assert.deepEqual(preview.added, []);
  });
});
