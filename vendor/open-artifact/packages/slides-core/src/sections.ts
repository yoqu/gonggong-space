/**
 * Outline sections: runs of slides with a one-sentence description.
 *
 * In `project/deck.json`, `sections` maps a key to `{description, start}`:
 * the run begins at slide `start` and lasts until the next section's start.
 * A section without slides has `before` instead (the slide it sits before,
 * null at the end) and an optional `seq` ordering empty sections at the same
 * place. Slides before the first section form the undescribed *opening run*.
 *
 * Every operation here is pure: it takes a {@link SectionedDeck} and returns
 * a new one, or undefined when the operation does not apply.
 */

import { LIMITS } from './limits.ts';
import type { DeckIndex, DeckSection } from './deck.ts';

/** A section with its key. */
export interface SectionEntry extends DeckSection {
  key: string;
}

/** The slice of a deck the section operations read and rewrite. */
export interface SectionedDeck {
  order: string[];
  sections: SectionEntry[];
}

/** One row of the outline: a section and its slides (or the opening run, `section` null). */
export interface SectionGroup {
  section: SectionEntry | null;
  ids: string[];
}

/** Makes keys for new sections. */
export type KeyMaker = () => string;

/** A random section key: `sec-` and 6 base-36 characters. */
export function newSectionKey(): string {
  return `sec-${Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/** Reads the deck index's sections as a list. */
export function sectionsOf(index: Pick<DeckIndex, 'sections'>): SectionEntry[] {
  return Object.entries(index.sections).map(([key, section]) => ({ key, ...section }));
}

/** Writes a section list back as the index map. */
export function sectionsMap(sections: readonly SectionEntry[]): Record<string, DeckSection> {
  const out: Record<string, DeckSection> = {};
  for (const { key, ...section } of sections) {
    const clean: DeckSection = { description: section.description };
    if (section.start !== undefined) clean.start = section.start;
    else {
      clean.before = section.before ?? null;
      if (section.seq !== undefined) clean.seq = section.seq;
    }
    out[key] = { ...section, ...clean };
    if (clean.start !== undefined) {
      delete out[key]!.before;
      delete out[key]!.seq;
    } else delete out[key]!.start;
  }
  return out;
}

/** The sectioned slice of an index (with order already resolved against files). */
export function sectionedDeck(index: Pick<DeckIndex, 'sections'>, order: string[]): SectionedDeck {
  return { order, sections: sectionsOf(index) };
}

const isEmpty = (section: DeckSection): boolean => section.start === undefined;
const hasDescription = (section: DeckSection): boolean => section.description !== '';

/** Normalizes a description: one line, trimmed, cut to the limit. */
export function normalizeDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, LIMITS.sectionDescription);
}

/** Sections with a `start` in `order`, one per start, in deck order. */
function anchoredInOrder(sections: readonly SectionEntry[], order: readonly string[]): SectionEntry[] {
  const at = new Map(order.map((id, i) => [id, i]));
  const seen = new Set<string>();
  return sections
    .filter((s) => s.start !== undefined && at.has(s.start) && !seen.has(s.start) && (seen.add(s.start), true))
    .sort((a, b) => at.get(a.start!)! - at.get(b.start!)!);
}

/** The outline rows in order: runs headed by sections (or the opening run) and empty sections. */
export function sectionGroups(sections: readonly SectionEntry[], order: readonly string[]): SectionGroup[] {
  const anchored = anchoredInOrder(sections, order);
  const byStart = new Map(anchored.map((s) => [s.start!, s]));
  const groups: SectionGroup[] = [];
  for (const id of order) {
    const section = byStart.get(id);
    if (section !== undefined || groups.length === 0) groups.push({ section: section ?? null, ids: [] });
    groups[groups.length - 1]!.ids.push(id);
  }
  if (groups[0] && groups[0].section === null && groups[0].ids.length === 0) groups.shift();
  // Place empty sections before the group holding their `before` slide.
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.ids.forEach((id) => groupOf.set(id, i)));
  const slot = (s: SectionEntry): number => (typeof s.before === 'string' && groupOf.has(s.before) ? groupOf.get(s.before)! : groups.length);
  const empties = new Map<number, SectionEntry[]>();
  for (const s of sections.filter(isEmpty)) empties.set(slot(s), [...(empties.get(slot(s)) ?? []), s]);
  const out: SectionGroup[] = [];
  for (let i = 0; i <= groups.length; i++) {
    const here = (empties.get(i) ?? []).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.key < b.key ? -1 : 1));
    for (const s of here) out.push({ section: s, ids: [] });
    if (i < groups.length) out.push(groups[i]!);
  }
  // An empty section right before the opening run heads it instead.
  const opening = out.findIndex((g) => g.section === null);
  if (opening > 0 && out[opening - 1]!.ids.length === 0) {
    out.splice(opening - 1, 2, { section: out[opening - 1]!.section, ids: out[opening]!.ids });
  }
  return out;
}

/**
 * Repairs sections after the order changed: duplicate starts turn into empty
 * sections (or go, when undescribed), and an empty section that now heads
 * slides starts at the first of them.
 */
export function reconcileSections(sections: readonly SectionEntry[], order: readonly string[]): SectionEntry[] {
  let list = [...sections];
  const starts = new Set<string>();
  if (list.some((s) => s.start !== undefined && (starts.has(s.start) || (starts.add(s.start), false)))) {
    const seen = new Set<string>();
    list = list.flatMap((s): SectionEntry[] => {
      if (s.start === undefined || !seen.has(s.start)) {
        if (s.start !== undefined) seen.add(s.start);
        return [s];
      }
      return hasDescription(s) ? [{ key: s.key, description: s.description, before: s.start, seq: s.seq ?? 0 }] : [];
    });
  }
  const heading = sectionGroups(list, order).find((g) => g.section !== null && isEmpty(g.section) && g.ids.length > 0);
  if (!heading) return list;
  const key = heading.section!.key;
  return list.map((s) => (s.key === key ? { key: s.key, description: s.description, start: heading.ids[0] } : s));
}

/** Re-sequences empty sections that ended up adjacent so they keep their old relative order. */
function preserveEmptyOrder(
  sections: SectionEntry[],
  previous: readonly SectionEntry[],
  previousOrder: readonly string[],
  order: readonly string[],
): SectionEntry[] {
  const previousIndex = new Map(
    sectionGroups(previous, previousOrder).flatMap((g, i): [string, number][] => (g.section ? [[g.section.key, i]] : [])),
  );
  const groups = sectionGroups(sections, order);
  let result = sections;
  for (let i = 0; i < groups.length; ) {
    let j = i;
    while (j < groups.length && groups[j]!.section !== null && groups[j]!.ids.length === 0 && isEmpty(groups[j]!.section!)) j++;
    const run = groups.slice(i, j).map((g) => g.section!);
    i = Math.max(j, i + 1);
    if (run.length < 2) continue;
    const sorted = [...run].sort((a, b) => (previousIndex.get(a.key) ?? Infinity) - (previousIndex.get(b.key) ?? Infinity));
    if (sorted.every((s, k) => s.key === run[k]!.key)) continue;
    const seqs = run.map((s) => s.seq ?? 0).sort((a, b) => a - b);
    for (let k = 1; k < seqs.length; k++) if (seqs[k]! <= seqs[k - 1]!) seqs[k] = seqs[k - 1]! + 1;
    const next = new Map(sorted.map((s, k) => [s.key, seqs[k]!]));
    result = result.map((s) => (next.has(s.key) ? { ...s, seq: next.get(s.key) } : s));
  }
  return result;
}

function same(a: readonly SectionEntry[], b: readonly SectionEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The first slide after group `index`, or null. */
function firstSlideAfter(groups: readonly SectionGroup[], index: number): string | null {
  for (let i = index + 1; i < groups.length; i++) if (groups[i]!.ids.length > 0) return groups[i]!.ids[0]!;
  return null;
}

/** Keys of the empty sections right before group `index`. */
function precedingEmpty(groups: readonly SectionGroup[], index: number): string[] {
  const keys: string[] = [];
  for (let i = index - 1; i >= 0 && groups[i]!.section !== null && groups[i]!.ids.length === 0; i--) keys.push(groups[i]!.section!.key);
  return keys;
}

/** Gives a run of adjacent empty sections fresh sequence numbers around `key`. */
function sequenceEmptyRun(sections: SectionEntry[], groups: readonly SectionGroup[], index: number, key: string): SectionEntry[] {
  const before = precedingEmpty(groups, index).reverse();
  const after: string[] = [];
  for (let i = index; i < groups.length && groups[i]!.section !== null && groups[i]!.ids.length === 0; i++) {
    if (groups[i]!.section!.key !== key) after.push(groups[i]!.section!.key);
  }
  if (before.length === 0 && after.length === 0) return sections;
  const base = Date.now();
  const seq = new Map([...before.filter((k) => k !== key), key, ...after].map((k, i) => [k, base + i]));
  return sections.map((s) => (seq.has(s.key) && isEmpty(s) ? { ...s, seq: seq.get(s.key) } : s));
}

/** Takes a slide out of the sections (its section moves to the next slide, or empties). */
export function removeSlideFromSections(sections: readonly SectionEntry[], order: readonly string[], id: string): SectionEntry[] {
  const at = order.indexOf(id);
  const next = at >= 0 ? order[at + 1] : undefined;
  const replacementBefore =
    sectionGroups(sections, order)
      .find((g) => g.ids.includes(id))
      ?.ids.filter((x) => x !== id)[0] ??
    next ??
    null;
  const reanchor = (s: SectionEntry): SectionEntry => (isEmpty(s) && s.before === id ? { ...s, before: replacementBefore } : s);
  const starting = sections.find((s) => s.start === id);
  if (!starting) return sections.some((s) => s.before === id) ? sections.map(reanchor) : [...sections];
  const starts = new Set(anchoredInOrder(sections, order).map((s) => s.start));
  const canExtend = next !== undefined && !starts.has(next);
  const result: SectionEntry[] = [];
  for (const s of sections) {
    if (s.start !== id) result.push(reanchor(s));
    else if (!(s === starting && canExtend) && !hasDescription(s)) continue;
    else {
      const { start: _start, ...rest } = s;
      result.push(s === starting && canExtend ? { ...rest, start: next } : { ...rest, before: next ?? null, seq: 0 });
    }
  }
  return preserveEmptyOrder(result, sections, order, order.filter((x) => x !== id));
}

/** Starts a new section at a slide. */
export function addSectionAtSlide(deck: SectionedDeck, slideId: string, description = '', key: string = newSectionKey()): SectionedDeck | undefined {
  const sections = reconcileSections(deck.sections, deck.order);
  if (
    !deck.order.includes(slideId) ||
    anchoredInOrder(sections, deck.order).some((s) => s.start === slideId) ||
    sections.some((s) => s.key === key) ||
    sections.length >= LIMITS.sections
  ) {
    return undefined;
  }
  return { ...deck, sections: [...sections, { key, description: normalizeDescription(description), start: slideId }] };
}

/** Adds an empty section before a slide (null: at the end). */
export function addEmptySectionBefore(deck: SectionedDeck, before: string | null, key: string = newSectionKey()): SectionedDeck | undefined {
  const sections = reconcileSections(deck.sections, deck.order);
  if (sections.some((s) => s.key === key) || sections.length >= LIMITS.sections) return undefined;
  const headsOpening =
    deck.order[0] !== undefined && before === deck.order[0] && !anchoredInOrder(sections, deck.order).some((s) => s.start === before);
  const section: SectionEntry = headsOpening
    ? { key, description: '', start: before! }
    : { key, description: '', before, seq: Date.now() };
  return { ...deck, sections: [...sections, section] };
}

/** Adds an empty section at outline gap `gap` (0 = before the first row). */
export function addSectionAtGap(deck: SectionedDeck, gap: number, key: string = newSectionKey()): SectionedDeck | undefined {
  const reconciled = { ...deck, sections: reconcileSections(deck.sections, deck.order) };
  const groups = sectionGroups(reconciled.sections, reconciled.order);
  if (gap < 0 || gap > groups.length) return undefined;
  const added = addEmptySectionBefore(reconciled, firstSlideAfter(groups, gap - 1), key);
  return added && { ...added, sections: sequenceEmptyRun(added.sections, groups, gap, key) };
}

/** Pulls slides out of the order and sections and puts them back before `before`. */
function detach(deck: SectionedDeck, sections: readonly SectionEntry[], ids: readonly string[], before: string | null): SectionedDeck {
  let list = [...sections];
  let order = deck.order;
  for (const id of ids) {
    list = removeSlideFromSections(list, order, id);
    order = order.filter((x) => x !== id);
  }
  const at = before === null ? order.length : order.indexOf(before);
  const index = at < 0 ? order.length : at;
  return { order: [...order.slice(0, index), ...ids, ...order.slice(index)], sections: list };
}

/** Moves slides into a new section placed at outline gap `gap`. */
export function moveSlidesIntoNewSection(
  deck: SectionedDeck,
  slideIds: readonly string[],
  gap: number,
  key: string = newSectionKey(),
  splitKey: string = newSectionKey(),
): SectionedDeck | undefined {
  const chosen = new Set(slideIds);
  const moving = deck.order.filter((id) => chosen.has(id));
  const sections = reconcileSections(deck.sections, deck.order);
  if (moving.length === 0 || moving.length !== chosen.size || sections.some((s) => s.key === key) || sections.length >= LIMITS.sections) {
    return undefined;
  }
  const groups = sectionGroups(sections, deck.order);
  if (gap < 0 || gap > groups.length) return undefined;
  let before = firstSlideAfter(groups, gap - 1);
  while (before !== null && chosen.has(before)) before = deck.order[deck.order.indexOf(before) + 1] ?? null;
  let base = sections;
  // Moving to the very top splits the opening run: what stays gets its own section.
  const split = gap === 0 && groups[0]?.section === null ? groups[0].ids.find((id) => !chosen.has(id)) : undefined;
  if (split !== undefined) {
    if (sections.length + 1 >= LIMITS.sections || sections.some((s) => s.key === splitKey)) return undefined;
    base = [...sections, { key: splitKey, description: '', start: split }];
  }
  const detached = detach(deck, base, moving, before);
  const preceding = new Set(precedingEmpty(groups, gap));
  const list = [
    ...detached.sections.map((s) => (preceding.has(s.key) ? { ...s, before: moving[0] } : s)),
    { key, description: '', start: moving[0] },
  ];
  return { order: detached.order, sections: reconcileSections(list, detached.order) };
}

/** Moves slides to position `index` within a section's run (null: the opening run). */
export function moveSlidesToSection(deck: SectionedDeck, slideIds: readonly string[], sectionKey: string | null, index: number): SectionedDeck | undefined {
  const chosen = new Set(slideIds);
  const moving = deck.order.filter((id) => chosen.has(id));
  if (moving.length === 0 || moving.length !== chosen.size) return undefined;
  const sections = reconcileSections(deck.sections, deck.order);
  const detached = detach(deck, sections, moving, null);
  const rest = detached.order.slice(0, detached.order.length - moving.length);
  let list = detached.sections;
  const target = sectionKey === null ? undefined : sections.find((s) => s.key === sectionKey);
  if (target && !list.some((s) => s.key === sectionKey)) {
    // The target emptied (all its slides were moved): keep it as an empty section in place.
    const groups = sectionGroups(sections, deck.order);
    let before = firstSlideAfter(groups, groups.findIndex((g) => g.section?.key === sectionKey));
    while (before !== null && chosen.has(before)) before = deck.order[deck.order.indexOf(before) + 1] ?? null;
    list = preserveEmptyOrder([...list, { key: target.key, description: target.description, before, seq: Date.now() }], sections, deck.order, rest);
  }
  const groups = sectionGroups(list, rest);
  const groupIndex = sectionKey === null ? groups.findIndex((g) => g.section === null) : groups.findIndex((g) => g.section?.key === sectionKey);
  if (groupIndex < 0 && sectionKey !== null) return undefined;
  const ids = groupIndex < 0 ? [] : groups[groupIndex]!.ids;
  const at = Math.max(0, Math.min(ids.length, index));
  const anchor = at < ids.length ? ids[at]! : groupIndex < 0 ? (rest[0] ?? null) : firstSlideAfter(groups, groupIndex);
  const insert = anchor === null ? rest.length : rest.indexOf(anchor);
  const order = [...rest.slice(0, insert), ...moving, ...rest.slice(insert)];
  if (sectionKey !== null && at === 0) {
    const preceding = new Set(ids.length === 0 ? precedingEmpty(groups, groupIndex) : []);
    list = list.map((s) =>
      s.key === sectionKey ? { key: s.key, description: s.description, start: moving[0] } : preceding.has(s.key) ? { ...s, before: moving[0] } : s,
    );
  }
  const next = { order, sections: reconcileSections(list, order) };
  if (order.join('\0') === deck.order.join('\0') && (same(deck.sections, next.sections) || layoutKey(deck) === layoutKey(next))) return undefined;
  return next;
}

/** A string that changes iff the outline (rows, descriptions, slides) changes. */
function layoutKey(deck: SectionedDeck): string {
  return sectionGroups(reconcileSections(deck.sections, deck.order), deck.order)
    .map((g) => `${g.section?.key ?? ''}:${g.section?.description ?? ''}:${g.ids.join(',')}`)
    .join('|');
}

/** Deletes a section (its slides join the run before it). */
export function deleteSection(deck: SectionedDeck, key: string): SectionedDeck | undefined {
  const sections = reconcileSections(deck.sections, deck.order);
  if (!sections.some((s) => s.key === key)) return undefined;
  return { ...deck, sections: reconcileSections(sections.filter((s) => s.key !== key), deck.order) };
}

/** Sets a section's description. */
export function describeSection(deck: SectionedDeck, key: string, description: string): SectionedDeck | undefined {
  const sections = reconcileSections(deck.sections, deck.order);
  const section = sections.find((s) => s.key === key);
  const text = normalizeDescription(description);
  if (!section || text === section.description) return undefined;
  return { ...deck, sections: sections.map((s) => (s.key === key ? { ...s, description: text } : s)) };
}

/** Moves a whole section (its run of slides) to outline gap `gap`. */
export function moveSectionToGap(deck: SectionedDeck, key: string, gap: number): SectionedDeck | undefined {
  let sections = reconcileSections(deck.sections, deck.order);
  const groups = sectionGroups(sections, deck.order);
  const from = groups.findIndex((g) => g.section?.key === key);
  if (from < 0 || gap < 0 || gap > groups.length || gap === from || gap === from + 1) return undefined;
  const ids = groups[from]!.ids;
  if (ids.length > 0 && gap === 0 && groups[0]!.section === null) {
    if (sections.length >= LIMITS.sections) return undefined;
    sections = [...sections, { key: newSectionKey(), description: '', start: groups[0]!.ids[0] }];
  }
  let before = firstSlideAfter(groups, gap - 1);
  while (before !== null && ids.includes(before)) {
    const current: string = before;
    before = firstSlideAfter(groups, groups.findIndex((g) => g.ids.includes(current)));
  }
  if (ids.length === 0) {
    const moved = sections.map((s) => (s.key !== key ? s : { ...s, before, seq: Date.now() }));
    const next = reconcileSections(sequenceEmptyRun(moved, groups, gap, key), deck.order);
    return same(sections, next) ? undefined : { ...deck, sections: next };
  }
  const rest = deck.order.filter((id) => !ids.includes(id));
  const at = before === null ? rest.length : rest.indexOf(before);
  const order = [...rest.slice(0, at), ...ids, ...rest.slice(at)];
  const preceding = new Set(precedingEmpty(groups, gap));
  const trailing = new Set<string>();
  for (let i = gap; i < groups.length && groups[i]!.section !== null && groups[i]!.ids.length === 0; i++) trailing.add(groups[i]!.section!.key);
  const movedIds = new Set(ids);
  const afterOld = firstSlideAfter(groups, from);
  const list = sections.map((s) =>
    preceding.has(s.key)
      ? { ...s, before: ids[0] }
      : trailing.has(s.key) && s.before === ids[0]
        ? { ...s, before }
        : isEmpty(s) && typeof s.before === 'string' && movedIds.has(s.before)
          ? { ...s, before: afterOld }
          : s,
  );
  const next = reconcileSections(list, order);
  if (order.join('\0') === deck.order.join('\0') && same(deck.sections, next)) return undefined;
  return { order, sections: next };
}

/**
 * Moves several sections (each with its run of slides) to outline gap `gap`,
 * keeping their order: the first lands at the gap, the others right after it.
 * Keys that are not sections are ignored.
 */
export function moveSectionsToGap(deck: SectionedDeck, keys: readonly string[], gap: number): SectionedDeck | undefined {
  const rows = sectionGroups(reconcileSections(deck.sections, deck.order), deck.order);
  const rowOf = (groups: readonly SectionGroup[], key: string): number => groups.findIndex((g) => g.section?.key === key);
  const moving = [...new Set(keys)].filter((key) => rowOf(rows, key) >= 0).sort((a, b) => rowOf(rows, a) - rowOf(rows, b));
  if (moving.length === 0) return undefined;
  // The gap counts rows as they are now: rows before it that move shift it back.
  let target = gap - moving.filter((key) => rowOf(rows, key) < gap).length;
  let current = deck;
  let changed = false;
  // Lift every moving section out first (to the end), then drop them in order.
  for (const key of moving) {
    const groups = sectionGroups(reconcileSections(current.sections, current.order), current.order);
    const next = moveSectionToGap(current, key, groups.length);
    if (next) {
      current = next;
      changed = true;
    }
  }
  for (const key of moving) {
    const groups = sectionGroups(reconcileSections(current.sections, current.order), current.order);
    const next = moveSectionToGap(current, key, Math.min(target, groups.length));
    if (next) {
      current = next;
      changed = true;
    }
    const after = sectionGroups(reconcileSections(current.sections, current.order), current.order);
    target = rowOf(after, key) + 1;
  }
  if (!changed) return undefined;
  return current.order.join('\0') === deck.order.join('\0') && JSON.stringify(current.sections) === JSON.stringify(deck.sections) ? undefined : current;
}

/** Where slides dropped at gap `gap` of the order land: a section and an index in its run. */
export function slideMoveDestination(deck: SectionedDeck, moved: readonly string[], gap: number): { sectionKey: string | null; index: number } {
  const set = new Set(moved);
  const unmoved = (id: string): boolean => !set.has(id);
  const before = deck.order.slice(0, Math.max(0, gap)).reverse().find(unmoved);
  const anchor = before ?? deck.order.find(unmoved);
  const group = anchor === undefined ? undefined : sectionGroups(reconcileSections(deck.sections, deck.order), deck.order).find((g) => g.ids.includes(anchor));
  if (!group) return { sectionKey: null, index: 0 };
  return { sectionKey: group.section?.key ?? null, index: before === undefined ? 0 : group.ids.filter(unmoved).indexOf(before) + 1 };
}

/** `order` with `moved` pulled out and put back together at `gap`. */
export function moveIdsToIndex(order: readonly string[], moved: readonly string[], gap: number): string[] {
  const set = new Set(moved);
  const rest = order.filter((id) => !set.has(id));
  const at = order.slice(0, Math.max(0, gap)).filter((id) => !set.has(id)).length;
  return [...rest.slice(0, at), ...order.filter((id) => set.has(id)), ...rest.slice(at)];
}

/** The key of the section a slide sits in (`-` for the opening run). */
export function sectionKeyOfSlide(groups: readonly SectionGroup[], slideId: string): string {
  return groups.find((g) => g.ids.includes(slideId))?.section?.key ?? '-';
}
