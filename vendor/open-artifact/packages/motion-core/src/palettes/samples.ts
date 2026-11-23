import { hueDistance, rgbToOklch } from '../recolor/color.ts';

/** What one picture pair shows: pixels read, pixels changed, pixels in the set's hues, and those of them changed. */
export type PixelTally = [read: number, changed: number, inHues: number, inHuesChanged: number];

/** How a turn of a set of hues shows on the film's pictures. */
export interface RecolorSample {
  /** The share of pixels the turn changes. */
  changes: number;
  /** The share of the pixels in the set's hues that it changes. */
  covered: number;
}

/** How far apart (any channel, 0 to 255) two pixels must be to count as changed. */
const CHANGED_PIXEL_DISTANCE = 24;
/** Pixels with less spread between channels than this are gray. */
const GRAY_PIXEL_SPREAD = 16;
const HUE_PIXEL_CHROMA = 0.05;
const HUE_PIXEL_DISTANCE = 15;

/**
 * Two RGBA pictures of the same moment, before and after a turn, compared every other pixel: how many changed, and
 * how many showed one of `hues` and changed.
 */
export function compareRecoloredPixels(before: ArrayLike<number>, after: ArrayLike<number>, hues: readonly number[]): PixelTally {
  const tally: PixelTally = [0, 0, 0, 0];
  for (let index = 0; index + 3 < before.length && index + 3 < after.length; index += 8) {
    const red = before[index]!;
    const green = before[index + 1]!;
    const blue = before[index + 2]!;
    const changed = Math.max(Math.abs(red - after[index]!), Math.abs(green - after[index + 1]!), Math.abs(blue - after[index + 2]!)) > CHANGED_PIXEL_DISTANCE;
    const color = Math.max(red, green, blue) - Math.min(red, green, blue) < GRAY_PIXEL_SPREAD ? null : rgbToOklch([red, green, blue]);
    const inHues = color !== null && color.C >= HUE_PIXEL_CHROMA && hues.some((hue) => hueDistance(hue, color.h) <= HUE_PIXEL_DISTANCE);
    tally[0]++;
    if (changed) tally[1]++;
    if (inHues) tally[2]++;
    if (inHues && changed) tally[3]++;
  }
  return tally;
}

/** The tallies of a turn's pictures as shares. */
export function summarizeRecoloredPixels(tallies: readonly PixelTally[]): RecolorSample {
  const [read, changed, inHues, inHuesChanged] = [0, 1, 2, 3].map((at) => tallies.reduce((sum, tally) => sum + tally[at]!, 0)) as [number, number, number, number];
  return { changes: read === 0 ? 0 : changed / read, covered: inHues === 0 ? 1 : inHuesChanged / inHues };
}

/**
 * Which set of hues to offer turns of (an index into the samples, or -1): the one whose probe changes the pictures
 * most, when it changes at least 0.5% of them and 60% of its hues' pixels, and twice as much as any other.
 */
export function chooseDistinctRecolorSample(samples: readonly RecolorSample[]): number {
  const best = samples.reduce((found, sample, index) => (sample.changes > (samples[found]?.changes ?? -1) ? index : found), -1);
  const chosen = samples[best];
  return chosen !== undefined &&
    chosen.covered >= 0.6 &&
    chosen.changes >= 0.005 &&
    samples.every((sample, index) => index === best || chosen.changes >= 2 * sample.changes)
    ? best
    : -1;
}

/** How many moments a film's pictures are compared at. */
export const STYLE_CARD_SAMPLE_COUNT = 6;
/** How wide (in pixels) the compared pictures are drawn. */
export const STYLE_CARD_FRAME_WIDTH = 480;

/** The moments a film of `duration` is compared at (in its unit): the middles of six equal stretches. */
export const recolorSampleTimes = (duration: number): number[] =>
  Array.from({ length: STYLE_CARD_SAMPLE_COUNT }, (_unused, index) => ((index + 0.5) / STYLE_CARD_SAMPLE_COUNT) * duration);
