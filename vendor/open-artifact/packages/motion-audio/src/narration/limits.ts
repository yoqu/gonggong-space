/** What narration may hold, and how it is mixed. */
export interface NarrationLimits {
  /** How far the score is lowered under narration, in dB, when the narration names none. */
  readonly duckDb: number;
  /** The narration's loudness target, in LUFS. */
  readonly loudness: number;
  readonly maxLines: number;
  readonly maxLineSeconds: number;
  /** All takes together. */
  readonly maxSpeechSeconds: number;
  readonly maxLineChars: number;
  /** A take's size in KiB, unless it is a plain 16-bit PCM wave. */
  readonly maxTakeKib: number;
  /** A plain 16-bit PCM wave's size in KiB. */
  readonly maxWavKib: number;
}

export const DEFAULT_NARRATION_LIMITS: NarrationLimits = {
  duckDb: -12,
  loudness: -16,
  maxLines: 100,
  maxLineSeconds: 30,
  maxSpeechSeconds: 36_000,
  maxLineChars: 300,
  maxTakeKib: 256,
  maxWavKib: 1536,
};

/** The duck a narration may ask for, in dB. */
export const DUCK_BOUNDS: readonly [number, number] = [-30, 0];
/** A line's words as shown: this many UTF-16 units at most. */
export const MAX_CAPTION_UNITS = 600;
/** A take's asset name is cut to this many characters. */
export const MAX_TAKE_NAME = 64;
