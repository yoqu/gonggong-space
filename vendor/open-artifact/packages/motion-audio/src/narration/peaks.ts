export const PEAKS_PER_SECOND = 60;
export const LEAST_PEAKS = 8;
export const MOST_PEAKS = 1800;
/** No bar is drawn lower than this, so silence still shows the take. */
export const PEAK_FLOOR = 0.08;
/** Lifts quiet speech so it still shows. */
export const PEAK_GAMMA = 0.6;
/** Samples read per bar at most. */
export const SAMPLES_PER_PEAK = 256;

/**
 * A take's waveform for the voiceover lane: bars at 60 a second (8 to 1800), each the loudest of the samples read across
 * its span, scaled to the take's loudest bar and lifted by the gamma.
 */
export function voicePeaks(samples: Float32Array, seconds: number): number[] {
  const count = Math.min(MOST_PEAKS, Math.max(LEAST_PEAKS, Math.round(seconds * PEAKS_PER_SECOND)));
  const span = samples.length / count;
  const stride = Math.max(1, Math.floor(span / SAMPLES_PER_PEAK));
  const bars = Array.from({ length: count }, (_unused, index) => {
    let peak = 0;
    for (let sample = Math.floor(index * span), end = Math.floor((index + 1) * span); sample < end; sample += stride) {
      peak = Math.max(peak, Math.abs(samples[sample] ?? 0));
    }
    return peak;
  });
  const loudest = Math.max(...bars);
  return bars.map((bar) => (loudest === 0 ? PEAK_FLOOR : Math.max(PEAK_FLOOR, Number(((bar / loudest) ** PEAK_GAMMA).toFixed(3)))));
}
