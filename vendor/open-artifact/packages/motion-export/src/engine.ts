import { EXPORT_SETTINGS, playSeconds } from '@open-artifact/motion-core';
import type { ExportFormat, ExportProblem } from '@open-artifact/motion-core';
import { renderFilmAudio } from '@open-artifact/motion-audio';
import type { FilmSound } from '@open-artifact/motion-audio';
import { ExportCheckError, VideoUnsupportedError, exportAbortError, isAborted } from './errors.ts';
import { VIDEO_PROBE_FRACTIONS, gifSeconds, probeFrames, probeGif, videoSeconds } from './estimate.ts';
import { exportFilename } from './filename.ts';
import type { FilmFacts, FrameSource } from './frame-source.ts';
import { encodeGif } from './gif/encode.ts';
import { createGifEstimator } from './gif/estimator.ts';
import { encodeMov } from './mov/encode.ts';
import { createMovProbe, movSeconds } from './mov/estimate.ts';
import { MOV_SETTINGS, planMovFrames } from './mov/plan.ts';
import type { MovChoices } from './mov/plan.ts';
import { createAlphaSurface } from './mov/surface.ts';
import type { GifMeasureTools } from './gif/estimator.ts';
import type { SurfaceMaker } from './gif/surface.ts';
import { estimateVideoBytes, planGifFrames, resolveGifPreset, resolveVideoSettings } from './plan.ts';
import type { GifPresetName, VideoSettings } from './plan.ts';
import { gifExportFormat, heldProblem, videoExportFormat } from './problems.ts';
import { createRasterHost } from './raster/host.ts';
import type { RasterCache, RasterHost } from './raster/host.ts';
import { stageExportFrame } from './stage-frame.ts';
import type { ExportEstimate, ExportFrame, ExportRunOptions, RenderedFile } from './types.ts';
import { newEncoderMemory } from './video/attempts.ts';
import type { EncoderMemory } from './video/attempts.ts';
import { encodeVideo } from './video/encode.ts';
import { planVideoExport } from './video/format.ts';
import type { VideoFormat, VideoPlan } from './video/format.ts';
import type { EncodeTryListener } from './visibility.ts';
import { formatLabels, words } from './words.ts';

export interface ExportEngineOptions {
  source: FrameSource;
  /** The raster frame's script (`virtual:motion-raster-frame`, or `buildRasterFrame()`). */
  rasterScript: string;
  document?: Document;
  /** Which encoder set-up worked last; kept by the editor across exports. */
  memory?: EncoderMemory;
  onTry?: EncodeTryListener;
  rasterCache?: RasterCache;
  surface?: SurfaceMaker;
  /** Where a MOV's frames are drawn and read back with their alpha. */
  alphaSurface?: SurfaceMaker;
  gifTools?: GifMeasureTools;
}

/** A finished video or GIF, with what to tell the agent about it. */
export interface ExportResult extends RenderedFile {
  format: ExportFormat;
  /** Frames that had to be held; null when every frame was drawn. */
  problem: ExportProblem | null;
}

export interface ExportEngine {
  /** The format a video with these settings would be; null when this browser cannot make one. */
  videoFormat(settings: Partial<VideoSettings>): Promise<VideoFormat | null>;
  estimateVideo(settings: Partial<VideoSettings>, signal?: AbortSignal): Promise<ExportEstimate | null>;
  estimateGif(preset: GifPresetName, signal?: AbortSignal): Promise<ExportEstimate | null>;
  estimateMov(choices: Partial<MovChoices>, signal?: AbortSignal): Promise<ExportEstimate | null>;
  /** Rejects with the error that stopped it; `failedProblem(error)` says whether the film was to blame. */
  exportVideo(settings: Partial<VideoSettings>, options?: ExportRunOptions): Promise<ExportResult>;
  exportGif(preset: GifPresetName, options?: ExportRunOptions): Promise<ExportResult>;
  /** A QuickTime Animation movie that keeps the film's transparent background, with its sound as PCM. */
  exportMov(choices: Partial<MovChoices>, options?: ExportRunOptions): Promise<ExportResult>;
  dispose(): void;
}

const audible = (sound: FilmSound | null): sound is FilmSound => sound !== null && (sound.score.sounds.length > 0 || (sound.speech?.clips.length ?? 0) > 0);

const withSignal = (signal: AbortSignal | undefined): { signal?: AbortSignal } => (signal !== undefined ? { signal } : {});

/** Makes videos, GIFs and MOVs of the film a FrameSource draws. */
export function createExportEngine(options: ExportEngineOptions): ExportEngine {
  const { source } = options;
  const page = options.document ?? document;
  const memory = options.memory ?? newEncoderMemory();
  const plans = new Map<string, Promise<VideoPlan | null>>();
  const rasters = new Set<RasterHost>();

  const facts = (): FilmFacts => {
    const known = source.facts();
    if (known === null) throw new ExportCheckError(words.noFilm, 'no_film');
    return known;
  };

  const planFor = (film: FilmFacts, settings: Partial<VideoSettings>): Promise<VideoPlan | null> => {
    const resolved = resolveVideoSettings(settings, film);
    const key = JSON.stringify([film.width, film.height, film.fps, film.duration, resolved]);
    let plan = plans.get(key);
    if (plan === undefined) {
      plan = planVideoExport(film, resolved).then((made) => (made !== null && EXPORT_SETTINGS.withoutH264 === 'none' && made.format.videoCodec !== 'avc' ? null : made));
      plan.catch(() => plans.delete(key));
      plans.set(key, plan);
    }
    return plan;
  };

  /** Runs `work` with the stage lent to the export and a raster frame of its own; both are given back after. */
  async function withStage<T>(work: (frame: ExportFrame) => Promise<T>): Promise<T> {
    const release = source.borrow();
    const raster = createRasterHost({
      script: options.rasterScript,
      document: page,
      clippedTextWaitMs: () => source.clippedTextWaitMs(),
      ...(options.rasterCache !== undefined ? { cache: options.rasterCache } : {}),
    });
    rasters.add(raster);
    try {
      return await work(stageExportFrame(source, raster));
    } finally {
      rasters.delete(raster);
      raster.dispose();
      await release();
    }
  }

  return {
    async videoFormat(settings) {
      const film = source.facts();
      return film === null ? null : ((await planFor(film, settings))?.format ?? null);
    },

    async estimateVideo(settings, signal) {
      const film = facts();
      const plan = await planFor(film, settings);
      if (plan === null || isAborted(signal)) return null;
      const withAudio = plan.format.audioCodec !== null && audible(source.sound());
      const scale = settings.supersample === true ? 2 : 1;
      const size = { width: plan.width * scale, height: plan.height * scale };
      const msPerFrame = await withStage((frame) =>
        probeFrames(
          frame,
          VIDEO_PROBE_FRACTIONS.map((fraction) => playSeconds(film.duration * fraction)),
          size,
          signal,
        ),
      );
      if (isAborted(signal)) return null;
      return {
        bytes: estimateVideoBytes(plan, film.duration, withAudio),
        seconds: videoSeconds(plan.frames, msPerFrame, film.duration, withAudio),
        label: plan.format.label,
      };
    },

    async estimateGif(presetName, signal) {
      const film = facts();
      const preset = resolveGifPreset(presetName);
      const plan = planGifFrames(film, preset);
      const estimator = createGifEstimator(plan, options.surface, options.gifTools);
      const probed = await withStage((frame) => probeGif(frame, plan, preset, film.duration, estimator, signal));
      if (probed === null || isAborted(signal)) return null;
      return {
        bytes: probed.measure.bytes,
        seconds: gifSeconds(plan.frames, probed.frameMs, probed.measure.msPerFrame),
        label: formatLabels.gif,
        ...(probed.measure.atLeast === true ? { atLeast: true } : {}),
      };
    },

    async estimateMov(choices, signal) {
      const film = facts();
      const plan = planMovFrames(film, choices);
      const withAudio = audible(source.sound());
      const scale = choices.supersample === true ? 2 : 1;
      const probe = createMovProbe(plan, film.duration, (options.alphaSurface ?? createAlphaSurface)(plan));
      try {
        const frameMs = await withStage((frame) =>
          probeFrames(
            frame,
            VIDEO_PROBE_FRACTIONS.map((fraction) => playSeconds(film.duration * fraction)),
            { width: plan.width * scale, height: plan.height * scale },
            signal,
            (bitmap) => probe.add(bitmap),
          ),
        );
        if (isAborted(signal)) return null;
        const measure = probe.measure(withAudio);
        return {
          bytes: measure.bytes,
          seconds: movSeconds(plan.frames, frameMs, measure.encodeMs, film.duration, withAudio),
          label: formatLabels.mov,
          mov: { bytesPerSecond: measure.bytesPerSecond, budget: measure.budget, maxBytes: MOV_SETTINGS.maxBytes },
        };
      } finally {
        probe.dispose();
      }
    },

    async exportVideo(settings, run = {}) {
      const film = facts();
      const plan = await planFor(film, settings);
      if (plan === null) throw new VideoUnsupportedError();
      const sound = source.sound();
      let audio: AudioBuffer | null = null;
      if (plan.format.audioCodec !== null && audible(sound)) {
        run.onProgress?.({ done: 0, total: plan.frames, phase: 'audio' });
        audio = (await renderFilmAudio(sound)).buffer;
      }
      if (isAborted(run.signal)) throw exportAbortError();
      const made = await withStage((frame) =>
        encodeVideo({
          plan,
          frame,
          audio,
          supersample: settings.supersample === true,
          firstPacketMs: EXPORT_SETTINGS.firstPacketS * 1000,
          nextOnBreak: EXPORT_SETTINGS.onBreak === 'next',
          rangeFromStream: EXPORT_SETTINGS.rangeLabel === 'stream',
          lastInSoftware: EXPORT_SETTINGS.lastTry === 'software',
          stalls: EXPORT_SETTINGS.stallsInView,
          page,
          memory,
          ...(options.onTry !== undefined ? { onTry: options.onTry } : {}),
          ...(run.onProgress !== undefined ? { onProgress: run.onProgress } : {}),
          ...withSignal(run.signal),
        }),
      );
      return {
        blob: new Blob([made.bytes], { type: 'video/mp4' }),
        filename: exportFilename(film.title, 'mp4'),
        mime: 'video/mp4',
        held: made.held,
        ms: made.ms,
        format: videoExportFormat(plan),
        problem: heldProblem(made.held, true),
      };
    },

    async exportGif(presetName, run = {}) {
      const film = facts();
      const preset = resolveGifPreset(presetName);
      const plan = planGifFrames(film, preset);
      const made = await withStage((frame) =>
        encodeGif({
          plan,
          duration: film.duration,
          frame,
          maxBytes: preset.maxBytes,
          page,
          ...(options.surface !== undefined ? { surface: options.surface } : {}),
          ...(run.onProgress !== undefined ? { onProgress: run.onProgress } : {}),
          ...withSignal(run.signal),
        }),
      );
      return {
        blob: new Blob([made.bytes.slice()], { type: 'image/gif' }),
        filename: exportFilename(film.title, 'gif'),
        mime: 'image/gif',
        held: made.held,
        ms: made.ms,
        format: gifExportFormat(plan),
        problem: heldProblem(made.held, true),
      };
    },

    async exportMov(choices, run = {}) {
      const film = facts();
      const plan = planMovFrames(film, choices);
      const sound = source.sound();
      let audio: AudioBuffer | null = null;
      if (audible(sound)) {
        run.onProgress?.({ done: 0, total: plan.frames, phase: 'audio' });
        audio = (await renderFilmAudio(sound)).buffer;
      }
      if (isAborted(run.signal)) throw exportAbortError();
      const made = await withStage((frame) =>
        encodeMov({
          plan,
          frame,
          audio,
          supersample: choices.supersample === true,
          page,
          ...(options.alphaSurface !== undefined ? { surface: options.alphaSurface } : {}),
          ...(run.onProgress !== undefined ? { onProgress: run.onProgress } : {}),
          ...withSignal(run.signal),
        }),
      );
      return {
        blob: made.blob,
        filename: exportFilename(film.title, 'mov'),
        mime: 'video/quicktime',
        held: made.held,
        ms: made.ms,
        format: videoExportFormat(plan),
        problem: heldProblem(made.held, true),
      };
    },

    dispose() {
      for (const raster of rasters) raster.dispose();
      rasters.clear();
      plans.clear();
    },
  };
}
