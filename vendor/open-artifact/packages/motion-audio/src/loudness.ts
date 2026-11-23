/** The parts of a decoded buffer the meter and the PCM writers read, so plain arrays can stand in for one. */
export type PcmSource = Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels' | 'getChannelData'>;

export interface LoudnessMeasurement {
  /** Integrated loudness (BS.1770, gated); −Infinity for silence. */
  readonly lufs: number;
  /** The largest sample, as a gain. */
  readonly peak: number;
}

export const DEFAULT_TARGET_LUFS = -16;
/** No target is louder than this. */
export const LOUDEST_TARGET_LUFS = -6;
/** Normalization raises a quiet score by this much at most. */
export const MAX_NORMALIZATION_DB = 14;
/** Nor so far that its peak passes this; the limiter and clipper take what is over full scale. */
export const MAX_NORMALIZED_PEAK = 2.5;
/** Nor lowers it below this gain. */
export const LEAST_NORMALIZATION_GAIN = 0.05;

/** K-weighting's two biquads (high shelf, then high pass) as b0, b1, b2, a1, a2, for 48 kHz. */
const SHELF = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585] as const;
const HIGH_PASS = [1, -2, 1, -1.99004745483398, 0.99007225036621] as const;
const BLOCK_SECONDS = 0.4;
const STEP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = 10;

const energyLufs = (energy: number): number => -0.691 + 10 * Math.log10(Math.max(energy, 1e-12));
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Integrated loudness over 400 ms blocks every 100 ms, gated at −70 LUFS and then 10 LU under the mean. */
export function measureIntegratedLoudness(buffer: PcmSource): LoudnessMeasurement {
  const blockFrames = Math.round(BLOCK_SECONDS * buffer.sampleRate);
  const stepFrames = Math.round(STEP_SECONDS * buffer.sampleRate);
  const blockCount = Math.max(0, Math.floor((buffer.length - blockFrames) / stepFrames) + 1);
  const blockEnergies = new Float64Array(blockCount);
  const energyAtBlockStart = new Float64Array(blockCount);
  const [s0, s1, s2, sa1, sa2] = SHELF;
  const [h0, h1, h2, ha1, ha2] = HIGH_PASS;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    let shelfIn1 = 0;
    let shelfIn2 = 0;
    let shelfOut1 = 0;
    let shelfOut2 = 0;
    let passIn1 = 0;
    let passIn2 = 0;
    let passOut1 = 0;
    let passOut2 = 0;
    let energy = 0;
    let nextStart = 0;
    let nextEnd = 0;
    for (let frame = 0; frame < samples.length; frame++) {
      if (nextStart < blockCount && frame === nextStart * stepFrames) energyAtBlockStart[nextStart++] = energy;
      const sample = samples[frame];
      const size = Math.abs(sample);
      if (size > peak) peak = size;
      const shelved = s0 * sample + s1 * shelfIn1 + s2 * shelfIn2 - sa1 * shelfOut1 - sa2 * shelfOut2;
      shelfIn2 = shelfIn1;
      shelfIn1 = sample;
      shelfOut2 = shelfOut1;
      shelfOut1 = shelved;
      // The filters run in single precision between stages, as a Float32 pipeline would.
      const shelvedSingle = Math.fround(shelved);
      const passed = h0 * shelvedSingle + h1 * passIn1 + h2 * passIn2 - ha1 * passOut1 - ha2 * passOut2;
      passIn2 = passIn1;
      passIn1 = shelvedSingle;
      passOut2 = passOut1;
      passOut1 = passed;
      const weighted = Math.fround(passed);
      energy += weighted * weighted;
      if (nextEnd < blockCount && frame + 1 === nextEnd * stepFrames + blockFrames) {
        blockEnergies[nextEnd] += (energy - energyAtBlockStart[nextEnd]) / blockFrames;
        nextEnd++;
      }
    }
  }
  const loudBlocks = Array.from(blockEnergies).filter((energy) => energyLufs(energy) > ABSOLUTE_GATE_LUFS);
  if (loudBlocks.length === 0) return { lufs: -Infinity, peak };
  const relativeGate = energyLufs(mean(loudBlocks)) - RELATIVE_GATE_LU;
  const gated = loudBlocks.filter((energy) => energyLufs(energy) > relativeGate);
  return { lufs: energyLufs(mean(gated)), peak };
}

/**
 * The gain that brings a measured sound to `target` LUFS (the default when undefined, none when null), within the
 * normalization's bounds and the peak's room.
 */
export function loudnessGain(measurement: LoudnessMeasurement, target: number | null | undefined): number {
  if (target === null || !Number.isFinite(measurement.lufs)) return 1;
  const wanted = Math.pow(10, (Math.min(LOUDEST_TARGET_LUFS, target ?? DEFAULT_TARGET_LUFS) - measurement.lufs) / 20);
  const peakRoom = measurement.peak > 0 ? MAX_NORMALIZED_PEAK / measurement.peak : Infinity;
  return Math.max(LEAST_NORMALIZATION_GAIN, Math.min(wanted, Math.pow(10, MAX_NORMALIZATION_DB / 20), peakRoom));
}

export interface AudioLevel {
  /** Seconds from the buffer's start. */
  readonly t: number;
  readonly peak: number;
  readonly rms: number;
}

/** Peak and RMS over every `intervalSeconds`, across all channels. */
export function sampleLevels(buffer: PcmSource, intervalSeconds = 0.5): AudioLevel[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_unused, index) => buffer.getChannelData(index));
  const intervalFrames = Math.max(1, Math.round(buffer.sampleRate * intervalSeconds));
  const levels: AudioLevel[] = [];
  for (let start = 0; start < buffer.length; start += intervalFrames) {
    const end = Math.min(buffer.length, start + intervalFrames);
    let peak = 0;
    let squares = 0;
    let count = 0;
    for (const samples of channels) {
      for (let frame = start; frame < end; frame++) {
        const sample = samples[frame] ?? 0;
        peak = Math.max(peak, Math.abs(sample));
        squares += sample * sample;
        count++;
      }
    }
    levels.push({ t: start / buffer.sampleRate, peak, rms: Math.sqrt(squares / Math.max(1, count)) });
  }
  return levels;
}
