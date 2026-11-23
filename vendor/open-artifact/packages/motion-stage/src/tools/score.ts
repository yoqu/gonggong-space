import { DRUM_NAMES, FX_NAMES, PATCH_NAMES, type PlaySeconds, type ScoreEventKind } from '@open-artifact/motion-core';
import type { NarrationReport, PlayedScore } from '../protocol.ts';
import type { ScoreReport } from './types.ts';

const VOICES: Record<ScoreEventKind, readonly string[]> = { note: PATCH_NAMES, drum: DRUM_NAMES, fx: FX_NAMES };

const played = (t: number): PlaySeconds => t as PlaySeconds;

/** The score and narration a load reported, counted: enough to tell a silent or broken score at a glance. */
export function scoreReport(score: PlayedScore | null, narration: NarrationReport | null): ScoreReport {
  const events = score?.events ?? [];
  const unknown = new Set<string>();
  const counts: Record<ScoreEventKind, number> = { note: 0, drum: 0, fx: 0 };
  let first = Infinity;
  let last = -Infinity;
  for (const event of events) {
    counts[event.kind]++;
    if (!VOICES[event.kind].includes(event.patch)) unknown.add(event.kind + ':' + event.patch);
    first = Math.min(first, event.t);
    last = Math.max(last, event.t + event.dur);
  }
  return {
    events: events.length,
    notes: counts.note,
    drums: counts.drum,
    fx: counts.fx,
    unknown: [...unknown],
    first: played(Number.isFinite(first) ? first : 0),
    last: played(Number.isFinite(last) ? last : 0),
    tempo: score?.tempo ?? null,
    narration: narration === null ? null : { lines: narration.lines.length, seconds: narration.lines.reduce((sum, line) => sum + line.dur, 0) },
  };
}
