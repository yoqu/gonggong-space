import { AudioBufferSource, CanvasSource } from 'mediabunny';
import type { EncodedPacket } from 'mediabunny';
import { EncoderFailure, EncoderSilentError, ExportCheckError, SkippedVideoFramesError, asError, exportAbortError, isAborted } from '../errors.ts';
import { renderExportFrames } from '../frames.ts';
import { EXPORT_AUDIO_BITRATE } from '../plan.ts';
import type { ExportFrame, ExportProgress, HeldFrames } from '../types.ts';
import { withVisibleTimeout } from '../visibility.ts';
import type { EncodeTryListener, HiddenWatch } from '../visibility.ts';
import { words } from '../words.ts';
import { FIRST_ATTEMPT, encoderAttemptOptions } from './attempts.ts';
import type { EncoderAttempt, EncoderMemory } from './attempts.ts';
import { avcDecodesInOrder, repairAvcColorSpace } from './avc.ts';
import type { VideoPlan } from './format.ts';
import { createMp4Output } from './output.ts';

/** Errors a hardware encoder throws when it breaks: another set-up may work. */
const RETRYABLE_ENCODER_ERRORS: readonly string[] = ['OperationError', 'EncodingError'];
export const SUPERSAMPLE_SCALE = 2;

export interface VideoEncodeOptions {
  plan: VideoPlan;
  frame: ExportFrame;
  /** The film's sound, rendered; null for a silent file. */
  audio: AudioBuffer | null;
  supersample?: boolean;
  /** How long the encoder may stay silent, while the page is visible, before the try is given up. */
  firstPacketMs?: number;
  /** A set-up that breaks is followed by the next. */
  nextOnBreak?: boolean;
  /** The colour range is read from the stream, not trusted from the encoder. */
  rangeFromStream?: boolean;
  /** After every set-up put nothing out, one more try in software. */
  lastInSoftware?: boolean;
  onTry?: EncodeTryListener;
  stalls?: number;
  page?: Document;
  memory: EncoderMemory;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface VideoAttemptResult {
  bytes: Uint8Array<ArrayBuffer>;
  held: HeldFrames;
}

export interface AttemptContext {
  attempt: EncoderAttempt;
  preferSoftware: boolean;
  retried: boolean;
  hidden: HiddenWatch;
  reordered(): void;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return canvas instanceof HTMLCanvasElement ? canvas.getContext('2d', { alpha: false }) : canvas.getContext('2d', { alpha: false });
}

/** One try at the video with one encoder set-up. */
export async function encodeVideoAttempt(options: VideoEncodeOptions, context: AttemptContext): Promise<VideoAttemptResult> {
  const { plan, signal, memory } = options;
  const { attempt } = context;
  const isFirst = attempt === FIRST_ATTEMPT;
  const onProgress = options.onProgress ?? (() => undefined);
  const canvas = makeCanvas(plan.width, plan.height);
  const draw = context2d(canvas);
  if (draw === null) throw new ExportCheckError(words.noCanvas, 'no_canvas');
  draw.imageSmoothingEnabled = true;
  draw.imageSmoothingQuality = 'high';
  const { output, file } = createMp4Output();
  const controller = new AbortController();
  let packets = 0;
  let packetBytes = 0;
  let lastTimestamp = Number.NEGATIVE_INFINITY;
  let warnedOutOfOrder = false;
  let inOrder: boolean | undefined;
  const onEncodedPacket = (packet: EncodedPacket, meta: EncodedVideoChunkMetadata | undefined): void => {
    if (options.rangeFromStream === true) repairAvcColorSpace(meta?.decoderConfig);
    packets++;
    packetBytes += packet.byteLength;
    if (controller.signal.aborted) return;
    memory.preferred = attempt;
    inOrder ??= avcDecodesInOrder(meta?.decoderConfig);
    if (packet.timestamp < lastTimestamp && inOrder === true && !warnedOutOfOrder) {
      warnedOutOfOrder = true;
      console.info(`video export: the encoder began to send frames out of order at about frame ${packets} of ${plan.frames} (set-up ${JSON.stringify(attempt)})`);
      context.reordered();
    }
    lastTimestamp = packet.timestamp;
  };
  const videoSource = new CanvasSource(canvas, {
    codec: plan.format.videoCodec,
    bitrate: plan.videoBitrate,
    keyFrameInterval: 2,
    ...encoderAttemptOptions(attempt, plan, context.preferSoftware),
    onEncodedPacket,
  });
  output.addVideoTrack(videoSource, { frameRate: plan.fps });
  const audioSource =
    options.audio !== null && plan.format.audioCodec !== null ? new AudioBufferSource({ codec: plan.format.audioCodec, bitrate: EXPORT_AUDIO_BITRATE }) : null;
  if (audioSource !== null) output.addAudioTrack(audioSource);

  let rejectEncoder: (reason: unknown) => void = () => undefined;
  const encoderAborted = new Promise<never>((_resolve, reject) => {
    rejectEncoder = reject;
  });
  encoderAborted.catch(() => undefined);
  let cancelled: Promise<void> | undefined;
  const abortEncoding = (): void => {
    cancelled = output.cancel().catch(() => undefined);
    rejectEncoder(exportAbortError());
  };
  signal?.addEventListener('abort', abortEncoding, { once: true });

  const firstPacketMs = options.firstPacketMs ?? 0;
  const waitForFirstPacket = (operation: Promise<void>): Promise<void> =>
    packets > 0 || firstPacketMs <= 0
      ? operation
      : new Promise<void>((resolve, reject) => {
          withVisibleTimeout(
            operation,
            firstPacketMs,
            () => {
              if (packets === 0) reject(new EncoderSilentError());
            },
            controller.signal,
            options.page,
          ).then(resolve, reject);
        });
  const run = (operation: Promise<void>, finishing = false): Promise<void> =>
    Promise.race([waitForFirstPacket(operation), encoderAborted]).catch((error: unknown) => {
      if (error instanceof EncoderSilentError) throw error;
      if (
        options.nextOnBreak === true &&
        error instanceof DOMException &&
        RETRYABLE_ENCODER_ERRORS.includes(error.name) &&
        !finishing &&
        !context.hidden.seen()
      )
        throw new EncoderFailure(error);
      throw (!isFirst || context.retried) && packets === 0 ? new EncoderSilentError(error) : error;
    });

  let held: HeldFrames;
  try {
    await output.start();
    held = await renderExportFrames({
      plan,
      frame: options.frame,
      scale: options.supersample === true ? SUPERSAMPLE_SCALE : 1,
      ...(signal !== undefined ? { signal } : {}),
      ...(options.page !== undefined ? { page: options.page } : {}),
      ...(options.stalls !== undefined ? { stalls: options.stalls } : {}),
      onProgress: (progress) => onProgress({ ...progress, packets, bytes: packetBytes }),
      draw: (bitmap, index) => {
        if (bitmap === null && index > 0) return;
        draw.fillStyle = '#000';
        draw.fillRect(0, 0, plan.width, plan.height);
        if (bitmap !== null) draw.drawImage(bitmap, 0, 0, plan.width, plan.height);
      },
      commit: (index) => run(videoSource.add(index / plan.fps, 1 / plan.fps)),
    });
    onProgress({ done: plan.frames, total: plan.frames, phase: 'mux' });
    if (audioSource !== null && options.audio !== null) {
      await audioSource.add(options.audio);
      audioSource.close();
    }
    videoSource.close();
    await run(output.finalize(), audioSource !== null);
    if (isAborted(signal)) throw exportAbortError();
    if (packets === 0) throw new EncoderSilentError();
    if (!isFirst && packets < plan.frames) {
      memory.preferred = FIRST_ATTEMPT;
      throw new SkippedVideoFramesError(plan.frames - packets, plan.frames);
    }
  } catch (error) {
    await cancelled;
    if (output.state !== 'canceled' && output.state !== 'finalized') await output.cancel().catch(() => undefined);
    if (isAborted(signal)) throw exportAbortError();
    throw asError(error);
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abortEncoding);
  }
  const bytes = file();
  if (bytes === null) throw new ExportCheckError(words.noOutput, 'no_output');
  return { bytes, held };
}
