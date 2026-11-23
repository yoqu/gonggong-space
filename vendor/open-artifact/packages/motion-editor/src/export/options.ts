/** What the export dialog offers and advises, worked out from the film and the person's picks. */

import { SEND_SETTINGS, parseCssColor, type VideoFlags } from '@open-artifact/motion-core';
import { fitExportDimensions, movByteLimitMebibytes, storesWholeFrames } from '@open-artifact/motion-export';
import type { ExportDimensions, ExportEstimate, GifPresetName, HeldFrames, VideoHeight, VideoQuality } from '@open-artifact/motion-export';
import type { SceneReport } from '@open-artifact/motion-stage';
import { videoFlags } from '../host/flags.ts';
import { formatPlaybackTime } from '../transport/time-format.ts';
import * as words from './words.ts';

export const EXPORT_FORMATS = ['video', 'gif', 'mov', 'zip', 'html'] as const;
export type ExportFormatId = (typeof EXPORT_FORMATS)[number];

/** The formats this page offers: MOV only while its flag is on. */
export const offeredFormats = (flags: Pick<VideoFlags, 'movExport'> = videoFlags()): readonly ExportFormatId[] =>
  EXPORT_FORMATS.filter((format) => format !== 'mov' || flags.movExport);

/** Formats an estimate is made for: the ones drawn frame by frame. */
export const isMeasured = (format: ExportFormatId): format is 'video' | 'gif' | 'mov' => format === 'video' || format === 'gif' || format === 'mov';

/** The stage's background (its colour and image) lets what is behind it show. */
export function hasClearBackground(background: readonly [string, string] | undefined): boolean {
  if (background === undefined) return false;
  const [color, image] = background;
  const clear = (parseCssColor(color)?.alpha ?? 1) < 1;
  return clear && (image === '' || image === 'none');
}

export interface VideoOptions {
  height: VideoHeight;
  fps: number;
  quality: VideoQuality;
  supersample: boolean;
}

export interface FrameRates {
  full: number;
  half: number;
  /** null when a quarter of the rate would be under 12 frames a second. */
  quarter: number | null;
}

const LOWEST_QUARTER_RATE = 12;

export function frameRates(fps: number): FrameRates {
  const full = Math.max(2, Math.round(Number.isFinite(fps) ? fps : 30));
  const half = Math.max(1, Math.round(full / 2));
  const quarter = Math.round(full / 4);
  return { full, half, quarter: quarter >= LOWEST_QUARTER_RATE ? quarter : null };
}

export const defaultVideoOptions = (fps: number): VideoOptions => ({ height: 720, fps: frameRates(fps).full, quality: 'high', supersample: true });

/** The picks kept when the film's rate changes: a rate it no longer offers goes back to the full one. */
export function fitVideoOptions(options: VideoOptions, fps: number): VideoOptions {
  const rates = frameRates(fps);
  return [rates.full, rates.half, rates.quarter].includes(options.fps) ? options : { ...options, fps: rates.full };
}

/** The smallest file short of a shorter film: 720p, Low, and half the rate when it is over 30. */
export function smallerVideoOptions(options: VideoOptions, fps: number): VideoOptions {
  const rates = frameRates(fps);
  return { ...options, height: 720, fps: Math.min(options.fps, rates.full > 30 ? rates.half : rates.full), quality: 'low' };
}

export function canMakeSmaller(options: VideoOptions, fps: number): boolean {
  const smaller = smallerVideoOptions(options, fps);
  return smaller.height !== options.height || smaller.fps !== options.fps || smaller.quality !== options.quality;
}

/** An export this long is confirmed before it starts. */
export const asksFirst = (estimate: Pick<ExportEstimate, 'seconds'> | null): boolean => estimate !== null && estimate.seconds > SEND_SETTINGS.askOverS;

/** At the full rate, an export this long gets the advice of half the rate. */
export const suggestsHalfRate = (estimate: Pick<ExportEstimate, 'seconds'> | null, options: VideoOptions, fps: number): boolean =>
  estimate !== null && estimate.seconds > SEND_SETTINGS.fasterOverS && options.fps === frameRates(fps).full;

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(seconds: number): string {
  if (!(seconds >= 50)) return words.UNDER_A_MINUTE;
  return words.aboutMinutes(Math.round(seconds / 60));
}

/** The estimate as the dialog says it under the options. */
export function describeEstimate(format: 'video' | 'gif' | 'mov', estimate: ExportEstimate, options: VideoOptions, fps: number, gifMaxBytes: number): string {
  if (format === 'mov') {
    const perSecond = estimate.mov?.bytesPerSecond ?? estimate.bytes;
    return `${words.movPerSecond(formatFileSize(perSecond), storesWholeFrames())} · ${formatDuration(estimate.seconds)}`;
  }
  if (format === 'gif') {
    const size = formatFileSize(estimate.bytes);
    const parts = [estimate.atLeast === true ? words.atLeast(size) : words.about(size)];
    if (estimate.bytes <= gifMaxBytes) parts.push(formatDuration(estimate.seconds));
    return parts.join(' · ');
  }
  const said = `${words.upTo(formatFileSize(estimate.bytes))} · ${formatDuration(estimate.seconds)}`;
  return suggestsHalfRate(estimate, options, fps) ? `${said}. ${words.halfRateTip(frameRates(fps).half)}` : said;
}

/** What to say about a GIF's size: nothing, large, or over the limit; with the way out. */
export function gifSizeAdvice(bytes: number, heavyBytes: number, maxBytes: number, preset: GifPresetName, videoAvailable: boolean): string {
  if (bytes <= heavyBytes) return '';
  const way = preset === 'standard' ? (videoAvailable ? words.TRY_SMALL : words.TRY_SMALL_ONLY) : videoAvailable ? words.TRY_VIDEO : '';
  const said = bytes > maxBytes ? words.gifOverLimit(Math.floor(maxBytes / 1_048_576)) : words.GIF_LARGE;
  return way === '' ? said : `${said} ${way}`;
}

/** A MOV's size warning and its way out; null when the whole animation fits under the limit. */
export function movSizeAdvice(
  estimate: ExportEstimate,
  options: Pick<VideoOptions, 'height' | 'fps'>,
  film: ExportDimensions & { fps: number; duration: number },
): { warning: string; suggestion: string } | null {
  const mov = estimate.mov;
  if (mov === undefined) return null;
  const limit = movByteLimitMebibytes(mov.maxBytes);
  const whole = storesWholeFrames();
  if (mov.budget <= 0) return { warning: words.movSoundFills(limit), suggestion: words.MOV_SHORTER };
  if (mov.bytesPerSecond * film.duration <= mov.budget) return null;
  const seconds = Math.floor(mov.budget / Math.max(1, mov.bytesPerSecond));
  const rates = frameRates(film.fps);
  const lowerRate = options.fps > (rates.quarter ?? rates.half);
  const smallerAt720 = fitExportDimensions(film, 720).width < fitExportDimensions(film, options.height).width;
  const suggestion = smallerAt720
    ? lowerRate
      ? words.MOV_TRY_720_OR_RATE
      : words.MOV_TRY_720
    : lowerRate
      ? words.MOV_TRY_RATE
      : whole
        ? words.MOV_SHORTER
        : words.MOV_SHORTER_OR_STILLER;
  return { warning: words.movStopsAt(limit, seconds, whole), suggestion };
}

/** The MOV cannot be made at all: its sound alone fills the limit. */
export const movBlocked = (estimate: ExportEstimate | null): boolean => estimate?.mov !== undefined && estimate.mov.budget <= 0;

/** The note on a film that is not finished: scenes still to make, or a rough cut; null for a finished film. */
export function unfinishedNote(scenes: readonly SceneReport[] | null): string | null {
  if (scenes === null) return null;
  const missing = scenes.filter((scene) => scene.state === 'todo').length;
  if (missing > 0) return words.scenesMissing(missing);
  return scenes.some((scene) => scene.state === 'rough') ? words.ROUGH_CUT : null;
}

/** Where the held frames were, as the player shows times. */
export function heldWhere(held: HeldFrames): string {
  if (held.first === undefined) return '';
  const from = formatPlaybackTime(held.first.t);
  if (held.count === 1 || held.last === undefined) return words.heldAt(from);
  const to = formatPlaybackTime(held.last);
  return from === to ? words.heldAt(from) : words.heldBetween(from, to);
}

export const progressPercent = (done: number, total: number): number => (total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0);
