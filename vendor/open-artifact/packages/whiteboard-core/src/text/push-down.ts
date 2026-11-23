/**
 * Push-down while typing: as an edit makes a free text taller, the items
 * right below it move down by the growth, so the text never runs over them.
 *
 * The plan is taken once, when the edit starts: unlocked items whose top is
 * at or below the text's bottom and that overlap it horizontally, in the
 * same section and the same group as the text (a section moves with its
 * content, a host with its stickers). A turned text pushes nothing.
 */

import { findStickerHost, stickersOnHosts } from '../attachments.ts';
import { elementBounds, elementLayoutBox, type Box, type ElementMeasures } from '../geometry.ts';
import { outermostGroupOf } from '../groups.ts';
import { elementSitsInBox, sectionsSmallestFirst } from '../layout.ts';
import { elementTurn, isElementLocked, type BoardElement, type ElementId } from '../schema.ts';
import { collectMoveIds } from '../selection.ts';

/** Who a growing text pushes down. */
export interface TextPushPlan {
  /** The growing text. */
  id: ElementId;
  /** The text's bottom when the edit started. */
  bottom: number;
  /** Everything that moves (contents of pushed sections and stickers on pushed hosts included). */
  ids: ReadonlySet<ElementId>;
  /** Boxes of the pushed sections (free arrow ends inside them move along). */
  frames: readonly Box[];
}

/** The smallest section an element sits in (not itself); `undefined` on the open board. */
function sectionHolding(element: BoardElement, sections: readonly BoardElement[], measures: ElementMeasures | undefined): ElementId | undefined {
  const box = elementLayoutBox(element, measures);
  if (box === undefined) return undefined;
  for (const section of sections) {
    if (section.id === element.id) continue;
    const frame = elementLayoutBox(section, measures);
    if (frame !== undefined && elementSitsInBox(frame, element, box)) return section.id;
  }
  return undefined;
}

/**
 * The push plan for the text `id` (see the module comment); `undefined`
 * when it is not an unturned text or nothing sits below it.
 */
export function planTextPush(elements: readonly BoardElement[], id: ElementId, measures?: ElementMeasures): TextPushPlan | undefined {
  const text = elements.find((element) => element.id === id);
  if (text?.type !== 'text' || elementTurn(text) !== 0) return undefined;
  const box = elementLayoutBox(text, measures);
  if (box === undefined) return undefined;
  const bottom = box.y + box.h;
  const sections = sectionsSmallestFirst(elements);
  const section = sectionHolding(text, sections, measures);
  const group = outermostGroupOf(elements, text.id);
  const pushed = new Set<ElementId>();
  for (const element of elements) {
    if (element.id === text.id || element.type === 'arrow' || isElementLocked(element)) continue;
    if (element.type === 'sticker' && findStickerHost(element, elements, measures) !== undefined) continue;
    const bounds = elementBounds(element, measures);
    if (bounds === undefined || bounds.y < bottom - 0.5) continue;
    if (bounds.x >= box.x + box.w || bounds.x + bounds.w <= box.x) continue;
    if (sectionHolding(element, sections, measures) !== section || outermostGroupOf(elements, element.id) !== group) continue;
    pushed.add(element.id);
  }
  if (pushed.size === 0) return undefined;
  const moving = collectMoveIds(elements, pushed, measures);
  for (const sticker of stickersOnHosts(moving, elements, measures)) moving.add(sticker);
  moving.delete(text.id);
  const frames = elements.flatMap((element) => (element.type === 'container' && pushed.has(element.id) ? (elementLayoutBox(element, measures) ?? []) : []));
  return { id: text.id, bottom, ids: moving, frames };
}

/** How far a plan's items are pushed while the text's box is `box`: its growth below the starting bottom, never negative. */
export function textPushGrowth(plan: Pick<TextPushPlan, 'bottom'>, box: Box | undefined): number {
  return box === undefined ? 0 : Math.max(0, Math.round(box.y + box.h - plan.bottom));
}
