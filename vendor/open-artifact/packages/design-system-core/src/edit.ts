/**
 * Edits of a raw `tokens.json`, as the editor page makes them.
 *
 * The page edits the file the agent wrote, not the normalized model: keys
 * this page does not understand (`meta`, a family's `note`, a token's
 * extra fields) survive every edit. Each function returns a new object and
 * never mutates its input, so the caller can keep the old one for undo.
 */

import { cleanName, storedTokenList, type ThemedValue } from './tokens.ts';

/** A parsed `tokens.json` (any JSON object). */
export type RawTokens = Record<string, unknown>;

/** Families whose tokens are `{name, value, usage}` lists. */
export type ListFamily = string;

/** A token entry as stored. */
export interface RawEntry {
  name: string;
  value?: unknown;
  usage?: string;
  [key: string]: unknown;
}

/** Parses `tokens.json`; an empty or missing file is an empty object. */
export function parseTokensFile(text: string | undefined): { raw: RawTokens; error: string | null } {
  if (text === undefined || !text.trim()) return { raw: {}, error: null };
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { raw: {}, error: 'tokens.json is not a JSON object.' };
    return { raw: value as RawTokens, error: null };
  } catch (error) {
    return { raw: {}, error: `tokens.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Writes `tokens.json` the way agents are asked to: two-space indent, trailing newline. */
export function serializeTokens(raw: RawTokens): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The token list of a family (empty when absent or malformed). */
export function familyEntries(raw: RawTokens, family: ListFamily): RawEntry[] {
  const node = raw[family];
  return (storedTokenList(family, node) ?? []).filter((entry): entry is RawEntry => isObject(entry) && typeof entry.name === 'string');
}

/** Replaces a family's token list, keeping the family's other keys. */
function withEntries(raw: RawTokens, family: ListFamily, update: (entries: unknown[]) => unknown[]): RawTokens {
  const node = isObject(raw[family]) ? (raw[family] as Record<string, unknown>) : {};
  const entries = storedTokenList(family, node) ?? [];
  const next = { ...node, tokens: update(entries) };
  if (family === 'color' && Array.isArray(node.groups)) delete (next as Record<string, unknown>).groups;
  return { ...raw, [family]: next };
}

/** The theme ids of the color family, first theme first. */
export function themeIds(raw: RawTokens): string[] {
  const color = raw.color;
  if (!isObject(color) || !Array.isArray(color.themes)) return [];
  return color.themes.flatMap((theme) => {
    const id = cleanName(isObject(theme) ? theme.id : theme)?.toLowerCase();
    return id ? [id] : [];
  });
}

/** Merges fields into one entry. A field set to `undefined` is removed. */
export function updateEntry(raw: RawTokens, family: ListFamily, name: string, fields: Partial<RawEntry>): RawTokens {
  return withEntries(raw, family, (entries) =>
    entries.map((entry) => {
      if (!isObject(entry) || cleanName(entry.name) !== name) return entry;
      const next: Record<string, unknown> = { ...entry, ...fields };
      for (const [key, value] of Object.entries(fields)) if (value === undefined) delete next[key];
      return next;
    }),
  );
}

/**
 * Sets a color or shadow value. With a theme id, only that theme changes:
 * a single value becomes a per-theme map (the old value stays the first
 * theme's), and a map whose themes all agree collapses back to one value.
 */
export function setThemedValue(raw: RawTokens, family: 'color' | 'shadow', name: string, value: string, theme: string | null): RawTokens {
  const entry = familyEntries(raw, family).find((candidate) => cleanName(candidate.name) === name);
  if (!entry) return raw;
  const themes = themeIds(raw);
  if (!theme || themes.length < 2) return updateEntry(raw, family, name, { value });
  const current = entry.value as ThemedValue | undefined;
  const map: Record<string, string> =
    typeof current === 'string' ? { [themes[0]!]: current } : isObject(current) ? { ...(current as Record<string, string>) } : {};
  map[theme] = value;
  const values = themes.map((id) => map[id] ?? map[themes[0]!]);
  const collapsed = values.every((v) => v === values[0]) && Object.keys(map).every((key) => themes.includes(key));
  return updateEntry(raw, family, name, { value: collapsed ? values[0] : map });
}

/** Restores inheritance for one secondary theme, keeping all other overrides. */
export function clearThemeOverride(raw: RawTokens, family: string, name: string, theme: string): RawTokens {
  const themes = themeIds(raw);
  const value = familyEntries(raw, family).find((entry) => cleanName(entry.name) === name)?.value;
  if (!isObject(value) || !themes.includes(theme) || theme === themes[0] || !Object.hasOwn(value, theme)) return raw;
  const copy = { ...value };
  // A later-only value was borrowed by the first theme on read.
  copy[themes[0]!] ??= themes.map((id) => copy[id]).find((v) => v !== undefined);
  delete copy[theme];
  return updateEntry(raw, family, name, { value: Object.keys(copy).length === 1 ? copy[themes[0]!] : copy });
}

/** Adds a token at the end of a family (creating the family if needed). */
export function addEntry(raw: RawTokens, family: ListFamily, entry: RawEntry): RawTokens {
  let next = raw;
  if (family === 'color' && !isObject(raw.color)) next = { ...raw, color: { themes: [{ id: 'light', name: 'Light' }], tokens: [] } };
  return withEntries(next, family, (entries) => [...entries, entry]);
}

/** Removes a token. */
export function removeEntry(raw: RawTokens, family: ListFamily, name: string): RawTokens {
  return withEntries(raw, family, (entries) => entries.filter((entry) => !isObject(entry) || cleanName(entry.name) !== name));
}

/** Renames a token; color and shadow aliases (`{old}`) follow it. */
export function renameEntry(raw: RawTokens, family: ListFamily, from: string, to: string): RawTokens {
  let next = updateEntry(raw, family, from, { name: to });
  if (family !== 'color' && family !== 'shadow') return next;
  const rewrite = (value: unknown): unknown => {
    if (value === `{${from}}` || value === `{--${from}}`) return `{${to}}`;
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, rewrite(v)]));
    return value;
  };
  for (const themed of ['color', 'shadow'] as const) {
    if (!isObject(next[themed])) continue;
    next = withEntries(next, themed, (entries) => entries.map((entry) => (isObject(entry) ? { ...entry, value: rewrite(entry.value) } : entry)));
  }
  return next;
}

/** Moves a token to `index` within its family. */
export function moveEntry(raw: RawTokens, family: ListFamily, name: string, index: number): RawTokens {
  return withEntries(raw, family, (entries) => {
    const from = entries.findIndex((entry) => isObject(entry) && cleanName(entry.name) === name);
    if (from < 0) return entries;
    const list = [...entries];
    const [moved] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, moved);
    return list;
  });
}

/* -------------------------------------------------------------------------- */
/* Type styles                                                                 */
/* -------------------------------------------------------------------------- */

/** Merges fields into a type style found by name. A field set to `undefined` is removed. */
export function updateStyle(raw: RawTokens, name: string, fields: Record<string, unknown>): RawTokens {
  const type = raw.type;
  if (!isObject(type) || !Array.isArray(type.groups)) return raw;
  const groups = type.groups.map((group) => {
    if (!isObject(group) || !Array.isArray(group.styles)) return group;
    return {
      ...group,
      styles: group.styles.map((style) => {
        if (!isObject(style) || style.name !== name) return style;
        const next: Record<string, unknown> = { ...style, ...fields };
        for (const [key, value] of Object.entries(fields)) if (value === undefined) delete next[key];
        return next;
      }),
    };
  });
  return { ...raw, type: { ...type, groups } };
}

/** Sets a family note (the text above a family's section). */
export function setFamilyNote(raw: RawTokens, family: ListFamily, note: string): RawTokens {
  const node = isObject(raw[family]) ? (raw[family] as Record<string, unknown>) : { tokens: [] };
  const next: Record<string, unknown> = { ...node, note };
  if (!note.trim()) delete next.note;
  return { ...raw, [family]: next };
}

/** A token name not yet used in `family`, built from `stem`. */
export function freeTokenName(raw: RawTokens, family: ListFamily, stem: string): string {
  const families = new Set([family, ...Object.keys(raw).filter((key) => key !== 'type')]);
  const taken = new Set([...families].flatMap((key) => familyEntries(raw, key).map((entry) => cleanName(entry.name))));
  for (let n = 1; ; n++) {
    const name = n === 1 ? stem : `${stem}-${n}`;
    if (!taken.has(name)) return name;
  }
}
