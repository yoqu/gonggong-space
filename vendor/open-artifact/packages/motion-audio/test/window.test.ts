import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playSeconds } from '@open-artifact/motion-core';
import {
  LOOKAHEAD_SECONDS,
  START_DELAY_SECONDS,
  contextTimeOf,
  dueSounds,
  firstHeard,
  heardFrom,
  lookaheadHorizon,
  passOrigin,
  playTimeAt,
} from '../src/window.ts';
import type { HeardSpan } from '../src/window.ts';

const span = (start: number, end: number): HeardSpan => ({ start: playSeconds(start), end: playSeconds(end) });
const play = playSeconds;

describe('the scheduling window', () => {
  const spans = [span(0, 0.5), span(0.2, 5), span(1, 1.5), span(2, 2.5), span(4, 4.5)];

  it('starts at the first sound still heard', () => {
    assert.equal(firstHeard(spans, play(0)), 0);
    assert.equal(firstHeard(spans, play(0.6)), 1);
    assert.equal(firstHeard(spans, play(10)), 5);
  });

  it('hands over the sounds that start by the horizon, skipping those already over', () => {
    assert.deepEqual(dueSounds(spans, 1, play(1.6), play(2.8)), { due: [1, 3], next: 4 });
    assert.deepEqual(dueSounds(spans, 4, play(1.6), play(2.8)), { due: [], next: 4 });
    assert.deepEqual(dueSounds(spans, 4, play(1.6), play(4)), { due: [4], next: 5 });
  });

  it('takes every sound heard from a time, for an offline render', () => {
    assert.deepEqual(heardFrom(spans, play(1.6)), [1, 3, 4]);
  });
});

describe('pass timing', () => {
  it('puts the start a little ahead of now, at any rate', () => {
    const origin = passOrigin(10, play(4), 2);
    assert.equal(origin, 10 + START_DELAY_SECONDS - 2);
    assert.ok(Math.abs(contextTimeOf(4, origin, 2) - (10 + START_DELAY_SECONDS)) < 1e-12);
    assert.ok(Math.abs(playTimeAt(10 + START_DELAY_SECONDS + 1, origin, 2) - 6) < 1e-12);
  });

  it('looks ahead the lookahead, as played at the rate', () => {
    const origin = passOrigin(0, play(0), 1);
    assert.ok(Math.abs(lookaheadHorizon(START_DELAY_SECONDS, origin, 1) - LOOKAHEAD_SECONDS) < 1e-12);
    assert.ok(Math.abs(lookaheadHorizon(1, 0, 0.5) - (1 + LOOKAHEAD_SECONDS) * 0.5) < 1e-12);
  });
});
