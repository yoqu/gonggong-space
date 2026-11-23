/** A small deterministic generator in [0, 1), so noise and reverb sound the same on every render. */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 1831565813) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE_SECONDS = 1.5;
const NOISE_SEED = 12345;

export function noiseSamples(length: number): Float32Array<ArrayBuffer> {
  const random = seededRandom(NOISE_SEED);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) samples[index] = random() * 2 - 1;
  return samples;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A second and a half of white noise per context, looped by every noisy sound from its own offset. */
export function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  const kept = noiseBuffers.get(context);
  if (kept !== undefined) return kept;
  const length = Math.round(context.sampleRate * NOISE_SECONDS);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  buffer.copyToChannel(noiseSamples(length), 0);
  noiseBuffers.set(context, buffer);
  return buffer;
}
