import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { ScoreData, ScoreEvent } from '@open-artifact/motion-core';
import { SILENT_MASTER, playScore } from '../src/played-score.ts';
import { identityTimeline, segmentTimeline } from '../src/timeline.ts';

const film = filmSeconds;
const play = playSeconds;

const event = (t: number, kind: ScoreEvent['kind'], patch: string, more: Partial<ScoreEvent> = {}): ScoreEvent => ({
  t: film(t),
  dur: 0.5,
  kind,
  patch,
  midi: 60,
  vel: 100,
  ...more,
});

const score = (events: ScoreEvent[]): ScoreData => ({ events, master: { gain: -6, fadeOut: 1 } });

describe('playing a score', () => {
  it('resolves patches: aliases, a marimba for an unknown pitched patch, silence for an unknown drum or effect', () => {
    const played = playScore(
      score([event(0, 'note', 'Rhodes'), event(1, 'note', 'theremin'), event(2, 'drum', 'BD'), event(3, 'drum', 'gong'), event(4, 'fx', 'swoosh'), event(5, 'fx', 'laser')]),
      identityTimeline(film(10)),
    );
    assert.deepEqual(
      played.sounds.map((sound) => `${sound.patch.kind}:${sound.patch.name}`),
      ['note:ep', 'note:marimba', 'drum:kick', 'fx:whoosh'],
    );
  });

  it('drops events before 0, at 108000 s or later, or not finite', () => {
    const played = playScore(
      score([event(-0.1, 'note', 'pad'), event(108_000, 'note', 'pad'), event(Number.NaN, 'note', 'pad'), event(1, 'note', 'pad', { dur: Number.POSITIVE_INFINITY })]),
      identityTimeline(film(109_000)),
    );
    assert.equal(played.sounds.length, 0);
  });

  it('orders sounds by when they start to be heard; a reverse swell is heard before its onset, with its ring after', () => {
    const played = playScore(score([event(2, 'note', 'vibes'), event(3, 'fx', 'revswell', { dur: 2 })]), identityTimeline(film(10)));
    assert.deepEqual(
      played.sounds.map((sound) => [sound.patch.name, sound.at, sound.start, sound.end]),
      [
        ['revswell', 3, 1, 3.4],
        ['vibes', 2, 2, 2 + 0.5 + 1.6],
      ],
    );
  });

  it('keeps every number in bounds', () => {
    const [sound] = playScore(
      score([event(1, 'note', 'keys', { dur: 99, midi: 200, vel: 0, params: { pan: 5, gain: -100, bright: 3 } })]),
      identityTimeline(film(100)),
    ).sounds;
    assert.ok(sound !== undefined);
    assert.equal(sound.sound.dur, 30);
    assert.equal(sound.sound.midi, 127);
    assert.equal(sound.sound.vel, 1);
    assert.deepEqual(sound.sound.settings, { pan: 1, gain: -60, bright: 2 });
  });

  it('reads a whoosh’s direction and a boing’s rate from the params', () => {
    const params: Record<string, number> = { into: 1, rate: 100 };
    const [sound] = playScore(score([event(1, 'fx', 'boing', { params })]), identityTimeline(film(10))).sounds;
    assert.deepEqual(sound?.sound.settings, { into: 1, rate: 40 });
  });

  it('plays nothing without a score, at the default master', () => {
    const played = playScore(null, identityTimeline(film(4)));
    assert.equal(played.sounds.length, 0);
    assert.equal(played.master, SILENT_MASTER);
    assert.equal(played.duration, 4);
  });
});

describe('a score through a recut', () => {
  // 0–4 s as it is; 4–6 s cut out; 6–10 s twice as long.
  const timeline = segmentTimeline(
    [
      { film: film(0), filmLength: 4, play: play(0), playLength: 4 },
      { film: film(6), filmLength: 4, play: play(4), playLength: 8 },
    ],
    film(10),
  );

  it('does not play an event whose onset is cut out', () => {
    const played = playScore(score([event(5, 'drum', 'kick')]), timeline);
    assert.equal(played.sounds.length, 0);
  });

  it('moves and stretches an event in a retimed span', () => {
    const [sound] = playScore(score([event(7, 'note', 'pad', { dur: 1 })]), timeline).sounds;
    assert.equal(sound?.at, 6);
    assert.equal(sound?.sound.dur, 2);
  });

  it('keeps the written length of an event whose end is cut out', () => {
    const [sound] = playScore(score([event(3.5, 'note', 'pad', { dur: 1 })]), timeline).sounds;
    assert.equal(sound?.at, 3.5);
    assert.equal(sound?.sound.dur, 1);
  });

  it('takes the played duration', () => {
    assert.equal(playScore(score([]), timeline).duration, 12);
  });
});
