import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditableWord } from '@open-artifact/motion-core';
import { clampSceneLength, findScene, roundTenths, scaledSceneLength, sceneLengthBounds, stableSceneKey, type LengthPart } from '../src/recut/bounds.ts';
import { hasScenes, partAt, sceneStep } from '../src/tweaks/scene-place.ts';
import { groupWords, inSteadyOrder, sameLines, shownText } from '../src/text/text-model.ts';

const part = (filmDur: number, playDur = filmDur, key: string | null = null, own = 'Scene'): LengthPart => ({ key, own, filmDur, playDur });

test('a scene may play from half to three times its own length', () => {
  const bounds = sceneLengthBounds([part(4), part(6)], 0);
  assert.deepEqual(bounds, { filmDur: 4, min: 2, max: 12 });
  assert.equal(sceneLengthBounds([part(4)], 3), null);
});

test('a short scene keeps at least a second, and never less than its own length', () => {
  assert.equal(sceneLengthBounds([part(1.5)], 0)?.min, 1);
  assert.equal(sceneLengthBounds([part(0.6)], 0)?.min, 0.6);
});

test('the other scenes leave room up to the 36000 s cap', () => {
  const bounds = sceneLengthBounds([part(10), part(20_000, 35_980)], 0);
  assert.equal(bounds?.max, 20);
  // Its own length stays allowed even when the others already fill the film.
  assert.equal(sceneLengthBounds([part(10), part(20_000, 35_995)], 0)?.max, 10);
});

test('lengths snap to tenths, stay within bounds, and land on the scene’s own length nearby', () => {
  const bounds = sceneLengthBounds([part(4)], 0)!;
  assert.equal(clampSceneLength(bounds, 5.04), 5);
  assert.equal(clampSceneLength(bounds, 5.06), 5.1);
  assert.equal(clampSceneLength(bounds, 0.4), 2);
  assert.equal(clampSceneLength(bounds, 99), 12);
  assert.equal(clampSceneLength({ filmDur: 4.03, min: 2.1, max: 12 }, 4.06), 4.03);
});

test('half and double speed halve or double the length, or say they cannot', () => {
  const bounds = sceneLengthBounds([part(4)], 0)!;
  assert.equal(scaledSceneLength(bounds, 4, 0.5), 8);
  assert.equal(scaledSceneLength(bounds, 4, 2), 2);
  assert.equal(scaledSceneLength(bounds, 2, 2), null);
  assert.equal(scaledSceneLength(bounds, 12, 0.5), null);
  // Back at its own pace: the change is taken back.
  assert.equal(scaledSceneLength(bounds, 8, 2), 4);
  assert.equal(scaledSceneLength(bounds, 2, 0.5), 4);
});

test('a scene is found again by id, else by place and own name', () => {
  const parts = [part(2, 2, 'intro', 'Intro'), part(3, 3, null, 'Part two')];
  assert.equal(stableSceneKey(parts[0]!, 0), 'intro');
  assert.equal(stableSceneKey(parts[1]!, 1), '1 Part two');
  assert.equal(findScene(parts, '1 Part two'), 1);
  assert.equal(findScene(parts, '0 Part two'), -1);
  assert.equal(roundTenths(2.349), 2.3);
});

test('the scene on show, and stepping to the next lands past its middle', () => {
  const parts = [
    { playStart: 0, playDur: 4 },
    { playStart: 4, playDur: 6 },
  ];
  assert.equal(partAt(parts, 0), 0);
  assert.equal(partAt(parts, 3.9999999), 1);
  assert.equal(partAt(parts, 4.5), 1);
  assert.equal(partAt(parts, 99), 1);
  assert.equal(partAt([], 1), -1);
  assert.deepEqual(sceneStep(parts, 0, 1), { index: 1, time: 4 + 6 * 0.6 });
  assert.equal(sceneStep(parts, 1, 1), null);
  assert.equal(sceneStep(parts, 0, -1), null);
  assert.equal(hasScenes(1, false), false);
  assert.equal(hasScenes(1, true), true);
  assert.equal(hasScenes(2, false), true);
});

test('stage texts read as shown texts, boxed only when every side is known', () => {
  assert.deepEqual(shownText({ text: 'Hi', x: 1, y: 2, w: 3, h: 4, line: 20, id: '0:1', seen: true }), {
    text: 'Hi',
    box: { x: 1, y: 2, w: 3, h: 4 },
    line: 20,
    id: '0:1',
    seen: true,
  });
  assert.deepEqual(shownText({ text: 'Hidden', x: 1 }), { text: 'Hidden', box: null, line: 0, seen: false });
});

test('lines compare by what they say, in any order', () => {
  assert.equal(sameLines([{ was: 'a', v: 'b' }, { was: 'c', v: 'd' }], [{ was: 'c', v: 'd' }, { was: 'a', v: 'b' }]), true);
  assert.equal(sameLines([{ was: 'a', v: 'b' }], [{ was: 'a', v: 'x' }]), false);
  assert.equal(sameLines([], [{ was: 'a', v: 'b' }]), false);
});

const word = (id: string, group: EditableWord['group'] = null): EditableWord => ({ id, text: id, boxes: [], max: 300, changed: false, group, places: 1 });

test('the list keeps its order while a field has focus, and keeps the focused line', () => {
  const now = [word('b'), word('c'), word('a')];
  assert.deepEqual(
    inSteadyOrder(now, ['a', 'b'], null).map((w) => w.id),
    ['a', 'b', 'c'],
  );
  const held = word('gone', 'more');
  assert.deepEqual(
    inSteadyOrder(now, null, held).map((w) => w.id),
    ['b', 'c', 'a', 'gone'],
  );
  assert.equal(inSteadyOrder([word('a', 'later')], ['a'], word('a', null))[0]?.group, null);
});

test('words group under fixed headings', () => {
  const groups = groupWords([word('x', 'not-on-screen'), word('y', 'more'), word('z'), word('w', 'more')]);
  assert.deepEqual(
    groups.map((group) => [group.group, group.words.map((w) => w.id)]),
    [
      [null, ['z']],
      ['more', ['y', 'w']],
      ['not-on-screen', ['x']],
    ],
  );
});
