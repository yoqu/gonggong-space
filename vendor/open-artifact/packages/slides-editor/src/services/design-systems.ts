/**
 * Installed design systems. A deck keeps a copy of each system it uses under
 * `project/ds/<folder>/` and lists it in `deck.json` (`designSystems`). This
 * service reads each copy's `tokens.json` and offers:
 *
 * - its colors as swatches in every color menu (first theme's value), and
 * - its type styles as text styles in the Text style menus, written as the
 *   same plain declarations the built-in styles use (a slide never refers to
 *   a token: it holds literal values, so it renders without the system), and
 * - its themes as looks in the Theme panel (services/theme/).
 *
 * Tokens are re-read when the installed list changes or when a `tokens.json`
 * under `project/ds/` changes.
 */

import { styleDeclarations, styleTag, type NormalizedStyle, type NormalizedTokens } from '@open-artifact/design-system-core';
import { createSystemsLoader } from '@open-artifact/editor-kit';
import {
  parseColor,
  parseFontFamily,
  type DesignSystemRecord,
  type StyleMap,
  type TextStyle,
} from '@open-artifact/slides-core';
import { create } from 'zustand';
import { useDeck } from '../state/deck.ts';
import { maybeSession } from './session.ts';
import { analyzeSystem, type AnalyzedSystem } from './theme/system.ts';

/** A color token, resolved to a literal color the slide subset accepts. */
export interface SystemColor {
  name: string;
  value: string;
  usage?: string;
}

/** A type style, converted to slide px. */
export interface SystemTextStyle {
  /** Menu key: `ds:<namespace>:<n>`. */
  id: string;
  name: string;
  group: string;
  /** The system's title. */
  system: string;
  /** The tag the style writes. */
  tag: TextStyle['tag'];
  /** The declarations the style sets (font-family not yet checked against the deck's faces). */
  declarations: StyleMap;
}

/** One installed design system's tokens. */
export interface InstalledSystem {
  namespace: string;
  title: string;
  colors: SystemColor[];
  styles: SystemTextStyle[];
  /** The system as the Theme panel restyles with it: themes with colour roles, heading and body faces. */
  look: AnalyzedSystem;
}

interface DesignSystemsState {
  systems: InstalledSystem[];
}

/** The installed systems, as last read. */
export const useDesignSystems = create<DesignSystemsState>()(() => ({ systems: [] }));

/** Prefix of design-system text style ids. */
export const SYSTEM_STYLE_PREFIX = 'ds:';

/** Converts one type style; null when its size is not a length. */
function convertStyle(tokens: NormalizedTokens, style: NormalizedStyle, id: string, system: string): SystemTextStyle | null {
  const declarations = styleDeclarations(tokens, style);
  if (!declarations) return null;
  return { id, name: style.name, group: style.group, system, tag: styleTag(style), declarations };
}

/** Reads a normalized tokens file into what the menus offer. */
export function systemFromTokens(record: Pick<DesignSystemRecord, 'namespace' | 'title'>, tokens: NormalizedTokens): InstalledSystem {
  const theme = tokens.themes[0]?.id;
  const colors: SystemColor[] = [];
  const seen = new Set<string>();
  for (const token of tokens.colors) {
    const raw = (theme ? token.resolved[theme] : undefined) ?? Object.values(token.resolved)[0];
    const value = raw ? parseColor(raw) : null;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    colors.push({ name: token.name, value, ...(token.usage ? { usage: token.usage } : {}) });
  }
  const styles: SystemTextStyle[] = [];
  const title = record.title || tokens.name || record.namespace;
  for (const group of tokens.groups) {
    for (const style of group.styles) {
      const converted = convertStyle(tokens, style, `${SYSTEM_STYLE_PREFIX}${record.namespace}:${styles.length}`, title);
      if (converted) styles.push(converted);
    }
  }
  return { namespace: record.namespace, title, colors, styles, look: analyzeSystem(record.namespace, title, tokens) };
}

/**
 * A style's declarations for this deck: a font family the deck has not
 * declared as a face is dropped (the slide would not render it), keeping
 * the generic fallback when the stack has one.
 */
export function systemStyleDeclarations(style: SystemTextStyle, faces: ReadonlySet<string>): StyleMap {
  const out: StyleMap = { ...style.declarations };
  const family = out['font-family'];
  if (family) {
    const parsed = parseFontFamily(family, faces);
    // Everything dropped heals to a bare `sans-serif`: leave the family alone then.
    if (parsed.ok && (!parsed.warning || parsed.value !== 'sans-serif')) out['font-family'] = parsed.value;
    else delete out['font-family'];
  }
  return out;
}

/** Declarations compared when telling which style a text element has. */
const MATCHED = ['font-size', 'font-weight', 'line-height', 'text-transform', 'letter-spacing'] as const;

/** The installed style a text element matches, if any. */
export function matchSystemStyle(systems: readonly InstalledSystem[], tag: string, style: StyleMap): SystemTextStyle | undefined {
  for (const system of systems) {
    for (const candidate of system.styles) {
      if (candidate.tag !== tag) continue;
      if (MATCHED.every((key) => (style[key] ?? undefined) === candidate.declarations[key])) return candidate;
    }
  }
  return undefined;
}

/** Finds an installed style by its menu id. */
export function systemStyleById(id: string): SystemTextStyle | undefined {
  for (const system of useDesignSystems.getState().systems) {
    const found = system.styles.find((style) => style.id === id);
    if (found) return found;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

const loader = createSystemsLoader<DesignSystemRecord, InstalledSystem>({
  artifact: () => maybeSession()?.artifact ?? null,
  records: () => useDeck.getState().index.designSystems,
  subscribe: (listener) => useDeck.subscribe(listener),
  read: systemFromTokens,
  loaded: ({ systems }) => useDesignSystems.setState({ systems }),
});

/** Loads the installed systems and keeps them current (`createSystemsLoader`, `@open-artifact/editor-kit`). Call once the deck is loaded. */
export function startDesignSystems(): void {
  loader.start();
}
