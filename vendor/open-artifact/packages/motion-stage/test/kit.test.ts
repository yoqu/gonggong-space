import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp, clamp01, eio, eo, lerp, seg, smoothstep, spring } from '../src/runtime/kit/math.ts';
import { cutPaper, polyLerp, polyStr } from '../src/runtime/kit/paper.ts';
import { frameSeed, rng, sceneSeed, vnoise } from '../src/runtime/kit/random.ts';
import { esc, streamed, typist, uncut } from '../src/runtime/kit/typing.ts';

test('rng gives the same numbers in 0..1 for the same seed', () => {
  const a = rng(42);
  const b = rng(42);
  const drawn = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(drawn, Array.from({ length: 1000 }, () => b()));
  assert.ok(drawn.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(drawn.slice(0, 5), Array.from({ length: 5 }, rng(43)));
});

test('rng steps by 32-bit integer arithmetic, not floats', () => {
  // state' = (state * 1664525 + 1013904223) mod 2^32, computed exactly with BigInt.
  let state = 0xffffffffn;
  const next = rng(0xffffffff);
  for (let i = 0; i < 5; i++) {
    state = (state * 1664525n + 1013904223n) % 4294967296n;
    assert.equal(next(), Number(state) / 4294967296);
  }
});

test('frame and scene seeds are unsigned 32-bit and tell moments and scenes apart', () => {
  assert.equal(frameSeed(0), 2654435761);
  assert.equal(frameSeed(1000), Number((1001n * 2654435761n) % 4294967296n));
  assert.equal(frameSeed(999.6), frameSeed(1000));
  for (const seed of [frameSeed(123456), sceneSeed('intro', 0), sceneSeed('outro', 99999)]) assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32);
  assert.notEqual(sceneSeed('intro', 0), sceneSeed('outro', 0));
  assert.notEqual(sceneSeed('intro', 0), sceneSeed('intro', 1));
  assert.equal(sceneSeed('intro', 500), sceneSeed('intro', 500));
});

test('value noise is smooth and within -1..1', () => {
  const noise = vnoise(3);
  for (let x = 0; x < 300; x += 0.37) {
    const value = noise(x);
    assert.ok(value >= -1 && value <= 1);
    assert.ok(Math.abs(noise(x + 0.001) - value) < 0.01);
  }
});

test('easing and ranges hold their ends', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(seg(5, 0, 10), 0.5);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  for (const ease of [eo, eio]) {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
  }
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.ok(Math.abs(spring(1) - 1) < 0.05);
});

test('a typist lands each character later than the one before, the same way each time', () => {
  const heard: number[] = [];
  const typed = typist('Hello. World', 1, 20, 7, heard);
  assert.equal(typed.times.length, 12);
  assert.ok(typed.times.every((t, i) => t > (typed.times[i - 1] ?? 1)));
  assert.deepEqual(heard, typed.times);
  assert.deepEqual(typist('Hello. World', 1, 20, 7).times, typed.times);
  assert.equal(typed.at(0), '');
  assert.equal(typed.at(typed.end), 'Hello. World');
  assert.equal(typed.count(typed.times[4] ?? 0), 5);
});

test('text is never cut inside a surrogate pair', () => {
  assert.equal(uncut('a😀b', 2), 'a');
  assert.equal(uncut('a😀b', 3), 'a😀');
  assert.equal(streamed('abcdefghij', 0.5, 1), '');
  assert.equal(streamed('abcdefghij', 10, 0), 'abcdefghij');
  assert.equal(esc('<a & b>'), '&lt;a &amp; b>');
});

test('cut paper is deterministic, and morphs point by point', () => {
  const a = cutPaper(1, 7);
  assert.equal(a.length, 7);
  assert.deepEqual(cutPaper(1, 7), a);
  const b = cutPaper(2, 7);
  const near = (from: number[][], to: number[][]): boolean => from.every((point, i) => point.every((x, j) => Math.abs(x - (to[i]?.[j] ?? NaN)) < 1e-12));
  assert.deepEqual(polyLerp(a, b, 0), a);
  assert.ok(near(polyLerp(a, b, 1), b));
  assert.match(polyStr(a, 100, 100, 50, 50), /^[\d.\-]+,[\d.\-]+( [\d.\-]+,[\d.\-]+){6}$/);
});
