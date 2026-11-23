/**
 * `tokens.json`: a design system's tokens, and their compiled `tokens.css`.
 *
 * Every family but `type` is a LIST of `{name, value, usage}` entries;
 * `color` adds `themes`, and a color (or shadow) value may be per theme.
 * Values are validated strictly: anything that could smuggle CSS (`var()`,
 * `url()`, braces, named colors) is dropped with a note rather than
 * emitted, because the compiled stylesheet is loaded into other people's
 * pages. A name-to-value map (DTCG style) is valid JSON this grammar does
 * not read: that family shows as empty.
 */

/* -------------------------------------------------------------------------- */
/* File shape                                                                  */
/* -------------------------------------------------------------------------- */

/** A color theme. */
export interface Theme {
  id: string;
  name: string;
}

/** A value that is either one string or one per theme id. */
export type ThemedValue = string | Record<string, string>;

/** A token entry of a list family. */
export interface TokenEntry<V = string> {
  name: string;
  value: V;
  usage?: string;
}

/** A list family (`spacing`, `radius`, `opacity`, …). */
export interface TokenFamily<V = string> {
  note?: string;
  tokens: TokenEntry<V>[];
}

/** The color family. */
export interface ColorFamily extends TokenFamily<ThemedValue> {
  themes: Theme[];
}

/** A font file. */
export interface FontFace {
  /** Bare family name, no quotes. */
  family: string;
  /** Path under `project/`; a bare name means `fonts/<file>`. */
  file: string;
  /** CSS descriptor: `"400"` or `"300 800"`. */
  weight?: string | number;
  style?: 'normal' | 'italic' | 'oblique';
}

/** A type style. */
export interface TypeStyle {
  name: string;
  fontSize: string | number;
  lineHeight?: string | number;
  fontWeight?: string | number;
  letterSpacing?: string | number;
  fontStyle?: 'normal' | 'italic';
  opticalSize?: number;
  textTransform?: string;
  /** A `families` key (else the group's). */
  family?: string;
  sample?: string;
  usage?: string;
}

/** A group of type styles. */
export interface TypeGroup {
  name: string;
  family?: string;
  styles: TypeStyle[];
}

/** The type family. */
export interface TypeFamily {
  fonts: FontFace[];
  /** Key → CSS font-family stack. */
  families: Record<string, string>;
  groups: TypeGroup[];
}

/** The whole `tokens.json`. */
export interface TokensFile {
  name?: string;
  version?: number;
  color?: ColorFamily;
  type?: TypeFamily;
  spacing?: TokenFamily;
  radius?: TokenFamily;
  shadow?: TokenFamily<ThemedValue>;
  [family: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Grammar                                                                     */
/* -------------------------------------------------------------------------- */

/** Token and style names. */
export const TOKEN_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** Limits. */
export const TOKEN_LIMITS = {
  themes: 8,
  colors: 600,
  fonts: 4096,
  extraFamilies: 12,
  typeGroups: 12,
  typeStyles: 80,
  familyTokens: 60,
  note: 400,
  usage: 1000,
  sample: 200,
  aliasDepth: 16,
  family: 200,
  shadow: 400,
  plainValue: 200,
} as const;

/** Families with their own section and rules. */
export const KNOWN_FAMILIES = ['color', 'type', 'spacing', 'radius', 'shadow'] as const;
/** Top-level keys that are not families. */
const META_KEYS = new Set(['name', 'version', '$schema', 'description']);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(\s*[A-Za-z0-9.%,/\s+-]*\)$/i;
const ALIAS = /^\{(?:--)?([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\}$/;
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%)$/;
const PLAIN_VALUE = /^[A-Za-z0-9 #%(),./+_-]+$/;

/** Strips a leading `--` or `.` and validates; `null` when invalid. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/^--/, '').replace(/^\./, '');
  return TOKEN_NAME.test(name) ? name : null;
}

/** Escapes a name for a CSS identifier (`.` → `\.`). */
export function cssIdent(name: string): string {
  return name.replace(/\./g, '\\.').replace(/^\d/, (digit) => '\\3' + digit + ' ');
}

/** A literal color (not an alias): hex lowercased, or a plain color function. */
export function literalColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (HEX.test(text)) return text.toLowerCase();
  if (COLOR_FN.test(text) && !/\b(?:var|url|calc|env)\b/i.test(text)) return text;
  return null;
}

/** Parses an alias `{name}`; `null` when it is not one. */
export function aliasTarget(value: unknown): string | null {
  return typeof value === 'string' ? (ALIAS.exec(value.trim())?.[1] ?? null) : null;
}

/** A length: `12px`, `0.75rem`, `1em`, `50%`, `0`, or a number (px). */
export function length(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value === 0 ? '0' : `${value}px`;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '0') return '0';
  return LENGTH.test(text) ? text : null;
}

/** A line height: a length or a unitless number below 10. */
export function lineHeight(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 && value < 10 ? String(value) : `${value}px`;
  if (typeof value === 'string' && /^\d*\.?\d+$/.test(value.trim())) {
    const n = Number(value);
    return n > 0 && n < 10 ? value.trim() : null;
  }
  return length(value);
}

/** A font weight: 1–1000, a `"300 800"` range, `normal` or `bold`. */
export function fontWeight(value: unknown): string | null {
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  const parts = String(value ?? '').trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 2) return null;
  const ok = parts.every((part) => /^\d+$/.test(part) && Number(part) >= 1 && Number(part) <= 1000);
  return ok ? parts.join(' ') : null;
}

/** True when parentheses balance. */
function balanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** A CSS font-family stack: ≤200 chars, no `; { } < > \ ( )`, balanced quotes. */
export function familyStack(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > TOKEN_LIMITS.family || /[;{}<>\\()]/.test(text)) return null;
  if ((text.match(/"/g) ?? []).length % 2 || (text.match(/'/g) ?? []).length % 2) return null;
  return text;
}

/** A box-shadow: lengths, hex/function colors, `inset`, `none`; no `var()` or `url()`. */
export function shadowValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > TOKEN_LIMITS.shadow || !PLAIN_VALUE.test(text) || !balanced(text)) return null;
  if (/\b(?:var|url|calc|env|expression)\s*\(/i.test(text)) return null;
  return text;
}

/** A plain CSS value of an extra family. */
export function plainValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > TOKEN_LIMITS.plainValue || !PLAIN_VALUE.test(text) || !balanced(text)) return null;
  if (/\b(?:var|url|expression)\s*\(/i.test(text)) return null;
  return text;
}

/** Older systems kept color tokens inside named groups. A flat list takes precedence. */
export function storedTokenList(family: string, node: unknown): unknown[] | null {
  if (!node || typeof node !== 'object') return null;
  const { tokens, groups } = node as { tokens?: unknown; groups?: unknown };
  if (Array.isArray(tokens)) return tokens;
  if (family === 'color' && Array.isArray(groups)) {
    return groups.flatMap((group) => Array.isArray(group?.tokens) ? group.tokens : []);
  }
  return null;
}

function motionValue(value: unknown): string | null {
  if (typeof value === 'number' && value >= 0 && value < 1e6) return `${Math.round(value)}ms`;
  const text = plainValue(value);
  if (text && /^\.\d+(ms|s)$/i.test(text)) return '0' + text.toLowerCase();
  return text;
}

const clamp = (text: unknown, max: number): string | undefined =>
  typeof text === 'string' && text ? text.slice(0, max) : undefined;

/* -------------------------------------------------------------------------- */
/* Normalized model                                                            */
/* -------------------------------------------------------------------------- */

/** Why something was dropped or kept unshown. */
export interface TokenNote {
  level: 'warning' | 'info';
  message: string;
}

/** A color or shadow token, resolved per theme. */
export interface ThemedToken {
  name: string;
  usage?: string;
  /** What each theme declares: a literal or `{alias}` text. Missing themes inherit the first. */
  declared: Record<string, string>;
  /** Resolved literal per theme (aliases followed). */
  resolved: Record<string, string>;
}

/** A plain token. */
export interface PlainToken {
  name: string;
  value: string;
  usage?: string;
}

/** A validated type style. */
export interface NormalizedStyle {
  name: string;
  group: string;
  /** The `families` key, or `null` when the stack is inline. */
  familyKey: string | null;
  /** The CSS font-family value (`var(--font-key)` or a stack). */
  family: string | null;
  fontSize: string;
  lineHeight?: string;
  fontWeight?: string;
  letterSpacing?: string;
  fontStyle?: 'normal' | 'italic';
  opticalSize?: number;
  textTransform?: string;
  sample?: string;
  usage?: string;
}

/** A validated font face. */
export interface NormalizedFont {
  family: string;
  /** Path under the system root (`fonts/X.woff2`). */
  file: string;
  weight: string;
  style: 'normal' | 'italic' | 'oblique';
}

/** An extra family (`opacity`, `zIndex`…). */
export interface ExtraFamily {
  key: string;
  /** Section title from the key ("zIndex" → "Z index"). */
  title: string;
  note?: string;
  tokens: PlainToken[];
}

/** Everything a reader or the compiler needs, validated. */
export interface NormalizedTokens {
  name?: string;
  themes: Theme[];
  colors: ThemedToken[];
  colorNote?: string;
  shadows: ThemedToken[];
  spacing: PlainToken[];
  radius: PlainToken[];
  extras: ExtraFamily[];
  families: Record<string, string>;
  fonts: NormalizedFont[];
  groups: { name: string; family: string | null; styles: NormalizedStyle[] }[];
}

/** Title of an extra family from its key. */
export function familyTitle(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Result of {@link normalizeTokens}. */
export interface NormalizeResult {
  tokens: NormalizedTokens;
  notes: TokenNote[];
}

/** Validates a parsed `tokens.json`. Never throws; what fails a rule is dropped with a note. */
export function normalizeTokens(input: unknown): NormalizeResult {
  const notes: TokenNote[] = [];
  const note = (message: string, level: TokenNote['level'] = 'warning'): void => {
    notes.push({ level, message });
  };
  const raw = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const out: NormalizedTokens = {
    themes: [],
    colors: [],
    shadows: [],
    spacing: [],
    radius: [],
    extras: [],
    families: {},
    fonts: [],
    groups: [],
  };
  if (typeof raw.name === 'string') out.name = raw.name;
  /** Every family but type shares one `--name` namespace. */
  const taken = new Set<string>();

  const listOf = (key: string): unknown[] | null => {
    const family = raw[key];
    if (family === undefined) return null;
    const tokens = storedTokenList(key, family);
    if (!Array.isArray(tokens)) {
      note(`${key}: not a {"tokens": [...]} list, so it shows empty. Rewrite it as a list of {name, value, usage}.`);
      return null;
    }
    return tokens;
  };

  // Themes.
  const color = raw.color as { themes?: unknown; note?: unknown } | undefined;
  const themeList = Array.isArray(color?.themes) ? (color!.themes as unknown[]) : [];
  for (const theme of themeList) {
    const id = cleanName(typeof theme === 'string' ? theme : (theme as Theme)?.id)?.toLowerCase();
    if (!id || id === 'prototype' || Object.hasOwn(Object.prototype, id) || out.themes.some((t) => t.id === id)) {
      note(`color.themes: theme ${JSON.stringify((theme as Theme)?.id)} dropped (bad or duplicate id).`);
      continue;
    }
    if (out.themes.length >= TOKEN_LIMITS.themes) {
      note(`color.themes: more than ${TOKEN_LIMITS.themes} themes; "${id}" dropped.`);
      continue;
    }
    out.themes.push({ id, name: typeof (theme as Theme)?.name === 'string' ? (theme as Theme).name : id });
  }
  if (!out.themes.length) out.themes.push({ id: 'light', name: 'Light' });
  const themeIds = out.themes.map((theme) => theme.id);
  const firstTheme = themeIds[0]!;
  out.colorNote = clamp(color?.note, TOKEN_LIMITS.note);

  /** Reads a themed value into declared text per theme (literal or alias), validating literals. */
  const readThemed = (
    family: string,
    name: string,
    value: unknown,
    literal: (v: unknown) => string | null,
  ): Record<string, string> | null => {
    const perTheme: Record<string, unknown> =
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { [firstTheme]: value };
    const declared: Record<string, string> = {};
    for (const [rawTheme, v] of Object.entries(perTheme)) {
      const theme = rawTheme.toLowerCase();
      if (!themeIds.includes(theme)) {
        note(`${family}.${name}: unknown theme "${rawTheme}" ignored.`);
        continue;
      }
      if (aliasTarget(v) && family === 'color') declared[theme] = `{${aliasTarget(v)}}`;
      else if (literal(v)) declared[theme] = literal(v)!;
      else note(`${family}.${name}: value ${JSON.stringify(v)} for "${theme}" dropped.`);
    }
    if (!Object.keys(declared).length) return null;
    // A value only in a later theme is borrowed for the first.
    if (!declared[firstTheme]) declared[firstTheme] = declared[themeIds.find((id) => declared[id] !== undefined)!]!;
    return declared;
  };

  // Colors.
  const colorTokens = listOf('color') ?? [];
  const declaredColors: { name: string; usage?: string; declared: Record<string, string> }[] = [];
  for (const entry of colorTokens) {
    const e = entry as TokenEntry<unknown>;
    const name = cleanName(e?.name);
    if (!name) {
      note(`color: token name ${JSON.stringify(e?.name)} is invalid; dropped.`);
      continue;
    }
    if (taken.has(name)) {
      note(`color.${name}: duplicate name; dropped.`);
      continue;
    }
    if (declaredColors.length >= TOKEN_LIMITS.colors) {
      note(`color: more than ${TOKEN_LIMITS.colors} tokens; the rest dropped.`);
      break;
    }
    const declared = readThemed('color', name, e.value, literalColor);
    if (!declared) {
      note(`color.${name}: no valid value in any theme; dropped.`);
      continue;
    }
    taken.add(name);
    declaredColors.push({ name, usage: clamp(e.usage, TOKEN_LIMITS.usage), declared });
  }
  // Resolve aliases per theme; a missing/self/cyclic/too-deep alias drops that theme's value.
  const byName = new Map(declaredColors.map((token) => [token.name, token]));
  const resolve = (name: string, theme: string, seen: string[]): string | null => {
    const token = byName.get(name);
    if (!token) return null;
    const text = token.declared[theme] ?? token.declared[firstTheme];
    if (!text) return null;
    const target = aliasTarget(text);
    if (!target) return text;
    if (seen.includes(target) || seen.length >= TOKEN_LIMITS.aliasDepth) return null;
    return resolve(target, theme, [...seen, target]);
  };
  for (const token of declaredColors) {
    // Resolve in every theme: a theme the token does not declare inherits the
    // first theme's text, and an inherited alias follows that theme's target.
    const resolved: Record<string, string> = {};
    for (const theme of themeIds) {
      const value = resolve(token.name, theme, [token.name]);
      if (value) {
        resolved[theme] = value;
      } else if (token.declared[theme] !== undefined) {
        note(`color.${token.name}: alias ${token.declared[theme]} in "${theme}" does not resolve (missing, self, cycle or deeper than ${TOKEN_LIMITS.aliasDepth}); dropped.`);
        delete token.declared[theme];
      }
    }
    if (!Object.keys(resolved).length) continue;
    if (!resolved[firstTheme]) {
      const borrowed = Object.keys(resolved)[0]!;
      resolved[firstTheme] = resolved[borrowed]!;
      token.declared[firstTheme] = token.declared[borrowed]!;
    }
    out.colors.push({ name: token.name, usage: token.usage, declared: token.declared, resolved });
  }

  // Plain list families.
  const readPlain = (key: string, validate: (value: unknown) => string | null, max: number): PlainToken[] => {
    const list = listOf(key);
    const tokens: PlainToken[] = [];
    for (const entry of list ?? []) {
      const e = entry as TokenEntry<unknown>;
      const name = cleanName(e?.name);
      const value = validate(e?.value);
      if (!name || value === null) {
        note(`${key}: ${JSON.stringify(e?.name)} = ${JSON.stringify(e?.value)} dropped (bad name or value).`);
        continue;
      }
      if (taken.has(name)) {
        note(`${key}.${name}: name already used by another token; dropped.`);
        continue;
      }
      if (tokens.length >= max) {
        note(`${key}: more than ${max} tokens; the rest dropped.`);
        break;
      }
      taken.add(name);
      tokens.push({ name, value, usage: clamp(e.usage, TOKEN_LIMITS.usage) });
    }
    return tokens;
  };

  // Shadows (themed like colors, no aliases).
  for (const entry of listOf('shadow') ?? []) {
    const e = entry as TokenEntry<unknown>;
    const name = cleanName(e?.name);
    if (!name || taken.has(name)) {
      note(`shadow: ${JSON.stringify(e?.name)} dropped (bad or duplicate name).`);
      continue;
    }
    const declared = readThemed('shadow', name, e.value, shadowValue);
    if (!declared) continue;
    if (out.shadows.length >= TOKEN_LIMITS.familyTokens) {
      note(`shadow: at most ${TOKEN_LIMITS.familyTokens} tokens are read.`);
      break;
    }
    taken.add(name);
    out.shadows.push({ name, usage: clamp(e.usage, TOKEN_LIMITS.usage), declared, resolved: { ...declared } });
  }
  out.spacing = readPlain('spacing', length, TOKEN_LIMITS.familyTokens);
  out.radius = readPlain('radius', (value) => value === 'full' ? '9999px' : length(value), TOKEN_LIMITS.familyTokens);

  // Extra families.
  for (const key of Object.keys(raw)) {
    if (META_KEYS.has(key) || (KNOWN_FAMILIES as readonly string[]).includes(key)) continue;
    const family = raw[key] as { tokens?: unknown; note?: unknown } | null;
    if (!/^(?!(?:prototype|constructor)$)[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(key) || !family || typeof family !== 'object' || !Array.isArray(family.tokens)) {
      note(`"${key}" is not a token family; kept, not shown.`, 'info');
      continue;
    }
    if (out.extras.length >= TOKEN_LIMITS.extraFamilies) {
      note(`"${key}": more than ${TOKEN_LIMITS.extraFamilies} extra families; kept, not shown.`);
      continue;
    }
    out.extras.push({
      key,
      title: familyTitle(key),
      note: clamp(family.note, TOKEN_LIMITS.note),
      tokens: readPlain(key, key === 'motion' ? motionValue : plainValue, TOKEN_LIMITS.familyTokens),
    });
  }

  // Type.
  const type = raw.type as Partial<TypeFamily> | undefined;
  if (type && typeof type === 'object') {
    for (const [rawKey, stack] of Object.entries(type.families ?? {})) {
      const key = cleanName(rawKey)?.toLowerCase();
      const value = familyStack(stack);
      if (!key || !value) {
        note(`type.families.${rawKey}: invalid family stack; dropped.`);
        continue;
      }
      if (Object.keys(out.families).length >= 12) {
        note('type.families: at most 12 font families are read.');
        break;
      }
      out.families[key] = value;
    }
    for (const font of Array.isArray(type.fonts) ? type.fonts.slice(0, TOKEN_LIMITS.fonts) : []) {
      const family = typeof font?.family === 'string' ? font.family.trim() : '';
      const file = typeof font?.file === 'string' ? font.file.trim() : '';
      if (!family || /["';{}<>\\()]/.test(family) || !file || /(?:^|\/)\.\.(?:\/|$)|^\/|[:\x00-\x1f"'()\\]/.test(file)) {
        note(`type.fonts: ${JSON.stringify(font)} dropped (family must be a bare name, file a relative path).`);
        continue;
      }
      const weight = font.weight === undefined ? '400' : fontWeight(font.weight);
      const style = font.style ?? 'normal';
      if (!weight || !['normal', 'italic', 'oblique'].includes(style)) {
        note(`type.fonts: ${family} has an invalid weight or style; dropped.`);
        continue;
      }
      out.fonts.push({ family, file: file.includes('/') ? file : `fonts/${file}`, weight, style });
    }
    let styleCount = 0;
    for (const group of Array.isArray(type.groups) ? type.groups : []) {
      if (out.groups.length >= TOKEN_LIMITS.typeGroups) {
        note(`type.groups: more than ${TOKEN_LIMITS.typeGroups} groups; the rest dropped.`);
        break;
      }
      const groupName = typeof group?.name === 'string' ? group.name : 'Styles';
      const groupFamily = typeof group?.family === 'string' ? group.family : null;
      const styles: NormalizedStyle[] = [];
      const seenStyles = new Set(out.groups.flatMap((g) => g.styles.map((s) => s.name)));
      for (const style of Array.isArray(group?.styles) ? group.styles : []) {
        const name = cleanName(style?.name);
        const fontSize = length(style?.fontSize);
        if (!name || !fontSize || seenStyles.has(name)) {
          note(`type.${groupName}: style ${JSON.stringify(style?.name)} dropped (bad name, duplicate or bad fontSize).`);
          continue;
        }
        if (styleCount >= TOKEN_LIMITS.typeStyles) {
          note(`type: more than ${TOKEN_LIMITS.typeStyles} styles; the rest dropped.`);
          break;
        }
        const familyRef = (typeof style.family === 'string' ? style.family : groupFamily)?.toLowerCase() ?? null;
        const familyKey = familyRef && out.families[familyRef] ? familyRef : null;
        const inlineStack = !familyKey && familyRef ? familyStack(style.family ?? group.family) : null;
        const normalized: NormalizedStyle = {
          name,
          group: groupName,
          familyKey,
          family: familyKey ? `var(--font-${cssIdent(familyKey)})` : inlineStack,
          fontSize,
        };
        const lh = style.lineHeight === undefined ? undefined : lineHeight(style.lineHeight);
        if (lh) normalized.lineHeight = lh;
        const fw = style.fontWeight === undefined ? undefined : fontWeight(style.fontWeight);
        if (fw) normalized.fontWeight = fw;
        const ls = style.letterSpacing === undefined ? undefined : length(style.letterSpacing);
        if (ls) normalized.letterSpacing = ls;
        if (style.fontStyle === 'italic' || style.fontStyle === 'normal') normalized.fontStyle = style.fontStyle;
        if (typeof style.opticalSize === 'number' && Number.isFinite(style.opticalSize)) normalized.opticalSize = style.opticalSize;
        if (typeof style.textTransform === 'string' && /^(none|uppercase|lowercase|capitalize)$/.test(style.textTransform)) {
          normalized.textTransform = style.textTransform;
        }
        const sample = clamp(style.sample, TOKEN_LIMITS.sample);
        if (sample) normalized.sample = sample;
        const usage = clamp(style.usage, TOKEN_LIMITS.usage);
        if (usage) normalized.usage = usage;
        seenStyles.add(name);
        styles.push(normalized);
        styleCount++;
      }
      out.groups.push({ name: groupName, family: groupFamily, styles });
    }
  }
  return { tokens: out, notes };
}

/* -------------------------------------------------------------------------- */
/* tokens.css                                                                  */
/* -------------------------------------------------------------------------- */

/** Options of {@link compileTokensCss}. */
export interface CompileOptions {
  /** Written in the header comment. */
  title?: string;
  /** Maps a font file path (under the system root) to the URL the CSS uses. Default: as is. */
  fontUrl?: (file: string) => string;
}

const FONT_FORMATS: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/** Writes a color/shadow value: aliases become `var(--name)`. */
function cssThemed(text: string): string {
  const target = aliasTarget(text);
  return target ? `var(--${cssIdent(target)})` : text;
}

/** Compiles normalized tokens to the `tokens.css` every consumer loads. */
export function compileTokensCss(tokens: NormalizedTokens, options: CompileOptions = {}): string {
  const lines: string[] = [];
  const comment = (value: string) => value.replace(/\*\//g, '* /').replace(/<\//g, '< /').replace(/[\r\n\f]+/g, ' ').trim();
  const usage = (value?: string) => value ? ` /* ${comment(value)} */` : '';
  const first = tokens.themes[0]!.id;
  lines.push(`/* ${comment(options.title ?? tokens.name ?? 'Design system')} — generated from tokens.json */`);

  // Colors and shadows of the first theme.
  lines.push(`:root, [data-theme="${first}"] {`);
  for (const token of [...tokens.colors, ...tokens.shadows]) {
    lines.push(`  --${cssIdent(token.name)}: ${cssThemed(token.declared[first]!)};${usage(token.usage)}`);
  }
  lines.push('}');

  // Further themes: overrides, plus aliases re-declared so they follow the theme.
  for (const theme of tokens.themes.slice(1)) {
    const body: string[] = [];
    for (const token of [...tokens.colors, ...tokens.shadows]) {
      const own = token.declared[theme.id];
      const inherited = token.declared[first]!;
      if (own !== undefined && own !== inherited) body.push(`  --${cssIdent(token.name)}: ${cssThemed(own)};`);
      else if (aliasTarget(own ?? inherited)) body.push(`  --${cssIdent(token.name)}: ${cssThemed(inherited)};`);
    }
    if (body.length) lines.push(`[data-theme="${theme.id}"] {`, ...body, '}');
  }

  // Theme-independent values.
  const root: string[] = [];
  for (const token of [...tokens.spacing, ...tokens.radius, ...tokens.extras.flatMap((family) => family.tokens)]) {
    root.push(`  --${cssIdent(token.name)}: ${token.value};${usage(token.usage)}`);
  }
  for (const [key, stack] of Object.entries(tokens.families)) root.push(`  --font-${cssIdent(key)}: ${stack};`);
  const declared = new Set([...tokens.colors, ...tokens.shadows, ...tokens.spacing, ...tokens.radius, ...tokens.extras.flatMap((family) => family.tokens)].map((token) => token.name));
  for (const group of tokens.groups) {
    for (const style of group.styles) {
      if (declared.has('text-' + style.name)) continue;
      const italic = style.fontStyle === 'italic' ? 'italic ' : '';
      root.push(`  --text-${cssIdent(style.name)}: ${italic}${style.fontWeight ?? '400'} ${style.fontSize}/${style.lineHeight ?? '1.4'} ${style.family ?? 'inherit'};${usage(style.usage)}`);
    }
  }
  if (root.length) lines.push(':root {', ...root, '}');

  // One class per type style.
  for (const group of tokens.groups) {
    for (const style of group.styles) {
      const decls: string[] = [];
      if (style.family) decls.push(`font-family: ${style.family}`);
      decls.push(`font-size: ${style.fontSize}`);
      decls.push(`line-height: ${style.lineHeight ?? '1.4'}`);
      decls.push(`font-weight: ${style.fontWeight ?? '400'}`);
      decls.push(`letter-spacing: ${style.letterSpacing ?? '0'}`);
      if (style.fontStyle) decls.push(`font-style: ${style.fontStyle}`);
      if (style.textTransform) decls.push(`text-transform: ${style.textTransform}`);
      if (style.opticalSize !== undefined) decls.push(`font-variation-settings: 'opsz' ${style.opticalSize}`);
      lines.push(`.${cssIdent(style.name)} {`, ...decls.map((declaration) => `  ${declaration};`), '}');
    }
  }

  // Font faces.
  const fontUrl = options.fontUrl ?? ((file: string) => file);
  for (const font of tokens.fonts) {
    const ext = font.file.split('.').pop()?.toLowerCase() ?? '';
    const format = FONT_FORMATS[ext];
    const url = fontUrl(font.file).replace(/["\\\n]/g, '');
    lines.push(
      `@font-face { font-family: "${font.family}"; src: url("${url}")${format ? ` format("${format}")` : ''}; font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Parses and compiles in one step. */
export function tokensToCss(text: string, options?: CompileOptions): { css: string; notes: TokenNote[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const { tokens } = normalizeTokens({});
    return { css: compileTokensCss(tokens, options), notes: [{ level: 'warning', message: `tokens.json is not valid JSON: ${String(error)}` }] };
  }
  const { tokens, notes } = normalizeTokens(parsed);
  return { css: compileTokensCss(tokens, options), notes };
}

/** The label shared by tokens in a palette (after any common namespace). */
export function colorStem(name: string): string {
  return /^(.*?)-\d{1,4}$/.exec(name)?.[1] ?? name.split('-')[0]!;
}

export function colorGroups(colors: ThemedToken[]): { prefix: string; groups: Map<string, ThemedToken[]> } {
  const names = colors.map((color) => color.name);
  let prefix = '';
  const parts = (names[0] ?? '').split('-');
  for (let n = 1; names.length > 1 && n < parts.length; n++) {
    const candidate = parts.slice(0, n).join('-') + '-';
    if (!names.every((name) => name.startsWith(candidate) && name.length > candidate.length)) break;
    if (names.some((name) => name.slice(candidate.length).includes('-'))) prefix = candidate;
  }
  const stems = new Set(names.map((name) => name.slice(prefix.length)).filter((name) => name.includes('-')).map(colorStem));
  const groups = new Map<string, ThemedToken[]>([['', []]]);
  for (const color of colors) {
    const stem = colorStem(color.name.slice(prefix.length));
    const key = stems.has(stem) ? stem : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(color);
  }
  if (!groups.get('')!.length) groups.delete('');
  return { prefix, groups };
}
