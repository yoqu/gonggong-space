/** Lengths set by hand that stop counting when the agent gives a scene another length of its own. Pure. */

import { partRecut, type ClockPart, type RecutPart, type RecutRecord } from '@open-artifact/motion-core';
import { findScene, stableSceneKey } from './bounds.ts';

/** A change of the scene's own length smaller than this plays the same, so it says nothing. */
const SAME_LENGTH = 0.02;

/** A length set by hand that counts now: what the scene is called, and the length it plays over. */
export interface HandLength {
  label: string;
  v: number;
}

export const recutParts = (parts: readonly ClockPart[]): RecutPart[] => parts.map((part) => ({ key: part.key, own: part.own, filmDur: part.filmDur }));

/** The lengths set by hand that count now, by the scene's stable key. */
export function handLengths(record: RecutRecord, parts: readonly ClockPart[]): Map<string, HandLength> {
  const forParts = recutParts(parts);
  const lengths = new Map<string, HandLength>();
  parts.forEach((part, index) => {
    const dur = partRecut(record, forParts, index).dur;
    if (dur !== null) lengths.set(stableSceneKey(part, index), { label: part.label, v: dur.v });
  });
  return lengths;
}

/**
 * What the scenes were called whose length set by hand counted `before` and no longer does `now`, while the record
 * still holds it and the scene is still there at another length of its own: the agent changed that length.
 */
export function lapsedHandLengths(
  before: ReadonlyMap<string, HandLength>,
  now: ReadonlyMap<string, HandLength>,
  record: RecutRecord,
  parts: readonly ClockPart[],
): string[] {
  const recorded = new Set(
    record.scenes.flatMap((entry) =>
      entry.dur === undefined ? [] : [entry.target.by === 'id' ? entry.target.id : `${entry.target.part} ${entry.name?.was ?? ''}`],
    ),
  );
  const lapsed: string[] = [];
  for (const [key, was] of before) {
    if (now.has(key) || !recorded.has(key)) continue;
    const part = parts[findScene(parts, key)];
    if (part !== undefined && Math.abs(part.filmDur - was.v) >= SAME_LENGTH) lapsed.push(was.label);
  }
  return lapsed;
}
