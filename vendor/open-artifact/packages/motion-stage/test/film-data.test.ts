import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { PlaySeconds } from '@open-artifact/motion-core';
import { captionCues, readNarration } from '../src/runtime/captions.ts';
import { cardInk, DARK_INK, LIGHT_INK } from '../src/runtime/scenes/card.ts';
import { readScenes } from '../src/runtime/scenes/read.ts';
import { recordScore } from '../src/runtime/score.ts';
import { fromBase64, offlineDataText, readOfflineData, toBase64 } from '../src/offline/data.ts';
import type { StageFilm } from '../src/protocol.ts';

const errors: string[] = [];
const originalError = console.error;
beforeEach(() => {
  errors.length = 0;
  console.error = (...parts: unknown[]): void => {
    errors.push(parts.map(String).join(' '));
  };
});
afterEach(() => {
  console.error = originalError;
});

test('scenes.json is read with its defaults, or refused in one sentence', () => {
  const read = readScenes(JSON.stringify({ v: 1, stage: 'rough', scenes: [{ id: 'intro', dur: 3 }, { id: 'demo', name: '  Demo  ', dur: 5 }] }));
  assert.equal(read.width, 1920);
  assert.equal(read.fps, 60);
  assert.deepEqual(read.scenes, [
    { id: 'intro', name: 'intro', dur: 3 },
    { id: 'demo', name: 'Demo', dur: 5 },
  ]);
  assert.throws(() => readScenes('{}'), /^Error: scenes\.json: must be JSON/);
  assert.throws(() => readScenes(JSON.stringify({ v: 1, stage: 'final', scenes: [{ id: 'Intro', dur: 1 }] })), /needs an "id"/);
  assert.throws(() => readScenes(JSON.stringify({ v: 1, stage: 'final', scenes: [{ id: 'a', dur: 1 }, { id: 'a', dur: 1 }] })), /two scenes are called a/);
  assert.throws(() => readScenes(JSON.stringify({ v: 1, stage: 'final', scenes: [{ id: 'a', dur: 20_000 }, { id: 'b', dur: 20_000 }] })), /add up to 40000 s/);
});

test('a card takes the ink that stands out more on its ground', () => {
  assert.equal(cardInk([0, 0, 0]), LIGHT_INK);
  assert.equal(cardInk([255, 255, 255]), DARK_INK);
  assert.equal(cardInk([20, 30, 120]), LIGHT_INK);
});

test('the score recorder lays notes on the beat grid and reads pitch names', () => {
  const score = recordScore((S) => {
    S.tempo(120);
    S.program('lead', 'pluck', { pan: -0.5 });
    S.note('lead', 'A4', { beat: 2, beats: 1 });
    S.chord('pad', ['C4', 'E4', 'G4'], { t: 0, dur: 2 });
    S.fx('whoosh', 1.5, { into: 0.3, rate: 2 });
    S.note('lead', 'H9', { t: 0 });
    S.master({ gain: 2, loudness: false });
  });
  const lead = score.events.find((event) => event.patch === 'pluck');
  assert.deepEqual(lead && [lead.t, lead.dur, lead.midi, lead.params], [1, 0.5, 69, { pan: -0.5 }]);
  assert.deepEqual(
    score.events.filter((event) => event.patch === 'pad').map((event) => event.midi),
    [60, 64, 67],
  );
  assert.deepEqual(score.events.find((event) => event.kind === 'fx')?.params, { into: 0.3, rate: 2 });
  assert.deepEqual(score.master, { gain: 2, fadeOut: 1, loudness: null });
  assert.ok(score.events.every((event, i) => event.t >= (score.events[i - 1]?.t ?? 0)));
  assert.match(errors[0] ?? '', /1 pitch could not be read.*"H9"/);
});

test('narration lines outside the film or its limits are left out and named', () => {
  const read = readNarration(
    {
      lines: [
        { at: 1, dur: 2, text: 'Hello there', audio: 'a.mp3' },
        { at: 50, dur: 2, text: 'Too late', audio: 'b.mp3' },
        { at: 2, dur: 99, text: 'Too long', audio: 'c.mp3' },
      ],
      duck: 0.4,
      captions: { style: 'bottom' },
    },
    10,
    { maxLines: 10, maxLineSeconds: 30 },
  );
  assert.equal(read?.lines.length, 1);
  assert.equal(read?.duck, 0.4);
  assert.deepEqual(read?.captions, { style: 'bottom' });
  assert.equal(errors.length, 2);
  assert.equal(readNarration({ lines: [], captions: false }, 10, { maxLines: 1, maxLineSeconds: 1 })?.captions, false);
  assert.equal(readNarration('nothing', 10, { maxLines: 1, maxLineSeconds: 1 }), null);
});

test('a long caption shows in parts of about equal length, each for its share of the time', () => {
  const words = Array.from({ length: 30 }, (_, i) => 'word' + i).join(' ');
  const cues = captionCues([{ at: 2 as PlaySeconds, dur: 6, text: words, audio: 'a.mp3' }]);
  assert.ok(cues.length >= 3);
  assert.ok(cues.every((cue) => cue.text.length <= 90));
  assert.equal(cues.map((cue) => cue.text).join(' '), words);
  assert.equal(cues[0]?.from, 2);
  assert.ok(Math.abs((cues[cues.length - 1]?.to ?? 0) - 8) < 1e-9);
  assert.ok(cues.every((cue, i) => i === 0 || cue.from >= (cues[i - 1]?.from ?? 0)));
});

test('a standalone page carries its film as script-safe JSON, bytes and all', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]).buffer;
  assert.deepEqual(new Uint8Array(fromBase64(toBase64(bytes))), new Uint8Array(bytes));
  const film: StageFilm = {
    script: 'window.CUT = { duration: 1, render() {} }; // </script><!--',
    modules: [],
    assets: [
      { name: 'dot.png', mime: 'image/png', w: 1, h: 1, bytes },
      { name: 'clip.mp4', mime: 'video/mp4', w: 2, h: 2, url: 'clip.mp4' },
    ],
    faces: null,
    narration: null,
    clippedTextWaitMs: 0,
    mode: 'final',
  };
  const text = offlineDataText(film);
  assert.ok(!text.includes('</'));
  assert.ok(!text.includes('<!--'));
  const read = readOfflineData(text);
  assert.ok(typeof read !== 'string');
  assert.equal(read.script, film.script);
  const first = read.assets[0];
  assert.ok(first?.bytes);
  assert.deepEqual(new Uint8Array(first.bytes), new Uint8Array(bytes));
  assert.equal(read.assets[1]?.url, 'clip.mp4');
  assert.equal(readOfflineData('{"version":2}'), 'the film data is not version 1');
  assert.equal(readOfflineData(text.replace('"mode":"final"', '"mode":"draft"')), 'the film data is not a film the stage can load');
});
