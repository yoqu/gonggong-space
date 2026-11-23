import { measureSpeechGain } from '../offline.ts';
import { parsePcmWave } from '../wave.ts';
import type { PcmWave } from '../wave.ts';
import { DEFAULT_NARRATION_LIMITS } from './limits.ts';
import type { NarrationLimits } from './limits.ts';
import { voicePeaks } from './peaks.ts';
import type { NarrationPlan } from './plan.ts';
import type { DecodedNarration, TakeIssue } from './speech.ts';

/** What turns a take's bytes into samples: any audio context. */
export interface TakeDecoder {
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer>;
}

export interface DecodeOptions {
  readonly limits?: NarrationLimits;
  /** False once the film has moved on, so a stale decode stops early. */
  readonly isCurrent?: () => boolean;
  readonly decoder?: TakeDecoder | null;
  /** How the takes' loudness gain is found; by default they are rendered through the mix and measured. */
  readonly speechGain?: (takes: readonly AudioBuffer[], targetLufs: number) => Promise<number>;
}

const KIB = 1024;
/** A take may run this much past a line's limit before it is too long. */
const LINE_SLACK_SECONDS = 1;

/**
 * Judges a take by its bytes before decoding: too big unless it is a plain wave within the wave limit, too long when a
 * wave says so, or past the narration's total.
 */
export function judgeTakeBytes(byteLength: number, wave: PcmWave | null, totalSeconds: number, limits: NarrationLimits): TakeIssue | null {
  if (wave === null && byteLength > limits.maxTakeKib * KIB) return 'big';
  if (wave !== null && wave.seconds > limits.maxLineSeconds + LINE_SLACK_SECONDS) return 'long';
  if (totalSeconds + (wave?.seconds ?? 0) > limits.maxSpeechSeconds || totalSeconds >= limits.maxSpeechSeconds) return 'total';
  return null;
}

/** Judges a decoded take by its length. */
export function judgeTakeSeconds(seconds: number | null, totalSeconds: number, limits: NarrationLimits): TakeIssue | null {
  if (seconds === null || seconds === 0) return 'undecodable';
  if (seconds > limits.maxLineSeconds + LINE_SLACK_SECONDS) return 'long';
  if (totalSeconds + seconds > limits.maxSpeechSeconds) return 'total';
  return null;
}

function defaultDecoder(): TakeDecoder | null {
  return typeof OfflineAudioContext === 'undefined' ? null : new OfflineAudioContext(1, 1, 48000);
}

/** Decodes each take the lines name once, within the limits. Null when the film moved on meanwhile. */
export async function decodeNarration(
  plan: NarrationPlan,
  assets: ReadonlyMap<string, ArrayBuffer>,
  options: DecodeOptions = {},
): Promise<DecodedNarration | null> {
  const limits = options.limits ?? DEFAULT_NARRATION_LIMITS;
  const isCurrent = options.isCurrent ?? (() => true);
  const decoder = options.decoder === undefined ? defaultDecoder() : options.decoder;
  const takes = new Map<string, AudioBuffer>();
  const found = new Map<string, TakeIssue | number>();
  const peaks = new Map<string, readonly number[]>();
  let totalSeconds = 0;
  for (const name of new Set(plan.lines.map((line) => line.audio))) {
    const bytes = assets.get(name);
    if (bytes === undefined) continue;
    if (!isCurrent()) return null;
    // A plain 16-bit wave is read by its chunks, so its length is known before decoding and it may be larger than an mp3.
    const wave = bytes.byteLength <= Math.max(limits.maxTakeKib, limits.maxWavKib) * KIB ? parsePcmWave(bytes) : null;
    const before = judgeTakeBytes(bytes.byteLength, wave, totalSeconds, limits);
    const buffer =
      before !== null || decoder === null
        ? null
        : await decoder.decodeAudioData(wave?.bare() ?? bytes.slice(0)).catch((): null => null);
    const issue = before ?? judgeTakeSeconds(buffer === null || buffer.length === 0 ? null : buffer.duration, totalSeconds, limits);
    if (issue !== null || buffer === null) {
      found.set(name, issue ?? 'undecodable');
      continue;
    }
    found.set(name, buffer.duration);
    totalSeconds += buffer.duration;
    takes.set(name, buffer);
    peaks.set(name, voicePeaks(buffer.getChannelData(0), buffer.duration));
  }
  if (!isCurrent()) return null;
  const measure = options.speechGain ?? ((buffers: readonly AudioBuffer[], target: number) => measureSpeechGain(buffers, target));
  const gain = takes.size === 0 ? 1 : await measure([...takes.values()], limits.loudness);
  if (!isCurrent()) return null;
  return { plan, takes, found, peaks, gain };
}
