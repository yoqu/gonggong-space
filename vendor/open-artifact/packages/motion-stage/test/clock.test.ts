import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FilmSeconds, PlaySeconds, ScoreData } from '@open-artifact/motion-core';
import { filmParts, playedScore, plainClock, sceneClock } from '../src/runtime/recut.ts';
import type { Chapter } from '../src/protocol.ts';

const film = (x: number): FilmSeconds => x as FilmSeconds;
const play = (x: number): PlaySeconds => x as PlaySeconds;
const chapters: Chapter<FilmSeconds>[] = [
  { t: film(0), label: 'Intro' },
  { t: film(4), label: 'Middle' },
  { t: film(10), label: 'End' },
];

test('the film is cut at its chapters, keyed by scene where the counts agree', () => {
  const parts = filmParts(12, chapters, ['intro', 'middle', 'end']);
  assert.deepEqual(
    parts.map((part) => [part.key, part.label, part.a0, part.nat]),
    [
      ['intro', 'Intro', 0, 4],
      ['middle', 'Middle', 4, 6],
      ['end', 'End', 10, 2],
    ],
  );
  assert.ok(filmParts(12, chapters, ['only']).every((part) => part.key === null));
  // A chapter at the very end, or with no label, cuts nothing.
  assert.equal(filmParts(12, [...chapters, { t: film(11.99), label: 'Late' }, { t: film(6), label: ' ' }], null).length, 3);
});

test('with no record the clocks are one', () => {
  const clock = plainClock(12);
  assert.equal(clock.moved, false);
  assert.equal(clock.duration, 12);
  for (const t of [0, 1.5, 4, 9.999, 12]) {
    assert.equal(clock.at(play(t)).T, t);
    assert.equal(clock.back(film(t)), t);
  }
});

test('a scene given twice its length plays at half speed, and back undoes at', () => {
  const record = JSON.stringify({ v: 1, scenes: [{ id: 'middle', dur: { was: 6, v: 12 }, name: { was: 'Middle', v: 'The middle' } }] });
  const clock = sceneClock(filmParts(12, chapters, ['intro', 'middle', 'end']), record);
  assert.equal(clock.moved, true);
  assert.equal(clock.duration, 18);
  assert.equal(clock.parts[1]?.label, 'The middle');
  assert.equal(clock.parts[1]?.own, 'Middle');
  assert.deepEqual(clock.at(play(10)), { T: 7, rate: 0.5 });
  assert.equal(clock.at(play(17)).T, 11);
  for (const T of [0, 2, 4, 7, 10, 11.5]) assert.ok(Math.abs(clock.at(clock.back(film(T))).T - T) < 1e-9);
  // Before 0 and past the end, played time runs on at normal speed.
  assert.equal(clock.back(film(-1)), -1);
  assert.equal(clock.back(film(13)), 19);
});

test('a length out of limits, or for a scene that has changed, is ignored', () => {
  const parts = filmParts(12, chapters, ['intro', 'middle', 'end']);
  const tooLong = JSON.stringify({ v: 1, scenes: [{ id: 'middle', dur: { was: 6, v: 30 } }] });
  assert.equal(sceneClock(parts, tooLong).moved, false);
  const stale = JSON.stringify({ v: 1, scenes: [{ id: 'middle', dur: { was: 5, v: 8 } }] });
  assert.equal(sceneClock(parts, stale).moved, false);
  assert.equal(sceneClock(parts, '{not json').moved, false);
});

test('lengths that would take the film past 36000 s are set aside', () => {
  const long = filmParts(24_000, [{ t: film(0), label: 'A' }, { t: film(12_000), label: 'B' }], ['a', 'b']);
  const record = JSON.stringify({ v: 1, scenes: [{ id: 'a', dur: { was: 12_000, v: 24_000 } }, { id: 'b', dur: { was: 12_000, v: 24_000 } }] });
  const clock = sceneClock(long, record);
  assert.equal(clock.aside, true);
  assert.equal(clock.moved, false);
  assert.equal(clock.duration, 24_000);
});

test('the score moves with the scenes, at the same pitch', () => {
  const record = JSON.stringify({ v: 1, scenes: [{ id: 'middle', dur: { was: 6, v: 12 } }] });
  const clock = sceneClock(filmParts(12, chapters, ['intro', 'middle', 'end']), record);
  const score: ScoreData = {
    events: [
      { t: film(1), dur: 0.5, kind: 'note', patch: 'piano', midi: 60, vel: 64 },
      { t: film(5), dur: 1, kind: 'note', patch: 'piano', midi: 64, vel: 64 },
      { t: film(11), dur: 0.2, kind: 'drum', patch: 'kick', midi: 0, vel: 90 },
    ],
    master: { gain: -6, fadeOut: 1, loudness: -16 },
  };
  const played = playedScore(score, clock);
  assert.deepEqual(
    played.events.map((event) => [event.t, Math.round(event.dur * 1e9) / 1e9, event.midi]),
    [
      [1, 0.5, 60],
      [6, 2, 64],
      [17, 0.2, 0],
    ],
  );
  assert.deepEqual(played.master, score.master);
});
