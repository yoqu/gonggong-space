import { isPlainObject } from '../json.ts';
import { FILM_SCHEMA_VERSION } from '../limits.ts';
import { readVersionOneRecord, recordAbout, type SerializeRecordOptions } from './common.ts';

/** A color changed by hand: wherever the code says `was`, the film shows `v` (both `#rrggbb`, lower case). */
export interface RecoloredColor {
  was: string;
  v: string;
}

export interface RecoloredRecord {
  about?: string;
  colors: RecoloredColor[];
}

export const EMPTY_RECOLORED_RECORD: RecoloredRecord = { colors: [] };
export const MAX_RECOLORED_COLORS = 64;
export const PALETTE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const RECOLORED_ABOUT =
  'The page writes this file; never write or delete it. A person changed the film’s colors: wherever the film’s code says a color’s "was", the film shows its "v", and a person who names a color means its "v". To change a color listed here, write the new color in the code in place of its "was". If they want the film’s own colors back, point them to Palette, under Style in the side panel.';

export function parseRecoloredRecord(input: unknown): RecoloredRecord {
  const record = readVersionOneRecord(input, 'colors');
  if (record === null) return { colors: [] };
  const colors = new Map<string, RecoloredColor>();
  for (const item of (record.colors as unknown[]).slice(0, MAX_RECOLORED_COLORS)) {
    if (!isPlainObject(item) || typeof item.was !== 'string' || typeof item.v !== 'string') continue;
    if (!PALETTE_COLOR_PATTERN.test(item.was) || !PALETTE_COLOR_PATTERN.test(item.v)) continue;
    const was = item.was.toLowerCase();
    const v = item.v.toLowerCase();
    if (was !== v) {
      colors.set(was, { was, v });
    }
  }
  const about = recordAbout(record);
  return { ...(about !== undefined ? { about } : {}), colors: [...colors.values()] };
}

/** The record with one color changed, or put back when `v` is the film's own. */
export function setRecoloredColor(record: RecoloredRecord, was: string, v: string): RecoloredRecord {
  const from = was.toLowerCase();
  const to = v.toLowerCase();
  const rest = record.colors.filter((color) => color.was !== from);
  return { ...record, colors: from === to || !PALETTE_COLOR_PATTERN.test(to) ? rest : [...rest, { was: from, v: to }] };
}

/** `recolored.json`'s text, or `null` when no color is changed. */
export function serializeRecoloredRecord(record: RecoloredRecord, options: SerializeRecordOptions = {}): string | null {
  if (record.colors.length === 0) return null;
  const colors = record.colors.slice(0, MAX_RECOLORED_COLORS).map(({ was, v }) => ({ was, v }));
  return JSON.stringify(options.about === false ? { v: FILM_SCHEMA_VERSION, colors } : { v: FILM_SCHEMA_VERSION, about: RECOLORED_ABOUT, colors });
}
