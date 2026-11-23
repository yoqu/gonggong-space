import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASELINE_ATTEMPT, FIRST_ATTEMPT, avcBaselineCodecString, encoderAttemptOptions } from '../src/video/attempts.ts';
import { describeVideoFormat } from '../src/video/format.ts';

test('the Baseline codec string names the smallest level the frame fits', () => {
  assert.equal(avcBaselineCodecString({ width: 640, height: 360 }), 'avc1.42001e');
  assert.equal(avcBaselineCodecString({ width: 1280, height: 720 }), 'avc1.42001f');
  assert.equal(avcBaselineCodecString({ width: 1920, height: 1080 }), 'avc1.420028');
  assert.equal(avcBaselineCodecString({ width: 7680, height: 4320 }), 'avc1.420033');
});

test('only the Baseline attempt names a codec string, and software only when asked', () => {
  const size = { width: 1280, height: 720 };
  assert.equal(encoderAttemptOptions(FIRST_ATTEMPT, size, false).fullCodecString, undefined);
  assert.equal(encoderAttemptOptions(BASELINE_ATTEMPT, size, false).fullCodecString, 'avc1.42001f');
  assert.equal(encoderAttemptOptions(FIRST_ATTEMPT, size, true).hardwareAcceleration, 'prefer-software');
  assert.equal(encoderAttemptOptions(FIRST_ATTEMPT, size, false).hardwareAcceleration, undefined);
});

test('a format other than H.264 with AAC says why', () => {
  assert.equal(describeVideoFormat('avc', 'aac').note, undefined);
  assert.ok(describeVideoFormat('avc', null).note !== undefined);
  const vp9 = describeVideoFormat('vp9', 'aac');
  assert.equal(vp9.audioCodec, null);
  assert.equal(vp9.label, 'MP4 · VP9, no audio');
});
