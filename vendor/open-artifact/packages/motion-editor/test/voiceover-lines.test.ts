import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VoiceoverLine } from '@open-artifact/motion-audio';
import { filmSeconds, playSeconds, type PlaySeconds } from '@open-artifact/motion-core';
import {
  clampTo,
  keepTypedFor,
  laneSpan,
  lineBounds,
  lineKeys,
  peaksPath,
  snapVoiceTime,
  voiceChanges,
  voiceClock,
  voiceClockTenths,
  voiceWords,
  withTyped,
  wordsRoom,
} from '../src/voiceover/lines.ts';
import { shiftText } from '../src/voiceover/words.ts';

const line = (at: number, dur: number, text: string, audio: string): VoiceoverLine => ({ at: playSeconds(at), dur, text, audio, peaks: null });

test('words are compared and sent with one space, nothing unsafe and nothing invisible', () => {
  assert.equal(voiceWords('  Hello \n\t world  '), 'Hello world');
  assert.equal(voiceWords('a\u0007b‮c​d'), 'abcd');
});

test('a line is known by its take, its words and which of the same it is', () => {
  const keys = lineKeys([line(0, 1, 'Hi', 'a.mp3'), line(2, 1, 'Hi', 'a.mp3'), line(4, 1, 'Bye', 'a.mp3')]);
  assert.equal(new Set(keys).size, 3);
  assert.ok(keys[1]!.endsWith('\u00002'));
});

test('clocks show minutes and seconds, and tenths while moving', () => {
  assert.equal(voiceClock(75.9), '1:15');
  assert.equal(voiceClock(-3), '0:00');
  assert.equal(voiceClockTenths(1.25), '0:01.3');
  assert.equal(voiceClockTenths(59.96), '1:00.0');
});

test('changes are the lines whose typed words differ, with their film time', () => {
  const lines = [line(1, 2, 'One line', 'a.mp3'), line(4, 2, 'Two', 'b.mp3')];
  const keys = lineKeys(lines);
  const toFilm = (t: PlaySeconds) => filmSeconds(t * 2);
  const typed = { [keys[0]!]: ' One   line ', [keys[1]!]: '' };
  const changes = voiceChanges(lines, typed, toFilm);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0]!.change, { at: 8, audio: 'b.mp3', was: 'Two', words: '' });
});

test('typed words go with their lines and come back on reset', () => {
  const typed = withTyped({}, 'k1', 'new');
  assert.deepEqual(typed, { k1: 'new' });
  assert.deepEqual(withTyped(typed, 'k1', undefined), {});
  assert.equal(keepTypedFor(typed, ['k1']), typed);
  assert.deepEqual(keepTypedFor({ k1: 'a', k2: 'b' }, ['k2']), { k2: 'b' });
});

test('a moved line keeps a gap from its neighbours and ends before the film does', () => {
  const lines = [line(0, 2, 'a', 'a'), line(5, 2, 'b', 'b'), line(10, 2, 'c', 'c')];
  const [low, high] = lineBounds(lines, 1, 20);
  assert.equal(low, 2.3);
  assert.ok(Math.abs(high - 7.7) < 1e-9);
  const last = lineBounds(lines, 2, 12);
  assert.equal(last[1], 10, 'a line already past the end may stay where it is');
  assert.equal(clampTo([2.3, 7.7], 9), 7.7);
  assert.equal(snapVoiceTime(3.1234), 3.1);
  assert.equal(snapVoiceTime(3.13), 3.15);
});

test('the lane places blocks and words, and draws peaks as an outline', () => {
  assert.deepEqual(laneSpan(5, 2, 20), { left: '25%', width: 'calc(10% - 2px)' });
  assert.equal(wordsRoom([0, 5, 10], 0, 2, 20), 5);
  assert.equal(wordsRoom([0, 5, 10], 2, 2, 20), 10);
  assert.equal(wordsRoom([0, 1], 0, 2, 20), 2);
  assert.equal(peaksPath([0.5, 1]), 'M0 1L0.5 0.5L1.5 0L2 1Z');
  assert.equal(shiftText(-0.4), '0.4 s earlier');
  assert.equal(shiftText(1.25), '1.25 s later');
});
