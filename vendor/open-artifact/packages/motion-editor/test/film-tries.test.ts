import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmModule } from '@open-artifact/motion-core';
import { applyFilmRecords, failedTryNote, filmTryCodes, recordsHeld } from '../src/engine/applied-film.ts';

const json = (name: string, value: unknown): FilmModule => ({ name, kind: 'json', text: JSON.stringify(value) });
const SCRIPT = "const title = 'Hello there world'; ctx.fillStyle = '#ff0000';";
const film = { script: SCRIPT, modules: [json('scenes.json', { v: 1, scenes: [] })] };
const lines = { lines: [{ was: 'Hello there world', v: 'Hi all' }] };
const colors = { colors: [{ was: '#ff0000', v: '#00ff00' }] };

test('a film with lines and colors is tried with both, then the lines alone, then as written', () => {
  const tries = filmTryCodes(film, { retyped: lines, recolored: colors });
  assert.deepEqual(
    tries.map((tried) => [tried.lines, tried.colors, tried.script]),
    [
      [true, true, "const title = 'Hi all'; ctx.fillStyle = '#00ff00';"],
      [true, false, "const title = 'Hi all'; ctx.fillStyle = '#ff0000';"],
      [false, false, SCRIPT],
    ],
  );
  assert.equal(tries[2]!.modules, film.modules);
});

test('records the code no longer says give no try of their own', () => {
  const gone = { colors: [{ was: '#123456', v: '#00ff00' }] };
  assert.deepEqual(recordsHeld(applyFilmRecords(film, { retyped: null, recolored: gone })), { lines: false, colors: false, unreadLines: false });
  assert.equal(filmTryCodes(film, { retyped: null, recolored: gone }).length, 1);
  assert.equal(filmTryCodes(film, { retyped: null, recolored: colors }).length, 2);
});

test('the console says what the next try leaves out', () => {
  assert.match(failedTryNote({ lines: true, colors: true }, { lines: true, colors: false }), /retyped lines .* and colors .*tried without the colors/);
  assert.match(failedTryNote({ lines: false, colors: true }, { lines: false, colors: false }), /runs as written.*pick another palette/);
  assert.match(failedTryNote({ lines: true, colors: false }, { lines: false, colors: false }), /reset the words in Tweaks/);
});
