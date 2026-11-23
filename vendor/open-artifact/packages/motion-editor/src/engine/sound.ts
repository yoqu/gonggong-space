/**
 * The film's sound from what the stage reported when it was ready: the score as played and the narration lines.
 * Both are already on the play clock, so the sound player gets them on an identity timeline over the played length.
 */

import { decodeNarration, identityTimeline, planNarration, type FilmSoundInput } from '@open-artifact/motion-audio';
import { filmSeconds, type FilmAsset, type NarrationData, type ScoreData } from '@open-artifact/motion-core';
import type { NarrationReport, PlayedScore } from '@open-artifact/motion-stage';
import type { ReadyMessage } from './stage-controller.ts';

/** The score as the sound player reads it: on an identity timeline, a moment as played is the film's moment. */
export function scoreOnPlayClock(score: PlayedScore | null): ScoreData | null {
  if (score === null) return null;
  return { ...score, events: score.events.map((event) => ({ ...event, t: filmSeconds(event.t) })) };
}

export function narrationOnPlayClock(report: NarrationReport | null): NarrationData | null {
  if (report === null || report.lines.length === 0) return null;
  return {
    lines: report.lines.map((line) => ({ at: filmSeconds(line.at), dur: line.dur, text: line.text, audio: line.audio })),
    ...(report.duck !== null ? { duck: report.duck } : {}),
  };
}

export interface SoundLoad {
  /** False once another film is on show, so a stale decode stops early. */
  isCurrent(): boolean;
  assets: readonly FilmAsset[];
  bytes(ref: string): Promise<ArrayBuffer | null>;
}

/** Gives the sound player (through `give`) the score at once, then the narration once its takes are decoded. */
export async function loadFilmSound(give: (input: FilmSoundInput) => void, ready: ReadyMessage, load: SoundLoad): Promise<void> {
  const duration = filmSeconds(ready.meta.duration);
  const timeline = identityTimeline(duration);
  const score = scoreOnPlayClock(ready.score);
  give({ score, narration: null, timeline });
  const narration = narrationOnPlayClock(ready.narration);
  const plan = narration === null ? null : planNarration(narration, duration);
  if (plan === null) return;
  const takes = new Map<string, ArrayBuffer>();
  const names = new Set(plan.lines.map((line) => line.audio));
  await Promise.all(
    load.assets
      .filter((asset) => names.has(asset.name))
      .map(async (asset) => {
        const bytes = await load.bytes(asset.ref);
        // decodeAudioData detaches what it is given; the kept copy stays whole.
        if (bytes !== null) takes.set(asset.name, bytes.slice(0));
      }),
  );
  if (!load.isCurrent()) return;
  const decoded = await decodeNarration(plan, takes, { isCurrent: load.isCurrent });
  if (!load.isCurrent()) return;
  give({ score, narration: decoded, timeline });
}
