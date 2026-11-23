/**
 * Tells a person of hides that may have stopped holding since the film changed: the record's hides for the stretch
 * read that find nothing, or whose thing the film's own style now shows anyway. A hide is told once in this page, and
 * once per film in this browser where the browser can keep a list; a hide whose thing another hide hides all the same
 * is not told. Pure but for {@link tellLapsedHides}, which reads and writes that list.
 */

import type { RetouchLayer } from '@open-artifact/motion-core';
import type { LayerRow, LayersReport } from '@open-artifact/motion-stage/protocol';
import { hiddenMayShow } from './words.ts';

/** The told list keeps this many hides at most, the newest. */
export const TOLD_HIDDEN_MOST = 200;
/** The report's lists are read this far at most. */
const MOST_LISTED = 64;

/** A hide as the told list names it: the entry, and the value it sets. */
export const hideKey = (entry: RetouchLayer): string => `${entry.id} hidden ${entry.hidden?.v ?? ''}`;

export interface HidesToTell {
  /** Hides to tell of now. */
  now: number;
  /** Hides first met in a stretch this page had not read: told only if the list can be kept, so never twice. */
  ifKept: number;
  /** The told list to keep; null: the browser keeps none. */
  told: string[] | null;
}

function byEntry(rows: readonly LayerRow[] | null): Map<string, LayerRow> {
  const found = new Map<string, LayerRow>();
  const walk = (row: LayerRow): void => {
    if (row.look?.entry != null && !found.has(row.look.entry)) found.set(row.look.entry, row);
    row.kids.forEach(walk);
    if (row.sole !== null) walk(row.sole);
  };
  rows?.forEach(walk);
  return found;
}

/**
 * Which hides of the record to tell of after a reading. `said`: the hides this page told of, which it adds to.
 * `firstRead`: the page had not read this stretch before, so what lapsed may have lapsed before it opened.
 */
export function hidesToTell(
  layers: readonly RetouchLayer[],
  report: Pick<LayersReport, 'rows' | 'lost' | 'underHide'>,
  scene: string,
  firstRead: boolean,
  said: Set<string>,
  told: readonly string[] | null,
): HidesToTell {
  const inScene = (id: string): boolean => id.startsWith(scene + ':');
  const lost = new Set(report.lost.filter(inScene).slice(0, MOST_LISTED));
  const underHide = new Set(report.underHide.filter(inScene).slice(0, MOST_LISTED));
  const rows = byEntry(report.rows);
  const keep = told === null ? null : new Set(told.slice(-TOLD_HIDDEN_MOST));
  let now = 0;
  let ifKept = 0;
  for (const entry of layers) {
    if (entry.hidden === undefined) continue;
    const key = hideKey(entry);
    const look = rows.get(entry.id)?.look ?? null;
    const isLost = lost.has(entry.id);
    const lapsed = isLost || (look !== null && look.hidden === 0 && look.home && look.lapsed.includes('hidden'));
    if (!lapsed) {
      // It holds again here: should it lapse later, it is told again.
      if (!isLost && look !== null && look.home && !look.lapsed.includes('hidden')) keep?.delete(key);
      continue;
    }
    if (said.has(key) || keep?.has(key) || underHide.has(entry.id)) continue;
    said.add(key);
    if (firstRead && keep === null) continue;
    keep?.add(key);
    if (firstRead) ifKept += 1;
    else now += 1;
  }
  const hides = new Set(layers.filter((entry) => entry.hidden !== undefined).map(hideKey));
  return { now, ifKept, told: keep === null ? null : [...keep].filter((key) => hides.has(key)).slice(-TOLD_HIDDEN_MOST) };
}

const storageKey = (): string => `video-told-hidden:${typeof location === 'undefined' ? '/' : location.pathname}`;

function readTold(): string[] | null {
  let text: string | null;
  try {
    text = localStorage.getItem(storageKey());
  } catch {
    return null;
  }
  try {
    const list: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(list) ? list.filter((each): each is string => typeof each === 'string').slice(-TOLD_HIDDEN_MOST) : [];
  } catch {
    return [];
  }
}

function writeTold(list: readonly string[]): boolean {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(list.slice(-TOLD_HIDDEN_MOST)));
    return true;
  } catch {
    return false;
  }
}

const said = new Set<string>();
const readStretches = new Set<string>();

/** After a reading of `stretchKey`: tells of the hides of the record that may be showing again, by `show`. */
export function tellLapsedHides(layers: readonly RetouchLayer[], report: LayersReport, scene: string, stretchKey: string, show: (words: string) => void): void {
  const firstRead = !readStretches.has(stretchKey);
  readStretches.add(stretchKey);
  const told = readTold();
  const tell = hidesToTell(layers, report, scene, firstRead, said, told);
  let count = tell.now;
  if (tell.told !== null && told !== null && (tell.told.join('\n') === told.join('\n') || writeTold(tell.told))) count += tell.ifKept;
  if (count > 0) show(hiddenMayShow(count));
}
