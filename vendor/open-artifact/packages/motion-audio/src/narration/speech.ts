import type { PlaySeconds } from '@open-artifact/motion-core';
import type { FilmTimeline } from '../timeline.ts';
import { duckEnvelope } from './duck.ts';
import type { DuckPoint } from './duck.ts';
import type { NarrationPlan } from './plan.ts';

/** Why a take is silent: over the size limit, past the total, not decodable, or longer than a line may be. */
export type TakeIssue = 'big' | 'total' | 'undecodable' | 'long';

/** Narration with its takes decoded. `found` has each take's seconds, or why it is silent; a missing take is not in it. */
export interface DecodedNarration {
  readonly plan: NarrationPlan;
  readonly takes: ReadonlyMap<string, AudioBuffer>;
  readonly found: ReadonlyMap<string, TakeIssue | number>;
  /** Each decoded take's waveform for the voiceover lane. */
  readonly peaks: ReadonlyMap<string, readonly number[]>;
  /** The gain that brings the takes to the narration's loudness target. */
  readonly gain: number;
}

export interface SpeechClip {
  readonly at: PlaySeconds;
  readonly buffer: AudioBuffer;
}

/** Narration as the mixer plays it: its takes at their play times, their gain, and the score's duck under them. */
export interface Speech {
  readonly clips: readonly SpeechClip[];
  readonly gain: number;
  readonly duck: readonly DuckPoint[];
}

/**
 * Places the decoded takes in play time. A line starts on the action it speaks of, so its start moves with the picture;
 * its take keeps its own length. A line whose start is cut out is not spoken. Null when nothing is spoken.
 */
export function placeSpeech(narration: DecodedNarration | null, timeline: FilmTimeline): Speech | null {
  if (narration === null) return null;
  const clips: SpeechClip[] = [];
  for (const line of narration.plan.lines) {
    const buffer = narration.takes.get(line.audio);
    const at = timeline.toPlay(line.at);
    if (buffer === undefined || at === null) continue;
    clips.push({ at, buffer });
  }
  if (clips.length === 0) return null;
  return {
    clips,
    gain: narration.gain,
    duck: duckEnvelope(
      clips.map((clip) => ({ at: clip.at, dur: clip.buffer.duration })),
      narration.plan.duckDb,
    ),
  };
}
