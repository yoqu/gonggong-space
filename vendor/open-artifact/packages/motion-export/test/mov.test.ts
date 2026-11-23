import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playSeconds } from '@open-artifact/motion-core';
import { MovTooLargeError } from '../src/errors.ts';
import type { ExportSurface } from '../src/gif/surface.ts';
import { createMovProbe, movSeconds } from '../src/mov/estimate.ts';
import { MOV_SETTINGS, STEREO_PCM_BYTES_PER_SECOND, estimateMovHeaderBytes, movByteLimitMebibytes, movFrameBudget, planMovFrames, storesWholeFrames } from '../src/mov/plan.ts';

const film = { title: 'Film', width: 1920, height: 1080, fps: 30, duration: playSeconds(10) };

test('a MOV plan takes the video heights and never a faster rate than the film', () => {
  assert.deepEqual(planMovFrames(film, { height: 720 }), { width: 1280, height: 720, fps: 30, frames: 300 });
  assert.deepEqual(planMovFrames(film, { height: 1080, fps: 60 }), { width: 1920, height: 1080, fps: 30, frames: 300 });
  assert.deepEqual(planMovFrames(film, { height: 999, fps: 15 }), { width: 1920, height: 1080, fps: 15, frames: 150 });
  assert.equal(planMovFrames({ ...film, duration: playSeconds(0) }, {}).frames, 1);
});

test('the frames get what the atoms and the sound leave under 50 MB', () => {
  assert.equal(MOV_SETTINGS.maxBytes, 50 * 1_048_576);
  assert.equal(estimateMovHeaderBytes(300), 300 * 16 + 16_384);
  assert.equal(movFrameBudget(300, 0), MOV_SETTINGS.maxBytes - estimateMovHeaderBytes(300));
  assert.ok(movFrameBudget(300, 300 * STEREO_PCM_BYTES_PER_SECOND) <= 0, 'five minutes of PCM leave no room');
  assert.equal(movByteLimitMebibytes(MOV_SETTINGS.maxBytes), 50);
  assert.equal(movByteLimitMebibytes(10), 1);
  assert.equal(new MovTooLargeError(MOV_SETTINGS.maxBytes).message, 'The MOV passed the 50 MB limit, so the export stopped.');
  assert.equal(storesWholeFrames(), false);
  assert.equal(storesWholeFrames({ keyEvery: 1, repeats: 'whole' }), true);
});

test('an estimate counts the busiest frame probed for each second, and the sound', () => {
  const plan = planMovFrames({ ...film, width: 32, height: 18 }, { height: 720 });
  const pictures = [new Uint8ClampedArray(32 * 18 * 4), new Uint8ClampedArray(32 * 18 * 4).map((_, index) => (index * 37) & 0xff)];
  let painted = 0;
  const surface: ExportSurface = { paint: () => void painted++, pixels: () => pictures[(painted - 1) % 2]! };
  const probe = createMovProbe(plan, film.duration, surface);
  const bitmap = {} as ImageBitmap;
  probe.add(bitmap);
  probe.add(bitmap);
  const silent = probe.measure(false);
  const loud = probe.measure(true);
  probe.dispose();
  assert.ok(silent.bytesPerSecond > 30 * 32 * 18 * 4 * 0.5, 'noise hardly compresses');
  assert.equal(silent.bytes, Math.round(estimateMovHeaderBytes(plan.frames) + silent.bytesPerSecond * 10));
  assert.equal(loud.bytes - silent.bytes, 10 * STEREO_PCM_BYTES_PER_SECOND);
  assert.equal(loud.budget, movFrameBudget(plan.frames, 10 * STEREO_PCM_BYTES_PER_SECOND));
  assert.equal(movSeconds(300, 20, 5, 10, true), Math.round((300 * 25 + 2500) / 1000 + 1));
});
