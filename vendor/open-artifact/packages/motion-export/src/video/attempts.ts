import { canEncodeVideo } from 'mediabunny';
import { isAborted } from '../errors.ts';
import type { ExportDimensions } from '../types.ts';
import type { VideoPlan } from './format.ts';

/** One set-up of the video encoder. Some hardware encoders break on one and work with another. */
export interface EncoderAttempt {
  latencyMode: 'quality' | 'realtime';
  /** H.264 Baseline profile, which more hardware encodes. */
  baseline?: true;
}

export interface EncoderAttemptOptions {
  latencyMode: 'quality' | 'realtime';
  fullCodecString?: string;
  bitrateMode: 'variable';
  hardwareAcceleration?: 'prefer-software';
}

export const FIRST_ATTEMPT: EncoderAttempt = { latencyMode: 'quality' };
export const BASELINE_ATTEMPT: EncoderAttempt = { latencyMode: 'quality', baseline: true };
export const REALTIME_ATTEMPT: EncoderAttempt = { latencyMode: 'realtime' };
export const ENCODER_ATTEMPTS: readonly EncoderAttempt[] = [FIRST_ATTEMPT, BASELINE_ATTEMPT, REALTIME_ATTEMPT];

export const ENCODER_SUPPORT_TIMEOUT_MS = 2000;

/** The macroblocks a Baseline level allows a frame, and the level's code. */
const AVC_BASELINE_LEVELS: ReadonlyArray<readonly [number, string]> = [
  [1620, '1e'],
  [3600, '1f'],
  [5120, '20'],
  [8192, '28'],
  [8704, '2a'],
  [22080, '32'],
];

export function avcBaselineCodecString(size: ExportDimensions): string {
  const macroblocks = Math.ceil(size.width / 16) * Math.ceil(size.height / 16);
  return 'avc1.4200' + (AVC_BASELINE_LEVELS.find(([most]) => macroblocks <= most)?.[1] ?? '33');
}

export function encoderAttemptOptions(attempt: EncoderAttempt, size: ExportDimensions, preferSoftware: boolean): EncoderAttemptOptions {
  return {
    latencyMode: attempt.latencyMode,
    ...(attempt.baseline === true ? { fullCodecString: avcBaselineCodecString(size) } : {}),
    bitrateMode: 'variable',
    ...(preferSoftware ? { hardwareAcceleration: 'prefer-software' as const } : {}),
  };
}

/** The set-ups worth trying for a codec: Baseline is H.264's alone. */
export const attemptsFor = (plan: VideoPlan): EncoderAttempt[] =>
  ENCODER_ATTEMPTS.filter((attempt) => plan.format.videoCodec === 'avc' || attempt.baseline !== true);

/** Whether the browser says it encodes with that set-up; false when it does not say in time. */
export function supportsEncoderAttempt(plan: VideoPlan, options: EncoderAttemptOptions, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (isAborted(signal)) {
      resolve(false);
      return;
    }
    const settle = (supported: boolean): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', refuse);
      resolve(supported);
    };
    const refuse = (): void => settle(false);
    const timer = setTimeout(refuse, ENCODER_SUPPORT_TIMEOUT_MS);
    signal?.addEventListener('abort', refuse, { once: true });
    canEncodeVideo(plan.format.videoCodec, { width: plan.width, height: plan.height, bitrate: plan.videoBitrate, ...options }).then(settle, refuse);
  });
}

/**
 * What the encoder learned across exports in this page: the set-up that last put frames out is tried first, and after
 * a hardware encoder broke, later set-ups are tried in software.
 */
export interface EncoderMemory {
  preferred: EncoderAttempt;
  softwareOnRetry: boolean;
}

export const newEncoderMemory = (): EncoderMemory => ({ preferred: FIRST_ATTEMPT, softwareOnRetry: false });
