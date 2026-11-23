import { playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds } from '@open-artifact/motion-core';
import type { FilmTimeline } from '../timeline.ts';
import type { NarrationPlan } from './plan.ts';
import type { DecodedNarration } from './speech.ts';

/** A caption on screen from `start` to `end`, in play time. */
export interface CaptionCue {
  readonly start: PlaySeconds;
  readonly end: PlaySeconds;
  readonly text: string;
}

/** A line on the voiceover lane: when it plays, how long its take runs, its words and its waveform (null: not decoded). */
export interface VoiceoverLine {
  readonly at: PlaySeconds;
  readonly dur: number;
  readonly text: string;
  readonly audio: string;
  readonly peaks: readonly number[] | null;
}

/** The captions of a narration that shows them: each line with words, from its start for its said length. */
export function captionCues(plan: NarrationPlan | null, timeline: FilmTimeline): CaptionCue[] {
  if (plan === null || plan.captions === false) return [];
  const cues: CaptionCue[] = [];
  for (const line of plan.lines) {
    if (line.text.trim() === '') continue;
    const start = timeline.toPlay(line.at);
    if (start === null) continue;
    cues.push({ start, end: playSeconds(start + line.dur), text: line.text });
  }
  return cues;
}

/** The caption showing at `t`: the latest one started by then and not yet over. */
export function cueAt(cues: readonly CaptionCue[], t: PlaySeconds): CaptionCue | null {
  let showing: CaptionCue | null = null;
  for (const cue of cues) {
    if (cue.start > t) break;
    if (t < cue.end) showing = cue;
  }
  return showing;
}

/** The voiceover lane's lines, with each take's real length where it decoded. */
export function voiceoverLines(narration: DecodedNarration, timeline: FilmTimeline): VoiceoverLine[] {
  const lines: VoiceoverLine[] = [];
  for (const line of narration.plan.lines) {
    const at = timeline.toPlay(line.at);
    if (at === null) continue;
    const take = narration.takes.get(line.audio);
    lines.push({
      at,
      dur: take?.duration ?? line.dur,
      text: line.text,
      audio: line.audio,
      peaks: narration.peaks.get(line.audio) ?? null,
    });
  }
  return lines;
}
