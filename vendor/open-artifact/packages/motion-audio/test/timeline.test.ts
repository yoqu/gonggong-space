import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import { identityTimeline, segmentTimeline } from '../src/timeline.ts';

const film = filmSeconds;
const play = playSeconds;

describe('identity timeline', () => {
  it('plays the film as it is', () => {
    const timeline = identityTimeline(film(10));
    assert.equal(timeline.playDuration, 10);
    assert.equal(timeline.toPlay(film(3.5)), 3.5);
    assert.equal(timeline.toFilm(play(12)), 10);
  });
});

describe('segment timeline', () => {
  // 0–4 s plays as it is; 4–6 s is cut out; 6–10 s plays twice as long.
  const timeline = segmentTimeline(
    [
      { film: film(0), filmLength: 4, play: play(0), playLength: 4 },
      { film: film(6), filmLength: 4, play: play(4), playLength: 8 },
    ],
    film(10),
  );

  it('plays the kept spans at their rates', () => {
    assert.equal(timeline.playDuration, 12);
    assert.equal(timeline.toPlay(film(2)), 2);
    assert.equal(timeline.toPlay(film(6)), 4);
    assert.equal(timeline.toPlay(film(8)), 8);
  });

  it('gives no play time inside a span cut out', () => {
    assert.equal(timeline.toPlay(film(4)), null);
    assert.equal(timeline.toPlay(film(5.9)), null);
  });

  it('runs on at normal speed before the start and past the end', () => {
    assert.equal(timeline.toPlay(film(-0.5)), -0.5);
    assert.equal(timeline.toPlay(film(10)), 12);
    assert.equal(timeline.toPlay(film(11)), 13);
  });

  it('maps play time back to film time, clamped to the film', () => {
    assert.equal(timeline.toFilm(play(2)), 2);
    assert.equal(timeline.toFilm(play(8)), 8);
    assert.equal(timeline.toFilm(play(-1)), 0);
    assert.equal(timeline.toFilm(play(20)), 10);
  });

  it('maps a span’s first play instant to its own start, not the span before', () => {
    assert.equal(timeline.toFilm(play(4)), 6);
  });

  it('is the identity with no segment', () => {
    const plain = segmentTimeline([], film(5));
    assert.equal(plain.toPlay(film(4)), 4);
    assert.equal(plain.playDuration, 5);
  });
});
