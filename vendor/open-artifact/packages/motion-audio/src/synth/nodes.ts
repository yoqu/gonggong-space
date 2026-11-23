import { NOISE_SECONDS } from './noise.ts';
import type { PatchPreset } from './presets.ts';
import { voiceGain } from './voice.ts';
import type { Sound } from './voice.ts';

/** Where a score's sounds go: the dry send and the reverb send of one session, and the noise they share. */
export interface VoiceBus {
  readonly context: BaseAudioContext;
  readonly dry: AudioNode;
  readonly reverb: AudioNode;
  readonly noise: AudioBuffer;
  /** Keeps a source so the session can stop it early. */
  track(source: AudioScheduledSourceNode): void;
}

/** A sound's own input (its level and pan already set) and the context time it starts at. */
export interface VoiceOutput {
  readonly node: GainNode;
  readonly at: number;
}

/** Sources run a little past their envelope's end so the envelope, not the source, ends the sound. */
const SOURCE_OVERRUN = 0.02;

export function connectVoiceOutput(bus: VoiceBus, sound: Sound, preset: PatchPreset, at: number): VoiceOutput {
  const { context } = bus;
  const gain = context.createGain();
  gain.gain.value = voiceGain(sound, preset.gain);
  const panner = context.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, sound.settings.pan ?? preset.pan));
  gain.connect(panner);
  panner.connect(bus.dry);
  const reverb = Math.max(0, Math.min(1, sound.settings.rev ?? preset.rev));
  if (reverb > 0.001) {
    const send = context.createGain();
    send.gain.value = reverb;
    panner.connect(send);
    send.connect(bus.reverb);
  }
  return { node: gain, at };
}

export function oscillator(
  bus: VoiceBus,
  type: OscillatorType,
  frequency: number,
  destination: AudioNode,
  at: number,
  stop: number,
  detune = 0,
): OscillatorNode {
  const node = bus.context.createOscillator();
  node.type = type;
  node.frequency.value = Math.min(frequency, bus.context.sampleRate * 0.45);
  if (detune !== 0) node.detune.value = detune;
  node.connect(destination);
  node.start(at);
  node.stop(stop + SOURCE_OVERRUN);
  bus.track(node);
  return node;
}

/** A low-frequency oscillator modulating `target` by ±`depth` (a tremolo or vibrato), running from `at` to `stop`. */
export function modulator(bus: VoiceBus, frequency: number, depth: number, target: AudioParam, at: number, stop: number): void {
  const node = bus.context.createOscillator();
  node.frequency.value = frequency;
  const amount = bus.context.createGain();
  amount.gain.value = depth;
  node.connect(amount);
  amount.connect(target);
  node.start(at);
  node.stop(stop + SOURCE_OVERRUN);
  bus.track(node);
}

export function noise(bus: VoiceBus, destination: AudioNode, at: number, stop: number, offset = 0): AudioBufferSourceNode {
  const source = bus.context.createBufferSource();
  source.buffer = bus.noise;
  source.loop = true;
  source.connect(destination);
  source.start(at, offset % NOISE_SECONDS);
  source.stop(stop + SOURCE_OVERRUN);
  bus.track(source);
  return source;
}

export function filter(
  context: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  resonance: number,
  destination: AudioNode,
): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = resonance;
  node.connect(destination);
  return node;
}
