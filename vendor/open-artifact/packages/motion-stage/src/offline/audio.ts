import type { PlaySeconds } from '@open-artifact/motion-core';
import type { NarrationReport, PlayedScore } from '../protocol.ts';

/**
 * The sound of a standalone film, given to the player from outside: the stage records the score and reads the
 * narration, and the player plays neither itself. With none, the film plays silent.
 */
export interface ScorePlayer {
  /** Once the film is ready, with its sound as played. */
  prepare(score: PlayedScore | null, narration: NarrationReport | null, duration: PlaySeconds): Promise<void>;
  /** Called from a click, which a browser asks for before it makes a sound. */
  start(t: PlaySeconds): void;
  stop(): void;
  /** Played time by the sound's own clock while it plays, which the picture follows; null while silent. */
  now(): PlaySeconds | null;
}

export type ScorePlayerFactory = () => ScorePlayer;

/** The global a standalone page's audio script sets, before the player's script runs. */
export const OFFLINE_AUDIO_GLOBAL = 'filmAudio';

export function injectedAudio(): ScorePlayer | null {
  const factory: unknown = Reflect.get(window, OFFLINE_AUDIO_GLOBAL);
  if (typeof factory !== 'function') return null;
  try {
    const made: unknown = Reflect.apply(factory, window, []);
    return isScorePlayer(made) ? made : null;
  } catch (error) {
    console.warn('the film’s sound could not be set up, so it plays silent: ' + String(error));
    return null;
  }
}

function isScorePlayer(value: unknown): value is ScorePlayer {
  if (value === null || typeof value !== 'object') return false;
  return ['prepare', 'start', 'stop', 'now'].every((key) => typeof Reflect.get(value, key) === 'function');
}
