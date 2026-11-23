import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FilmSeconds, PlaySeconds } from '@open-artifact/motion-core';
import type { PlayedScore } from '../src/protocol.ts';
import { readCut } from '../src/runtime/cut.ts';
import { scoreReport, toolsFilm } from '../src/tools.ts';

const ID = 'ab'.repeat(16);
const documents = (): Record<string, unknown> => ({
  'film/meta': JSON.stringify({ v: 1, title: 'Spring', updatedAt: '' }),
  'film/script': { code: 'window.CUT = kit.scenes();' },
  'modules/scene-a.js': JSON.stringify({ kind: 'js', text: "kit.css('.a{color:#3366cc}');" }),
  'modules/recolored.json': JSON.stringify({ kind: 'json', text: JSON.stringify({ v: 1, colors: [{ was: '#3366cc', v: '#ff8800' }] }) }),
  'modules/retouched.json': JSON.stringify({ kind: 'json', text: JSON.stringify({ v: 1, layers: [] }) }),
  'assets/dot.png': JSON.stringify({ ref: '/_blob/' + ID, mime: 'image/png', w: 2, h: 2 }),
  'assets/clip.mp4': JSON.stringify({ ref: '_blob/' + ID, mime: 'video/mp4' }),
  'assets/gone.png': JSON.stringify({ ref: '/_blob/' + 'cd'.repeat(16), mime: 'image/png' }),
});

test('toolsFilm reads the db layout, applies colors, keeps retouched.json and reports what it cannot have', () => {
  const read = toolsFilm({ documents: documents(), blobs: { [ID]: 'AAEC' } });
  assert.equal(read.title, 'Spring');
  assert.ok(read.film);
  assert.equal(read.film.mode, 'final');
  assert.equal(read.film.script, 'window.CUT = kit.scenes();');
  assert.match(read.film.modules.find((module) => module.name === 'scene-a.js')?.text ?? '', /#ff8800/);
  assert.ok(read.film.modules.some((module) => module.name === 'retouched.json'));
  const dot = read.film.assets.find((asset) => asset.name === 'dot.png');
  assert.deepEqual([...new Uint8Array(dot?.bytes ?? new ArrayBuffer(0))], [0, 1, 2]);
  assert.equal(read.film.assets.find((asset) => asset.name === 'clip.mp4')?.url, 'data:video/mp4;base64,AAEC');
  assert.deepEqual(read.problems, ['The asset gone.png could not be loaded (_blob/' + 'cd'.repeat(16) + ' was not given).']);
});

test('toolsFilm refuses a film with no code, and names a document that is not JSON', () => {
  const read = toolsFilm({ documents: { 'film/meta': '{"v":1,"title":"x","updatedAt":""}', 'modules/a.js': '{oops' }, mode: 'rough' });
  assert.equal(read.film, null);
  assert.match(read.problems[0] ?? '', /no code/);
  assert.ok(read.problems.includes('db/modules/a.js.json is not JSON; the player ignores it.'));
});

test('scoreReport counts events by kind and names patches with no voice', () => {
  const at = (t: number): PlaySeconds => t as PlaySeconds;
  const score: PlayedScore = {
    events: [
      { t: at(0.5), dur: 0.5, kind: 'note', patch: 'marimba', midi: 60, vel: 60 },
      { t: at(1), dur: 0.1, kind: 'drum', patch: 'kick', midi: 36, vel: 90 },
      { t: at(2), dur: 1, kind: 'fx', patch: 'kazoo', midi: 60, vel: 50 },
    ],
    master: { gain: 0, fadeOut: 0 },
    tempo: { bpm: 96, t0: 0 as FilmSeconds },
  };
  const report = scoreReport(score, { lines: [{ at: at(0), dur: 2.5, text: 'Hi', audio: 'hi.wav' }], duck: null });
  assert.deepEqual(report, {
    events: 3,
    notes: 1,
    drums: 1,
    fx: 1,
    unknown: ['fx:kazoo'],
    first: 0.5,
    last: 3,
    tempo: { bpm: 96, t0: 0 },
    narration: { lines: 1, seconds: 2.5 },
  });
  assert.deepEqual(scoreReport(null, null), { events: 0, notes: 0, drums: 0, fx: 0, unknown: [], first: 0, last: 0, tempo: null, narration: null });
});

test('the cut reads its score and narration when asked, so a film of scenes can set them in init', () => {
  const given: Record<string, unknown> = { duration: 4, render() {} };
  const cut = readCut(given);
  assert.ok(typeof cut !== 'string');
  assert.equal(cut.score, null);
  given['score'] = () => 'scored';
  given['narration'] = ['line'];
  assert.equal(typeof cut.score, 'function');
  assert.deepEqual(cut.narration, ['line']);
});
