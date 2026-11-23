import { isPlainObject, type JsonObject } from '../json.ts';
import { FILM_SCHEMA_VERSION, MAX_FILM_SECONDS } from '../limits.ts';
import { matching, normalizeLayerLabel, numberWithin, readPair, readVersionOneRecord } from './common.ts';

/** A value set by hand on one thing: `v` shows in place of the `was` the film gave it. */
export interface RetouchPair<T> {
  was: T;
  v: T;
}

export const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** What the side panel lets a person change on one thing. */
export interface RetouchProperties {
  fill?: RetouchPair<string>;
  ink?: RetouchPair<string>;
  size?: RetouchPair<number>;
  radius?: RetouchPair<number>;
  hidden?: { was: 0; v: 1 };
  weight?: RetouchPair<number>;
  italic?: RetouchPair<0 | 1>;
  px?: RetouchPair<number>;
  leading?: { was: number | 'normal'; v: number };
  tracking?: RetouchPair<number>;
  align?: RetouchPair<TextAlign>;
  face?: { was: string; v: string };
  svgfill?: RetouchPair<string>;
  svgstroke?: RetouchPair<string>;
}

export type RetouchProperty = keyof RetouchProperties;

/** One thing on the picture whose look was changed by hand, and how the player finds it again. */
export interface RetouchLayer extends RetouchProperties {
  /** The scene, digits that only name the entry, then the thing's tag: `yard:3.1/h1`. */
  id: string;
  cls: string;
  /** Which it was of how many such elements at `at`, and maybe a hash of its words: `0/2/k3f9a`. */
  kin: string;
  /**
   * What a hide on a `g` inside an svg is also found by once a change inside it ends its print: six hex digits for each
   * named `g` in it (a leading 0), then for each of its shapes, dot-joined (`isRetouchParts`).
   */
  parts?: string;
  /** A second of that scene (film seconds) at which it was on the picture. */
  at: number;
  /** Its words when a text style was last changed. */
  label?: string;
}

export interface RetouchedRecord {
  layers: RetouchLayer[];
}

export const EMPTY_RETOUCHED_RECORD: RetouchedRecord = { layers: [] };
export const MAX_RETOUCHED_LAYERS = 64;
export const MAX_RETOUCH_CLASS_CHARS = 200;

export const RETOUCH_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}:\d{1,3}(?:\.\d{1,3}){0,23}\/[a-z][a-z0-9-]{0,31}$/;
export const RETOUCH_KIN_PATTERN = /^\d{1,4}\/\d{1,4}(\/[0-9a-z]{1,7})?$/;
export const RETOUCH_COLOR_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
export const RETOUCH_PARTS_PATTERN = /^[0-9a-f]{6}(\.[0-9a-f]{6}){0,31}$/;
/** At most this many of a `parts`' hashes name a `g`; the rest are shapes. */
export const RETOUCH_PARTS_NAMES = 12;
/** No hash stands in a `parts` more often: that many copies mean "that many or more". */
export const RETOUCH_PARTS_MANY = 4;
const SVG_SHAPE_ID_PATTERN = /\/(path|rect|circle|ellipse|line|polyline|polygon)$/;

/** What a text style may be set to by hand (`v`), and what the film may have given (`was`). */
export const TEXT_STYLE_BOUNDS = {
  weight: { was: [1, 1000], v: [100, 900] },
  px: { was: [1, 2000], v: [4, 2000] },
  leading: { was: [0.1, 10], v: [0.5, 4] },
  tracking: { was: [-1, 2], v: [-0.2, 1] },
} as const;

/** What the side panel's controls offer. */
export const TEXT_STYLE_UI_BOUNDS = {
  px: [8, 600],
  leading: [0.6, 3],
  tracking: [-0.15, 0.6],
} as const;

export const SIZE_BOUNDS = [0.1, 4] as const;
export const RADIUS_BOUNDS = [0, 2000] as const;

/** The properties under Appearance; the others are text styles. */
export const APPEARANCE_RETOUCH_PROPERTIES = ['fill', 'size', 'radius', 'hidden', 'svgfill', 'svgstroke'] as const satisfies readonly RetouchProperty[];
export const TEXT_RETOUCH_PROPERTIES = ['ink', 'weight', 'italic', 'px', 'leading', 'tracking', 'align', 'face'] as const satisfies readonly RetouchProperty[];
export const RETOUCH_PROPERTIES = [
  'fill',
  'ink',
  'size',
  'radius',
  'hidden',
  'weight',
  'italic',
  'px',
  'leading',
  'tracking',
  'align',
  'face',
  'svgfill',
  'svgstroke',
] as const satisfies readonly RetouchProperty[];

export const isRetouchColor = matching(RETOUCH_COLOR_PATTERN);
const isBit = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const isTextAlign = (value: unknown): value is TextAlign => TEXT_ALIGNS.some((align) => align === value);
const isWeight = (value: unknown): value is number => numberWithin(100, 900)(value) && value % 100 === 0;
const isLeadingWas = (value: unknown): value is number | 'normal' => value === 'normal' || numberWithin(0.1, 10)(value);
const isFaceWas = matching(/^[A-Za-z0-9 _-]{1,64}$/);
const isFaceSlug = matching(/^(?=.{1,48}$)[a-z0-9]+(?:-[a-z0-9]+)*$/);
const isHiddenPair = (value: unknown): value is { was: 0; v: 1 } => isPlainObject(value) && value.was === 0 && value.v === 1;

/** Whether the entry names a shape inside an `svg`, the only things `svgfill` and `svgstroke` count on. */
export const isSvgShapeId = (id: string): boolean => SVG_SHAPE_ID_PATTERN.test(id);

/** Whether a thing holds words the player found when the entry was written (a third part of `kin`). */
export const hasWordsHash = (kin: string): boolean => kin.split('/').length === 3;

/**
 * Whether the hashes of a `parts` stand as the stage writes them: in order, so the names (which start with 0) come
 * first and are {@link RETOUCH_PARTS_NAMES} at most, and no hash more than {@link RETOUCH_PARTS_MANY} times.
 */
export function partsLaidOut(parts: readonly string[]): boolean {
  return parts.every(
    (hash, i) => !(i > 0 && hash < parts[i - 1]!) && hash !== parts[i - RETOUCH_PARTS_MANY] && (i < RETOUCH_PARTS_NAMES || hash >= '1'),
  );
}

export const isRetouchParts = (value: unknown): value is string =>
  typeof value === 'string' && RETOUCH_PARTS_PATTERN.test(value) && partsLaidOut(value.split('.'));

function readProperties(item: JsonObject, id: string): RetouchProperties {
  const properties: RetouchProperties = {};
  const color = (key: 'fill' | 'ink' | 'svgfill' | 'svgstroke'): void => {
    const pair = readPair(item[key], isRetouchColor, isRetouchColor);
    if (pair !== undefined) properties[key] = pair;
  };
  color('fill');
  color('ink');
  const size = readPair(item.size, numberWithin(...SIZE_BOUNDS), numberWithin(...SIZE_BOUNDS));
  if (size !== undefined) properties.size = size;
  const radius = readPair(item.radius, numberWithin(...RADIUS_BOUNDS), numberWithin(...RADIUS_BOUNDS));
  if (radius !== undefined) properties.radius = radius;
  if (isHiddenPair(item.hidden)) properties.hidden = { was: 0, v: 1 };
  const weight = readPair(item.weight, numberWithin(...TEXT_STYLE_BOUNDS.weight.was), isWeight);
  if (weight !== undefined) properties.weight = weight;
  const italic = readPair(item.italic, isBit, isBit);
  if (italic !== undefined) properties.italic = italic;
  const px = readPair(item.px, numberWithin(...TEXT_STYLE_BOUNDS.px.was), numberWithin(...TEXT_STYLE_BOUNDS.px.v));
  if (px !== undefined) properties.px = px;
  const leading = readPair(item.leading, isLeadingWas, numberWithin(...TEXT_STYLE_BOUNDS.leading.v));
  if (leading !== undefined) properties.leading = leading;
  const tracking = readPair(item.tracking, numberWithin(...TEXT_STYLE_BOUNDS.tracking.was), numberWithin(...TEXT_STYLE_BOUNDS.tracking.v));
  if (tracking !== undefined) properties.tracking = tracking;
  const align = readPair(item.align, isTextAlign, isTextAlign);
  if (align !== undefined) properties.align = align;
  const face = readPair(item.face, isFaceWas, isFaceSlug);
  if (face !== undefined) properties.face = face;
  if (isSvgShapeId(id)) {
    color('svgfill');
    color('svgstroke');
  }
  return properties;
}

const hasAny = (properties: RetouchProperties, keys: readonly RetouchProperty[]): boolean => keys.some((key) => properties[key] !== undefined);

/** One entry as the player reads it, or `null` when it names nothing it could find or holds no value it would show. */
export function parseRetouchLayer(value: unknown): RetouchLayer | null {
  if (!isPlainObject(value)) return null;
  const { id, cls, kin, parts, at, label } = value;
  if (typeof id !== 'string' || !RETOUCH_ID_PATTERN.test(id)) return null;
  if (typeof cls !== 'string' || cls.length > MAX_RETOUCH_CLASS_CHARS || !/^[\x20-\x7e]*$/.test(cls)) return null;
  if (typeof kin !== 'string' || !RETOUCH_KIN_PATTERN.test(kin)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > MAX_FILM_SECONDS) return null;
  const properties = readProperties(value, id);
  if (!hasAny(properties, RETOUCH_PROPERTIES)) return null;
  // A label is only for a text style: it keeps the words of what was styled, not of what was only moved or hidden.
  const keepsLabel = typeof label === 'string' && label !== '' && label === normalizeLayerLabel(label) && hasAny(properties, TEXT_RETOUCH_PROPERTIES);
  return { id, cls, kin, ...(isRetouchParts(parts) ? { parts } : {}), at, ...(keepsLabel ? { label } : {}), ...properties };
}

/** The entries of `retouched.json` the player keeps: at most 64, each id once. */
export function parseRetouchedRecord(input: unknown): RetouchedRecord {
  const record = readVersionOneRecord(input, 'layers');
  if (record === null) return { layers: [] };
  const seen = new Set<string>();
  const layers: RetouchLayer[] = [];
  for (const item of (record.layers as unknown[]).slice(0, MAX_RETOUCHED_LAYERS)) {
    const layer = parseRetouchLayer(item);
    if (layer === null || seen.has(layer.id)) continue;
    seen.add(layer.id);
    layers.push(layer);
  }
  return { layers };
}

export type RetouchChange = { [K in RetouchProperty]: { property: K; value: RetouchProperties[K] | null } }[RetouchProperty];

/** Where a layer is found: what a change by hand needs besides the value. */
export type RetouchTarget = Pick<RetouchLayer, 'id' | 'cls' | 'kin' | 'at'> & { parts?: string; label?: string };

/**
 * The record with one value set by hand on a thing, or taken back (`value: null`). A hide also takes the target's
 * way of finding the thing (`cls`, `kin`, `parts`, `at`), so one made again on a thing found loosely is found by it.
 */
export function setRetouchProperty(record: RetouchedRecord, target: RetouchTarget, change: RetouchChange): RetouchedRecord {
  const index = record.layers.findIndex((layer) => layer.id === target.id);
  const found = { cls: target.cls, kin: target.kin, ...(isRetouchParts(target.parts) ? { parts: target.parts } : {}), at: target.at };
  const current: RetouchLayer = index >= 0 ? record.layers[index]! : { id: target.id, ...found };
  const next: RetouchLayer = { ...current };
  if (index >= 0 && change.property === 'hidden') {
    delete next.parts;
    Object.assign(next, found);
  }
  if (change.value === null) delete next[change.property];
  else Object.assign(next, { [change.property]: change.value });
  if (target.label !== undefined && TEXT_RETOUCH_PROPERTIES.some((key) => key === change.property)) {
    const label = normalizeLayerLabel(target.label);
    if (label === '') delete next.label;
    else next.label = label;
  }
  if (!hasAny(next, TEXT_RETOUCH_PROPERTIES)) delete next.label;
  const keep = hasAny(next, RETOUCH_PROPERTIES);
  const layers = record.layers.slice();
  if (index >= 0) {
    if (keep) layers[index] = next;
    else layers.splice(index, 1);
  } else if (keep) {
    if (layers.length >= MAX_RETOUCHED_LAYERS) return record;
    layers.push(next);
  }
  return { layers };
}

/** The record without every value set by hand on the thing `id` names. */
export function clearRetouchLayer(record: RetouchedRecord, id: string): RetouchedRecord {
  return { layers: record.layers.filter((layer) => layer.id !== id) };
}

function layerJson(layer: RetouchLayer): Record<string, unknown> {
  const json: Record<string, unknown> = { id: layer.id, cls: layer.cls, kin: layer.kin };
  if (layer.parts !== undefined) json.parts = layer.parts;
  json.at = layer.at;
  if (layer.label !== undefined) json.label = layer.label;
  for (const key of RETOUCH_PROPERTIES) if (layer[key] !== undefined) json[key] = layer[key];
  return json;
}

/** `retouched.json`'s text, or `null` when no look is changed by hand. */
export function serializeRetouchedRecord(record: RetouchedRecord): string | null {
  if (record.layers.length === 0) return null;
  return JSON.stringify({ v: FILM_SCHEMA_VERSION, layers: record.layers.map(layerJson) });
}

/** `retouched.json` as an export carries it: without the words each entry noted for the page. */
export function exportedRetouchedText(record: RetouchedRecord): string | null {
  return serializeRetouchedRecord({ layers: record.layers.map(({ label: _label, ...layer }) => layer) });
}
