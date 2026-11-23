/**
 * The voiceover's lines as the page edits them: their words compared and sent, the keys they are known by, the
 * changes a person typed, and where the lane may move a line to.
 */

import type { VoiceoverLine } from '@open-artifact/motion-audio';
import type { FilmSeconds, PlaySeconds, VoiceoverChange } from '@open-artifact/motion-core';

/** A line on the lane may not come nearer the line before or after it than this (seconds). */
export const LINE_GAP = 0.3;
/** Nor end nearer the film's end than this. */
export const END_MARGIN = 0.5;
/** Moves land on this grid (seconds). */
export const MOVE_SNAP = 0.05;
/** A press on a line becomes a drag once the pointer went this far (px). */
export const DRAG_START_PX = 6;
export const NUDGE_SECONDS = 0.1;
export const NUDGE_SHIFT_SECONDS = 0.5;
/** Nudges add up; the line goes once the keys have rested this long. */
export const NUDGE_COMMIT_MS = 600;
/** A move sent waits this long for the film to come back with it. */
export const MOVE_WAIT_MS = 30_000;
/** Lines sent to the agent stay marked this long when the agent never starts on them. */
export const OUT_HOLD_MS = 60_000;

/** Characters that have no place in words sent to the agent: controls and direction overrides. */
const UNSAFE_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g;

/** A line's words as compared and sent: one space between words, nothing unsafe in a prompt, nothing invisible. */
export function voiceWords(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_CHARACTERS, '')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .trim();
}

/**
 * Each line's key: its take and its words, and which of the same it is (a take may say the same words twice). A move
 * keeps a line's key; new words from the agent make it another line.
 */
export function lineKeys(lines: readonly Pick<VoiceoverLine, 'audio' | 'text'>[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = `${line.audio}\u0000${line.text}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return `${base}\u0000${count}`;
  });
}

/** `m:ss`, as a line's time shows. */
export function voiceClock(seconds: number): string {
  const whole = Math.max(0, seconds);
  return `${Math.floor(whole / 60)}:${String(Math.floor(whole % 60)).padStart(2, '0')}`;
}

/** `m:ss.t`, as a line being moved shows where it goes. */
export function voiceClockTenths(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${voiceClock(Math.floor(tenths / 10))}.${tenths % 10}`;
}

/** Words typed by line key; a line not in it says its own words. */
export type TypedWords = Readonly<Record<string, string>>;

/** The lines whose typed words differ from what they say: new words, or `''` to take the line out. */
export function voiceChanges(
  lines: readonly VoiceoverLine[],
  typed: TypedWords,
  toFilm: (t: PlaySeconds) => FilmSeconds,
): { key: string; change: VoiceoverChange }[] {
  const keys = lineKeys(lines);
  const changes: { key: string; change: VoiceoverChange }[] = [];
  lines.forEach((line, index) => {
    const key = keys[index]!;
    const words = typed[key];
    if (words === undefined) return;
    const now = voiceWords(words);
    const was = voiceWords(line.text);
    if (now === was) return;
    changes.push({ key, change: { at: toFilm(line.at), audio: line.audio, was, words: now } });
  });
  return changes;
}

/** Typed words kept only for lines that are still there. */
export function keepTypedFor(typed: TypedWords, keys: readonly string[]): TypedWords {
  const known = new Set(keys);
  const entries = Object.entries(typed);
  return entries.every(([key]) => known.has(key)) ? typed : Object.fromEntries(entries.filter(([key]) => known.has(key)));
}

/** Words typed for one line; `undefined` puts back what it says. */
export function withTyped(typed: TypedWords, key: string, words: string | undefined): TypedWords {
  const { [key]: _gone, ...rest } = typed;
  return words === undefined ? rest : { ...rest, [key]: words };
}

export const clampTo = ([low, high]: readonly [number, number], value: number): number => Math.min(high, Math.max(low, value));

export const snapVoiceTime = (t: number): number => Number((Math.round(t / MOVE_SNAP) * MOVE_SNAP).toFixed(2));

/**
 * Where line `index` may start: after the lines before it and before the next one, a gap apart, and ending before the
 * film's end. Never a range that leaves out where it is now.
 */
export function lineBounds(lines: readonly Pick<VoiceoverLine, 'at' | 'dur'>[], index: number, ends: number): [number, number] {
  const line = lines[index]!;
  const next = lines[index + 1];
  const earliest = lines.slice(0, index).reduce((latest, before) => Math.max(latest, before.at + before.dur + LINE_GAP), 0);
  const latest = Math.min(next === undefined ? Infinity : next.at - LINE_GAP - line.dur, ends - END_MARGIN - line.dur);
  return [Math.min(earliest, line.at), Math.max(latest, line.at)];
}

/** How far a line's words may run: to the next line that starts after it, and at least as far as the line itself. */
export function wordsRoom(starts: readonly number[], index: number, dur: number, across: number): number {
  const at = starts[index]!;
  return Math.max(dur, Math.min(across, ...starts.filter((start) => start > at)) - at);
}

/** A block's place on the lane, as CSS. */
export function laneSpan(at: number, dur: number, across: number): { left: string; width: string } {
  const span = Math.max(0.001, across);
  return { left: `${(at / span) * 100}%`, width: `calc(${(dur / span) * 100}% - 2px)` };
}

/** The peaks as a filled outline over the base line, in a box `peaks.length` wide and 1 high. */
export function peaksPath(peaks: readonly number[]): string {
  return `M0 1${peaks.map((peak, index) => `L${index + 0.5} ${1 - peak}`).join('')}L${peaks.length} 1Z`;
}
