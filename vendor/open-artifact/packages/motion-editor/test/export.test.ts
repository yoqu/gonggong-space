import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILM_SHAPES, playSeconds } from '@open-artifact/motion-core';
import { HOST_SAVE_MAX_BYTES, deliveryRoute } from '../src/export/deliver.ts';
import { StageFrameError, StageGoneError } from '../src/engine/frame-errors.ts';
import { frameFailure } from '../src/export/frame-source.ts';
import {
  asksFirst,
  canMakeSmaller,
  defaultVideoOptions,
  describeEstimate,
  fitVideoOptions,
  formatDuration,
  formatFileSize,
  frameRates,
  gifSizeAdvice,
  heldWhere,
  progressPercent,
  smallerVideoOptions,
  suggestsHalfRate,
  unfinishedNote,
} from '../src/export/options.ts';
import { chosenShape, otherShapeIds, ownShapeLabel, ratioOf, shapeIdOf, typedStart } from '../src/export/shapes.ts';
import * as words from '../src/export/words.ts';

const wide = { width: 1920, height: 1080 };
const MB = 1_048_576;

test('ratios read in lowest terms, or as people say them', () => {
  assert.equal(ratioOf(wide), '16:9');
  assert.equal(ratioOf({ width: 1080, height: 1350 }), '4:5');
  assert.equal(ratioOf({ width: 2520, height: 1080 }), '21:9');
  assert.equal(ratioOf({ width: 1280, height: 800 }), '16:10');
  assert.equal(ratioOf({ width: 0, height: 10 }), '');
});

test('a film knows its named shape and offers the others', () => {
  assert.equal(shapeIdOf(wide), 'wide');
  assert.equal(shapeIdOf({ width: 1000, height: 1000 }), 'square');
  assert.equal(shapeIdOf({ width: 1000, height: 300 }), null);
  assert.deepEqual(otherShapeIds(wide), ['vertical', 'square', 'portrait']);
  assert.equal(ownShapeLabel(wide), words.shapeLabel('Wide', '16:9'));
  assert.equal(ownShapeLabel({ width: 2520, height: 1080 }), '21:9');
});

test('a shape choice makes another shape, nothing, or cannot be made', () => {
  assert.equal(chosenShape({ kind: 'own' }, wide), null);
  assert.equal(chosenShape({ kind: 'named', id: 'wide' }, wide), null);
  assert.deepEqual(chosenShape({ kind: 'named', id: 'square' }, wide), FILM_SHAPES.square);
  assert.equal(chosenShape({ kind: 'typed', across: 32, down: 18 }, wide), null);
  assert.equal(chosenShape({ kind: 'typed', across: 10, down: 1 }, wide), 'unusable');
  const typed = chosenShape({ kind: 'typed', across: 3, down: 2 }, wide);
  assert.ok(typed !== null && typed !== 'unusable');
  assert.equal(typed.ratio, '3:2');
});

test('a typed ratio starts turned from the film’s own', () => {
  assert.deepEqual(typedStart(wide), { kind: 'typed', across: 9, down: 16 });
  assert.deepEqual(typedStart({ width: 500, height: 500 }), { kind: 'typed', across: 4, down: 3 });
});

test('frame rates offer a quarter only at 12 fps or more', () => {
  assert.deepEqual(frameRates(60), { full: 60, half: 30, quarter: 15 });
  assert.deepEqual(frameRates(30), { full: 30, half: 15, quarter: null });
  assert.deepEqual(frameRates(24), { full: 24, half: 12, quarter: null });
});

test('video picks start at 720p, full rate, High and 2×, and keep only rates the film offers', () => {
  const picks = defaultVideoOptions(30);
  assert.deepEqual(picks, { height: 720, fps: 30, quality: 'high', supersample: true });
  assert.equal(fitVideoOptions({ ...picks, fps: 15 }, 30).fps, 15);
  assert.equal(fitVideoOptions({ ...picks, fps: 20 }, 60).fps, 60);
});

test('smaller settings are 720p and Low, at half the rate over 30 fps', () => {
  const big = { height: 1080 as const, fps: 60, quality: 'high' as const, supersample: true };
  assert.deepEqual(smallerVideoOptions(big, 60), { ...big, height: 720, fps: 30, quality: 'low' });
  assert.equal(smallerVideoOptions({ ...big, fps: 30 }, 30).fps, 30);
  assert.equal(canMakeSmaller(big, 60), true);
  assert.equal(canMakeSmaller({ height: 720, fps: 30, quality: 'low', supersample: false }, 30), false);
});

test('a long export is asked about first, and a very long one at full rate advises half', () => {
  const picks = defaultVideoOptions(30);
  assert.equal(asksFirst(null), false);
  assert.equal(asksFirst({ seconds: 30 }), false);
  assert.equal(asksFirst({ seconds: 41 }), true);
  assert.equal(suggestsHalfRate({ seconds: 120 }, picks, 30), true);
  assert.equal(suggestsHalfRate({ seconds: 120 }, { ...picks, fps: 15 }, 30), false);
  assert.equal(suggestsHalfRate({ seconds: 60 }, picks, 30), false);
});

test('sizes, times and estimates read as the dialog says them', () => {
  assert.equal(formatFileSize(512), '1 KB');
  assert.equal(formatFileSize(3.25 * MB), '3.3 MB');
  assert.equal(formatDuration(20), words.UNDER_A_MINUTE);
  assert.equal(formatDuration(150), words.aboutMinutes(3));
  const picks = defaultVideoOptions(30);
  const said = describeEstimate('video', { bytes: 2 * MB, seconds: 120, label: 'MP4' }, picks, 30, 50 * MB);
  assert.equal(said, `${words.upTo('2.0 MB')} · ${words.aboutMinutes(2)}. ${words.halfRateTip(15)}`);
  const gif = describeEstimate('gif', { bytes: 60 * MB, seconds: 10, label: 'GIF', atLeast: true }, picks, 30, 50 * MB);
  assert.equal(gif, words.atLeast('60.0 MB'));
});

test('a large GIF is advised against, with the way out', () => {
  assert.equal(gifSizeAdvice(5 * MB, 10 * MB, 50 * MB, 'standard', true), '');
  assert.equal(gifSizeAdvice(20 * MB, 10 * MB, 50 * MB, 'standard', true), `${words.GIF_LARGE} ${words.TRY_SMALL}`);
  assert.equal(gifSizeAdvice(60 * MB, 10 * MB, 50 * MB, 'small', false), words.gifOverLimit(50));
  assert.equal(gifSizeAdvice(20 * MB, 10 * MB, 50 * MB, 'standard', false), `${words.GIF_LARGE} ${words.TRY_SMALL_ONLY}`);
});

test('an unfinished film says so', () => {
  assert.equal(unfinishedNote(null), null);
  assert.equal(unfinishedNote([{ id: 'a', state: 'final' }]), null);
  assert.equal(unfinishedNote([{ id: 'a', state: 'rough' }]), words.ROUGH_CUT);
  assert.equal(unfinishedNote([{ id: 'a', state: 'todo' }, { id: 'b', state: 'todo' }, { id: 'c', state: 'rough' }]), words.scenesMissing(2));
});

test('held frames say where they were, and progress stays in 0 to 100', () => {
  assert.equal(heldWhere({ count: 0, total: 10 }), '');
  assert.match(heldWhere({ count: 1, total: 10, first: { t: playSeconds(2), message: 'x' } }), /^at /);
  assert.match(heldWhere({ count: 3, total: 10, first: { t: playSeconds(2), message: 'x' }, last: playSeconds(9) }), /^between /);
  assert.equal(progressPercent(5, 10), 50);
  assert.equal(progressPercent(5, 0), 0);
  assert.equal(progressPercent(12, 10), 100);
});

test('a failed pull is read as no film, a held frame, or the browser’s doing', () => {
  assert.deepEqual(frameFailure(new StageGoneError('no film on the stage')), { kind: 'unloaded' });
  assert.deepEqual(frameFailure(new Error('boom')), { kind: 'failed', message: 'boom', hold: true, env: false });
  const late = new StageFrameError('no answer in time', { hold: true, env: true });
  assert.deepEqual(frameFailure(late), { kind: 'failed', message: 'no answer in time', hold: true, env: true });
  assert.deepEqual(frameFailure(new StageFrameError('scene threw', { hold: false, env: false })), { kind: 'failed', message: 'scene threw', hold: false, env: false });
});

test('a file over the host’s limit goes to the browser', () => {
  assert.equal(HOST_SAVE_MAX_BYTES, 512 * 1_048_576);
  assert.equal(deliveryRoute(200 * 1_048_576, true), 'host', 'a long MOV still saves through the host');
  assert.equal(deliveryRoute(HOST_SAVE_MAX_BYTES, true), 'host');
  assert.equal(deliveryRoute(HOST_SAVE_MAX_BYTES + 1, true), 'browser');
  assert.equal(deliveryRoute(10, false), 'browser');
  // A host that saves in the browser (a cloud host) has no cap of its own: a long film still goes through it.
  assert.equal(deliveryRoute(HOST_SAVE_MAX_BYTES + 1, true, true), 'host');
});
