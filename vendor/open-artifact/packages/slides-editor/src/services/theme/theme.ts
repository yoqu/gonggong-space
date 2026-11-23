/**
 * The Theme panel's commands: restyle the whole deck from an installed
 * design system's look (or back to its original look), bring slides still
 * wearing an earlier look along, and change the heading or body typeface
 * across every slide. Each is one undo step covering every slide it touches
 * and `deck.json` (faces and the remembered looks). Runs in the browser; no
 * model is involved.
 */

import { DS_DIR, faceKey, formatFamilies, LIMITS, familyList, type DeckFace, type Slide } from '@open-artifact/slides-core';
import { toast } from '@open-artifact/ui';
import { deckOrder, useDeck } from '../../state/deck.ts';
import { GOOGLE_FONTS, WEB_SAFE_FONTS, googleFace, googleFont, webSafeFont, type Generic } from '../../lib/fonts.ts';
import { useDesignSystems, type InstalledSystem } from '../design-systems.ts';
import { analyzeDeck, MAX_RESTYLE_COLORS, type DeckAnalysis } from './analysis.ts';
import {
  carryFaces,
  currentLook,
  memoryMatch,
  memorySlots,
  nextMemory,
  ORIGINAL_LOOK,
  originalEntry,
  planColors,
  readThemeMemory,
  renderableStack,
  restyleSlideColors,
  restyleSlideFamilies,
  stackFor,
  strayUses,
  usedFamilies,
  withThemeMemory,
  type ColorRestyle,
  type FamilyChange,
  type LookEntry,
  type ThemeMemory,
} from './restyle.ts';
import { roleColor, type LookFamily, type SystemTheme } from './system.ts';

/** One look the panel offers: a system theme, or the original look. */
export interface LookOption {
  /** `<namespace>/<theme id>`, or '' for the original look. */
  id: string;
  title: string;
  /** The theme's name when the system has several. */
  subtitle?: string;
  /** Ground, ink, accent, surface, muted (what a tile shows). */
  swatches: string[];
  heading?: string;
  body?: string;
}

/** The id of a system theme's look. */
export const lookId = (namespace: string, theme: string): string => `${namespace}/${theme}`;

/** Splits a look id. */
function parseLookId(id: string): { namespace: string; theme: string } {
  const at = id.indexOf('/');
  return at < 0 ? { namespace: id, theme: '' } : { namespace: id.slice(0, at), theme: id.slice(at + 1) };
}

function themeSwatches(theme: SystemTheme): string[] {
  const pick = (role: Parameters<typeof roleColor>[1]): string | undefined => roleColor(theme, role);
  return [pick('background') ?? '#ffffff', pick('text') ?? '#1a1a1a', pick('accent') ?? pick('text') ?? '#1a1a1a', pick('surface') ?? pick('background') ?? '#ffffff', pick('muted') ?? '#777777'];
}

/** Every look of the installed systems (their themes), after the original look. */
export function lookOptions(systems: readonly InstalledSystem[], original: LookOption): LookOption[] {
  const out: LookOption[] = [original];
  for (const system of systems) {
    const themes = system.look.themes;
    for (const theme of themes) {
      out.push({
        id: lookId(system.namespace, theme.id),
        title: system.title,
        ...(themes.length > 1 ? { subtitle: theme.name } : {}),
        swatches: themeSwatches(theme),
        ...(system.look.heading ? { heading: system.look.heading.family } : {}),
        ...(system.look.body ? { body: system.look.body.family } : {}),
      });
    }
  }
  return out;
}

/** A look's display title. */
export function lookTitle(option: Pick<LookOption, 'title' | 'subtitle'>): string {
  return option.subtitle ? `${option.title} · ${option.subtitle}` : option.title;
}

/* -------------------------------------------------------------------------- */
/* Deck state                                                                  */
/* -------------------------------------------------------------------------- */

/** The slides a restyle reads and writes (in deck order, held ones left out). */
function editableSlides(): { id: string; slide: Slide }[] {
  const state = useDeck.getState();
  return deckOrder(state)
    .map((id) => ({ id, entry: state.slides[id] }))
    .filter((x): x is { id: string; entry: NonNullable<typeof x.entry> } => Boolean(x.entry && !x.entry.held))
    .map(({ id, entry }) => ({ id, slide: entry.slide }));
}

/** What the panel shows about the deck. */
export interface ThemeState {
  analysis: DeckAnalysis;
  /** The remembered looks, when the deck still matches them. */
  memory: ThemeMemory | null;
  /** The look the deck wears ('' for its own). */
  current: string;
  /** Slides that still wear colours of an earlier look. */
  strays: string[];
}

/** Reads the deck for the panel (memoized by the caller on the slide and index objects). */
export function readThemeState(slides: readonly { id: string; slide: Slide }[], indexStyle: ReturnType<typeof readThemeMemory>, systems: readonly InstalledSystem[]): ThemeState {
  let memory = indexStyle;
  const current = currentLook(memory);
  const system = current ? systems.find((s) => s.namespace === parseLookId(current).namespace) : undefined;
  const analysis = analyzeDeck(slides.map((s) => s.slide), system?.look);
  if (memory && memoryMatch(memory, analysis.uses) < 0.5) memory = null;
  const strays: string[] = [];
  if (memory?.recent[0]) {
    const looks = [memory.recent[0], ...memory.recent.slice(1), memory.original];
    for (const { id, slide } of slides) if (strayUses(slide, looks, memory.original.on) > 0) strays.push(id);
  }
  return { analysis, memory, current: memory ? currentLook(memory) : ORIGINAL_LOOK, strays };
}

/* -------------------------------------------------------------------------- */
/* Typefaces                                                                   */
/* -------------------------------------------------------------------------- */

const GENERICS = /^(sans-serif|serif|monospace|system-ui|cursive|fantasy|ui-sans-serif|ui-serif|ui-monospace)$/i;

/**
 * The face a family needs carried: the deck's own, a design system's font
 * file, or a Google font; 'builtin' for generic and web-safe families; null
 * when the deck cannot carry it.
 */
export function faceFor(family: string, faces: Record<string, DeckFace>, systems: readonly InstalledSystem[]): DeckFace | 'builtin' | null {
  if (!family || GENERICS.test(family) || webSafeFont(family)) return 'builtin';
  const lower = family.toLowerCase();
  const own = Object.values(faces).find((f) => f.family.toLowerCase() === lower);
  if (own) return own;
  for (const system of systems) {
    for (const look of [system.look.heading, system.look.body]) {
      if (!look?.files?.length || look.family.toLowerCase() !== lower) continue;
      const file = look.files.find((f) => f.weight === '400' && f.style === 'normal') ?? look.files.find((f) => f.style === 'normal') ?? look.files[0]!;
      return { family: look.family, src: `${DS_DIR}${system.namespace}/${file.file}` };
    }
  }
  const google = googleFont(family);
  return google ? googleFace(google) : null;
}

/** The generic a family falls back to. */
function genericOf(family: string, stack?: string): Generic {
  const last = stack ? familyList(stack).at(-1)?.toLowerCase() : undefined;
  if (last === 'serif' || last === 'monospace' || last === 'sans-serif') return last;
  return webSafeFont(family)?.generic ?? googleFont(family)?.generic ?? 'sans-serif';
}

/** The stack written for a family. */
export function familyStack(family: string, stack?: string): string {
  if (!family) return '';
  if (GENERICS.test(family)) return family.toLowerCase();
  return formatFamilies([family, genericOf(family, stack)]);
}

/** Families the font pickers offer: the deck's, the installed systems', the Google catalog and web-safe faces. */
export function familyChoices(faces: Record<string, DeckFace>, systems: readonly InstalledSystem[]): { family: string; group: string }[] {
  const out: { family: string; group: string }[] = [];
  const seen = new Set<string>();
  const add = (family: string | undefined, group: string): void => {
    if (!family || seen.has(family.toLowerCase())) return;
    seen.add(family.toLowerCase());
    out.push({ family, group });
  };
  for (const face of Object.values(faces)) add(face.family, 'In this deck');
  for (const system of systems) {
    add(system.look.heading?.family, system.title);
    add(system.look.body?.family, system.title);
  }
  for (const font of [...WEB_SAFE_FONTS, ...GOOGLE_FONTS].sort((a, b) => a.family.localeCompare(b.family))) add(font.family, 'More fonts');
  return out;
}

/** A requested typeface change, resolved against what the deck can carry. */
interface FontPlan {
  heading?: FamilyChange;
  body?: FamilyChange;
  wanted: [string, DeckFace][];
  /** Families that could not be carried. */
  missing: string[];
}

/** Resolves heading/body stacks to changes and the faces they need. */
function planFonts(analysis: DeckAnalysis, want: { heading?: string; body?: string }, faces: Record<string, DeckFace>, systems: readonly InstalledSystem[]): FontPlan {
  const plan: FontPlan = { wanted: [], missing: [] };
  for (const which of ['heading', 'body'] as const) {
    const stack = want[which];
    if (stack === undefined) continue;
    const family = familyList(stack)[0] ?? '';
    if ((family.toLowerCase() || '') === analysis[which]) continue;
    const face = faceFor(family, faces, systems);
    if (face === null) {
      plan.missing.push(family);
      continue;
    }
    if (face !== 'builtin') plan.wanted.push([faceKey(face.family), face]);
    plan[which] = { from: analysis[which], to: stack };
  }
  return plan;
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

/** Restyles slides (colours, then typefaces); returns the changed ones and the faces the deck then carries. */
function restyle(
  entries: readonly { id: string; slide: Slide }[],
  colors: ColorRestyle | null,
  fonts: FontPlan,
): { slides: Record<string, Slide>; faces: Record<string, DeckFace> | null; fontsDropped: boolean } {
  const state = useDeck.getState();
  const run = (withFonts: boolean): { slides: Record<string, Slide>; all: Slide[] } => {
    const changed: Record<string, Slide> = {};
    const all: Slide[] = [];
    const declared = new Set([...Object.values(state.index.faces), ...fonts.wanted.map(([, f]) => f)].map((f) => f.family.toLowerCase()));
    const fix = (change: FamilyChange | undefined): FamilyChange | undefined => (change ? { ...change, to: renderableStack(change.to, declared) } : undefined);
    const heading = withFonts ? fix(fonts.heading) : undefined;
    const body = withFonts ? fix(fonts.body) : undefined;
    for (const { id, slide } of entries) {
      let next = colors ? restyleSlideColors(slide, colors) : slide;
      next = restyleSlideFamilies(next, { heading, body });
      if (next !== slide) changed[id] = next;
      all.push(next);
    }
    // Held slides keep their families: they still need their faces.
    for (const entry of Object.values(state.slides)) if (entry.held) all.push(entry.slide);
    return { slides: changed, all };
  };
  let result = run(true);
  let faces = carryFaces(state.index.faces, fonts.wanted, usedFamilies(result.all), LIMITS.faces);
  let fontsDropped = false;
  if (!faces) {
    fontsDropped = true;
    result = run(false);
    faces = carryFaces(state.index.faces, [], usedFamilies(result.all), LIMITS.faces) ?? state.index.faces;
  }
  return { slides: result.slides, faces, fontsDropped };
}

function reportFonts(plan: FontPlan, dropped: boolean): void {
  if (dropped) toast.add({ title: 'Fonts unchanged', description: `A presentation carries up to ${LIMITS.faces} typefaces, and the new ones would not fit.` });
  else if (plan.missing.length) toast.add({ title: 'Some fonts were kept', description: `${plan.missing.join(', ')} can't be carried by this deck, so the current fonts stay.` });
}

/** The look option of an id, from the installed systems. */
function findLook(id: string, systems: readonly InstalledSystem[]): { system: InstalledSystem; theme: SystemTheme } | null {
  const { namespace, theme } = parseLookId(id);
  const system = systems.find((s) => s.namespace === namespace);
  const found = system?.look.themes.find((t) => t.id === theme) ?? (theme === '' ? system?.look.themes[0] : undefined);
  return system && found ? { system, theme: found } : null;
}

/** The stack a look family writes (its own stack when it names the family first). */
const lookStack = (look: LookFamily | undefined): string | undefined => (look ? familyStack(look.family, look.stack) : undefined);

/**
 * Restyles the whole deck to a look (`''` for the original look), as one
 * undo step. Returns false when nothing was done.
 */
export function applyLook(id: string): boolean {
  const state = useDeck.getState();
  if (state.readOnly || state.status !== 'ready') return false;
  const systems = useDesignSystems.getState().systems;
  const entries = editableSlides();
  const view = readThemeState(entries, readThemeMemory(state.index), systems);
  const { analysis } = view;
  let memory = view.memory;
  if (!memory && analysis.over) {
    toast.add({ title: "This deck can't be restyled automatically", description: `It uses ${analysis.distinct} colors (at most ${MAX_RESTYLE_COLORS}). Ask the agent to redo its look instead.` });
    return false;
  }
  const slides = entries.map((e) => e.slide);
  const original = memory?.original ?? originalEntry(analysis.slots, stackFor(slides, analysis.heading), stackFor(slides, analysis.body));
  const looks = memory ? [...memory.recent, memory.original] : [original];

  let to: Record<string, string>;
  let fonts: { heading?: string; body?: string };
  let title: string;
  if (id === ORIGINAL_LOOK) {
    if (!memory) return false;
    to = original.colors;
    fonts = { heading: original.heading, body: original.body };
    title = 'Original look';
  } else {
    const found = findLook(id, systems);
    if (!found) return false;
    to = planColors(memory ? memorySlots(original) : analysis.slots, found.theme);
    fonts = { heading: lookStack(found.system.look.heading), body: lookStack(found.system.look.body) };
    title = lookTitle({ title: found.system.title, ...(found.system.look.themes.length > 1 ? { subtitle: found.theme.name } : {}) });
  }

  const fontPlan = planFonts(analysis, fonts, state.index.faces, systems);
  const colors: ColorRestyle = { from: looks, to, ...(original.on ? { on: original.on } : {}), ...(memory ? {} : { assign: analysis.assign }) };
  const result = restyle(entries, colors, fontPlan);
  const applied: LookEntry = {
    look: id,
    title,
    colors: to,
    ...(fonts.heading !== undefined ? { heading: fonts.heading } : {}),
    ...(fonts.body !== undefined ? { body: fonts.body } : {}),
  };
  const { on: _on, ...originalLook } = original;
  memory = nextMemory(memory, original, id === ORIGINAL_LOOK ? originalLook : applied);
  const index = withThemeMemory({ ...state.index, faces: result.faces ?? state.index.faces }, memory);
  state.apply(`Theme: ${title}`, { slides: result.slides, index });
  reportFonts(fontPlan, result.fontsDropped);
  return true;
}

/** Brings slides still wearing an earlier look's colours to the current look (one undo step). */
export function applyCurrentLookToAll(): void {
  const state = useDeck.getState();
  if (state.readOnly) return;
  const memory = readThemeMemory(state.index);
  const current = memory?.recent[0];
  if (!memory || !current) return;
  const looks = [current, ...memory.recent.slice(1), memory.original];
  const result = restyle(editableSlides(), { from: looks, to: current.colors, ...(memory.original.on ? { on: memory.original.on } : {}) }, { wanted: [], missing: [] });
  if (!Object.keys(result.slides).length) return;
  state.apply(`Theme: ${current.title ?? 'look'} on all slides`, { slides: result.slides });
}

/** Sets the heading or body typeface across the deck (one undo step); '' for the default face. */
export function setDeckFamily(which: 'heading' | 'body', family: string): void {
  const state = useDeck.getState();
  if (state.readOnly) return;
  const systems = useDesignSystems.getState().systems;
  const entries = editableSlides();
  const analysis = analyzeDeck(entries.map((e) => e.slide));
  const stack = familyStack(family);
  const plan = planFonts(analysis, { [which]: stack }, state.index.faces, systems);
  if (!plan.heading && !plan.body) {
    reportFonts(plan, false);
    return;
  }
  const result = restyle(entries, null, plan);
  const index = result.faces && result.faces !== state.index.faces ? { ...state.index, faces: result.faces } : undefined;
  state.apply(which === 'heading' ? 'Heading font' : 'Body font', { slides: result.slides, ...(index ? { index } : {}) });
  reportFonts(plan, result.fontsDropped);
}
