import { seededRandom } from './synth/noise.ts';

export const REVERB_SECONDS = 1.9;
/** The reverb return's level into the mix. */
export const REVERB_RETURN = 0.5;
const REVERB_SEED = 777;
/** Samples over which the impulse fades in, so it starts without a click. */
const FADE_IN_SAMPLES = 200;

/** A room's impulse: seeded noise decaying on a 2.6 power curve, one channel after the other from the same generator. */
export function reverbImpulseSamples(sampleRate: number, seconds = REVERB_SECONDS): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const random = seededRandom(REVERB_SEED);
  const length = Math.round(sampleRate * seconds);
  const channel = (): Float32Array<ArrayBuffer> => {
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index++) {
      const progress = index / length;
      samples[index] = (random() * 2 - 1) * Math.pow(1 - progress, 2.6) * (index < FADE_IN_SAMPLES ? index / FADE_IN_SAMPLES : 1);
    }
    return samples;
  };
  const left = channel();
  return [left, channel()];
}

/** The reverb send: a convolver on the impulse above, at the return level. Returns its input and its output. */
export function createReverb(context: BaseAudioContext): { input: GainNode; output: GainNode } {
  const input = context.createGain();
  const convolver = context.createConvolver();
  convolver.normalize = true;
  const [left, right] = reverbImpulseSamples(context.sampleRate);
  const impulse = context.createBuffer(2, left.length, context.sampleRate);
  impulse.copyToChannel(left, 0);
  impulse.copyToChannel(right, 1);
  convolver.buffer = impulse;
  const output = context.createGain();
  output.gain.value = REVERB_RETURN;
  input.connect(convolver);
  convolver.connect(output);
  return { input, output };
}
