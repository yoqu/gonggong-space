import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filmSeconds, parseRecutRecord, pruneRecutText, recutMatchesScenes, type RecutPart } from '../src/index.ts';

const parts: RecutPart[] = [
  { key: 'pour', own: 'The pour', filmDur: filmSeconds(4.5) },
  { key: 'bell', own: 'Bell', filmDur: filmSeconds(3) },
];
const recut = (scenes: unknown[]): string => JSON.stringify({ v: 1, scenes });

describe('recut prune', () => {
  it('waits until scenes.json and the film the stage plays agree', () => {
    const listed = [
      { id: 'pour', dur: 4.5 },
      { id: 'bell', dur: 3 },
    ];
    assert.equal(recutMatchesScenes(listed, parts), true);
    assert.equal(recutMatchesScenes([{ id: 'pour', dur: 5 }, listed[1]!], parts), false, 'the list changed a length the film has not caught up with');
    assert.equal(recutMatchesScenes([listed[1]!, listed[0]!], parts), false);
    assert.equal(recutMatchesScenes(listed.slice(0, 1), parts), false);
    assert.equal(recutMatchesScenes(null, parts), false);
    assert.equal(recutMatchesScenes([], []), false);
  });

  it('keeps the text when everything still applies', () => {
    const text = recut([
      { id: 'pour', dur: { was: 4.5, v: 6 }, name: { was: 'The pour', v: 'Bronze' } },
      { id: 'bell', dur: { was: 3, v: 2 } },
    ]);
    assert.equal(pruneRecutText(text, parts), text);
    assert.equal(pruneRecutText(null, parts), null);
  });

  it('drops scenes that are gone, and lengths and names whose was no longer matches', () => {
    const text = recut([
      { id: 'pour', dur: { was: 4, v: 6 }, name: { was: 'The pour', v: 'Bronze' } },
      { id: 'bell', name: { was: 'Old bell', v: 'Ring' } },
      { id: 'gone', dur: { was: 2, v: 3 } },
    ]);
    const pruned = pruneRecutText(text, parts);
    assert.notEqual(pruned, text);
    assert.deepEqual(parseRecutRecord(pruned).scenes, [{ target: { by: 'id', id: 'pour' }, name: { was: 'The pour', v: 'Bronze' } }]);
  });

  it('drops a length the scene’s bounds no longer allow, and entries that do not read', () => {
    const outOfBounds = recut([{ id: 'pour', dur: { was: 4.5, v: 20 } }]);
    assert.equal(pruneRecutText(outOfBounds, parts), null);
    const unreadable = recut([{ id: 'pour', dur: { was: 4.5, v: 6 } }, { id: 'Not An Id!' }]);
    assert.deepEqual(parseRecutRecord(pruneRecutText(unreadable, parts)).scenes, [{ target: { by: 'id', id: 'pour' }, dur: { was: 4.5, v: 6 } }]);
  });

  it('leaves nothing, or a record of another version, alone', () => {
    assert.equal(pruneRecutText(recut([{ id: 'gone', dur: { was: 2, v: 3 } }]), parts), null);
    const later = JSON.stringify({ v: 2, scenes: [{ id: 'gone' }] });
    assert.equal(pruneRecutText(later, parts), later);
  });
});
