/**
 * Runs the export dialog: one export engine while it is open (the encoder memory outlives it), estimates for the
 * picks, an export with its progress and cancel, the file handed over, and what went wrong said in the page's words.
 */

import { exportProblemRequest, type ExportFormat, type FilmShape } from '@open-artifact/motion-core';
import {
  EncoderFailure,
  EncoderSilentError,
  ExportCheckError,
  FrameRenderError,
  FrameStallError,
  GifTooLargeError,
  MovTooLargeError,
  SourceExportError,
  VideoUnsupportedError,
  createExportEngine,
  failedProblem,
  isAbortError,
  newEncoderMemory,
  resolveGifPreset,
  type ExportEngine,
  type ExportedFile,
  type ExportProgress,
  type MovChoices,
  type VideoSettings,
} from '@open-artifact/motion-export';
import type { FilmSound } from '@open-artifact/motion-audio';
import { askShape } from '../agent/requests.ts';
import { isStaleBuildError } from '../app/stale-build.ts';
import { sendAgentRequest } from '../agent/send.ts';
import { filmEngine } from '../engine/engine-context.ts';
import { maybeSession } from '../host/session.ts';
import { useFilm } from '../stores/film.ts';
import { agentName } from '../stores/working.ts';
import { formatPlaybackTime } from '../transport/time-format.ts';
import { exportSourceZip, exportStandalonePage, type CodeInput } from './code-files.ts';
import { deliverFile, downloadInBrowser, type Delivery } from './deliver.ts';
import { editorFrameSource, filmFacts } from './frame-source.ts';
import {
  asksFirst,
  canMakeSmaller,
  fitVideoOptions,
  isMeasured,
  movSizeAdvice,
  offeredFormats,
  smallerVideoOptions,
  type ExportFormatId,
  type VideoOptions,
} from './options.ts';
import { scoreMidi } from './score-file.ts';
import { chosenShape } from './shapes.ts';
import { OPTIONS_STEP, useExport, type ExportState, type FixableProblem, type NoEstimate, type Progress } from './store.ts';
import * as words from './words.ts';

const ESTIMATE_DELAY_MS = 300;

/** Which encoder set-up worked last, kept from one dialog to the next. */
const memory = newEncoderMemory();

let engine: Promise<ExportEngine | null> | null = null;
let estimateRun: AbortController | null = null;
let estimateTimer: ReturnType<typeof setTimeout> | undefined;
let exportRun: AbortController | null = null;

const set = (patch: Partial<ExportState>): void => useExport.setState(patch);

function exportEngine(): Promise<ExportEngine | null> {
  engine ??= (async () => {
    const film = filmEngine();
    if (film === null) return null;
    const raster = await import('virtual:motion-raster-frame');
    return createExportEngine({ source: editorFrameSource(film), rasterScript: raster.default, memory });
  })();
  return engine;
}

const videoSettings = (options: VideoOptions): VideoSettings => ({ height: options.height, fps: options.fps, quality: options.quality, supersample: options.supersample });

/** A MOV takes the video's resolution, rate and supersampling; it has no quality to pick. */
const movChoices = (options: VideoOptions): MovChoices => ({ height: options.height, fps: options.fps, supersample: options.supersample });

const audible = (sound: FilmSound): boolean => sound.score.sounds.length > 0 || (sound.speech?.clips.length ?? 0) > 0;

function stopEstimate(): void {
  clearTimeout(estimateTimer);
  estimateRun?.abort();
  estimateRun = null;
}

const noEstimate = (error: unknown): NoEstimate =>
  error instanceof VideoUnsupportedError ? 'unsupported' : error instanceof FrameRenderError ? 'film' : error instanceof FrameStallError ? 'slow' : 'failed';

async function estimateNow(run: AbortController): Promise<void> {
  const { format, video, gif } = useExport.getState();
  const exporter = await exportEngine();
  if (exporter === null || run.signal.aborted || !isMeasured(format)) return;
  try {
    const estimate =
      format === 'video'
        ? await exporter.estimateVideo(videoSettings(video), run.signal)
        : format === 'mov'
          ? await exporter.estimateMov(movChoices(video), run.signal)
          : await exporter.estimateGif(gif, run.signal);
    if (run.signal.aborted) return;
    set({ estimate: estimate === null ? (format === 'video' ? { kind: 'missing', why: 'unsupported' } : { kind: 'none' }) : { kind: 'ready', estimate } });
  } catch (error) {
    if (run.signal.aborted || isAbortError(error)) return;
    set({ estimate: { kind: 'missing', why: noEstimate(error) } });
  }
}

/** Estimates the picks a moment after they settle; the film's own shape only, and never during an export. */
export function scheduleEstimate(): void {
  stopEstimate();
  const state = useExport.getState();
  if (!state.open || state.step.kind !== 'options' || state.shape.kind !== 'own' || !isMeasured(state.format) || filmFacts() === null) {
    set({ estimate: { kind: 'none' } });
    return;
  }
  if (state.format === 'video' && state.videoAvailable === false) {
    set({ estimate: { kind: 'missing', why: 'unsupported' } });
    return;
  }
  set({ estimate: { kind: 'busy' } });
  const run = new AbortController();
  estimateRun = run;
  estimateTimer = setTimeout(() => void estimateNow(run), ESTIMATE_DELAY_MS);
}

async function checkVideo(): Promise<void> {
  const exporter = await exportEngine();
  const { video } = useExport.getState();
  const format = exporter === null || filmFacts() === null ? null : await exporter.videoFormat(videoSettings(video)).catch(() => null);
  set({ videoAvailable: format !== null });
  scheduleEstimate();
}

export function openExport(): void {
  const facts = filmFacts();
  const { video, format } = useExport.getState();
  set({
    open: true,
    step: OPTIONS_STEP,
    videoAvailable: null,
    estimate: { kind: 'none' },
    ...(offeredFormats().includes(format) ? {} : { format: 'video' as const }),
    ...(facts !== null ? { video: fitVideoOptions(video, facts.fps) } : {}),
  });
  void checkVideo();
}

export function closeExport(): void {
  stopEstimate();
  exportRun?.abort();
  exportRun = null;
  const current = engine;
  engine = null;
  void current?.then((exporter) => exporter?.dispose());
  set({ open: false, step: OPTIONS_STEP });
}

/** Changes the picks and estimates again. */
export function pick(patch: Partial<Pick<ExportState, 'format' | 'video' | 'gif' | 'shape'>>): void {
  set(patch);
  scheduleEstimate();
}

/** Asks the agent for the film in the shape picked, and closes the dialog. */
export function makeShape(shape: FilmShape): void {
  void askShape(shape);
  closeExport();
}

export function useSmallerSettings(): void {
  const facts = filmFacts();
  if (facts === null) return;
  set({ step: OPTIONS_STEP, format: 'video', video: smallerVideoOptions(useExport.getState().video, facts.fps) });
  scheduleEstimate();
}

export function backToOptions(): void {
  set({ step: OPTIONS_STEP });
  scheduleEstimate();
}

export function cancelExport(): void {
  exportRun?.abort();
}

export async function askToFix(fix: FixableProblem): Promise<void> {
  await sendAgentRequest(exportProblemRequest(fix.problem, fix.format, useFilm.getState().clock));
}

export function downloadInstead(file: ExportedFile): void {
  const step = useExport.getState().step;
  if (step.kind !== 'failed') return;
  set({ step: { kind: 'done', format: step.format, filename: file.filename, delivery: downloadInBrowser(file), held: null, fix: null, leftOut: { fonts: [], files: [] } } });
}

function progressOf(update: ExportProgress | { phase: 'files'; done: number; total: number }): Progress {
  return { phase: update.phase, done: update.done, total: update.total };
}

function plannedFormat(format: 'video' | 'gif' | 'mov', options: VideoOptions, preset: ExportState['gif']): ExportFormat {
  if (format === 'video' || format === 'mov') return { kind: 'video', height: options.height, fps: options.fps };
  const gif = resolveGifPreset(preset);
  return { kind: 'gif', shortSide: gif.shortSide, delayCs: gif.delayCs };
}

interface Failure {
  title: string;
  message: string;
  fix: FixableProblem | null;
  smaller: boolean;
}

/** How a MOV that passed its limit could fit, from the estimate when there is one. */
function movWayOut(state: ExportState): string {
  const film = filmFacts();
  const advice = film !== null && state.estimate.kind === 'ready' ? movSizeAdvice(state.estimate.estimate, state.video, film) : null;
  return advice?.suggestion ?? words.MOV_SHORTER_OR_STILLER;
}

function failure(error: unknown, format: ExportFormatId, state: ExportState): Failure {
  const fps = filmFacts()?.fps ?? state.video.fps;
  const smaller = format === 'video' && canMakeSmaller(state.video, fps);
  const title = words.notSaved(format);
  if (isStaleBuildError(error)) return { title, message: words.RELOAD_TO_EXPORT, fix: null, smaller: false };
  if (error instanceof GifTooLargeError) return { title, message: `${words.gifOverLimit(Math.floor(error.maxBytes / 1_048_576))} ${words.TRY_SMALL}`, fix: null, smaller: false };
  if (error instanceof MovTooLargeError) return { title: error.message, message: movWayOut(state), fix: null, smaller: false };
  if (error instanceof VideoUnsupportedError) return { title, message: words.NO_VIDEO_HERE, fix: null, smaller: false };
  if (error instanceof ExportCheckError && error.code === 'no_film') return { title, message: words.NOT_READY, fix: null, smaller: false };
  if (error instanceof SourceExportError) return { title, message: error.message, fix: null, smaller: false };
  const problem = failedProblem(error);
  if (problem !== null && problem.kind === 'failed' && isMeasured(format)) {
    const message = `${words.frameFailedAt(formatPlaybackTime(problem.t))} ${words.askForFix(agentName())}`;
    return { title: words.EXPORT_INCOMPLETE, message, fix: { problem, format: plannedFormat(format, state.video, state.gif) }, smaller: false };
  }
  // The encoder ran out of room or stopped answering: a smaller file is the likeliest way past it.
  const encoder = error instanceof EncoderFailure || error instanceof EncoderSilentError;
  const message = error instanceof Error && error.message !== '' ? error.message : words.EXPORT_FAILED;
  return { title, message: encoder && smaller ? `${message} ${words.REDUCE_HELP}` : message, fix: null, smaller: encoder && smaller };
}

function codeInput(signal: AbortSignal, onProgress: (done: number, total: number) => void): CodeInput | null {
  const facts = filmFacts();
  const { film, records, meta } = useFilm.getState();
  const stage = filmEngine();
  if (facts === null || film === null || meta === null || stage === null) return null;
  return { film, records, facts, background: meta.background[0], sounds: audible(stage.sound.sound), midi: scoreMidi(facts.title), signal, onProgress };
}

async function produce(format: ExportFormatId, state: ExportState, signal: AbortSignal, report: (progress: Progress) => void) {
  const onProgress = (update: ExportProgress): void => report(progressOf(update));
  switch (format) {
    case 'video':
    case 'gif':
    case 'mov': {
      const exporter = await exportEngine();
      if (exporter === null) throw new ExportCheckError(words.NOT_READY, 'no_film');
      const run = { onProgress, signal };
      const result =
        format === 'video'
          ? await exporter.exportVideo(videoSettings(state.video), run)
          : format === 'mov'
            ? await exporter.exportMov(movChoices(state.video), run)
            : await exporter.exportGif(state.gif, run);
      return { file: result, held: result.held.count > 0 ? result.held : null, fix: result.problem === null ? null : { problem: result.problem, format: result.format }, leftOut: { fonts: [], files: [] } };
    }
    case 'zip':
    case 'html': {
      const input = codeInput(signal, (done, total) => report({ phase: 'files', done, total }));
      if (input === null) throw new ExportCheckError(words.NOT_READY, 'no_film');
      report({ phase: 'files', done: 0, total: 0 });
      if (format === 'html') return { file: await exportStandalonePage(input), held: null, fix: null, leftOut: { fonts: [], files: [] } };
      const zip = await exportSourceZip(input);
      return { file: zip, held: null, fix: null, leftOut: { fonts: zip.folder.fontsLeftOut, files: zip.folder.filesLeftOut } };
    }
    default: {
      const never: never = format;
      return never;
    }
  }
}

/** Starts the export picked; a long one is confirmed first unless `confirmed`. */
export async function startExport(confirmed = false): Promise<void> {
  const state = useExport.getState();
  const own = filmFacts();
  if (own !== null && state.shape.kind !== 'own') {
    const shape = chosenShape(state.shape, own);
    if (shape !== null && shape !== 'unusable') makeShape(shape);
    return;
  }
  const { format, estimate } = state;
  if (!confirmed && isMeasured(format) && estimate.kind === 'ready' && asksFirst(estimate.estimate)) {
    set({ step: { kind: 'confirm', seconds: estimate.estimate.seconds } });
    return;
  }
  stopEstimate();
  const run = new AbortController();
  exportRun = run;
  const report = (progress: Progress): void => {
    if (exportRun === run) set({ step: { kind: 'running', format, progress } });
  };
  report({ phase: null, done: 0, total: 0 });
  try {
    const made = await produce(format, state, run.signal, report);
    if (run.signal.aborted) throw new DOMException('cancelled', 'AbortError');
    let delivery: Delivery;
    const downloads = maybeSession()?.downloads ?? null;
    try {
      delivery = await deliverFile(made.file, downloads);
    } catch (error) {
      if (exportRun !== run) return;
      const message = error instanceof Error && error.message !== '' ? error.message : words.EXPORT_FAILED;
      // A host that saves in the browser refused the person (a viewer the owner does not let export): no way around it.
      set({ step: { kind: 'failed', format, title: words.notSaved(format), message, fix: null, smaller: false, file: downloads?.browser === true ? null : made.file } });
      return;
    }
    if (exportRun !== run) return;
    set({ step: { kind: 'done', format, filename: made.file.filename, delivery, held: made.held, fix: made.fix, leftOut: made.leftOut } });
  } catch (error) {
    if (exportRun !== run) return;
    if (run.signal.aborted || isAbortError(error)) {
      backToOptions();
      return;
    }
    set({ step: { kind: 'failed', format, ...failure(error, format, state), file: null } });
  } finally {
    if (exportRun === run) exportRun = null;
  }
}
