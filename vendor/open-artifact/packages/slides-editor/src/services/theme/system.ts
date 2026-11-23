









import type { NormalizedTokens } from '@open-artifact/design-system-core';
import { familyList, parseColor } from '@open-artifact/slides-core';
import { contrast, hexOf, isChromatic, isDark, lightness, statusBand, type StatusMeaning } from './color.ts';

/** The roles a palette slot (and a theme colour) can play. */
export type ColorRole =
  | 'background'
  | 'surface'
  | 'text'
  | 'muted'
  | 'border'
  | 'accent'
  | 'accent-soft'
  | 'on-accent'
  | 'inverse'
  | 'on-inverse'
  | 'on-inverse-muted'
  | 'inverse-accent'
  | StatusMeaning
  | 'other';

/** Roles in the order the panel lists them. */
export const COLOR_ROLES: readonly ColorRole[] = [
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'accent',
  'accent-soft',
  'on-accent',
  'inverse',
  'on-inverse',
  'on-inverse-muted',
  'inverse-accent',
  'success',
  'warning',
  'danger',
  'info',
  'other',
];

/** Human names of the roles. */
export const ROLE_LABELS: Record<ColorRole, string> = {
  background: 'Background',
  surface: 'Surface',
  text: 'Text',
  muted: 'Secondary text',
  border: 'Lines',
  accent: 'Accent',
  'accent-soft': 'Accent tint',
  'on-accent': 'Text on accent',
  inverse: 'Inverse ground',
  'on-inverse': 'Text on inverse',
  'on-inverse-muted': 'Secondary on inverse',
  'inverse-accent': 'Accent on inverse',
  success: 'Success',
  warning: 'Warning',
  danger: 'Error',
  info: 'Info',
  other: 'Other',
};

/** A theme colour with its role and how good a fit it is (0 best). */
export interface ThemeColor {
  name: string;
  value: string;
  role: ColorRole;
  rank: number;
}

/** One theme of a system. */
export interface SystemTheme {
  id: string;
  name: string;
  dark: boolean;
  colors: ThemeColor[];
}

/** A typeface a look sets: its CSS stack and the files that carry it, if the system ships them. */
export interface LookFamily {
  /** The first family name. */
  family: string;
  /** The `font-family` value written to slides. */
  stack: string;
  /** Font files of the system (`fonts/X.woff2`, under the system's folder), by weight. */
  files?: { file: string; weight: string; style: string }[];
}

/** A design system ready for restyling. */
export interface AnalyzedSystem {
  /** The system's namespace (its `project/ds/<namespace>/` folder). */
  key: string;
  title: string;
  themes: SystemTheme[];
  heading?: LookFamily;
  body?: LookFamily;
}

/** Most themes a system offers in the panel. */
export const MAX_THEMES = 8;

/** Splits a token name into lower-case words (`brandPrimary-fg` → `brand primary fg`). */
function words(name: string): string {
  return ` ${name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()} `;
}

const has = (text: string, ...terms: string[]): boolean => terms.some((t) => text.includes(` ${t} `));

/** The role a token's name (or usage note) states, if any. */
export function namedRole(text: string): ColorRole | undefined {
  const w = words(text);
  const accentWord = has(w, 'primary', 'accent', 'brand', 'highlight', 'link', 'interactive', 'action', 'cta');
  if (has(w, 'inverse', 'inverted') && has(w, 'text', 'fg', 'foreground', 'ink', 'on')) return 'on-inverse';
  if (has(w, 'inverse', 'inverted')) return 'inverse';
  if (has(w, 'on') && (accentWord || has(w, 'primary'))) return 'on-accent';
  if (accentWord && has(w, 'fg', 'foreground', 'contrast', 'text', 'on')) return 'on-accent';
  if (has(w, 'success', 'positive', 'good', 'ok', 'valid')) return 'success';
  if (has(w, 'warning', 'warn', 'caution', 'attention')) return 'warning';
  if (has(w, 'danger', 'error', 'destructive', 'negative', 'critical', 'bad')) return 'danger';
  if (has(w, 'info', 'informative', 'notice')) return 'info';
  if (accentWord && has(w, 'soft', 'subtle', 'tint', 'muted', 'light', 'weak', 'bg', 'background', 'container', 'wash')) return 'accent-soft';
  if (accentWord) return 'accent';
  if (has(w, 'border', 'line', 'divider', 'stroke', 'outline', 'separator', 'rule', 'hairline')) return 'border';
  const textWord = has(w, 'text', 'fg', 'foreground', 'ink', 'body', 'heading', 'content', 'copy', 'type') || (has(w, 'on') && has(w, 'background', 'surface', 'bg'));
  if (textWord && has(w, 'muted', 'subtle', 'secondary', 'tertiary', 'placeholder', 'caption', 'dim', 'faint', 'quiet')) return 'muted';
  if (textWord) return 'text';
  if (has(w, 'surface', 'card', 'panel', 'raised', 'elevated', 'container', 'sunken', 'layer', 'well', 'subtle', 'muted', 'secondary')) return 'surface';
  if (has(w, 'bg', 'background', 'canvas', 'page', 'base', 'paper', 'backdrop')) return 'background';
  return undefined;
}

/**
 * Gives every colour of one theme a role. Names and usage notes first
 * (rank 0 and 1), then the colour itself against the theme's background
 * (rank 3).
 */
export function assignThemeRoles(tokens: readonly { name: string; value: string; usage?: string }[]): { colors: ThemeColor[]; dark: boolean } {
  const colors: ThemeColor[] = [];
  const unnamed: { name: string; value: string }[] = [];
  for (const token of tokens) {
    const hex = hexOf(token.value);
    if (!hex) continue;
    const byName = namedRole(token.name);
    if (byName) {
      colors.push({ name: token.name, value: hex, role: byName, rank: 0 });
      continue;
    }
    const byUsage = token.usage ? namedRole(token.usage) : undefined;
    if (byUsage) colors.push({ name: token.name, value: hex, role: byUsage, rank: 1 });
    else unnamed.push({ name: token.name, value: hex });
  }
  // The background: the named one, else the lightest grey (or the darkest, in a dark-looking set).
  let background = colors.find((c) => c.role === 'background')?.value;
  if (!background) {
    const neutrals = unnamed.filter((t) => !isChromatic(t.value)).sort((a, b) => lightness(b.value) - lightness(a.value));
    const pick = neutrals[0];
    if (pick) {
      background = pick.value;
      colors.push({ name: pick.name, value: pick.value, role: 'background', rank: 2 });
      unnamed.splice(unnamed.indexOf(pick), 1);
    } else background = '#ffffff';
  }
  const dark = isDark(background);
  for (const token of unnamed) {
    const c = contrast(token.value, background);
    let role: ColorRole;
    if (isChromatic(token.value)) role = statusBand(token.value) && colors.some((x) => x.role === 'accent') ? statusBand(token.value)! : 'accent';
    else if (c >= 7) role = 'text';
    else if (c >= 3) role = 'muted';
    else if (c >= 1.25) role = 'border';
    else role = 'surface';
    colors.push({ name: token.name, value: token.value, role, rank: 3 });
  }
  return { colors, dark };
}

/** The best colour of a role in a theme (lowest rank, then token order). */
export function roleColor(theme: SystemTheme | undefined, role: ColorRole, nth = 0): string | undefined {
  if (!theme) return undefined;
  const list = theme.colors.filter((c) => c.role === role).sort((a, b) => a.rank - b.rank);
  return list[nth]?.value;
}

/** A family stack's first family, and the system's font files for it. */
function lookFamily(stack: string | null | undefined, tokens: NormalizedTokens): LookFamily | undefined {
  if (!stack || stack.includes('var(')) return undefined;
  const family = familyList(stack)[0];
  if (!family || /^(sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(family)) return undefined;
  const files = tokens.fonts.filter((f) => f.family.toLowerCase() === family.toLowerCase()).map((f) => ({ file: f.file, weight: f.weight, style: f.style }));
  return { family, stack, ...(files.length ? { files } : {}) };
}

/** Heading and body typefaces from the type styles and family names. */
function systemFamilies(tokens: NormalizedTokens): { heading?: LookFamily; body?: LookFamily } {
  const stackOf = (key: string | null, inline: string | null): string | null => (key ? (tokens.families[key] ?? null) : inline);
  let heading: LookFamily | undefined;
  let body: LookFamily | undefined;
  for (const group of tokens.groups) {
    for (const style of group.styles) {
      const name = words(`${group.name} ${style.name}`);
      const stack = stackOf(style.familyKey, style.family) ?? (group.family ? (tokens.families[group.family] ?? null) : null);
      if (!heading && has(name, 'display', 'hero', 'h1', 'title', 'heading', 'headline', 'h2')) heading = lookFamily(stack, tokens);
      if (!body && has(name, 'body', 'paragraph', 'text', 'p', 'copy', 'base', 'default')) body = lookFamily(stack, tokens);
    }
  }
  const byKey = (...keys: string[]): LookFamily | undefined => {
    for (const [key, stack] of Object.entries(tokens.families)) if (keys.some((k) => words(key).includes(` ${k} `))) return lookFamily(stack, tokens);
    return undefined;
  };
  heading ??= byKey('heading', 'display', 'headline', 'title');
  body ??= byKey('body', 'text', 'sans', 'base', 'default');
  const first = Object.values(tokens.families)[0];
  body ??= lookFamily(first, tokens);
  heading ??= body;
  return { heading, body };
}

/** Analyses a system's tokens: its themes (up to {@link MAX_THEMES}) with colour roles, and its typefaces. */
export function analyzeSystem(key: string, title: string, tokens: NormalizedTokens): AnalyzedSystem {
  const ids = tokens.themes.length ? tokens.themes.slice(0, MAX_THEMES) : [{ id: '', name: 'Default' }];
  const themes: SystemTheme[] = [];
  for (const theme of ids) {
    const list = tokens.colors
      .map((token) => {
        const raw = (theme.id ? token.resolved[theme.id] : undefined) ?? Object.values(token.resolved)[0];
        const value = raw ? parseColor(raw) : null;
        return value ? { name: token.name, value, usage: token.usage } : null;
      })
      .filter((t): t is { name: string; value: string; usage: string | undefined } => t !== null);
    if (!list.length) continue;
    const { colors, dark } = assignThemeRoles(list.map((t) => ({ name: t.name, value: t.value, ...(t.usage ? { usage: t.usage } : {}) })));
    themes.push({ id: theme.id, name: theme.name, dark, colors });
  }
  return { key, title, themes, ...systemFamilies(tokens) };
}
