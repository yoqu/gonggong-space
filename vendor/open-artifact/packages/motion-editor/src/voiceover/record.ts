/**
 * "Record changes": the lines whose words a person changed (to record again) or emptied (to take out) go to the agent
 * as one request. The page never records a take itself; the lines sent stay marked until the agent's turn is done.
 */

import type { VoiceoverLine } from '@open-artifact/motion-audio';
import { filmSeconds, voiceoverRequest, type FilmClock, type FilmSeconds, type PlaySeconds, type VideoAgentRequest } from '@open-artifact/motion-core';
import { sendAgentRequest } from '../agent/send.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { voiceChanges, type TypedWords } from './lines.ts';
import { useVoiceover } from './store.ts';

/** The film's own moment for a moment as played (a film without a clock yet plays at its own times). */
export const filmTimeOf =
  (clock: FilmClock | null) =>
  (t: PlaySeconds): FilmSeconds =>
    clock === null ? filmSeconds(t) : clock.toFilm(t);

export interface VoiceRequest {
  request: VideoAgentRequest;
  /** Lines changed in all. */
  changes: number;
  /** The keys of the lines this request carries (the first that fit; the rest go with the next press). */
  keys: string[];
}

/** What a press would send for these lines and typed words; null when nothing is changed. */
export function voiceRequestFor(lines: readonly VoiceoverLine[] | null, typed: TypedWords, clock: FilmClock | null): VoiceRequest | null {
  if (lines === null) return null;
  const changes = voiceChanges(lines, typed, filmTimeOf(clock));
  if (changes.length === 0) return null;
  const { sent, ...request } = voiceoverRequest(changes.map((entry) => entry.change));
  return { request, changes: changes.length, keys: changes.slice(0, sent).map((entry) => entry.key) };
}

/** Sends the changes that fit one request; a request that could only be copied leaves the lines open to edit. */
export async function recordVoiceChanges(): Promise<void> {
  const state = useVoiceover.getState();
  const working = useWorking.getState();
  if (state.asked || working.activity === 'working' || working.readOnlyReason !== null) return;
  const pending = voiceRequestFor(state.lines, state.typed, useFilm.getState().clock);
  if (pending === null) return;
  state.sent(pending.keys);
  const outcome = await sendAgentRequest(pending.request);
  if (outcome !== 'sent') useVoiceover.getState().settled();
}
