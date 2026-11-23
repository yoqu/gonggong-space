import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { PlaySeconds, ScoreData, ScoreMaster } from '@open-artifact/motion-core';
import { soundExtent } from './synth/presets.ts';
import type { ResolvedPatch } from './synth/presets.ts';
import { MAX_SOUND_SECONDS, voiceOf } from './synth/voice.ts';
import type { Sound } from './synth/voice.ts';
import type { FilmTimeline } from './timeline.ts';

/** Score events later than this are not played (3x the 10-hour film limit). */
export const MAX_EVENT_SECONDS = 108_000;

/** A score sound placed in play time: its onset, and the span it is heard over (its ring included). */
export interface PlayedSound {
  readonly patch: ResolvedPatch;
  readonly sound: Sound;
  readonly at: PlaySeconds;
  readonly start: PlaySeconds;
  readonly end: PlaySeconds;
}

/** A score as it is heard: its sounds in play time, ordered by when they start to be heard. */
export interface PlayedScore {
  readonly sounds: readonly PlayedSound[];
  readonly master: ScoreMaster;
  readonly duration: PlaySeconds;
}

/** What a film without a score plays: nothing, at the default master. */
export const SILENT_MASTER: ScoreMaster = { gain: -6, fadeOut: 1 };

/**
 * Places the score's events in play time. Starts and lengths both move with the timeline, so a stretched span's sound
 * slows with its picture at the same pitch; an event whose onset is cut out is not played, and one whose end is cut out
 * keeps its written length.
 */
export function playScore(score: ScoreData | null, timeline: FilmTimeline): PlayedScore {
  const sounds: PlayedSound[] = [];
  for (const event of score?.events ?? []) {
    if (!Number.isFinite(event.t) || !Number.isFinite(event.dur) || event.t < 0 || event.t >= MAX_EVENT_SECONDS) continue;
    const voice = voiceOf(event);
    if (voice === null) continue;
    const at = timeline.toPlay(voice.t);
    if (at === null) continue;
    const endAt = timeline.toPlay(filmSeconds(voice.t + voice.sound.dur));
    const dur = Math.max(0.01, Math.min(MAX_SOUND_SECONDS, endAt === null ? voice.sound.dur : endAt - at));
    const [start, end] = soundExtent(voice.patch, at, dur);
    sounds.push({ patch: voice.patch, sound: { ...voice.sound, dur }, at, start: playSeconds(start), end: playSeconds(end) });
  }
  sounds.sort((first, second) => first.start - second.start);
  return { sounds, master: score?.master ?? SILENT_MASTER, duration: timeline.playDuration };
}
