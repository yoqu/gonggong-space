import { EXPORT_SETTINGS, GIF_SETTINGS } from '@open-artifact/motion-core';
import type { FilmFacts } from './frame-source.ts';
import { BYTES_PER_MEBIBYTE } from './errors.ts';
import type { ExportDimensions, FramePlan } from './types.ts';

export const EXPORT_AUDIO_BITRATE = 128_000;
export const VIDEO_HEIGHTS = [720, 1080] as const;
export type VideoHeight = (typeof VIDEO_HEIGHTS)[number];
export const VIDEO_FRAME_RATES = [24, 30, 60] as const;
export const MAX_EXPORT_FPS = 120;

export type VideoQuality = 'low' | 'medium' | 'high';
const QUALITY_MULTIPLIERS: Readonly<Record<VideoQuality, number>> = { high: 1, medium: 0.5, low: 0.25 };

/** What a person picks for a video. */
export interface VideoSettings {
  /** The short side, in pixels. */
  height: number;
  fps?: number;
  quality?: VideoQuality;
  maxVideoBitrate?: number;
  /** Draw each frame at twice the size and scale it down. */
  supersample?: boolean;
}

export interface VideoFramePlan extends FramePlan {
  videoBitrate: number;
}

export const evenDimension = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

/** The film's size with its short side at `shortSide` (never larger than the film's own), in even pixels. */
export function fitExportDimensions(film: ExportDimensions, shortSide: number): ExportDimensions {
  const sourceSide = Math.min(film.width, film.height);
  const targetSide = Math.min(shortSide, sourceSide);
  return { width: evenDimension((film.width * targetSide) / sourceSide), height: evenDimension((film.height * targetSide) / sourceSide) };
}

export function chooseVideoBitrate(size: ExportDimensions, fps: number, quality: VideoQuality = 'high'): number {
  const rate = fps > 45 ? 1 : quality === 'high' || fps > 20 ? 0.8 : 0.64;
  return Math.round((Math.min(size.width, size.height) >= 1000 ? 8_000_000 : 5_000_000) * rate * QUALITY_MULTIPLIERS[quality]);
}

/** The video bitrate that keeps a file of `duration` seconds, with its audio, under `maxBytes`. */
export function videoBitrateWithinBudget(duration: number, maxBytes: number): number {
  return Math.floor((maxBytes * 0.9 * 8) / Math.max(1, duration) - EXPORT_AUDIO_BITRATE);
}

export const isVideoHeight = (value: unknown): value is VideoHeight => typeof value === 'number' && (VIDEO_HEIGHTS as readonly number[]).includes(value);
const isQuality = (value: unknown): value is VideoQuality => value === 'low' || value === 'medium' || value === 'high';

/**
 * Settings as the export uses them: a known height (1080 otherwise), a quality, and a bitrate that keeps the file
 * within the export's size budget.
 */
export function resolveVideoSettings(settings: Partial<VideoSettings>, film: Pick<FilmFacts, 'duration'>): VideoSettings & { quality: VideoQuality } {
  const maxBytes = EXPORT_SETTINGS.maxMb * BYTES_PER_MEBIBYTE;
  const budget = Math.max(videoBitrateWithinBudget(film.duration, maxBytes), EXPORT_SETTINGS.floorKbps * 1000);
  return {
    height: isVideoHeight(settings.height) ? settings.height : 1080,
    ...(typeof settings.fps === 'number' && Number.isFinite(settings.fps) ? { fps: settings.fps } : {}),
    quality: isQuality(settings.quality) ? settings.quality : 'high',
    maxVideoBitrate: Math.min(settings.maxVideoBitrate ?? Number.POSITIVE_INFINITY, budget),
    supersample: settings.supersample === true,
  };
}

export function planVideoFrames(film: FilmFacts, settings: VideoSettings): VideoFramePlan {
  const size = fitExportDimensions(film, settings.height);
  const wanted = settings.fps !== undefined && Number.isFinite(settings.fps) ? settings.fps : film.fps;
  const fps = Math.max(1, Math.min(wanted, Math.max(1, film.fps), MAX_EXPORT_FPS));
  const videoBitrate = Math.min(chooseVideoBitrate(size, fps, settings.quality), settings.maxVideoBitrate ?? Number.POSITIVE_INFINITY);
  return { ...size, fps, frames: Math.max(1, Math.round(film.duration * fps)), videoBitrate };
}

export function estimateVideoBytes(plan: Pick<VideoFramePlan, 'videoBitrate'>, duration: number, withAudio: boolean): number {
  return Math.round(((duration * (plan.videoBitrate + (withAudio ? EXPORT_AUDIO_BITRATE : 0))) / 8) * 1.02 + 4096);
}

export type GifPresetName = 'standard' | 'small';

export interface GifPreset {
  shortSide: number;
  /** Hundredths of a second each frame shows. */
  delayCs: number;
  maxBytes: number;
  /** How long an estimate may spend on extra probes when the film rests. */
  estimateExtraMs: number;
}

export interface GifPlan extends FramePlan {
  delayCs: number;
}

/** A GIF preset; the small one is never larger nor faster than the standard one. */
export function resolveGifPreset(name: GifPresetName): GifPreset {
  const maxBytes = GIF_SETTINGS.maxMb * BYTES_PER_MEBIBYTE;
  const estimateExtraMs = GIF_SETTINGS.estimateExtraS * 1000;
  const standard = GIF_SETTINGS.standard;
  switch (name) {
    case 'standard':
      return { shortSide: standard.shortSide, delayCs: standard.delayCs, maxBytes, estimateExtraMs };
    case 'small':
      return {
        shortSide: Math.min(GIF_SETTINGS.small.shortSide, standard.shortSide),
        delayCs: Math.max(GIF_SETTINGS.small.delayCs, standard.delayCs),
        maxBytes,
        estimateExtraMs,
      };
    default: {
      const never: never = name;
      return never;
    }
  }
}

/** A GIF above this many bytes is heavy to share. */
export const GIF_HEAVY_BYTES = Math.min(GIF_SETTINGS.heavyMb, GIF_SETTINGS.maxMb) * BYTES_PER_MEBIBYTE;

export function planGifFrames(film: Pick<FilmFacts, 'width' | 'height' | 'duration'>, preset: Pick<GifPreset, 'shortSide' | 'delayCs'>): GifPlan {
  const fps = 100 / preset.delayCs;
  return { ...fitExportDimensions(film, preset.shortSide), delayCs: preset.delayCs, fps, frames: Math.max(1, Math.round(film.duration * fps)) };
}
