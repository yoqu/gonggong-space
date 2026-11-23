import type { DrumName } from '@open-artifact/motion-core';
import { decayEnvelope } from './envelope.ts';
import { filter, noise, oscillator } from './nodes.ts';
import type { VoiceBus, VoiceOutput } from './nodes.ts';

/** A drum hit: filtered noise and pitched sines, each on its own decay. Drums have no pitch or length of their own. */
export function synthesizeDrum(bus: VoiceBus, name: DrumName, output: VoiceOutput): void {
  const { context } = bus;
  const { at, node: out } = output;
  switch (name) {
    case 'kick': {
      const body = decayEnvelope(context, out, at, { peak: 1.1, attack: 0.002, decay: 0.09, stop: at + 0.5 });
      const sweep = oscillator(bus, 'sine', 50, body, at, at + 0.5);
      sweep.frequency.setValueAtTime(160, at);
      sweep.frequency.exponentialRampToValueAtTime(46, at + 0.1);
      const beater = decayEnvelope(context, out, at, { peak: 0.25, attack: 0.0005, decay: 0.004, stop: at + 0.03 });
      noise(bus, filter(context, 'lowpass', 2500, 0.5, beater), at, at + 0.03, 0.1);
      return;
    }
    case 'snare': {
      const wires = decayEnvelope(context, out, at, { peak: 0.8, attack: 0.001, decay: 0.06, stop: at + 0.3 });
      noise(bus, filter(context, 'bandpass', 1900, 0.8, wires), at, at + 0.3, 0.3);
      const shell = decayEnvelope(context, out, at, { peak: 0.5, attack: 0.001, decay: 0.04, stop: at + 0.2 });
      oscillator(bus, 'triangle', 185, shell, at, at + 0.2).frequency.setTargetAtTime(150, at, 0.03);
      return;
    }
    case 'clap': {
      for (let hand = 0; hand < 3; hand++) {
        const start = at + hand * 0.011;
        const slap = decayEnvelope(context, out, start, { peak: 0.6, attack: 0.0005, decay: 0.008, stop: at + 0.06 });
        noise(bus, filter(context, 'bandpass', 1300, 1.2, slap), start, at + 0.06, 0.2 + hand * 0.1);
      }
      const room = decayEnvelope(context, out, at + 0.033, { peak: 0.55, attack: 0.001, decay: 0.07, stop: at + 0.4 });
      noise(bus, filter(context, 'bandpass', 1500, 0.9, room), at + 0.033, at + 0.4, 0.5);
      return;
    }
    case 'hat':
    case 'openhat': {
      const decay = name === 'hat' ? 0.022 : 0.16;
      const body = decayEnvelope(context, out, at, { peak: 0.5, attack: 0.0008, decay, stop: at + decay * 8 });
      noise(bus, filter(context, 'highpass', 7200, 0.6, body), at, at + decay * 8, 0.7);
      return;
    }
    case 'shaker': {
      const body = decayEnvelope(context, out, at, { peak: 0.45, attack: 0.012, decay: 0.025, stop: at + 0.2 });
      noise(bus, filter(context, 'bandpass', 6500, 1.5, body), at, at + 0.2, 0.9);
      return;
    }
    case 'sidestick': {
      const body = decayEnvelope(context, out, at, { peak: 0.7, attack: 0.0005, decay: 0.012, stop: at + 0.1 });
      oscillator(bus, 'sine', 1750, body, at, at + 0.1);
      oscillator(bus, 'sine', 2600, body, at, at + 0.1);
      const rim = decayEnvelope(context, out, at, { peak: 0.5, attack: 0.0003, decay: 0.006, stop: at + 0.05 });
      noise(bus, filter(context, 'highpass', 2500, 0.5, rim), at, at + 0.05, 0.4);
      return;
    }
    case 'woodblock':
    case 'cowbell': {
      const wood = name === 'woodblock';
      const pitch = wood ? 820 : 560;
      const body = decayEnvelope(context, out, at, { peak: 0.9, attack: 0.0005, decay: wood ? 0.018 : 0.06, stop: at + 0.3 });
      const resonance = filter(context, 'bandpass', pitch, 6, body);
      oscillator(bus, wood ? 'sine' : 'square', pitch, resonance, at, at + 0.3);
      oscillator(bus, 'sine', pitch * 1.51, resonance, at, at + 0.3);
      return;
    }
    case 'tamb': {
      for (let jingle = 0; jingle < 3; jingle++) {
        const start = at + jingle * 0.018;
        const body = decayEnvelope(context, out, start, { peak: 0.35, attack: 0.001, decay: 0.03, stop: at + 0.25 });
        noise(bus, filter(context, 'bandpass', 8000 + jingle * 900, 2.5, body), start, at + 0.25, 0.3 * jingle);
      }
      return;
    }
    case 'tom': {
      const body = decayEnvelope(context, out, at, { peak: 0.9, attack: 0.002, decay: 0.12, stop: at + 0.5 });
      const sweep = oscillator(bus, 'sine', 130, body, at, at + 0.5);
      sweep.frequency.setValueAtTime(210, at);
      sweep.frequency.exponentialRampToValueAtTime(120, at + 0.15);
      return;
    }
    case 'crash':
    case 'ride': {
      const crash = name === 'crash';
      const stop = at + (crash ? 2.5 : 1.2);
      const body = decayEnvelope(context, out, at, { peak: crash ? 0.5 : 0.35, attack: 0.002, decay: crash ? 0.6 : 0.25, stop });
      const shimmer = filter(context, 'peaking', crash ? 5200 : 3100, 4, body);
      noise(bus, filter(context, 'highpass', crash ? 3500 : 6000, 0.4, shimmer), at, stop, 1.1);
      if (!crash) {
        const bell = decayEnvelope(context, out, at, { peak: 0.12, attack: 0.001, decay: 0.2, stop: at + 0.8 });
        oscillator(bus, 'sine', 3120, bell, at, at + 0.8);
      }
      return;
    }
    default: {
      const never: never = name;
      return never;
    }
  }
}
