/**
 * Scene lengths and names set by hand, written to `recut.json`. The stage reads the record as it loads, so a write
 * reloads the film at the new lengths. Every change can be undone; undo finds its scene again by id (or place and
 * name), since the parts may have been rebuilt in between.
 */

import { announce } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import {
  RECUT_MODULE,
  parseRecutRecord,
  partRecut,
  playSeconds,
  serializeRecutRecord,
  setRecutScene,
  snapSceneDuration,
  type ClockPart,
  type RecutChange,
} from '@open-artifact/motion-core';
import { pushUndo } from '../engine/undo.ts';
import { checkShorterScene } from '../flash/index.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { readRecord, refusesLaterRecord, writeRecord } from '../tweaks/record-documents.ts';
import { clampSceneLength, findScene, sceneLengthBounds, stableSceneKey } from './bounds.ts';
import { recutParts } from './lapsed.ts';
import * as words from './words.ts';

const NO_PARTS: readonly ClockPart[] = [];

export const clockParts = (): readonly ClockPart[] => useFilm.getState().clock?.parts ?? NO_PARTS;

/** What the record says of the scene now: its length and name set by hand, `null` where none. */
function setByHand(index: number): { dur: number | null; name: string | null } {
  const values = partRecut(readRecord(RECUT_MODULE, parseRecutRecord), recutParts(clockParts()), index);
  return { dur: values.dur?.v ?? null, name: values.name?.v ?? null };
}

/** Writes one scene's change; `true` when the record now says it (written, or already so). */
function writeChange(key: string, change: RecutChange): boolean {
  const parts = clockParts();
  const index = findScene(parts, key);
  if (index < 0 || refusesLaterRecord(RECUT_MODULE, 'scenes')) return false;
  const record = readRecord(RECUT_MODULE, parseRecutRecord);
  const text = serializeRecutRecord(setRecutScene(record, recutParts(parts), index, change));
  if (text === serializeRecutRecord(record)) return true;
  return writeRecord(RECUT_MODULE, text);
}

/** Whether the flash check lets the scene play over `length`, and the length it allows (a longer one, or none). */
async function flashAllows(index: number, label: string, playDur: number, length: number): Promise<number | null> {
  let verdict: Awaited<ReturnType<typeof checkShorterScene>>;
  try {
    verdict = await checkShorterScene({ sceneIndex: index, playDur: playSeconds(length) });
  } catch (error) {
    console.warn('video: the flash check failed', error);
    return length;
  }
  if (verdict.kind !== 'too-fast' && verdict.kind !== 'unchecked') return length;
  const unchecked = verdict.kind === 'unchecked';
  const minimum = snapSceneDuration(verdict.minimum, Math.ceil);
  if (minimum >= playDur - 1e-6) {
    toast.add({ title: unchecked ? words.UNCHECKED_NOW : words.tooShortNow(label) });
    return null;
  }
  toast.add({ title: unchecked ? words.uncheckedAt(label, minimum) : words.tooShortAt(label, minimum) });
  return Math.max(length, minimum);
}

/**
 * Plays the scene at `index` over `seconds` (snapped and kept within bounds), or over its own length for `null`.
 * Making a scene faster than its own pace waits for the flash check, and only while paused. Resolves to the length
 * written, or `null` when nothing was.
 */
export async function setSceneLength(index: number, seconds: number | null): Promise<number | null> {
  const parts = clockParts();
  const part = parts[index];
  const bounds = sceneLengthBounds(parts, index);
  if (part === undefined || bounds === null) return null;
  const key = stableSceneKey(part, index);
  let length = seconds === null ? part.filmDur : clampSceneLength(bounds, seconds);
  const before = setByHand(index).dur;
  if (Math.abs(length - part.playDur) < 1e-6 && (before === null) === (length === part.filmDur)) return null;
  if (length < part.filmDur - 1e-6 && length < part.playDur - 1e-6) {
    if (usePlayback.getState().playing) {
      toast.add({ title: words.PAUSE_TO_SHORTEN });
      return null;
    }
    const allowed = await flashAllows(index, part.label, part.playDur, length);
    if (allowed === null) return null;
    length = allowed;
  }
  const dur = (value: number | null): RecutChange => ({ kind: 'dur', dur: value === null ? null : playSeconds(value) });
  if (!writeChange(key, dur(length))) return null;
  pushUndo({ label: words.LENGTH_CHANGE, undo: () => void writeChange(key, dur(before)), redo: () => void writeChange(key, dur(length)) });
  announce(words.sceneLasts(index + 1, length));
  return length;
}

/** Calls the scene at `index` by `name`, or by its own name again for `null` (or a blank one). */
export function setSceneName(index: number, name: string | null): boolean {
  const part = clockParts()[index];
  if (part === undefined) return false;
  const key = stableSceneKey(part, index);
  const before = setByHand(index).name;
  const change = (value: string | null): RecutChange => ({ kind: 'name', name: value });
  if (!writeChange(key, change(name))) return false;
  const after = setByHand(index).name;
  if (after === before) return true;
  pushUndo({ label: words.NAME_CHANGE, undo: () => void writeChange(key, change(before)), redo: () => void writeChange(key, change(after)) });
  announce(words.sceneRenamed(index + 1));
  return true;
}
