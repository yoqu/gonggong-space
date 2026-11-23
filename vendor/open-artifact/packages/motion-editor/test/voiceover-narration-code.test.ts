import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmModule } from '@open-artifact/motion-core';
import {
  findNarrationCode,
  hasNarrationCode,
  movableTakes,
  narrationAtFor,
  narrationAtWrite,
  shiftNarrationAt,
  withoutNarrationAts,
} from '../src/voiceover/narration-code.ts';

const SCENES_ONLY = 'window.CUT = kit.scenes();';

const narrationModule = (text: string, extra: Partial<FilmModule> = {}): FilmModule => ({ name: 'narration.js', kind: 'js', text, ...extra });

const MODULE_TEXT = `kit.narration((T) => ({
  lines: [
    { at: 1.5, dur: 2, text: "Hello there", audio: "line-1.mp3" },
    { at: T.yard + 0.5, dur: 3, text: 'In the yard', audio: 'line-2.mp3' },
  ],
}));`;

const film = (text = MODULE_TEXT, extra: Partial<FilmModule> = {}) => ({ script: SCENES_ONLY, modules: [narrationModule(text, extra)] });

test('the narration is read from the module when the script only lists scenes', () => {
  const code = findNarrationCode(film());
  assert.ok(code !== null);
  assert.equal(code.inScript, false);
  assert.deepEqual(
    code.lines.map((line) => line.audio),
    ['line-1.mp3', 'line-2.mp3'],
  );
  assert.equal(hasNarrationCode(film()), true);
  assert.equal(hasNarrationCode({ script: SCENES_ONLY, modules: [] }), false);
});

test('the narration is read from the script when the script writes it', () => {
  const script = `window.CUT = { scenes: [] };\nwindow.CUT.narration = { lines: [ { at: 2, dur: 1, text: "Hi", audio: "hi.mp3" } ] };`;
  const code = findNarrationCode({ script, modules: [] });
  assert.ok(code !== null);
  assert.equal(code.inScript, true);
  assert.equal(narrationAtFor({ script, modules: [] }, 'hi.mp3'), '2');
});

test('words inside a comment are not taken for a line', () => {
  const text = `kit.narration((T) => ({ lines: [ /* { at: 1, dur: 1, text: "x", audio: "x.mp3" } */ ] }));`;
  const code = findNarrationCode(film(text));
  assert.ok(code === null || code.lines.length === 0);
});

test('a start moves as a number or as a scene start plus seconds', () => {
  assert.equal(shiftNarrationAt('1.5', 0.25), '1.75');
  assert.equal(shiftNarrationAt('1', -2), null);
  assert.equal(shiftNarrationAt('T.yard + 0.5', -0.5), 'T.yard');
  assert.equal(shiftNarrationAt('T.yard', -1.2), 'T.yard - 1.2');
  assert.equal(shiftNarrationAt('T["the end"] - 1', 3), 'T["the end"] + 2');
  assert.equal(shiftNarrationAt('start()', 1), null);
});

test('only takes the code says once, with a start the page can move, are movable', () => {
  const lines = [{ audio: 'line-1.mp3' }, { audio: 'line-2.mp3' }];
  assert.deepEqual([...movableTakes(film(), lines)].sort(), ['line-1.mp3', 'line-2.mp3']);
  assert.equal(movableTakes(film(), [{ audio: 'line-1.mp3' }]).size, 0, 'a count that does not match moves nothing');
  assert.equal(narrationAtFor(film(), 'line-2.mp3'), 'T.yard + 0.5');
});

test('a move writes the narration module whole, and refuses a module stored in parts', () => {
  const write = narrationAtWrite(film(), 'line-1.mp3', '1.5', '2');
  assert.ok(write !== null);
  assert.equal(write.path, 'modules/narration.js');
  assert.ok('text' in write.data && write.data.text.includes('{ at: 2, dur: 2, text: "Hello there"'));
  assert.equal(narrationAtWrite(film(), 'line-1.mp3', '9', '2'), null, 'the code no longer reads what was moved');
  assert.equal(narrationAtWrite(film(MODULE_TEXT, { parts: 2 }), 'line-1.mp3', '1.5', '2'), null);
});

test('leaving out the starts makes films that differ only in times alike', () => {
  const moved = narrationAtWrite(film(), 'line-1.mp3', '1.5', '3');
  assert.ok(moved !== null && 'text' in moved.data);
  const a = withoutNarrationAts(film());
  const b = withoutNarrationAts(film(moved.data.text));
  assert.equal(a.modules[0]!.text, b.modules[0]!.text);
});
