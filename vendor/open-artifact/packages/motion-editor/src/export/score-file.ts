/** The film's score as the code export's score.mid: kept from the last sound the engine loaded. */

import type { ScoreData } from '@open-artifact/motion-core';
import { toMidi } from '@open-artifact/motion-audio';
import { filmEngine } from '../engine/engine-context.ts';
import { videoFlags } from '../host/flags.ts';

let latestScore: ScoreData | null = null;

/** Keeps the score of each film the engine loads. */
export function watchScore(): () => void {
  const stop =
    filmEngine()?.onSoundLoad((input) => {
      latestScore = input.score;
    }) ?? (() => undefined);
  return () => {
    stop();
    latestScore = null;
  };
}

/** The score as a MIDI file; null when the film has none or the feature is off. */
export function scoreMidi(title: string): Uint8Array | null {
  if (!videoFlags().midiExport || latestScore === null || latestScore.events.length === 0) return null;
  return toMidi(latestScore, { title });
}
