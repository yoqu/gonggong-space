import type { FilmSeconds, NarrationData, NarrationLine } from '@open-artifact/motion-core';
import { DEFAULT_NARRATION_LIMITS, DUCK_BOUNDS, MAX_CAPTION_UNITS, MAX_TAKE_NAME } from './limits.ts';
import type { NarrationLimits } from './limits.ts';

/** Narration as it is played: its lines within the film and the limits, in time order, and the duck in dB. */
export interface NarrationPlan {
  readonly lines: readonly NarrationLine[];
  readonly duckDb: number;
  readonly captions: NarrationData['captions'];
}

/** A line's words, cut to the caption limit without splitting a surrogate pair. */
export function clipCaption(text: string): string {
  const cut = text.length > MAX_CAPTION_UNITS && /[\ud800-\udbff]/.test(text[MAX_CAPTION_UNITS - 1] ?? '') ? MAX_CAPTION_UNITS - 1 : MAX_CAPTION_UNITS;
  return text.slice(0, cut);
}

/** Keeps the lines that start within the film and are no longer than a line may be; null when none is left. */
export function planNarration(
  narration: NarrationData,
  duration: FilmSeconds,
  limits: NarrationLimits = DEFAULT_NARRATION_LIMITS,
): NarrationPlan | null {
  const lines: NarrationLine[] = [];
  for (const line of narration.lines.slice(0, limits.maxLines)) {
    if (!(line.at >= 0 && line.at < duration)) continue;
    if (!(line.dur > 0 && line.dur <= limits.maxLineSeconds)) continue;
    lines.push({
      at: line.at,
      dur: line.dur,
      audio: typeof line.audio === 'string' ? line.audio.slice(0, MAX_TAKE_NAME) : '',
      text: typeof line.text === 'string' ? clipCaption(line.text) : '',
    });
  }
  if (lines.length === 0) return null;
  lines.sort((first, second) => first.at - second.at);
  const duck = narration.duck;
  return {
    lines,
    duckDb: typeof duck === 'number' && Number.isFinite(duck) ? Math.max(DUCK_BOUNDS[0], Math.min(DUCK_BOUNDS[1], duck)) : limits.duckDb,
    captions: narration.captions,
  };
}
