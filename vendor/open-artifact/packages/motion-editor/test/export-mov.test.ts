import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOV_SETTINGS } from '@open-artifact/motion-export';
import type { ExportEstimate } from '@open-artifact/motion-export';
import { defaultVideoOptions, describeEstimate, hasClearBackground, movBlocked, movSizeAdvice, offeredFormats } from '../src/export/options.ts';
import * as words from '../src/export/words.ts';

const film = { width: 1920, height: 1080, fps: 60, duration: 20 };
const MB = 1_048_576;

const movEstimate = (bytesPerSecond: number, budget = 40 * MB): ExportEstimate => ({
  bytes: bytesPerSecond * film.duration,
  seconds: 30,
  label: 'MOV',
  mov: { bytesPerSecond, budget, maxBytes: MOV_SETTINGS.maxBytes },
});

test('MOV is offered next to MP4 and GIF only while its flag is on', () => {
  assert.deepEqual(offeredFormats({ movExport: true }), ['video', 'gif', 'mov', 'zip', 'html']);
  assert.deepEqual(offeredFormats({ movExport: false }), ['video', 'gif', 'zip', 'html']);
  assert.equal(words.FORMAT_LABELS.mov, 'MOV');
});

test('a clear background is told apart from a coloured or pictured one', () => {
  assert.equal(hasClearBackground(['rgba(0, 0, 0, 0)', 'none']), true);
  assert.equal(hasClearBackground(['transparent', 'none']), true);
  assert.equal(hasClearBackground(['rgb(255, 255, 255)', 'none']), false);
  assert.equal(hasClearBackground(['rgba(0, 0, 0, 0)', 'linear-gradient(red, blue)']), false);
  assert.equal(hasClearBackground(undefined), false);
});

test('a MOV estimate is said per second of movement', () => {
  const options = { ...defaultVideoOptions(60), fps: 60 };
  assert.equal(describeEstimate('mov', movEstimate(3 * MB), options, 60, 0), 'About 3.0 MB per second of movement · under a minute');
});

test('a MOV over the limit says where it stops and how it could fit', () => {
  const at1080 = { height: 1080 as const, fps: 60 };
  assert.equal(movSizeAdvice(movEstimate(1 * MB), at1080, film), null, 'twenty seconds at 1 MB fit under 40 MB');
  const over = movSizeAdvice(movEstimate(4 * MB), at1080, film);
  assert.deepEqual(over, { warning: 'The export stops at the 50 MB limit, about 10 seconds of movement.', suggestion: words.MOV_TRY_720_OR_RATE });
  assert.equal(movSizeAdvice(movEstimate(4 * MB), { height: 720, fps: 60 }, film)?.suggestion, words.MOV_TRY_RATE);
  assert.equal(movSizeAdvice(movEstimate(4 * MB), { height: 720, fps: 15 }, film)?.suggestion, words.MOV_SHORTER_OR_STILLER);
  assert.equal(movSizeAdvice(movEstimate(80 * MB), { height: 720, fps: 15 }, film)?.warning, 'The export stops at the 50 MB limit, under a second of movement.');
  const full = movEstimate(1 * MB, -5);
  assert.deepEqual(movSizeAdvice(full, at1080, film), { warning: words.movSoundFills(50), suggestion: words.MOV_SHORTER });
  assert.equal(movBlocked(full), true);
  assert.equal(movBlocked(movEstimate(1 * MB)), false);
  assert.equal(movBlocked(null), false);
});

test('held frames in a MOV that start the film are clear', () => {
  assert.equal(
    words.heldFrames(1, 10, 'at 0:00', 'video', true),
    '1 of 10 frames (at 0:00) hit an error in the animation’s code, so the video repeats the previous frame there (transparent at the very start).',
  );
});
