









import { familyList, type Slide, type SlideNode } from '@open-artifact/slides-core';
import { chroma, contrast, hue, hueDifference, isChromatic, isDark, isPaleTint, statusBand } from './color.ts';
import { roleColor, type AnalyzedSystem, type ColorRole, COLOR_ROLES } from './system.ts';
import { DEFAULT_GROUND, slideColorUses, type ColorProp, type ColorUse } from './walk.ts';

/** A distinct colour use with how often the deck makes it. */
export interface DeckUse extends ColorUse {
  key: string;
  count: number;
}

/** One palette slot: a role and the colour the deck gives it. */
export interface PaletteSlot {
  id: string;
  role: ColorRole;
  value: string;
  count: number;
  /** The slot this one's uses mostly sit on (inks only). */
  on?: string;
}

/** The deck's colours and typefaces as the Theme panel works with them. */
export interface DeckAnalysis {
  /** The page ground most content sits on. */
  ground: string;
  dark: boolean;
  slots: PaletteSlot[];
  /** Use key → slot id. */
  assign: Map<string, string>;
  /** The distinct colour uses. */
  uses: DeckUse[];
  /** Distinct colours. */
  distinct: number;
  /** Too many colours to restyle automatically. */
  over: boolean;
  /** First family of headings and of body text ('' for the default face). */
  heading: string;
  body: string;
}

/** Above this many distinct colours the deck is not restyled automatically. */
export const MAX_RESTYLE_COLORS = 512;

/** The key of a use (what it paints, its colour, the ground under it). */
export function useKey(use: Pick<ColorUse, 'prop' | 'value' | 'on'>): string {
  return `${use.prop}|${use.value}|${use.on}`;
}

const isArea = (prop: ColorProp): boolean => prop === 'ground' || prop === 'fill';

/** Groups uses by key, counting them. */
export function groupUses(uses: readonly ColorUse[]): DeckUse[] {
  const map = new Map<string, DeckUse>();
  for (const use of uses) {
    const key = useKey(use);
    const entry = map.get(key);
    if (entry) entry.count++;
    else map.set(key, { ...use, key, count: 1 });
  }
  return [...map.values()];
}

/** The slide ground most content sits on (greys count double against chromatic grounds). */
export function deckGround(uses: readonly DeckUse[]): string {
  const sitting = new Map<string, number>();
  for (const use of uses) {
    const on = use.prop === 'ground' ? use.value : use.on;
    sitting.set(on, (sitting.get(on) ?? 0) + use.count);
  }
  const grounds = [...new Set(uses.filter((u) => u.prop === 'ground').map((u) => u.value))];
  if (!grounds.length) return DEFAULT_GROUND;
  const weight = (v: string): number => (sitting.get(v) ?? 0) * (isChromatic(v) ? 0.5 : 1);
  return grounds.sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))[0]!;
}

/** Values by summed count, most first. */
function byCount(uses: readonly DeckUse[]): string[] {
  const sums = new Map<string, number>();
  for (const use of uses) sums.set(use.value, (sums.get(use.value) ?? 0) + use.count);
  return [...sums].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([v]) => v);
}







export function assignRoles(uses: readonly DeckUse[], ground: string, system?: AnalyzedSystem): Map<string, ColorRole> {
  const dark = isDark(ground);
  const theme = system?.themes.find((t) => t.dark === dark) ?? system?.themes[0];
  const systemAccent = roleColor(theme, 'accent');
  const roles = new Map<string, ColorRole>();
  const roleOfValue = new Map<string, ColorRole>();

  // Chromatic colours by weight (areas count triple: a filled accent is the accent).
  const weights = new Map<string, number>();
  for (const use of uses) if (isChromatic(use.value) && !isPaleTint(use.value)) weights.set(use.value, (weights.get(use.value) ?? 0) + use.count * (isArea(use.prop) ? 3 : 1));
  const chromatic = [...weights].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const mainAccent = chromatic.find((v) => v === systemAccent) ?? chromatic[0];
  const sameHue = (v: string, other: string | undefined): boolean => other !== undefined && hueDifference(v, other) < 24;
  const otherHues = chromatic.filter((v) => !sameHue(v, mainAccent) && !statusBand(v));
  const fewHues = new Set(otherHues.map((v) => Math.round(hue(v) / 30) % 12)).size <= 1;
  const isAccentHue = (v: string): boolean => sameHue(v, mainAccent) || (fewHues && otherHues.some((o) => v === o || sameHue(v, o)));

  const areaRole = (use: DeckUse): ColorRole => {
    const v = use.value;
    if (v === ground) return 'background';
    if (isChromatic(v)) {
      if (!isAccentHue(v)) return statusBand(v) ?? 'other';
      return contrast(v, ground) < 1.3 && chroma(v) < 0.09 ? 'accent-soft' : 'accent';
    }
    if (isDark(v) !== dark && contrast(v, ground) >= 4.5) return 'inverse';
    return use.prop === 'ground' || contrast(v, use.on) < 1.25 ? 'surface' : 'border';
  };
  const areas = uses.filter((u) => isArea(u.prop)).sort((a, b) => (a.prop === b.prop ? 0 : a.prop === 'ground' ? -1 : 1));
  for (const use of areas) {
    const role = areaRole(use);
    roles.set(use.key, role);
    if (!roleOfValue.has(use.value) || use.prop === 'ground') roleOfValue.set(use.value, role);
  }

  const groundRole = (use: DeckUse): ColorRole => roleOfValue.get(use.on) ?? (use.on === ground ? 'background' : 'surface');
  const neutralText = uses.filter((u) => u.prop === 'text' && !isChromatic(u.value));
  const mainText = (accept: (role: ColorRole) => boolean): string | undefined => {
    const candidates = neutralText.filter((u) => accept(groundRole(u)));
    return byCount(candidates.filter((u) => contrast(u.value, u.on) >= 7))[0] ?? byCount(candidates)[0];
  };
  const bodyText = mainText((r) => r !== 'accent' && r !== 'inverse' && r !== 'other' && !isStatus(r));
  const inverseText = mainText((r) => r === 'inverse');
  const readsLike = (use: DeckUse, reference: string | undefined): boolean => reference === undefined || contrast(use.value, use.on) >= 0.8 * contrast(reference, use.on);

  const inkRole = (use: DeckUse): ColorRole => {
    const v = use.value;
    const context = groundRole(use);
    if (use.prop === 'text' && contrast(v, use.on) < 1.5) return 'other';
    if (context === 'accent') return 'on-accent';
    if (context === 'other' || isStatus(context)) return 'other';
    if (isChromatic(v) && !isPaleTint(v)) {
      if (!isAccentHue(v)) return statusBand(v) ?? 'other';
      return context === 'inverse' ? 'inverse-accent' : 'accent';
    }
    if (context === 'inverse') return readsLike(use, inverseText) ? 'on-inverse' : 'on-inverse-muted';
    if (use.prop === 'line') return contrast(v, use.on) >= 7 ? 'text' : 'border';
    return readsLike(use, bodyText) ? 'text' : 'muted';
  };
  for (const use of uses) if (!isArea(use.prop)) roles.set(use.key, inkRole(use));
  return roles;
}

const isStatus = (role: ColorRole): boolean => role === 'success' || role === 'warning' || role === 'danger' || role === 'info';

/** The role of a slot id (`accent-2` → `accent`). */
export function slotRole(id: string): ColorRole {
  const base = id.replace(/-\d+$/, '') as ColorRole;
  return COLOR_ROLES.includes(base) ? base : 'other';
}

/** Groups role-tagged uses into slots, the busiest first within each role. */
export function buildSlots(uses: readonly DeckUse[], roles: Map<string, ColorRole>): { slots: PaletteSlot[]; assign: Map<string, string> } {
  const groups = new Map<string, DeckUse[]>();
  for (const use of uses) {
    const key = `${roles.get(use.key) ?? 'other'} ${use.value}`;
    groups.set(key, [...(groups.get(key) ?? []), use]);
  }
  const weight = (role: string, members: DeckUse[]): number => members.reduce((sum, u) => sum + u.count * (role === 'accent' && isArea(u.prop) ? 3 : 1), 0);
  const counters = new Map<string, number>();
  const assign = new Map<string, string>();
  const slots: PaletteSlot[] = [];
  const sorted = [...groups].sort((a, b) => {
    const ra = a[0].split(' ')[0]!;
    const rb = b[0].split(' ')[0]!;
    return weight(rb, b[1]) - weight(ra, a[1]) || (a[0] < b[0] ? -1 : 1);
  });
  for (const [key, members] of sorted) {
    const role = key.split(' ')[0] as ColorRole;
    const n = (counters.get(role) ?? 0) + 1;
    counters.set(role, n);
    const id = n === 1 ? role : `${role}-${n}`;
    slots.push({ id, role, value: members[0]!.value, count: members.reduce((s, u) => s + u.count, 0) });
    for (const use of members) assign.set(use.key, id);
  }
  // What each ink slot mostly sits on: the area slot of the same colour as its ground.
  const areaSlotOf = new Map<string, string>();
  for (const use of uses) if (isArea(use.prop) && !areaSlotOf.has(use.value)) areaSlotOf.set(use.value, assign.get(use.key)!);
  for (const slot of slots) {
    const tally = new Map<string, number>();
    for (const use of uses) {
      if (assign.get(use.key) !== slot.id || isArea(use.prop)) continue;
      const on = areaSlotOf.get(use.on);
      if (on) tally.set(on, (tally.get(on) ?? 0) + use.count);
    }
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (best) slot.on = best[0];
  }
  slots.sort((a, b) => COLOR_ROLES.indexOf(a.role) - COLOR_ROLES.indexOf(b.role) || a.id.length - b.id.length || (a.id < b.id ? -1 : 1));
  return { slots, assign };
}

/* -------------------------------------------------------------------------- */
/* Typefaces                                                                   */
/* -------------------------------------------------------------------------- */

/** True for a text node that reads as a heading (h1–h3, or a textbox opening with one). */
export function isHeadingNode(node: SlideNode): boolean {
  if (node.kind === 'text') return node.tag !== 'p' || parseFloat(node.style['font-size'] ?? '') >= 56;
  if (node.kind === 'textbox') return node.blocks[0]?.kind === 'text' && node.blocks[0].tag !== 'p';
  return false;
}

/** The first family of a `font-family` value, lower-cased ('' when none). */
export function familyKeyOf(value: string | undefined): string {
  return value ? (familyList(value)[0] ?? '').toLowerCase() : '';
}

/** Visits every text-bearing node of a slide with the family it renders in (first family, '' for the default). */
export function walkTextFamilies(slide: Slide, visit: (node: SlideNode, family: string, heading: boolean) => void): void {
  const walk = (nodes: readonly SlideNode[], inherited: string): void => {
    for (const node of nodes) {
      const own = node.style['font-family'];
      const family = own ? familyKeyOf(own) : inherited;
      if (node.kind === 'box') walk(node.children, family);
      else if (node.kind === 'text' || node.kind === 'textbox' || node.kind === 'list' || node.kind === 'table') visit(node, family, isHeadingNode(node));
    }
  };
  walk(slide.children, familyKeyOf(slide.style['font-family']));
}

/** The family most headings and most body text render in. */
export function deckFamilies(slides: readonly Slide[]): { heading: string; body: string } {
  const heading = new Map<string, number>();
  const body = new Map<string, number>();
  for (const slide of slides) {
    walkTextFamilies(slide, (_node, family, isHeading) => {
      const map = isHeading ? heading : body;
      map.set(family, (map.get(family) ?? 0) + 1);
    });
  }
  const top = (map: Map<string, number>): string | undefined => [...map].sort((a, b) => b[1] - a[1])[0]?.[0];
  const b = top(body) ?? top(heading) ?? '';
  return { heading: top(heading) ?? b, body: b };
}

/** Analyses a deck's colours and typefaces. */
export function analyzeDeck(slides: readonly Slide[], system?: AnalyzedSystem): DeckAnalysis {
  const uses = groupUses(slides.flatMap((slide) => slideColorUses(slide)));
  const ground = deckGround(uses);
  const distinct = new Set(uses.map((u) => u.value)).size;
  const { slots, assign } = distinct > MAX_RESTYLE_COLORS ? { slots: [], assign: new Map<string, string>() } : buildSlots(uses, assignRoles(uses, ground, system));
  return { ground, dark: isDark(ground), slots, assign, uses, distinct, over: distinct > MAX_RESTYLE_COLORS, ...deckFamilies(slides) };
}
