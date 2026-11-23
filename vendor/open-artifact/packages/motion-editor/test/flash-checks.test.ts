import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FlashFrameAnalyzer } from '@open-artifact/wasm-motion';
import { FlashChecks } from '../src/flash/checks.ts';
import { inspectScene, type PulledFrame } from '../src/flash/inspect.ts';
import { flashProgress } from '../src/flash/progress.ts';
import { checkBudgetMs, flashCacheKey, flashSignature, flashVerdict, isFinished, leastScale, needsNoCheck, type FlashOutcome } from '../src/flash/verdict.ts';

test('a check is on course, behind, or late by the pace of its frames', () => {
  const steady = Array.from({ length: 20 }, (_, index) => index * 10);
  assert.equal(flashProgress(steady, 100, 10_000, 3000), 'on');
  assert.equal(flashProgress([0, 10, 20], 1000, 100, 3000), 'on', 'too early to judge');
  const slow = Array.from({ length: 20 }, (_, index) => index * 500);
  assert.equal(flashProgress(slow, 100, 10_000, 30_000), 'behind');
  assert.equal(flashProgress(slow, 100, 10_000, 1000), 'late');
  assert.equal(flashProgress(slow, 100, 10_000, 0), 'late');
});

test('a verdict allows the scene its least share, or the unchecked share when the check had no answer', () => {
  assert.deepEqual(flashVerdict({ outcome: 0.8, nat: 10, playDur: 9, uncheckedScale: 0.5 }), { kind: 'safe' });
  assert.deepEqual(flashVerdict({ outcome: 0.8, nat: 10, playDur: 6, uncheckedScale: 0.5 }), { kind: 'too-fast', minimum: 8 });
  assert.deepEqual(flashVerdict({ outcome: 0.333, nat: 10, playDur: 3, uncheckedScale: 0.5 }), { kind: 'too-fast', minimum: 3.33 });
  assert.deepEqual(flashVerdict({ outcome: 'late', nat: 10, playDur: 4, uncheckedScale: 0.5 }), { kind: 'unchecked', minimum: 5 });
  assert.deepEqual(flashVerdict({ outcome: 'long', nat: 40, playDur: 4, uncheckedScale: 0.5 }), { kind: 'safe' });
  assert.deepEqual(flashVerdict({ outcome: 1, nat: 0.8, playDur: 0.4, uncheckedScale: 0.5 }), { kind: 'safe' }, 'a scene of a second or less');
  assert.equal(needsNoCheck(5, 5), true);
  assert.equal(needsNoCheck(5, 4), false);
  assert.equal(leastScale('torn', 0.5), 0.5);
});

test('a check is final once it has an answer, or has had its tries', () => {
  assert.equal(isFinished(undefined), false);
  assert.equal(isFinished({ outcome: 0.4, tries: 1 }), true);
  assert.equal(isFinished({ outcome: 'long', tries: 1 }), true);
  assert.equal(isFinished({ outcome: 'late', tries: 1 }), false);
  assert.equal(isFinished({ outcome: 'late', tries: 2 }), true);
  assert.equal(checkBudgetMs(2, 1, 10_000), 12_000);
  assert.equal(checkBudgetMs(0.5, 1, 10_000), 10_000);
});

test('the cache key leaves out the recut, and changes with what the film draws', () => {
  const base = { script: 'cut()', modules: [{ name: 'a.js', kind: 'js' as const, text: 'a' }], assets: [{ name: 'p.png', ref: '_blob/1' }] };
  const recut = { ...base, modules: [...base.modules, { name: 'recut.json', kind: 'json' as const, text: '{"scenes":[]}' }] };
  assert.equal(flashSignature(base), flashSignature(recut));
  assert.notEqual(flashSignature(base), flashSignature({ ...base, script: 'cut(1)' }));
  assert.notEqual(flashSignature(base), flashSignature({ ...base, assets: [{ name: 'p.png', ref: '_blob/2' }] }));
  assert.equal(flashCacheKey('s', { start: 2, nat: 3 }), 's 2+3');
});

test('checks are kept, shared while running, and tried again with more time', async () => {
  const checks = new FlashChecks({ idle: () => true });
  const slowdowns: number[] = [];
  const outcomes: FlashOutcome[] = ['late', 0.6];
  const inspect = async ({ slowdown }: { slowdown: number }): Promise<FlashOutcome> => {
    slowdowns.push(slowdown);
    return outcomes.shift() ?? 'torn';
  };
  const [first, second] = await Promise.all([checks.check('k', inspect), checks.check('k', inspect)]);
  assert.equal(first, 0.6);
  assert.equal(second, 0.6);
  assert.deepEqual(slowdowns, [1, 1.5]);
  assert.equal(await checks.check('k', inspect), 0.6);
  assert.equal(slowdowns.length, 2, 'a finished check is not run again');
});

test('a background check gives way while the page is busy, and keeps nothing', async () => {
  let idle = false;
  const checks = new FlashChecks({ idle: () => idle });
  let runs = 0;
  const inspect = async (): Promise<FlashOutcome> => {
    runs++;
    return 0.5;
  };
  assert.equal(await checks.check('k', inspect, true), 'torn');
  assert.equal(runs, 0);
  assert.equal(checks.peek('k'), undefined);
  idle = true;
  assert.equal(await checks.check('k', inspect, true), 0.5);
});

test('the oldest checks are let go first', async () => {
  const checks = new FlashChecks({ idle: () => true, max: 2 });
  for (const key of ['a', 'b', 'c']) await checks.check(key, async () => 1);
  assert.equal(checks.peek('a'), undefined);
  assert.ok(checks.peek('c') !== undefined);
});

function fakeAnalyzer(added: number[]): () => FlashFrameAnalyzer {
  return () => ({
    add: (_pixels, width) => void added.push(width),
    report: () => ({ frames: added.length, fastest: null, span: Infinity, safeScale: 0.7 }),
    dispose: () => undefined,
  });
}

const frame: PulledFrame = { svg: '<svg/>', pw: 4, ph: 2 };
const sampling = { times: [0, 1 / 30, 2 / 30, 3 / 30], fromFrame: 1, toFrame: 3 };

test('an inspection reads every frame in order and reports the least share', async () => {
  const added: number[] = [];
  const asked: number[] = [];
  const outcome = await inspectScene({
    sampling,
    pull: async (t) => {
      asked.push(t);
      return frame;
    },
    rasterize: async (pulled) => ({ pixels: new Uint8ClampedArray(pulled.pw * pulled.ph * 4), width: pulled.pw }),
    analyzer: fakeAnalyzer(added),
    budgetMs: 10_000,
    patienceMs: 3000,
    ahead: 2,
    slowdown: 1,
    wanted: () => true,
  });
  assert.equal(outcome, 0.7);
  assert.deepEqual(asked, sampling.times);
  assert.equal(added.length, 4);
});

test('an inspection without readable frames, a failing stage, or out of time says so', async () => {
  const base = {
    sampling,
    analyzer: fakeAnalyzer([]),
    budgetMs: 10_000,
    patienceMs: 3000,
    ahead: 1,
    slowdown: 1,
    wanted: () => true,
  };
  assert.equal(await inspectScene({ ...base, pull: async () => frame, rasterize: async () => null }), 'faulty');
  assert.equal(await inspectScene({ ...base, pull: () => Promise.reject(new Error('gone')), rasterize: async () => null }), 'torn');
  assert.equal(await inspectScene({ ...base, wanted: () => false, pull: async () => frame, rasterize: async () => null }), 'torn');
  const never = new Promise<PulledFrame>(() => undefined);
  assert.equal(await inspectScene({ ...base, budgetMs: 20, pull: () => never, rasterize: async () => null }), 'unseen');
});
