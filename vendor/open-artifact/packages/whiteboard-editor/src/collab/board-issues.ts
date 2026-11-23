/**
 * Layout problems the page can measure in what a viewer sees, reported to
 * the agent in the view context (`issues`, worst first, and `issuesMore`):
 *
 * - `words_covered`: text that something drawn above it hides (sections,
 *   pen drawings, stickers and arrows never count as covering);
 * - `sticking_out`: an item that reaches past the edge of its section;
 * - `padding`: a section whose contents sit tight against an edge, or much
 *   closer to one edge than to the opposite one;
 * - `cut_off`: an embed whose HTML reached the size cap, so its end is lost.
 *
 * Grouped items, items someone is holding (moving or typing in) and items
 * under a pen drawing are never reported: those overlaps are on purpose.
 *
 * Pure: unit-tested without a DOM.
 */

import {
  elementBounds,
  isHtmlAtCharLimit,
  elementPlainText,
  type BoardElement,
  type Box,
  type ElementMeasures,
} from '@open-artifact/whiteboard-core';

/** One measured problem. */
export type BoardIssue =
  /** `by` covers `hidden` (0–1) of the text of `id`. */
  | { kind: 'words_covered'; id: string; by: string; hidden: number }
  /** `id` reaches `by` board units past the edge of section `section`. */
  | { kind: 'sticking_out'; id: string; section: string; by: number }
  /** The contents of section `id` are `gap` board units from its `side` edge. */
  | { kind: 'padding'; id: string; side: 'top' | 'right' | 'bottom' | 'left'; gap: number }
  /** Embed `id` was cut at the size cap. */
  | { kind: 'cut_off'; id: string };

/** What {@link findBoardIssues} returns. */
export interface BoardIssues {
  /** At most {@link MAX_REPORTED_ISSUES}, worst first. */
  issues: BoardIssue[];
  /** How many more were found. */
  more: number;
}

/** Most issues reported. */
export const MAX_REPORTED_ISSUES = 5;

/** Share of an item's text that must be hidden to report it. */
export const WORDS_COVERED_MIN = 0.1;

/** Share for tables and embeds, whose every cell or control matters. */
export const WORDS_COVERED_MIN_DENSE = 0.01;

/** How far past its section's edge an item must reach to be reported. */
export const STICKING_OUT_MIN = 12;

/** A gap this small between a section's contents and its edge is tight. */
export const PADDING_TIGHT = 8;

/** A gap this small is tight when the opposite gap is much larger. */
export const PADDING_UNEVEN = 12;

/** How much larger the opposite gap must be for {@link PADDING_UNEVEN} to apply. */
export const PADDING_UNEVEN_DIFFERENCE = 12;

/** Inputs of {@link findBoardIssues}. */
export interface BoardIssueInput {
  /** Every element, back to front. */
  elements: readonly BoardElement[];
  measures?: ElementMeasures;
  /** The board area the viewer sees; issues outside it are not reported. */
  view: Box;
  /** Items someone holds (moving, typing in). */
  held?: ReadonlySet<string>;
}

interface Scored {
  issue: BoardIssue;
  score: number;
}

function intersect(a: Box, b: Box): Box | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : undefined;
}

function area(box: Box): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

function contains(outer: Box, x: number, y: number): boolean {
  return x >= outer.x && x <= outer.x + outer.w && y >= outer.y && y <= outer.y + outer.h;
}

/** True for items whose words can be covered. */
function hasWords(element: BoardElement): boolean {
  if (element.type === 'table' || element.type === 'html') return true;
  if (element.type === 'container' || element.type === 'stroke' || element.type === 'sticker' || element.type === 'arrow' || element.type === 'image') return false;
  return elementPlainText(element).trim().length > 0;
}

/** True for items that can cover words drawn below them. */
function canCover(element: BoardElement): boolean {
  return element.type !== 'container' && element.type !== 'stroke' && element.type !== 'sticker' && element.type !== 'arrow';
}

/** True for items that belong to a group (their overlaps are intended). */
function grouped(element: BoardElement): boolean {
  return (element.groups?.length ?? 0) > 0;
}

/**
 * The share of `box` the boxes in `covers` hide together, measured on a
 * coarse grid so overlapping covers are not counted twice.
 */
export function coveredShare(box: Box, covers: readonly Box[], steps = 24): number {
  if (covers.length === 0 || area(box) === 0) return 0;
  let hidden = 0;
  for (let row = 0; row < steps; row += 1) {
    const y = box.y + ((row + 0.5) / steps) * box.h;
    for (let col = 0; col < steps; col += 1) {
      const x = box.x + ((col + 0.5) / steps) * box.w;
      if (covers.some((cover) => contains(cover, x, y))) hidden += 1;
    }
  }
  return hidden / (steps * steps);
}

/** The innermost section around an item's center (sections never sit in themselves). */
function sectionOf(element: BoardElement, box: Box, sections: ReadonlyArray<{ element: BoardElement; box: Box }>): { element: BoardElement; box: Box } | undefined {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let best: { element: BoardElement; box: Box } | undefined;
  for (const section of sections) {
    if (section.element.id === element.id || !contains(section.box, cx, cy)) continue;
    if (element.type === 'container' && area(section.box) <= area(box)) continue;
    if (best === undefined || area(section.box) < area(best.box)) best = section;
  }
  return best;
}

/** Measures the problems in what a viewer sees. */
export function findBoardIssues(input: BoardIssueInput): BoardIssues {
  const { elements, measures, view } = input;
  const held = input.held ?? new Set<string>();
  const found: Scored[] = [];
  const boxes = elements.map((element) => elementBounds(element, measures));
  const sections = elements.flatMap((element, index) => (element.type === 'container' && boxes[index] !== undefined ? [{ element, box: boxes[index]! }] : []));
  const strokes = elements.flatMap((element, index) => (element.type === 'stroke' && boxes[index] !== undefined ? [{ index, box: boxes[index]! }] : []));
  const membersBySection = new Map<string, Box[]>();

  elements.forEach((element, index) => {
    const box = boxes[index];
    if (box === undefined || intersect(box, view) === undefined) return;
    const exempt = held.has(element.id) || grouped(element);

    // An embed cut at the size cap.
    if (element.type === 'html' && isHtmlAtCharLimit(element)) found.push({ issue: { kind: 'cut_off', id: element.id }, score: Number.POSITIVE_INFINITY });

    // Words covered by something drawn later.
    const underSketch = strokes.some((stroke) => stroke.index > index && intersect(stroke.box, box) !== undefined);
    if (!exempt && !underSketch && hasWords(element)) {
      const covers: Array<{ id: string; box: Box }> = [];
      for (let above = index + 1; above < elements.length; above += 1) {
        const other = elements[above]!;
        const otherBox = boxes[above];
        if (otherBox === undefined || !canCover(other) || held.has(other.id)) continue;
        if (grouped(other) && other.groups!.some((group) => element.groups?.includes(group) === true)) continue;
        const overlap = intersect(box, otherBox);
        if (overlap !== undefined) covers.push({ id: other.id, box: overlap });
      }
      const hidden = coveredShare(
        box,
        covers.map((cover) => cover.box),
      );
      const min = element.type === 'table' || element.type === 'html' ? WORDS_COVERED_MIN_DENSE : WORDS_COVERED_MIN;
      if (hidden > min && covers.length > 0) {
        const worst = covers.reduce((best, cover) => (area(cover.box) > area(best.box) ? cover : best));
        found.push({ issue: { kind: 'words_covered', id: element.id, by: worst.id, hidden: Math.round(hidden * 100) / 100 }, score: 200 * hidden });
      }
    }

    // Past the edge of its section.
    if (element.type === 'arrow') return;
    const section = sectionOf(element, box, sections);
    if (section === undefined) return;
    const members = membersBySection.get(section.element.id) ?? [];
    members.push(box);
    membersBySection.set(section.element.id, members);
    if (exempt) return;
    const past = Math.max(section.box.x - box.x, box.x + box.w - (section.box.x + section.box.w), section.box.y - box.y, box.y + box.h - (section.box.y + section.box.h));
    if (past > STICKING_OUT_MIN) found.push({ issue: { kind: 'sticking_out', id: element.id, section: section.element.id, by: Math.round(past) }, score: past });
  });

  // Contents tight against a section's edge.
  for (const section of sections) {
    const members = membersBySection.get(section.element.id);
    if (members === undefined || members.length === 0 || intersect(section.box, view) === undefined) continue;
    const inside = members.filter((box) => box.x >= section.box.x && box.y >= section.box.y && box.x + box.w <= section.box.x + section.box.w && box.y + box.h <= section.box.y + section.box.h);
    if (inside.length === 0) continue;
    const left = Math.min(...inside.map((box) => box.x)) - section.box.x;
    const top = Math.min(...inside.map((box) => box.y)) - section.box.y;
    const right = section.box.x + section.box.w - Math.max(...inside.map((box) => box.x + box.w));
    const bottom = section.box.y + section.box.h - Math.max(...inside.map((box) => box.y + box.h));
    const gaps: Array<{ side: 'top' | 'right' | 'bottom' | 'left'; gap: number; opposite: number }> = [
      { side: 'left', gap: left, opposite: right },
      { side: 'right', gap: right, opposite: left },
      { side: 'top', gap: top, opposite: bottom },
      { side: 'bottom', gap: bottom, opposite: top },
    ];
    const tight = gaps
      .filter(({ gap, opposite }) => gap <= PADDING_TIGHT || (gap <= PADDING_UNEVEN && opposite - gap > PADDING_UNEVEN_DIFFERENCE))
      .sort((a, b) => a.gap - b.gap)[0];
    if (tight !== undefined) {
      found.push({ issue: { kind: 'padding', id: section.element.id, side: tight.side, gap: Math.max(0, Math.round(tight.gap)) }, score: PADDING_UNEVEN + 1 - Math.max(0, tight.gap) });
    }
  }

  found.sort((a, b) => b.score - a.score);
  return { issues: found.slice(0, MAX_REPORTED_ISSUES).map((entry) => entry.issue), more: Math.max(0, found.length - MAX_REPORTED_ISSUES) };
}
