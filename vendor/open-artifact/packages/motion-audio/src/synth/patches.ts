import type { PatchName } from '@open-artifact/motion-core';
import { adsrEnvelope, decayEnvelope } from './envelope.ts';
import { filter, modulator, oscillator } from './nodes.ts';
import type { VoiceBus, VoiceOutput } from './nodes.ts';
import { midiToFrequency } from './voice.ts';
import type { Sound } from './voice.ts';

/** A pitched note: oscillators through envelopes and filters, tuned by `detune`, its overtones scaled by `bright`. */
export function synthesizePatch(bus: VoiceBus, name: PatchName, sound: Sound, output: VoiceOutput): void {
  const { context } = bus;
  const { at, node: out } = output;
  const frequency = midiToFrequency(sound.midi) * Math.pow(2, (sound.settings.detune ?? 0) / 1200);
  const bright = sound.settings.bright ?? 1;
  // Low notes ring longer than high ones.
  const ringScale = Math.max(0.5, Math.min(2, 440 / Math.max(60, frequency)));
  switch (name) {
    case 'marimba': {
      const body = decayEnvelope(context, out, at, { peak: 1, attack: 0.003, decay: 0.18 * ringScale, stop: at + 1.2 });
      oscillator(bus, 'sine', frequency, body, at, at + 1.2);
      const overtone = decayEnvelope(context, out, at, { peak: 0.28 * bright, attack: 0.002, decay: 0.045, stop: at + 0.3 });
      oscillator(bus, 'sine', frequency * 3.93, overtone, at, at + 0.3);
      const strike = decayEnvelope(context, out, at, { peak: 0.08 * bright, attack: 0.001, decay: 0.015, stop: at + 0.1 });
      oscillator(bus, 'sine', frequency * 9.9, strike, at, at + 0.1);
      return;
    }
    case 'ep': {
      const { gain: body, end } = adsrEnvelope(context, out, at, sound.dur, {
        attack: 0.006,
        decay: 0.9,
        sustain: 0.45,
        release: 0.35,
        peak: 0.8,
      });
      const carrier = oscillator(bus, 'sine', frequency, body, at, end);
      // Frequency modulation by the note itself, bright at the strike and mellowing over 0.4 s.
      const fm = context.createOscillator();
      fm.frequency.value = frequency;
      const fmDepth = context.createGain();
      fmDepth.gain.setValueAtTime(frequency * 2.2 * bright, at);
      fmDepth.gain.setTargetAtTime(frequency * 0.5, at, 0.4);
      fm.connect(fmDepth);
      fmDepth.connect(carrier.frequency);
      fm.start(at);
      fm.stop(end + 0.02);
      bus.track(fm);
      const tine = decayEnvelope(context, out, at, { peak: 0.12 * bright, attack: 0.002, decay: 0.08, stop: at + 0.4 });
      oscillator(bus, 'sine', frequency * 14, tine, at, at + 0.4);
      modulator(bus, 4.8, 0.12, body.gain, at, end);
      return;
    }
    case 'bass': {
      const { gain: body, end } = adsrEnvelope(context, out, at, sound.dur, {
        attack: 0.005,
        decay: 0.35,
        sustain: 0.5,
        release: 0.09,
        peak: 1,
      });
      const lowpass = filter(context, 'lowpass', 380, 1.2, body);
      lowpass.frequency.setValueAtTime(900 * bright, at);
      lowpass.frequency.setTargetAtTime(320, at, 0.12);
      oscillator(bus, 'sawtooth', frequency, lowpass, at, end);
      oscillator(bus, 'triangle', frequency, body, at, end);
      return;
    }
    case 'pad': {
      const { gain: body, end } = adsrEnvelope(context, out, at, sound.dur, {
        attack: 0.45,
        decay: 0.8,
        sustain: 0.8,
        release: 0.9,
        peak: 0.5,
      });
      const lowpass = filter(context, 'lowpass', 1400 * bright, 0.4, body);
      oscillator(bus, 'sawtooth', frequency, lowpass, at, end, -7);
      oscillator(bus, 'sawtooth', frequency, lowpass, at, end, 7);
      oscillator(bus, 'sine', frequency / 2, body, at, end);
      return;
    }
    case 'vibes': {
      const body = decayEnvelope(context, out, at, { peak: 0.9, attack: 0.004, decay: 0.7 * ringScale, stop: at + 2.4 });
      oscillator(bus, 'sine', frequency, body, at, at + 2.4);
      const overtone = decayEnvelope(context, out, at, { peak: 0.18 * bright, attack: 0.003, decay: 0.25, stop: at + 1 });
      oscillator(bus, 'sine', frequency * 4, overtone, at, at + 1);
      modulator(bus, 5.5, 0.25, body.gain, at, at + 2.4);
      return;
    }
    case 'glock': {
      const body = decayEnvelope(context, out, at, { peak: 0.7, attack: 0.001, decay: 0.35, stop: at + 1.8 });
      oscillator(bus, 'sine', frequency, body, at, at + 1.8);
      const second = decayEnvelope(context, out, at, { peak: 0.3 * bright, attack: 0.001, decay: 0.18, stop: at + 0.9 });
      oscillator(bus, 'sine', frequency * 2.76, second, at, at + 0.9);
      const third = decayEnvelope(context, out, at, { peak: 0.12 * bright, attack: 0.001, decay: 0.08, stop: at + 0.4 });
      oscillator(bus, 'sine', frequency * 5.4, third, at, at + 0.4);
      return;
    }
    case 'pluck': {
      const body = decayEnvelope(context, out, at, { peak: 1, attack: 0.002, decay: 0.12 * ringScale, stop: at + 0.8 });
      const lowpass = filter(context, 'lowpass', 2500 * bright, 0.7, body);
      lowpass.frequency.setTargetAtTime(600, at, 0.08);
      oscillator(bus, 'triangle', frequency, lowpass, at, at + 0.8);
      oscillator(bus, 'square', frequency, lowpass, at, at + 0.8);
      return;
    }
    case 'keys': {
      const { gain: body, end } = adsrEnvelope(context, out, at, sound.dur, {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.6,
        release: 0.25,
        peak: 0.6,
      });
      const lowpass = filter(context, 'lowpass', 1800 * bright, 0.8, body);
      oscillator(bus, 'square', frequency, lowpass, at, end, -4);
      oscillator(bus, 'sawtooth', frequency, lowpass, at, end, 5);
      return;
    }
    default: {
      const never: never = name;
      return never;
    }
  }
}
