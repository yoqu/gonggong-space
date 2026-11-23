/**
 * Restyling a deck from one look to another. A look is a palette (a colour
 * per slot: `background`, `text`, `accent`, `accent-2`, …) and a heading and
 * body typeface. The deck remembers its original look and its last two looks
 * in `deck.json` (`style.theme`), so switching back restores the exact
 * values it had, and colours left over from an earlier look (a slide added in
 * the old palette) can be found and brought along.
 *
 * Planning a system look maps each slot to the system theme's colour of the
 * same role (deriving tints, lines and inks it does not name), then keeps
 * every ink legible on the ground it sits on. Pure: no store, no DOM.
 */

import { familyList, formatFamilies, parseFontFamily, type DeckFace, type DeckIndex, type Slide, type SlideNode, type StyleMap } from '@open-artifact/slides-core';
import { contrast, isChromatic, legibleOn, mix, withAlphaOf } from './color.ts';
import { familyKeyOf, isHeadingNode, slotRole, useKey, type PaletteSlot } from './analysis.ts';
import { roleColor, type ColorRole, type SystemTheme } from './system.ts';
import { mapSlideColors, type ColorProp, type ColorUse } from './walk.ts';

/* -------------------------------------------------------------------------- */
/* Memory                                                                      */
/* -------------------------------------------------------------------------- */

/** The id of the deck's own look. */
export const ORIGINAL_LOOK = '';

/** A remembered look: the slot colours and typefaces the deck had under it. */
export interface LookEntry {
  /** `<system>/<theme>`, or '' for the original look. */
  look: string;
  title?: string;
  colors: Record<string, string>;
  /** `font-family` stacks ('' for the default face); absent: not recorded. */
  heading?: string;
  body?: string;
  /** Original look only: the slot each ink slot sits on. */
  on?: Record<string, string>;
}

/** What `deck.json` `style.theme` holds. */
export interface ThemeMemory {
  original: LookEntry;
  /** The current look first, then the one before it (at most two). */
  recent: LookEntry[];
}

/** Most looks remembered besides the original. */
export const RECENT_LOOKS = 2;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseEntry(raw: unknown): LookEntry | null {
  if (!isRecord(raw) || typeof raw.look !== 'string' || !isRecord(raw.colors)) return null;
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.colors)) if (typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v)) colors[k] = v;
  const entry: LookEntry = { look: raw.look, colors };
  if (typeof raw.title === 'string') entry.title = raw.title;
  if (typeof raw.heading === 'string') entry.heading = raw.heading;
  if (typeof raw.body === 'string') entry.body = raw.body;
  if (isRecord(raw.on)) entry.on = Object.fromEntries(Object.entries(raw.on).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return entry;
}

/** The theme memory of an index, if it has a readable one. */
export function readThemeMemory(index: DeckIndex): ThemeMemory | null {
  const style = index.style;
  if (!isRecord(style) || !isRecord(style.theme)) return null;
  const original = parseEntry(style.theme.original);
  if (!original) return null;
  const recent = Array.isArray(style.theme.recent) ? style.theme.recent.map(parseEntry).filter((e): e is LookEntry => e !== null).slice(0, RECENT_LOOKS) : [];
  return { original, recent };
}

/** The index with `memory` stored (other `style` keys kept). */
export function withThemeMemory(index: DeckIndex, memory: ThemeMemory): DeckIndex {
  const style = isRecord(index.style) ? index.style : {};
  return { ...index, style: { ...style, theme: memory } };
}

/** The current look id ('' when the deck wears its own). */
export function currentLook(memory: ThemeMemory | null): string {
  return memory?.recent[0]?.look ?? ORIGINAL_LOOK;
}

/** Memory after `applied` became the current look: it goes first, the previous current second. */
export function nextMemory(memory: ThemeMemory | null, original: LookEntry, applied: LookEntry): ThemeMemory {
  const previous = memory?.recent ?? [];
  const recent = [applied, ...previous.filter((e) => e.look !== applied.look)].slice(0, RECENT_LOOKS);
  return { original: memory?.original ?? original, recent };
}

/** The share of colour uses (by count) whose colour one of the remembered looks has. */
export function memoryMatch(memory: ThemeMemory, uses: readonly { value: string; count: number }[]): number {
  const known = new Set([memory.original, ...memory.recent].flatMap((e) => Object.values(e.colors)));
  let hit = 0;
  let all = 0;
  for (const use of uses) {
    all += use.count;
    if (known.has(use.value)) hit += use.count;
  }
  return all ? hit / all : 1;
}

/** The original look from a fresh analysis. */
export function originalEntry(slots: readonly PaletteSlot[], heading?: string, body?: string): LookEntry {
  const colors: Record<string, string> = {};
  const on: Record<string, string> = {};
  for (const slot of slots) {
    colors[slot.id] = slot.value;
    if (slot.on) on[slot.id] = slot.on;
  }
  return { look: ORIGINAL_LOOK, title: 'Original look', colors, on, ...(heading !== undefined ? { heading } : {}), ...(body !== undefined ? { body } : {}) };
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

/** A slot to plan: its id, its colour in the original look and what it sits on. */
export interface PlanSlot {
  id: string;
  value: string;
  on?: string;
}

/** Slots of a remembered original look. */
export function memorySlots(original: LookEntry): PlanSlot[] {
  return Object.entries(original.colors).map(([id, value]) => ({ id, value, ...(original.on?.[id] ? { on: original.on[id] } : {}) }));
}

const INK_TARGET: Partial<Record<ColorRole, number>> = {
  text: 4.5,
  'on-accent': 4.5,
  'on-inverse': 4.5,
  muted: 3,
  'on-inverse-muted': 3,
  'inverse-accent': 3,
  accent: 3,
  success: 3,
  warning: 3,
  danger: 3,
  info: 3,
};

/** The best of `candidates` against `ground`. */
const mostReadable = (ground: string, candidates: string[]): string => [...candidates].sort((a, b) => contrast(b, ground) - contrast(a, ground))[0]!;

/**
 * The colour of every slot under a system theme: the theme's colour of the
 * slot's role (the nth one for `accent-2`…), derived when the theme has none,
 * then nudged until inks read on their ground.
 */
export function planColors(slots: readonly PlanSlot[], theme: SystemTheme): Record<string, string> {
  const T = (role: ColorRole, n = 0): string | undefined => roleColor(theme, role, n);
  const bg = T('background') ?? (theme.dark ? '#121212' : '#ffffff');
  const text = T('text') ?? legibleOn(theme.dark ? '#f2f2f2' : '#1a1a1a', bg, 7);
  const chromaticOthers = theme.colors.filter((c) => c.role === 'other' && isChromatic(c.value)).map((c) => c.value);
  const accents = [...theme.colors.filter((c) => c.role === 'accent').sort((a, b) => a.rank - b.rank).map((c) => c.value), ...chromaticOthers];
  const accent = accents[0] ?? text;
  const inverse = T('inverse') ?? text;
  const onInverse = T('on-inverse') ?? bg;
  const out: Record<string, string> = {};
  for (const slot of slots) {
    const role = slotRole(slot.id);
    const n = Number(/-(\d+)$/.exec(slot.id)?.[1] ?? 1);
    let value: string | undefined;
    switch (role) {
      case 'background':
        value = n === 1 ? bg : (T('surface', n - 2) ?? mix(bg, text, 0.04 * (n - 1)));
        break;
      case 'surface':
        value = T('surface', n - 1) ?? mix(bg, text, 0.05 * n);
        break;
      case 'text':
        value = T('text', n - 1) ?? text;
        break;
      case 'muted':
        value = T('muted', n - 1) ?? T('muted') ?? mix(text, bg, 0.4);
        break;
      case 'border':
        value = T('border', n - 1) ?? T('border') ?? mix(bg, text, 0.18);
        break;
      case 'accent':
        value = accents[n - 1] ?? (n === 1 ? accent : isChromatic(slot.value) ? slot.value : accent);
        break;
      case 'accent-soft':
        value = T('accent-soft', n - 1) ?? mix(bg, accent, 0.14);
        break;
      case 'on-accent':
        value = T('on-accent') ?? mostReadable(accent, [bg, text, '#ffffff', '#000000']);
        break;
      case 'inverse':
        value = inverse;
        break;
      case 'on-inverse':
        value = onInverse;
        break;
      case 'on-inverse-muted':
        value = mix(onInverse, inverse, 0.35);
        break;
      case 'inverse-accent':
        value = contrast(accent, inverse) >= 3 ? accent : onInverse;
        break;
      case 'success':
      case 'warning':
      case 'danger':
      case 'info':
        value = T(role) ?? slot.value;
        break;
      default:
        value = slot.value;
    }
    out[slot.id] = value;
  }
  // Inks stay legible on what they sit on.
  for (const slot of slots) {
    const target = INK_TARGET[slotRole(slot.id)];
    const ground = slot.on ? out[slot.on] : undefined;
    if (target && ground && out[slot.id]) out[slot.id] = legibleOn(out[slot.id]!, ground, target);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Colours                                                                     */
/* -------------------------------------------------------------------------- */

const AREA_ROLES: ReadonlySet<ColorRole> = new Set(['background', 'surface', 'accent', 'accent-soft', 'inverse', 'border', 'success', 'warning', 'danger', 'info', 'other']);
const INK_ROLES: ReadonlySet<ColorRole> = new Set(['text', 'muted', 'border', 'accent', 'on-accent', 'on-inverse', 'on-inverse-muted', 'inverse-accent', 'success', 'warning', 'danger', 'info', 'other']);

const fits = (prop: ColorProp, role: ColorRole): boolean => (prop === 'ground' || prop === 'fill' ? AREA_ROLES : INK_ROLES).has(role);

/**
 * The slot a colour use falls in under one of `looks` (tried in order), and
 * the index of the look that matched; null when no look has its colour.
 */
export function identifyUse(use: ColorUse, looks: readonly LookEntry[], on?: Record<string, string>): { slot: string; look: number } | null {
  for (let i = 0; i < looks.length; i++) {
    const look = looks[i]!;
    const candidates = Object.entries(look.colors).filter(([id, c]) => c === use.value && fits(use.prop, slotRole(id)));
    if (!candidates.length) continue;
    if (candidates.length > 1 && on) {
      // Prefer the slot that sits on the slot of this use's ground.
      const grounds = new Set(Object.entries(look.colors).filter(([, c]) => c === use.on).map(([id]) => id));
      const placed = candidates.find(([id]) => on[id] !== undefined && grounds.has(on[id]!));
      if (placed) return { slot: placed[0], look: i };
    }
    return { slot: candidates[0]![0], look: i };
  }
  return null;
}

/** How a deck's colours change. */
export interface ColorRestyle {
  /** Use key → slot, from a fresh analysis (first restyle). */
  assign?: Map<string, string>;
  /** Looks to identify colours by, the current one first. */
  from: readonly LookEntry[];
  /** The original look's `on` map (disambiguates equal colours). */
  on?: Record<string, string>;
  /** Slot → new colour. */
  to: Record<string, string>;
}

/** A slide with its colours restyled. */
export function restyleSlideColors(slide: Slide, plan: ColorRestyle): Slide {
  return mapSlideColors(slide, (use, raw) => {
    const slot = plan.assign?.get(useKey(use)) ?? identifyUse(use, plan.from, plan.on)?.slot;
    if (!slot) return undefined;
    const next = plan.to[slot];
    if (!next || next === use.value) return undefined;
    return withAlphaOf(next, raw);
  });
}

/**
 * Colour uses of a slide that wear an earlier look (found under one of
 * `looks` but the first) where the current look has another colour.
 */
export function strayUses(slide: Slide, looks: readonly LookEntry[], on?: Record<string, string>): number {
  let strays = 0;
  const current = looks[0];
  if (!current) return 0;
  mapSlideColors(slide, (use) => {
    const found = identifyUse(use, looks, on);
    if (found && found.look > 0 && current.colors[found.slot] && current.colors[found.slot] !== use.value) strays++;
    return undefined;
  });
  return strays;
}

/* -------------------------------------------------------------------------- */
/* Typefaces                                                                   */
/* -------------------------------------------------------------------------- */

/** One typeface change: text rendering in `from` (a family key, '' for the default) renders in `to` (a stack, '' for the default). */
export interface FamilyChange {
  from: string;
  to: string;
}

const textual = (node: SlideNode): boolean => node.kind === 'text' || node.kind === 'textbox' || node.kind === 'list' || node.kind === 'table';

function setFamily(style: StyleMap, stack: string | undefined): StyleMap {
  if ((style['font-family'] ?? undefined) === (stack || undefined)) return style;
  const next = { ...style };
  if (stack) next['font-family'] = stack;
  else delete next['font-family'];
  return next;
}

/**
 * A slide with its heading and body typefaces changed. Body declarations
 * (the slide, boxes, body text) that name the old body face are rewritten;
 * a heading that would follow them by inheritance keeps or gets its own
 * family, so headings and body change independently.
 */
export function restyleSlideFamilies(slide: Slide, change: { heading?: FamilyChange; body?: FamilyChange }): Slide {
  const { heading, body } = change;
  if (!heading && !body) return slide;
  const bodyStack = (own: string | undefined): string | undefined => (body && familyKeyOf(own) === body.from && (own || body.from === '') ? body.to || undefined : own);
  const walk = (nodes: readonly SlideNode[], origInherited: string | undefined, newInherited: string | undefined): SlideNode[] => {
    let out: SlideNode[] | null = null;
    nodes.forEach((node, i) => {
      const own = node.style['font-family'];
      const origEffective = own ?? origInherited;
      const isHeading = textual(node) && isHeadingNode(node);
      let newOwn = own;
      if (own && !isHeading) newOwn = bodyStack(own);
      const newEffective = newOwn ?? newInherited;
      if (textual(node)) {
        const desired = isHeading
          ? heading && familyKeyOf(origEffective) === heading.from
            ? heading.to || undefined
            : origEffective
          : body && familyKeyOf(origEffective) === body.from
            ? body.to || undefined
            : origEffective;
        if (familyKeyOf(newEffective) !== familyKeyOf(desired) && (desired || !newInherited)) newOwn = desired;
      }
      let next: SlideNode = node;
      if (newOwn !== own) next = { ...node, style: setFamily(node.style, newOwn) } as SlideNode;
      if (node.kind === 'box') {
        const children = walk(node.children, origEffective, newOwn ?? newInherited);
        if (children !== node.children) next = { ...(next as typeof node), children };
      }
      if (next !== node) {
        out ??= [...nodes];
        out[i] = next;
      }
    });
    return (out ?? nodes) as SlideNode[];
  };
  const own = slide.style['font-family'];
  const newOwn = body && familyKeyOf(own) === body.from ? body.to || undefined : own;
  const children = walk(slide.children, own, newOwn);
  if (newOwn === own && children === slide.children) return slide;
  return { ...slide, style: newOwn === own ? slide.style : setFamily(slide.style, newOwn), children };
}

/** The first declaration stack of a slide set whose first family is `key` ('' when `key` is ''). */
export function stackFor(slides: readonly Slide[], key: string): string {
  if (!key) return '';
  let found = '';
  const look = (style: StyleMap): void => {
    if (!found && familyKeyOf(style['font-family']) === key) found = style['font-family']!;
  };
  const walk = (nodes: readonly SlideNode[]): void => {
    for (const node of nodes) {
      look(node.style);
      if (node.kind === 'box') walk(node.children);
    }
  };
  for (const slide of slides) {
    look(slide.style);
    walk(slide.children);
    if (found) break;
  }
  return found || formatFamilies([key]);
}

/** Every family any `font-family` of the slides names, lower-cased. */
export function usedFamilies(slides: readonly Slide[]): Set<string> {
  const used = new Set<string>();
  const add = (value: string | undefined): void => {
    for (const name of familyList(value ?? '')) used.add(name.toLowerCase());
  };
  const walk = (nodes: readonly SlideNode[]): void => {
    for (const node of nodes) {
      add(node.style['font-family']);
      if (node.kind === 'box') walk(node.children);
      if (node.kind === 'table') for (const row of node.rows) for (const cell of row.cells) add(cell.style['font-family']);
    }
  };
  for (const slide of slides) {
    add(slide.style['font-family']);
    walk(slide.children);
  }
  return used;
}

/**
 * The deck's faces once `wanted` faces are carried: faces no slide names are
 * dropped first; null when more than `limit` would remain.
 */
export function carryFaces(faces: Record<string, DeckFace>, wanted: readonly [string, DeckFace][], used: ReadonlySet<string>, limit: number): Record<string, DeckFace> | null {
  const out: Record<string, DeckFace> = {};
  const have = new Set<string>();
  for (const [key, face] of Object.entries(faces)) {
    if (!used.has(face.family.toLowerCase())) continue;
    out[key] = face;
    have.add(face.family.toLowerCase());
  }
  for (const [key, face] of wanted) {
    if (have.has(face.family.toLowerCase())) continue;
    out[key] = face;
    have.add(face.family.toLowerCase());
  }
  return Object.keys(out).length > limit ? null : out;
}

/** `stack` reduced to the families the deck can render (declared faces and generics). */
export function renderableStack(stack: string, declared: ReadonlySet<string>): string {
  if (!stack) return '';
  const parsed = parseFontFamily(stack, declared);
  return parsed.ok ? parsed.value : stack;
}
