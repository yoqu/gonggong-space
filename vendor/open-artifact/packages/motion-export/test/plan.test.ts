import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playSeconds } from '@open-artifact/motion-core';
import {
  EXPORT_AUDIO_BITRATE,
  chooseVideoBitrate,
  estimateVideoBytes,
  evenDimension,
  fitExportDimensions,
  planGifFrames,
  planVideoFrames,
  resolveGifPreset,
  resolveVideoSettings,
  videoBitrateWithinBudget,
} from '../src/plan.ts';

const film = { title: 'Film', width: 1920, height: 1080, fps: 30, duration: playSeconds(10) };

test('dimensions are even and never larger than the film', () => {
  assert.equal(evenDimension(7), 8);
  assert.equal(evenDimension(0), 2);
  assert.deepEqual(fitExportDimensions({ width: 1920, height: 1080 }, 720), { width: 1280, height: 720 });
  assert.deepEqual(fitExportDimensions({ width: 1280, height: 720 }, 1080), { width: 1280, height: 720 });
  assert.deepEqual(fitExportDimensions({ width: 1080, height: 1920 }, 720), { width: 720, height: 1280 });
  const odd = fitExportDimensions({ width: 1001, height: 999 }, 500);
  assert.equal(odd.width % 2, 0);
  assert.equal(odd.height % 2, 0);
});

test('the bitrate grows with size and falls with quality', () => {
  const hd = chooseVideoBitrate({ width: 1920, height: 1080 }, 30);
  const small = chooseVideoBitrate({ width: 1280, height: 720 }, 30);
  assert.ok(hd > small);
  assert.ok(chooseVideoBitrate({ width: 1920, height: 1080 }, 30, 'low') < hd);
  assert.equal(chooseVideoBitrate({ width: 1920, height: 1080 }, 60), 8_000_000);
});

test('the budget keeps a long film within the size limit', () => {
  const maxBytes = 48 * 1_048_576;
  const bitrate = videoBitrateWithinBudget(600, maxBytes);
  assert.ok(estimateVideoBytes({ videoBitrate: bitrate }, 600, true) <= maxBytes);
});

test('settings fall back to 1080 and high quality, with the bitrate capped by the budget', () => {
  const resolved = resolveVideoSettings({ height: 900, quality: undefined }, { duration: playSeconds(600) });
  assert.equal(resolved.height, 1080);
  assert.equal(resolved.quality, 'high');
  assert.equal(resolved.supersample, false);
  assert.equal(resolved.maxVideoBitrate, videoBitrateWithinBudget(600, 48 * 1_048_576));
  assert.equal(resolveVideoSettings({ height: 720, quality: 'low', fps: 24 }, film).height, 720);
});

test('a video plan keeps to the film’s frame rate and counts every frame', () => {
  const plan = planVideoFrames(film, { height: 720, fps: 60 });
  assert.equal(plan.fps, 30);
  assert.equal(plan.frames, 300);
  assert.equal(plan.width, 1280);
  const capped = planVideoFrames(film, { height: 1080, maxVideoBitrate: 1000 });
  assert.equal(capped.videoBitrate, 1000);
});

test('the video estimate counts the audio only when there is some', () => {
  const silent = estimateVideoBytes({ videoBitrate: 1_000_000 }, 10, false);
  const loud = estimateVideoBytes({ videoBitrate: 1_000_000 }, 10, true);
  assert.ok(Math.abs(loud - silent - (10 * EXPORT_AUDIO_BITRATE * 1.02) / 8) < 1);
});

test('the small GIF preset is never larger nor faster than the standard one', () => {
  const standard = resolveGifPreset('standard');
  const small = resolveGifPreset('small');
  assert.ok(small.shortSide <= standard.shortSide);
  assert.ok(small.delayCs >= standard.delayCs);
  assert.equal(small.maxBytes, standard.maxBytes);
});

test('a GIF plan runs at 100 / delay frames a second', () => {
  const plan = planGifFrames(film, { shortSide: 480, delayCs: 5 });
  assert.equal(plan.fps, 20);
  assert.equal(plan.frames, 200);
  assert.equal(plan.height, 480);
});
