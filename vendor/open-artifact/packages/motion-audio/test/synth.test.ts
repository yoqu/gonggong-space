import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fadeLevel, masterGain, softClipCurve } from '../src/mixer.ts';
import { reverbImpulseSamples } from '../src/reverb.ts';
import { adsrEnd, adsrLevelAt, adsrReleaseAt } from '../src/synth/envelope.ts';
import { boingCurve, rollStrikes } from '../src/synth/fx.ts';
import { noiseSamples, seededRandom } from '../src/synth/noise.ts';
import { resolvePatch, ringSeconds } from '../src/synth/presets.ts';
import { decibelsToGain, midiToFrequency, velocityToGain, voiceGain } from '../src/synth/voice.ts';

const near = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

describe('envelopes', () => {
  const shape = { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.25, peak: 0.6 };

  it('lets a held note go after its length, never before its attack is over', () => {
    near(adsrReleaseAt(1, 0.5, shape.attack), 1.5);
    near(adsrReleaseAt(1, 0, shape.attack), 1.03);
    near(adsrEnd(1, 0.5, shape), 1.75);
  });

  it('is at its peak when the attack ends and falls towards the sustain level', () => {
    near(adsrLevelAt(shape.attack, shape), shape.peak);
    near(adsrLevelAt(100, shape), shape.peak * shape.sustain);
    const oneDecay = adsrLevelAt(shape.attack + shape.decay, shape);
    near(oneDecay, 0.36 + 0.24 * Math.exp(-1));
  });
});

describe('voice math', () => {
  it('tunes A4 to 440 Hz, an octave to a doubling', () => {
    near(midiToFrequency(69), 440);
    near(midiToFrequency(81), 880);
  });

  it('curves velocity, and adds the patch’s and the sound’s levels in dB', () => {
    near(velocityToGain(127), 1);
    near(velocityToGain(0), Math.pow(1 / 127, 1.5));
    near(decibelsToGain(-6), 0.501187233627, 1e-9);
    near(voiceGain({ dur: 1, midi: 60, vel: 127, settings: { gain: -3 } }, -3), decibelsToGain(-6));
  });

  it('rings pads, vibes, glockenspiels, effects and crashes longer', () => {
    const ring = (kind: 'note' | 'drum' | 'fx', patch: string): number => {
      const resolved = resolvePatch(kind, patch);
      assert.ok(resolved !== null);
      return ringSeconds(resolved);
    };
    assert.deepEqual(
      [ring('note', 'pad'), ring('note', 'glock'), ring('note', 'bass'), ring('fx', 'pop'), ring('drum', 'crash'), ring('drum', 'kick')],
      [1.2, 1.6, 0.6, 1.2, 1.8, 0.5],
    );
  });
});

describe('effects', () => {
  it('rolls ever faster, down to 35 ms between strikes', () => {
    const strikes = rollStrikes(1);
    near(strikes[0] ?? -1, 0);
    near(strikes[1] ?? -1, 0.16);
    near(strikes[2] ?? -1, 0.16 + 0.1376);
    assert.ok(strikes.every((strike) => strike < 0.98));
    const gaps = strikes.slice(1).map((strike, index) => strike - (strikes[index] ?? 0));
    assert.ok(gaps.every((gap) => gap >= 0.035 - 1e-12));
  });

  it('bends a boing about its pitch, the wobble dying away', () => {
    const curve = boingCurve(200, 1, 7);
    assert.equal(curve.length, 64);
    near(curve[0] ?? 0, 200, 1e-3);
    assert.ok(Math.abs((curve[63] ?? 0) - 200) < 200 * 0.45 * Math.exp(-5) + 1e-3);
  });
});

describe('noise and reverb', () => {
  it('is the same on every render', () => {
    const first = seededRandom(7);
    const second = seededRandom(7);
    for (let index = 0; index < 10; index++) assert.equal(first(), second());
    assert.deepEqual(noiseSamples(16), noiseSamples(16));
    const sample = noiseSamples(1000);
    assert.ok(sample.every((value) => value >= -1 && value < 1));
  });

  it('decays the reverb’s impulse and fades it in', () => {
    const [left, right] = reverbImpulseSamples(1000, 1.9);
    assert.equal(left.length, 1900);
    assert.equal(left[0], 0);
    assert.notDeepEqual(left, right);
    const energy = (samples: Float32Array, from: number, to: number): number =>
      samples.slice(from, to).reduce((sum, value) => sum + value * value, 0);
    assert.ok(energy(left, 200, 600) > energy(left, 1300, 1700) * 10);
  });
});

describe('the master bus’s math', () => {
  it('clips softly: straight to 0.85, then bending under 1', () => {
    const curve = softClipCurve();
    assert.equal(curve.length, 2049);
    near(curve[1024] ?? 1, 0);
    near(curve[Math.round((0.5 + 2) * 512)] ?? 0, 0.5, 1e-6);
    assert.ok((curve[2048] ?? 0) < 1 && (curve[2048] ?? 0) > 0.99);
    near(curve[0] ?? 0, -(curve[2048] ?? 0));
    for (let index = 1; index < curve.length; index++) assert.ok((curve[index] ?? 0) >= (curve[index - 1] ?? 0));
  });

  it('keeps the master level within −40…6 dB', () => {
    near(masterGain(-6), decibelsToGain(-6));
    near(masterGain(20), decibelsToGain(6));
    near(masterGain(-100), decibelsToGain(-40));
  });

  it('fades the score out over its last seconds', () => {
    assert.equal(fadeLevel(1, 2, 10, 5), 1);
    near(fadeLevel(1, 2, 10, 9), 0.5);
    assert.equal(fadeLevel(1, 2, 10, 10), 0);
    assert.equal(fadeLevel(0.5, 0, 10, 9.9), 0.5);
    near(fadeLevel(1, 20, 10, 5), 0.5);
  });
});
