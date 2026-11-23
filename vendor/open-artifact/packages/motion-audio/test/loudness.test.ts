import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loudnessGain, measureIntegratedLoudness, sampleLevels } from '../src/loudness.ts';
import type { PcmSource } from '../src/loudness.ts';

const RATE = 48000;

function pcm(channels: Float32Array<ArrayBuffer>[], sampleRate = RATE): PcmSource {
  return {
    sampleRate,
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(0),
  };
}

function sine(amplitude: number, frequency: number, seconds: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < samples.length; index++) samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE);
  return samples;
}

describe('integrated loudness', () => {
  it('reads a 1 kHz tone at −20 dBFS on both channels as −20 LUFS', () => {
    const tone = sine(0.1, 1000, 3);
    const measured = measureIntegratedLoudness(pcm([tone, tone]));
    assert.ok(Math.abs(measured.lufs - -20) < 0.2, `measured ${measured.lufs}`);
    assert.ok(Math.abs(measured.peak - 0.1) < 1e-3);
  });

  it('reads the same tone on one channel 3 dB lower', () => {
    const tone = sine(0.1, 1000, 3);
    const measured = measureIntegratedLoudness(pcm([tone, new Float32Array(tone.length)]));
    assert.ok(Math.abs(measured.lufs - -23.01) < 0.2, `measured ${measured.lufs}`);
  });

  it('gates out silence: a tone with a long silence after it reads as the tone', () => {
    const tone = sine(0.1, 1000, 3);
    const padded = new Float32Array(tone.length * 3);
    padded.set(tone);
    const measured = measureIntegratedLoudness(pcm([padded, padded]));
    assert.ok(Math.abs(measured.lufs - -20) < 0.3, `measured ${measured.lufs}`);
  });

  it('reads silence, and a buffer shorter than one block, as −Infinity', () => {
    assert.equal(measureIntegratedLoudness(pcm([new Float32Array(RATE)])).lufs, -Infinity);
    assert.equal(measureIntegratedLoudness(pcm([sine(0.5, 1000, 0.2)])).lufs, -Infinity);
  });
});

describe('loudness gain', () => {
  it('brings a sound to −16 LUFS by default', () => {
    assert.ok(Math.abs(loudnessGain({ lufs: -26, peak: 0.1 }, undefined) - Math.pow(10, 10 / 20)) < 1e-9);
  });

  it('takes the score’s own target, but none louder than −6', () => {
    assert.ok(Math.abs(loudnessGain({ lufs: -20, peak: 0.1 }, -14) - Math.pow(10, 6 / 20)) < 1e-9);
    assert.ok(Math.abs(loudnessGain({ lufs: -10, peak: 0.1 }, 0) - Math.pow(10, 4 / 20)) < 1e-9);
  });

  it('leaves the sound as it is with no target or no measurement', () => {
    assert.equal(loudnessGain({ lufs: -30, peak: 0.1 }, null), 1);
    assert.equal(loudnessGain({ lufs: -Infinity, peak: 0 }, undefined), 1);
  });

  it('raises by 14 dB at most, keeps the peak under 2.5, and lowers to 0.05 at least', () => {
    assert.ok(Math.abs(loudnessGain({ lufs: -60, peak: 0.01 }, undefined) - Math.pow(10, 14 / 20)) < 1e-9);
    assert.equal(loudnessGain({ lufs: -40, peak: 1 }, undefined), 2.5);
    assert.equal(loudnessGain({ lufs: 20, peak: 1 }, undefined), 0.05);
  });
});

describe('levels', () => {
  it('gives peak and RMS per interval across channels', () => {
    const left = new Float32Array([0.5, -0.5, 0, 0]);
    const right = new Float32Array([0.5, -0.5, 0, 0]);
    const levels = sampleLevels(pcm([left, right], 4), 0.5);
    assert.deepEqual(
      levels.map((level) => [level.t, level.peak, level.rms]),
      [
        [0, 0.5, 0.5],
        [0.5, 0, 0],
      ],
    );
  });
});
