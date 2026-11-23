import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds } from '@open-artifact/motion-core';
import { FrameRenderError } from '../src/errors.ts';
import { gifProbeTimes, gifSeconds, probeFrames, videoSeconds } from '../src/estimate.ts';
import { createGifEstimator, gifMeasureOf } from '../src/gif/estimator.ts';
import type { GifMeasureTools } from '../src/gif/estimator.ts';
import type { ExportSurface } from '../src/gif/surface.ts';
import type { GifPlan } from '../src/plan.ts';
import type { ExportFrame } from '../src/types.ts';

const fakeBitmap = (): ImageBitmap => ({ close: () => undefined }) as unknown as ImageBitmap;

test('estimated seconds add a second to finish', () => {
  assert.equal(videoSeconds(300, 20, 10, false), 7);
  assert.equal(videoSeconds(300, 20, 10, true), 10);
  assert.equal(gifSeconds(100, 15, 5), 3);
});

test('GIF probes come in pairs one frame apart, never past the end', () => {
  assert.deepEqual(gifProbeTimes([0.5, 1], 10, 20), [5, 5.05, 10, 10]);
});

test('a GIF guess is the largest first frame plus the average change for each later frame', () => {
  assert.deepEqual(gifMeasureOf({ largestFirst: 1000, seconds: 300, firsts: 1500, encodeMs: 60, pairs: 3, frames: 11 }), { bytes: 2000, msPerFrame: 10 });
});

test('a GIF guess below what the first frames alone came to is a floor', () => {
  assert.deepEqual(gifMeasureOf({ largestFirst: 1000, seconds: 0, firsts: 2500, encodeMs: 60, pairs: 3, frames: 3 }), {
    bytes: 2500,
    msPerFrame: 10,
    atLeast: true,
  });
});

test('the estimator measures pairs, and sees where the film rests', async () => {
  const plan: GifPlan = { width: 2, height: 2, fps: 10, frames: 21, delayCs: 10 };
  let painted: number[] = [0, 0, 0, 0];
  const surface = (): ExportSurface => ({
    paint: (image) => {
      painted = image === null ? [0, 0, 0, 0] : [Number(image), 0, 0, 255];
    },
    pixels: () => Uint8ClampedArray.from(painted),
  });
  const tools: GifMeasureTools = {
    palette: () => new Uint8Array(3),
    encoder: () => {
      let frames = 0;
      return { add: () => (++frames === 1 ? 100 : 10), dispose: () => undefined };
    },
    yieldTask: () => Promise.resolve(),
  };
  const estimator = createGifEstimator(plan, surface, tools);
  const picture = (value: number): CanvasImageSource => value as unknown as CanvasImageSource;
  estimator.add(picture(1), 0.1, 0);
  estimator.add(picture(2), 0.1, 1);
  assert.equal(estimator.rests(), false);
  estimator.add(picture(3), 0.5, 0);
  estimator.add(picture(3), 0.5, 1);
  assert.equal(estimator.rests(), true);
  const measure = await estimator.measure();
  assert.ok(measure !== null);
  assert.equal(measure.bytes, 100 + 10 * 20);
});

test('probing skips held frames and times the good ones', async () => {
  const frame: ExportFrame = (t) => (t > 1 ? Promise.reject(new FrameRenderError('broken', t)) : Promise.resolve(fakeBitmap()));
  const used: number[] = [];
  const times: PlaySeconds[] = [0.5, 2, 1].map(playSeconds);
  const ms = await probeFrames(frame, times, { width: 2, height: 2 }, undefined, (_bitmap, index) => used.push(index));
  assert.deepEqual(used, [0, 2]);
  assert.ok(ms >= 0);
});

test('probing throws the first held frame when every frame was held', async () => {
  const frame: ExportFrame = (t) => Promise.reject(new FrameRenderError('broken at ' + t, t));
  await assert.rejects(probeFrames(frame, [playSeconds(1), playSeconds(2)], { width: 2, height: 2 }, undefined), /broken at 1/);
});

test('probing passes on what cannot be held', async () => {
  const frame: ExportFrame = (t) => Promise.reject(new FrameRenderError('gone', t, false));
  await assert.rejects(probeFrames(frame, [playSeconds(1)], { width: 2, height: 2 }, undefined), /gone/);
});
