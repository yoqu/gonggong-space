import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ceilToFrame, floorCentiseconds, formatPlaybackTime, formatPosition, formatTenthsTime, snapToFrame, spokenPosition } from '../src/transport/time-format.ts';
import { nextChapterStart, pageSeek, previousChapterStart, seekedBy, steppedFrames } from '../src/keyboard/seek.ts';
import { canSendRender, createRenderGate, markHeld, markPresented, markSent, resetGate } from '../src/engine/render-gate.ts';
import { fitBox, pictureFraction } from '../src/player/fit.ts';
import { DEFAULT_PREFERENCES, parsePreferences } from '../src/stores/preferences.ts';

test('times show as m:ss, a hair under a second rounding up', () => {
  assert.equal(formatPlaybackTime(0), '0:00');
  assert.equal(formatPlaybackTime(2.9999999), '0:03');
  assert.equal(formatPlaybackTime(65.4), '1:05');
  assert.equal(formatPlaybackTime(Number.NaN), '0:00');
  assert.equal(formatTenthsTime(12.34), '0:12.3');
  assert.equal(floorCentiseconds(1.239), 1.23);
  assert.equal(formatPosition(3, 12), '0:03 / 0:12');
  assert.equal(spokenPosition(3.5, 12, 'Intro'), '3 of 12 seconds, Intro');
  assert.equal(spokenPosition(3.5, 12, null), '3 of 12 seconds');
});

test('frames snap at the film rate, with 60 for a missing one', () => {
  assert.equal(snapToFrame(1.01, 30), 1);
  assert.equal(ceilToFrame(1.01, 30), 31 / 30);
  assert.equal(ceilToFrame(1, 30), 1);
  assert.equal(snapToFrame(0.5 / 60 + 0.0001, 0), 1 / 60);
});

test('seeking clamps to the film and steps whole frames', () => {
  assert.equal(seekedBy(3, -5, 10), 0);
  assert.equal(seekedBy(8, 5, 10), 10);
  assert.equal(steppedFrames(1, 1, 30, 10), 31 / 30);
  assert.equal(steppedFrames(0, -1, 30, 10), 0);
});

test('page keys go chapter to chapter, or ten seconds without chapters', () => {
  const starts = [0, 4, 8];
  assert.equal(nextChapterStart(4, starts, 30, 12), 8);
  assert.equal(nextChapterStart(9, starts, 30, 12), 12);
  assert.equal(previousChapterStart(8, starts, 30), 4);
  assert.equal(previousChapterStart(8.5, starts, 30), 8);
  assert.equal(pageSeek(2, 1, [], 30, 30), 12);
  assert.equal(pageSeek(5, -1, starts, 30, 12), 4);
});

test('the render gate holds renders past two unshown, and lets the held one go', () => {
  const gate = createRenderGate();
  assert.equal(canSendRender(gate), true);
  markSent(gate, 1);
  markSent(gate, 2);
  assert.equal(canSendRender(gate), false);
  markHeld(gate);
  assert.equal(markPresented(gate, 1), true);
  assert.equal(markPresented(gate, 1), false);
  markSent(gate, 3);
  assert.equal(gate.waiting, false);
  resetGate(gate, 10);
  assert.equal(canSendRender(gate), true);
  assert.equal(markPresented(gate, 9), false);
});

test('the picture letterboxes in the player', () => {
  assert.deepEqual(fitBox({ width: 1000, height: 1000 }, { width: 1920, height: 1080 }), { left: 0, top: 219, width: 1000, height: 563 });
  assert.deepEqual(fitBox({ width: 0, height: 100 }, { width: 1920, height: 1080 }), { left: 0, top: 0, width: 0, height: 100 });
  const box = { left: 10, top: 20, width: 100, height: 50 };
  assert.deepEqual(pictureFraction(box, 60, 45), { x: 0.5, y: 0.5 });
  assert.equal(pictureFraction(box, 5, 45), null);
});

test('preferences read leniently', () => {
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences('not json'), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences('{"loop":true,"volume":3}'), { loop: true, volume: 1 });
  assert.deepEqual(parsePreferences('{"loop":"yes","volume":0.4}'), { loop: false, volume: 0.4 });
});
