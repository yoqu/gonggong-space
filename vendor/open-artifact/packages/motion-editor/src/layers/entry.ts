/**
 * Changes by hand on one layer, as entries of `retouched.json`: which entry a layer's change goes in, what a
 * property shows, and the pair a value is written as. Pure.
 */

import {
  RETOUCH_PROPERTIES,
  cssColorToHex,
  setRetouchProperty,
  type RetouchChange,
  type RetouchLayer,
  type RetouchProperty,
  type RetouchedRecord,
  type RetouchTarget,
} from '@open-artifact/motion-core';

/** What the stage says of how the film itself draws a thing, as far as entries go (a `LayerLook` or an `AskedLook`). */
export interface EntryLook {
  cls: string;
  kin: string | null;
  /** For a g in an svg: what a hide on it is also found by. */
  parts?: string;
  at: number;
  entry: string | null;
  /** The entry was found by its turn alone, on a thing with words: it may be another thing. */
  loose?: boolean;
  lapsed: readonly RetouchProperty[];
}

/** A layer as far as entries go. */
export interface EntryThing {
  id: string;
  texts: readonly string[];
}

/** An entry this page made or used for a thing in the current reading, so the next change goes in it too. */
export interface SeenTarget {
  thing: string;
  cls: string;
  kin: string;
  entry: string;
}

/** A thing whose look can be changed by hand: one the stage can find again (a kin, an id with no `+` or `*`). */
export const takesEntries = <L extends EntryLook>(thing: EntryThing, look: L | null): look is L & { kin: string } =>
  look !== null && look.kin !== null && !/[+*]/.test(thing.id);

const sceneOf = (id: string): string => id.slice(0, id.indexOf(':'));
const tagOf = (id: string): string => id.slice(id.lastIndexOf('/') + 1);

/** The entry that already marks this thing: the stage's word, else one this page made for it in this reading. */
export function knownEntryId(thing: EntryThing, look: EntryLook, seen: readonly SeenTarget[]): string | null {
  if (look.entry !== null && sceneOf(look.entry) === sceneOf(thing.id)) return look.entry;
  return seen.find((target) => target.thing === thing.id && target.cls === look.cls && target.kin === look.kin)?.entry ?? null;
}

/**
 * A new entry id for a thing: its scene and place, two groups of digits that only name the entry, and its tag. A
 * place too deep for the id's 24 parts is left out (`scene:999`).
 */
export function freshEntryId(thingId: string, taken: ReadonlySet<string>, digits: number): string {
  const slash = thingId.lastIndexOf('/');
  const place = thingId.slice(0, slash);
  const tag = thingId.slice(slash + 1);
  const head = place.split('.').length > 22 ? `${sceneOf(thingId)}:999` : place;
  const make = (d: number): string => `${head}.${Math.floor(d / 1000) % 1000}.${d % 1000}/${tag}`;
  let d = Math.max(0, Math.floor(digits)) % 1_000_000;
  for (let tries = 0; taken.has(make(d)) && tries < 1_000_000; tries += 1) d = (d + 1) % 1_000_000;
  return make(d);
}

/**
 * The entry a change to `thing` goes in, and where the stage finds the thing: the entry that marks it, else one of the
 * record that names a thing like it with the same words, else a new one. The entry keeps where it finds its thing,
 * except that a hide set again on a thing its entry found only loosely is found from then on as the stage now sees it.
 */
export function entryTarget(
  thing: EntryThing,
  look: EntryLook & { kin: string },
  record: RetouchedRecord | null,
  seen: readonly SeenTarget[],
  lost: readonly string[],
  digits: () => number,
  property?: RetouchProperty,
): RetouchTarget {
  const layers = record?.layers ?? [];
  const id =
    knownEntryId(thing, look, seen) ??
    layers.find(
      (layer) =>
        !lost.includes(layer.id) &&
        sceneOf(layer.id) === sceneOf(thing.id) &&
        tagOf(layer.id) === tagOf(thing.id) &&
        layer.cls === look.cls &&
        layer.kin === look.kin &&
        look.kin.split('/').length === 3,
    )?.id ??
    freshEntryId(thing.id, new Set(layers.map((layer) => layer.id)), digits());
  const existing = layers.find((layer) => layer.id === id);
  const { cls, kin, parts, at } = property === 'hidden' && look.loose === true ? look : (existing ?? look);
  return {
    id,
    cls,
    kin: kin ?? look.kin,
    ...(parts !== undefined ? { parts } : {}),
    at,
    ...(thing.texts[0] !== undefined ? { label: thing.texts[0] } : {}),
  };
}

/** The record's entry for a thing, if the record has it. */
export const entryOf = (record: RetouchedRecord | null, id: string | null): RetouchLayer | null =>
  id === null ? null : (record?.layers.find((layer) => layer.id === id) ?? null);

/**
 * A property of an entry counts on the thing shown when this page set it in this reading, or when the stage says the
 * entry marks the thing and the film's own style has not since changed under it.
 */
export function entryCounts(entry: RetouchLayer, look: EntryLook, property: RetouchProperty, touched: ReadonlySet<string>): boolean {
  if (entry[property] === undefined) return false;
  return touched.has(touchKey(entry.id, property)) || (look.entry === entry.id && !look.lapsed.includes(property));
}

export const touchKey = (entry: string, property: RetouchProperty): string => `${entry} ${property}`;

/** Whether any property of the entry counts on the thing shown. */
export const entryHasCounting = (entry: RetouchLayer | null, look: EntryLook | null, properties: readonly RetouchProperty[], touched: ReadonlySet<string>): boolean =>
  entry !== null && look !== null && properties.some((property) => entryCounts(entry, look, property, touched));

/** `#rrggbb` of a color with its alpha left out; undefined for none, or a color that does not show (alpha 00). */
export function opaqueHexColor(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (/^#[0-9a-f]{8}$/i.test(value) && value.slice(7).toLowerCase() === '00') return undefined;
  return value.slice(0, 7).toLowerCase();
}

/** A color a person picked, as the record writes it: `#rrggbb`, with the film's own alpha kept where asked. */
export function pickedColor(picked: string, was: string | null | undefined, keepAlpha: boolean): string | null {
  const hex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(picked) ? picked.slice(0, 7).toLowerCase() : cssColorToHex(picked);
  if (hex === null) return null;
  return keepAlpha && typeof was === 'string' && was.length === 9 ? hex + was.slice(7).toLowerCase() : hex;
}

/** Colors whose alpha the film gives stays as the film gives it. */
export const KEEPS_ALPHA: ReadonlySet<RetouchProperty> = new Set<RetouchProperty>(['svgfill', 'svgstroke', 'ink']);

type Value = string | number | null;

/**
 * The change that sets `property` to `v` on a thing whose film value is `was`: the pair, or a taking back (null) when
 * `v` is what the film gives anyway.
 */
export function pairChange(property: RetouchProperty, was: Value | undefined, v: Value): RetouchChange | null {
  if (property === 'hidden') return { property, value: v === 1 ? { was: 0, v: 1 } : null };
  if (v === null || was === undefined || was === null) return v === null ? ({ property, value: null } as RetouchChange) : null;
  if (v === was) return { property, value: null } as RetouchChange;
  return { property, value: { was, v } } as RetouchChange;
}

/** The record with a change made, and whether it took (false: the record holds as many entries as it can). */
export function applyChange(record: RetouchedRecord | null, target: RetouchTarget, change: RetouchChange): { record: RetouchedRecord; took: boolean } {
  const before = record ?? { layers: [] };
  const after = setRetouchProperty(before, target, change);
  const adds = change.value !== null && !before.layers.some((layer) => layer.id === target.id);
  return { record: after, took: !(adds && after === before) };
}

/** The value a property of an entry holds (`v`), as the controls read it. */
export function entryValue(entry: RetouchLayer, property: RetouchProperty): Value {
  const pair = entry[property];
  if (pair === undefined) return null;
  return pair.v as Value;
}

/** Every property, for taking back all of an entry's that count. */
export const ALL_PROPERTIES: readonly RetouchProperty[] = RETOUCH_PROPERTIES;
