import { FONT_SLOTS, builtinFontSlug, resolveBuiltinFont, resolveFontFamily, type BuiltinFont, type FontSlot } from '../fonts/builtin.ts';
import { parseFontRequest, type FontRequest } from '../fonts/google.ts';
import { isPlainObject, readRecordInput } from '../json.ts';
import { FILM_SCHEMA_VERSION } from '../limits.ts';
import { recordAbout } from './common.ts';

/**
 * A slot's typeface picked by hand: one the player carries, or a Google Fonts family with the built-in one that
 * shows wherever it cannot be fetched (`or`, a built-in slug).
 */
export type RefacedSlot = { kind: 'builtin'; font: BuiltinFont } | { kind: 'family'; family?: string; weights?: number[]; or: BuiltinFont };

export interface RefacedRecord {
  about?: string;
  slots: Partial<Record<FontSlot, RefacedSlot>>;
}

export const EMPTY_REFACED_RECORD: RefacedRecord = { slots: {} };

/** A slot as written in `refaced.json`, as the page reads it; `undefined` when it names nothing it can show. */
export function parseRefacedSlot(value: unknown, resolve: (slot: unknown) => FontRequest | null = parseFontRequest): RefacedSlot | undefined {
  const builtin = resolveBuiltinFont(value);
  if (builtin !== undefined) return { kind: 'builtin', font: builtin };
  if (!isPlainObject(value)) return undefined;
  const fallback = resolveFontFamily(value.or);
  if (fallback === undefined) return undefined;
  const request = value.family === undefined ? null : resolve(value);
  const google = request === null || resolveFontFamily(request.family) !== undefined ? null : request;
  return {
    kind: 'family',
    ...(google !== null ? { family: google.family } : {}),
    ...(google !== null && Array.isArray(value.weights) ? { weights: google.weights } : {}),
    or: fallback,
  };
}

/** The typefaces `refaced.json` picks, by slot. */
export function parseRefacedRecord(input: unknown, resolve?: (slot: unknown) => FontRequest | null): RefacedRecord {
  const record = readRecordInput(input);
  if (record === null || record.v !== FILM_SCHEMA_VERSION) return { slots: {} };
  const slots: Partial<Record<FontSlot, RefacedSlot>> = {};
  for (const slot of FONT_SLOTS) {
    const parsed = parseRefacedSlot(record[slot], resolve);
    if (parsed !== undefined) slots[slot] = parsed;
  }
  const about = recordAbout(record);
  return { ...(about !== undefined ? { about } : {}), slots };
}

function slotJson(slot: RefacedSlot): unknown {
  switch (slot.kind) {
    case 'builtin':
      return slot.font.id;
    case 'family':
      return {
        ...(slot.family !== undefined ? { family: slot.family } : {}),
        or: builtinFontSlug(slot.or),
        ...(slot.weights !== undefined ? { weights: slot.weights } : {}),
      };
    default: {
      const never: never = slot;
      return never;
    }
  }
}

const slotNames = (slots: RefacedRecord['slots']): FontSlot[] => FONT_SLOTS.filter((slot) => slots[slot] !== undefined);

/** What `refaced.json` tells the agent of the typefaces picked. */
export function refacedAbout(slots: RefacedRecord['slots']): string {
  const picked = slotNames(slots);
  const sans = slots.sans;
  if (picked.length === 1 && sans?.kind === 'builtin')
    return `The page writes this file; leave it as it is. A person picked this film’s typeface under Style, in the side panel: kit.fonts.sans (var(--sans) in css) now begins with it, in weights ${sans.font.weights}. Go on using it. For another of the panel’s typefaces, or the film’s original one back, point them to Font, under Style. For one that the panel does not have: in a film with modules/scenes.json a Google Fonts family goes in the slot of its fonts whose stack the words they mean wear (in sans it shows once the person sets Font to Original); their own font files go in as font assets, named ahead of that stack.`;
  const describe = (slot: FontSlot): string => {
    const picked = slots[slot]!;
    const shown = picked.kind === 'builtin' ? picked.font : picked.family === undefined ? picked.or : undefined;
    return `for kit.fonts.${slot} (var(--${slot}) in css), ${
      shown !== undefined
        ? `${shown.name} (weights: ${shown.weights})`
        : `the Google Fonts family in this file’s "${slot}" (fetched at 400 and 700, or what it has nearest; its "or" shows wherever it cannot be fetched)`
    }`;
  };
  return `The page writes this file; leave it as it is. Under Style, in the side panel, a person picked: ${picked.map(describe).join('; ')}. Go on using those stacks. If the person wants another typeface there, or the original one back, point the person to Font, under Style. A typeface that you name for such a stack in "fonts" in modules/scenes.json shows only once the person sets the menu for that text, under Font, to Original (Headline is the one for display); the person’s own font files go in as font assets, named ahead of the stack.`;
}

/** The record with one slot picked, or put back to the film's own (`null`). */
export function setRefacedSlot(record: RefacedRecord, slot: FontSlot, picked: RefacedSlot | null): RefacedRecord {
  const slots = { ...record.slots };
  if (picked === null) delete slots[slot];
  else slots[slot] = picked;
  return { ...record, slots };
}

function sceneFontJson(slot: RefacedSlot): unknown {
  if (slot.kind === 'builtin') return builtinFontSlug(slot.font);
  if (slot.family === undefined) return builtinFontSlug(slot.or);
  return { family: slot.family, ...(slot.weights !== undefined ? { weights: slot.weights } : {}), or: builtinFontSlug(slot.or) };
}

/** `scenes.json`'s text with the typefaces a person picked written into its `fonts`, so the code shows them on its own. */
export function withRefacedSceneFonts(scenesText: string, record: RefacedRecord): string {
  const picked = slotNames(record.slots);
  if (picked.length === 0) return scenesText;
  const scenes = readRecordInput(scenesText);
  if (scenes === null) return scenesText;
  const fonts = isPlainObject(scenes.fonts) ? scenes.fonts : {};
  return JSON.stringify({ ...scenes, fonts: { ...fonts, ...Object.fromEntries(picked.map((slot) => [slot, sceneFontJson(record.slots[slot]!)])) } });
}

/** `refaced.json`'s text, or `null` when no slot is picked. */
export function serializeRefacedRecord(record: RefacedRecord): string | null {
  const picked = slotNames(record.slots);
  if (picked.length === 0) return null;
  return JSON.stringify({
    v: FILM_SCHEMA_VERSION,
    about: refacedAbout(record.slots),
    ...Object.fromEntries(picked.map((slot) => [slot, slotJson(record.slots[slot]!)])),
  });
}
