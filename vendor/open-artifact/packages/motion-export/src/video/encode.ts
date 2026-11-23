import { EncoderFailure, EncoderSilentError, exportAbortError, isAborted } from '../errors.ts';
import { trackEncodeTry } from '../visibility.ts';
import { BASELINE_ATTEMPT, FIRST_ATTEMPT, attemptsFor, encoderAttemptOptions, supportsEncoderAttempt } from './attempts.ts';
import { encodeVideoAttempt } from './encode-attempt.ts';
import type { VideoAttemptResult, VideoEncodeOptions } from './encode-attempt.ts';

export interface EncodedVideo extends VideoAttemptResult {
  ms: number;
}

/**
 * One more try in software after every set-up broke: only when allowed, when a broken set-up is followed by the
 * next, for H.264, and when the encoder put out nothing at all.
 */
const softwareLastTryApplies = (options: VideoEncodeOptions, error: Error): boolean =>
  options.lastInSoftware === true &&
  options.nextOnBreak === true &&
  options.plan.format.videoCodec === 'avc' &&
  error instanceof EncoderSilentError &&
  error.cause === undefined;

const describeCause = (cause: unknown): string => (cause instanceof Error ? cause.name : typeof cause);

/** Makes the video, trying the encoder set-ups in turn while one breaks without putting frames out. */
export async function encodeVideo(options: VideoEncodeOptions): Promise<EncodedVideo> {
  const { plan, signal, memory } = options;
  const startedAt = performance.now();
  const attempts = attemptsFor(plan);
  const start = Math.max(0, attempts.indexOf(memory.preferred));
  let firstError: Error | undefined;
  let triedSoftware = false;
  for (let index = 0; ; index++) {
    const lastTry = index === attempts.length;
    const attempt = lastTry ? BASELINE_ATTEMPT : attempts[(start + index) % attempts.length] ?? FIRST_ATTEMPT;
    const softwareRetry = !lastTry && memory.softwareOnRetry && attempt !== FIRST_ATTEMPT && (attempt.baseline === true || plan.format.videoCodec !== 'avc');
    const preferSoftware = lastTry || (softwareRetry && (await supportsEncoderAttempt(plan, encoderAttemptOptions(attempt, plan, true), signal)));
    if (isAborted(signal)) throw exportAbortError();
    triedSoftware ||= softwareRetry;
    if (softwareRetry) options.onProgress?.({ done: 0, total: plan.frames, phase: 'frames' });
    try {
      const result = await trackEncodeTry(
        options.onTry,
        signal,
        (hidden, reordered) => encodeVideoAttempt(options, { attempt, preferSoftware, retried: index > 0, hidden, reordered }),
        options.page,
      );
      return { ...result, ms: performance.now() - startedAt };
    } catch (error) {
      const broke = error instanceof EncoderFailure;
      if (!broke && !(error instanceof EncoderSilentError)) throw error;
      firstError ??= broke ? error.failure : error;
      const another =
        index + 1 < attempts.length ||
        (index + 1 === attempts.length &&
          !triedSoftware &&
          softwareLastTryApplies(options, firstError) &&
          (await supportsEncoderAttempt(plan, encoderAttemptOptions(BASELINE_ATTEMPT, plan, true), signal)));
      memory.softwareOnRetry ||= broke && !lastTry;
      if (!another || isAborted(signal)) memory.preferred = FIRST_ATTEMPT;
      if (isAborted(signal)) throw exportAbortError();
      const cause = broke ? error.failure : error.cause;
      console.info(
        'video export: the encoder ' +
          (cause === undefined ? 'put out nothing' : `broke (${describeCause(cause)})${broke ? '' : ' before it put anything out'}`) +
          ` with ${JSON.stringify(attempt)}${preferSoftware ? ', in software' : ''}` +
          (another ? '; trying the next set-up' : `; giving up with the first try’s ${firstError.name}`),
      );
      if (!another) throw firstError;
      options.onProgress?.({ done: 0, total: plan.frames, phase: 'frames' });
    } finally {
      if (lastTry) memory.preferred = FIRST_ATTEMPT;
    }
  }
}
