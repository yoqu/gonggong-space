import { createReverb } from './reverb.ts';

/**
 * The master bus. The score's dry and reverb sends meet in a gentle compressor, take the loudness normalization gain, are
 * ducked under narration, then join the narration in a limiter, and a soft clipper keeps the sum under full scale.
 */
export interface MasterBus {
  readonly context: BaseAudioContext;
  /** The score's dry send. */
  readonly input: GainNode;
  /** The score's reverb send. */
  readonly reverbInput: GainNode;
  /** The score's loudness normalization gain. */
  readonly normalization: GainNode;
  /** The score's level under narration. */
  readonly duck: GainNode;
  /** Narration's input, past the score's compressor, normalization and ducking. */
  readonly speech: GainNode;
  /** The listener's volume (0 when muted). */
  readonly output: GainNode;
}

const CLIP_KNEE = 0.85;
const CLIP_POINTS = 2049;
/** The limiter's output is halved before the clipper, whose curve spans −2…2. */
const CLIP_INPUT_GAIN = 0.5;

/** Linear up to 0.85, then bending smoothly towards 1 (tanh), over inputs −2…2. */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CLIP_POINTS);
  for (let index = 0; index < CLIP_POINTS; index++) {
    const input = (index / (CLIP_POINTS - 1)) * 4 - 2;
    const size = Math.abs(input);
    curve[index] = Math.sign(input) * (size < CLIP_KNEE ? size : CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((size - CLIP_KNEE) / (1 - CLIP_KNEE)));
  }
  return curve;
}

/** The score's master level in dB, kept within −40…6, as a gain. */
export function masterGain(decibels: number): number {
  return Math.pow(10, Math.max(-40, Math.min(6, decibels)) / 20);
}

/**
 * The score's level at play time `play` given its master level and a fade-out over the last `fadeOut` seconds of
 * `duration`: the level to resume from when playback starts inside the fade.
 */
export function fadeLevel(level: number, fadeOut: number, duration: number, play: number): number {
  const fade = Math.max(0, Math.min(duration, fadeOut));
  if (duration <= 0 || fade <= 0) return level;
  const fadeStart = duration - fade;
  if (play <= fadeStart) return level;
  if (play >= duration) return 0;
  return level * (1 - (play - fadeStart) / fade);
}

export function createMasterBus(context: BaseAudioContext, destination: AudioNode = context.destination): MasterBus {
  const input = context.createGain();
  const reverb = createReverb(context);
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 10;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.2;
  input.connect(compressor);
  reverb.output.connect(compressor);
  const normalization = context.createGain();
  const duck = context.createGain();
  const speech = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  const clipInput = context.createGain();
  clipInput.gain.value = CLIP_INPUT_GAIN;
  const clipper = context.createWaveShaper();
  clipper.curve = softClipCurve();
  clipper.oversample = 'none';
  const output = context.createGain();
  compressor.connect(normalization);
  normalization.connect(duck);
  duck.connect(limiter);
  speech.connect(limiter);
  limiter.connect(clipInput);
  clipInput.connect(clipper);
  clipper.connect(output);
  output.connect(destination);
  return { context, input, reverbInput: reverb.input, normalization, duck, speech, output };
}
