import { clipCharacters } from '../json.ts';
import type { FilmSeconds } from '../units.ts';
import { REQUEST_LIMITS, clipRequestWords, joinWithAnd, randomDelimiterId, wrapUntrusted, type VideoAgentRequest } from './common.ts';

/** A line typed by hand that no longer shows: what the film says there now, the old words, and the ones typed. */
export interface EndedRetype {
  now: string;
  old: string;
  typed: string;
}

const ENDED_TEXT_MAX_WORDS = 300;
const ENDED_TEXT_MIN_WORDS = 40;

function endedTextBody(entries: readonly EndedRetype[], max: number, late: boolean, id: string): string {
  return [
    `${late ? 'Text typed by hand in the animation no longer shows.' : 'Text typed by hand in the animation stopped showing after your last change.'} For each entry in the block below, find the text in the animation that reads as its "says now", replace its "old words" there with its "typed by hand" words, and keep the rest of that text.`,
    `If no text in the animation reads as an entry's "says now", change nothing and ask me which text I mean.`,
    wrapUntrusted(
      'retyped text',
      entries
        .map((entry) => `says now: ${clipRequestWords(entry.now, max)}\nold words: ${clipRequestWords(entry.old, max)}\ntyped by hand: ${clipRequestWords(entry.typed, max)}`)
        .join('\n'),
      id,
    ),
  ].join('\n');
}

/**
 * Put back text typed by hand that the agent's last change ended (`late`: noticed later). Words are cut shorter until
 * the request fits, then as many entries go as fit, at least one; `sent` says how many.
 */
export function endedTextRequest(entries: readonly EndedRetype[], options: { late?: boolean; id?: string } = {}): VideoAgentRequest & { sent: number } {
  const late = options.late ?? false;
  const id = options.id ?? randomDelimiterId();
  const fits = (list: readonly EndedRetype[], max: number): boolean => endedTextBody(list, max, late, id).length <= REQUEST_LIMITS.text;
  let max = ENDED_TEXT_MAX_WORDS;
  while (max > ENDED_TEXT_MIN_WORDS && !fits(entries, max)) max = Math.max(ENDED_TEXT_MIN_WORDS, Math.floor(max / 2));
  let sent = Math.min(1, entries.length);
  while (sent < entries.length && fits(entries.slice(0, sent + 1), max)) sent += 1;
  return { title: 'Put back the text typed by hand', text: endedTextBody(entries.slice(0, sent), max, late, id), sent };
}

/** A voiceover line to record again (`words`) or take out (`words === ''`). */
export interface VoiceoverChange {
  /** Where the line starts, in the film's own seconds. */
  at: FilmSeconds;
  /** The narration's audio name. */
  audio: string;
  /** What it says now. */
  was: string;
  words: string;
}

const AUDIO_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const lineTime = (change: VoiceoverChange): string => `${change.at.toFixed(2)} s`;

function voiceoverBody(changes: readonly VoiceoverChange[], id: string): string {
  const again = changes.filter((change) => change.words !== '');
  const out = changes.filter((change) => change.words === '');
  const line = (change: VoiceoverChange): string =>
    `The line at ${lineTime(change)}, audio ${AUDIO_NAME_PATTERN.test(change.audio) ? change.audio : 'unnamed'}, says now: ${clipCharacters(change.was, 80)}${
      change.words === '' ? '\nIt is to go.' : `\nIt is to say: ${change.words}`
    }`;
  return [
    'Change these lines of the voiceover, and keep the others as they are.',
    ...(again.length > 0 ? [`Record the ${again.length > 1 ? 'lines' : 'line'} at ${joinWithAnd(again.map(lineTime))} again. The block below has the words I want.`] : []),
    ...(out.length > 0 ? [`Take out the ${out.length > 1 ? 'lines' : 'line'} at ${joinWithAnd(out.map(lineTime))}.`] : []),
    'If a line no longer says what the block shows, change nothing and ask me which one I mean.',
    wrapUntrusted('voiceover text', changes.map(line).join('\n').normalize('NFKC').replace(/[<>]/g, ''), id),
  ].join('\n');
}

/** Record voiceover lines again with new words, or take them out: as many changes as fit, at least one. */
export function voiceoverRequest(changes: readonly VoiceoverChange[], options: { id?: string } = {}): VideoAgentRequest & { sent: number } {
  const id = options.id ?? randomDelimiterId();
  let sent = Math.min(1, changes.length);
  while (sent < changes.length && voiceoverBody(changes.slice(0, sent + 1), id).length <= REQUEST_LIMITS.text) sent += 1;
  return { title: 'Change the voiceover', text: voiceoverBody(changes.slice(0, sent), id), sent };
}
