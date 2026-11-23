import type { FxName } from '@open-artifact/motion-core';
import { synthesizeDrum } from './drums.ts';
import { decayEnvelope } from './envelope.ts';
import { filter, noise, oscillator } from './nodes.ts';
import type { VoiceBus, VoiceOutput } from './nodes.ts';
import { synthesizePatch } from './patches.ts';
import { midiToFrequency } from './voice.ts';
import type { Sound } from './voice.ts';

const BELL_INTERVALS: Readonly<Record<'ding' | 'chime' | 'sparkle', readonly number[]>> = {
  ding: [0, 7],
  chime: [0, 4, 7, 12],
  sparkle: [0, 7, 12, 16, 19, 24],
};
const BELL_STEP_SECONDS: Readonly<Record<'ding' | 'chime' | 'sparkle', number>> = { ding: 0.12, chime: 0.09, sparkle: 0.055 };

/** The strikes of a drum roll: from 0.16 s apart, each 0.86 of the gap before, down to 0.035 s, over `length` seconds. */
export function rollStrikes(length: number): number[] {
  const strikes: number[] = [];
  let offset = 0;
  let gap = 0.16;
  while (offset < length - 0.02) {
    strikes.push(offset);
    offset += gap;
    gap = Math.max(0.035, gap * 0.86);
  }
  return strikes;
}

/** A boing's pitch curve: the note wobbling at `rate` per second, the wobble dying away. */
export function boingCurve(frequency: number, length: number, rate: number, points = 64): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index++) {
    const progress = index / (points - 1);
    curve[index] = frequency * (1 + 0.45 * Math.exp(-progress * 5) * Math.sin(2 * Math.PI * rate * progress * length));
  }
  return curve;
}

/** A sound effect: some are drums or bells played in a pattern, the rest made from noise sweeps and pitch bends. */
export function synthesizeFx(bus: VoiceBus, name: FxName, sound: Sound, output: VoiceOutput): void {
  const { context } = bus;
  const { at, node: out } = output;
  switch (name) {
    case 'tick': {
      // The velocity nudges the pitch so a run of ticks is not one note repeated.
      const pitch = 600 + (sound.vel % 7) * 14;
      const body = decayEnvelope(context, out, at, { peak: 0.8, attack: 0.0005, decay: 0.012, stop: at + 0.12 });
      const resonance = filter(context, 'bandpass', pitch, 5, body);
      oscillator(bus, 'sine', pitch, resonance, at, at + 0.12);
      oscillator(bus, 'triangle', pitch * 2.4, resonance, at, at + 0.12);
      return;
    }
    case 'click':
    case 'doubleclick': {
      const clicks = name === 'click' ? 1 : 2;
      for (let index = 0; index < clicks; index++) synthesizeDrum(bus, 'sidestick', { node: out, at: at + index * 0.11 });
      return;
    }
    case 'pop': {
      const body = decayEnvelope(context, out, at, { peak: 0.9, attack: 0.002, decay: 0.03, stop: at + 0.2 });
      const pitch = sound.midi > 0 ? midiToFrequency(sound.midi) : 520;
      const bend = oscillator(bus, 'sine', pitch, body, at, at + 0.2);
      bend.frequency.setValueAtTime(pitch * 0.7, at);
      bend.frequency.exponentialRampToValueAtTime(pitch * 1.6, at + 0.05);
      return;
    }
    case 'thud': {
      const body = decayEnvelope(context, out, at, { peak: 1, attack: 0.002, decay: 0.08, stop: at + 0.4 });
      const bend = oscillator(bus, 'sine', 90, body, at, at + 0.4);
      bend.frequency.setValueAtTime(140, at);
      bend.frequency.exponentialRampToValueAtTime(70, at + 0.12);
      const impact = decayEnvelope(context, out, at, { peak: 0.3, attack: 0.001, decay: 0.01, stop: at + 0.05 });
      noise(bus, filter(context, 'lowpass', 1200, 0.5, impact), at, at + 0.05, 1.2);
      return;
    }
    case 'ding':
    case 'chime':
    case 'sparkle': {
      const root = sound.midi > 0 ? sound.midi : name === 'sparkle' ? 96 : 88;
      const step = BELL_STEP_SECONDS[name];
      BELL_INTERVALS[name].forEach((interval, index) =>
        synthesizePatch(bus, 'glock', { ...sound, midi: root + interval }, { node: out, at: at + index * step }),
      );
      return;
    }
    case 'whoosh': {
      const reversed = (sound.settings.into ?? 0) > 0;
      const length = Math.max(0.15, sound.dur);
      const swell = context.createGain();
      swell.gain.setValueAtTime(0, at);
      swell.gain.linearRampToValueAtTime(0.7, at + length * (reversed ? 0.8 : 0.35));
      swell.gain.linearRampToValueAtTime(0, at + length);
      swell.connect(out);
      const sweep = filter(context, 'bandpass', 800, 1.1, swell);
      sweep.frequency.setValueAtTime(reversed ? 3200 : 500, at);
      sweep.frequency.exponentialRampToValueAtTime(reversed ? 500 : 3400, at + length);
      noise(bus, sweep, at, at + length, 0.3);
      return;
    }
    case 'revswell': {
      const length = Math.max(0.3, sound.dur);
      // Heard before its onset: when scheduled late, it starts part of the way up its swell.
      const start = Math.min(at, Math.max(context.currentTime, at - length));
      const progress = 1 - (at - start) / length;
      const swell = context.createGain();
      swell.gain.setValueAtTime(0.0001 * Math.pow(8000, progress), start);
      swell.gain.exponentialRampToValueAtTime(0.8, at);
      swell.gain.linearRampToValueAtTime(0, at + 0.04);
      swell.connect(out);
      const sweep = filter(context, 'highpass', 1800, 0.5, filter(context, 'peaking', 6000, 2, swell));
      sweep.frequency.setValueAtTime(900 * Math.pow(4000 / 900, progress), start);
      sweep.frequency.exponentialRampToValueAtTime(4000, at);
      noise(bus, sweep, start, at + 0.05, 0.6);
      return;
    }
    case 'boing': {
      const length = Math.max(0.4, sound.dur);
      const pitch = sound.midi > 0 ? midiToFrequency(sound.midi) : 180;
      const body = decayEnvelope(context, out, at, { peak: 1, attack: 0.003, decay: length * 0.3, stop: at + length });
      const spring = oscillator(bus, 'triangle', pitch, body, at, at + length);
      spring.frequency.setValueCurveAtTime(boingCurve(pitch, length, sound.settings.rate ?? 7), at, length);
      return;
    }
    case 'roll': {
      const length = Math.max(0.3, sound.dur);
      for (const offset of rollStrikes(length)) {
        const louder = { ...sound, vel: Math.min(127, sound.vel + Math.round((offset / length) * 30)) };
        synthesizeFx(bus, 'tick', louder, { node: out, at: at + offset });
      }
      synthesizeFx(bus, 'ding', sound, { node: out, at: at + length });
      return;
    }
    default: {
      const never: never = name;
      return never;
    }
  }
}
