/**
 * Reading order: the order in which a screen reader (or the agent's view of
 * the board) walks the elements. Sections nest their contents; items read in
 * rows (top to bottom, items within {@link READING_ROW_TOLERANCE} of a row's
 * top share it) and left to right within a row; an arrow reads right after
 * the subtree of the element it starts from.
 */

import { elementsWithinBox } from './attachments.ts';
import { arrowBoundsBox, elementLayoutBox, type Box, type ElementMeasures, type ElementsById } from './geometry.ts';
import { arrowDirectedEnds, arrowEndIds, type ArrowElement, type BoardElement, type ElementId } from './schema.ts';

/** Items whose tops are within this distance read as one row. */
export const READING_ROW_TOLERANCE = 90;

/** True unless the element is an arrow with an end attached to a missing element or to another arrow. */
export function isReadableArrow(element: BoardElement, byId: ElementsById): boolean {
  if (element.type !== 'arrow') return true;
  return arrowEndIds(element).every((id) => {
    const end = byId.get(id);
    return end !== undefined && end.type !== 'arrow';
  });
}

/** How many elements a reader announces (arrows with broken ends are skipped). */
export function countReadableElements(elements: readonly BoardElement[]): number {
  const byId = new Map(elements.map((element) => [element.id, element]));
  let count = 0;
  for (const element of elements) if (isReadableArrow(element, byId)) count += 1;
  return count;
}

/** The elements in reading order (see the module notes). */
export function orderElementsForReading(elements: readonly BoardElement[], measures?: ElementMeasures): BoardElement[] {
  const byId = new Map<ElementId, BoardElement>();
  const indexById = new Map<ElementId, number>();
  elements.forEach((element, index) => {
    byId.set(element.id, element);
    indexById.set(element.id, index);
  });
  const indexOf = (id: ElementId): number => indexById.get(id) ?? 0;
  const kept: BoardElement[] = [];
  const boxById = new Map<ElementId, Box>();
  for (const element of elements) {
    if (element.type === 'arrow' && (typeof arrowDirectedEnds(element).from === 'string' || !isReadableArrow(element, byId))) continue;
    const box = element.type === 'arrow' ? arrowBoundsBox(element, byId, measures) : elementLayoutBox(element, measures);
    if (!box) continue;
    kept.push(element);
    boxById.set(element.id, box);
  }
  const boxOf = (id: ElementId): Box => boxById.get(id)!;
  const areaOf = (id: ElementId): number => {
    const element = byId.get(id);
    return element !== undefined && 'w' in element && 'h' in element ? element.w * element.h : 0;
  };
  const parentOf = new Map<ElementId, ElementId>();
  for (const section of kept) {
    if (section.type !== 'container') continue;
    const area = boxOf(section.id);
    const freeArrows = kept.filter((element) => {
      if (element.type !== 'arrow') return false;
      const box = boxOf(element.id);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      return cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h;
    });
    for (const childId of [...elementsWithinBox(area, kept, measures, section.id), ...freeArrows.map((element) => element.id)]) {
      if (byId.get(childId)?.type === 'container') {
        const larger = areaOf(section.id) - areaOf(childId);
        if (larger < 0 || (larger === 0 && indexOf(section.id) > indexOf(childId))) continue;
      }
      const current = parentOf.get(childId);
      if (
        current === undefined ||
        areaOf(section.id) < areaOf(current) ||
        (areaOf(section.id) === areaOf(current) && indexOf(section.id) > indexOf(current))
      )
        parentOf.set(childId, section.id);
    }
  }
  const childrenOf = new Map<ElementId | null, BoardElement[]>();
  for (const element of kept) {
    const parent = parentOf.get(element.id) ?? null;
    let children = childrenOf.get(parent);
    if (!children) childrenOf.set(parent, (children = []));
    children.push(element);
  }
  const byRowThenColumn = (a: BoardElement, b: BoardElement): number => {
    const boxA = boxOf(a.id);
    const boxB = boxOf(b.id);
    return boxA.y - boxB.y || boxA.x - boxB.x || indexOf(a.id) - indexOf(b.id);
  };
  const byColumnThenRow = (a: BoardElement, b: BoardElement): number => {
    const boxA = boxOf(a.id);
    const boxB = boxOf(b.id);
    return boxA.x - boxB.x || boxA.y - boxB.y || indexOf(a.id) - indexOf(b.id);
  };
  const rowOrder = (group: readonly BoardElement[]): BoardElement[] => {
    const sorted = [...group].sort(byRowThenColumn);
    const out: BoardElement[] = [];
    let row: BoardElement[] = [];
    let rowTop = 0;
    for (const element of sorted) {
      const y = boxOf(element.id).y;
      if (row.length > 0 && y < rowTop + READING_ROW_TOLERANCE) row.push(element);
      else {
        out.push(...row.sort(byColumnThenRow));
        row = [element];
        rowTop = y;
      }
    }
    out.push(...row.sort(byColumnThenRow));
    return out;
  };
  const ordered: BoardElement[] = [];
  const visit = (parent: ElementId | null): void => {
    for (const element of rowOrder(childrenOf.get(parent) ?? [])) {
      ordered.push(element);
      if (element.type === 'container') visit(element.id);
    }
  };
  visit(null);
  const rankById = new Map<ElementId, number>();
  ordered.forEach((element, index) => rankById.set(element.id, index));
  const arrowsFrom = new Map<ElementId, ArrowElement[]>();
  for (const element of elements) {
    if (element.type !== 'arrow') continue;
    const from = arrowDirectedEnds(element).from;
    if (typeof from !== 'string' || !isReadableArrow(element, byId)) continue;
    let list = arrowsFrom.get(from);
    if (!list) arrowsFrom.set(from, (list = []));
    list.push(element);
  }
  const arrowTargetRank = (arrow: ArrowElement): number => {
    const to = arrowDirectedEnds(arrow).to;
    return typeof to === 'string' ? (rankById.get(to) ?? 0) : Number.MAX_SAFE_INTEGER;
  };
  for (const list of arrowsFrom.values()) list.sort((a, b) => arrowTargetRank(a) - arrowTargetRank(b) || indexOf(a.id) - indexOf(b.id));
  const lastIndexById = new Map<ElementId, number>();
  for (let index = ordered.length - 1; index >= 0; index--) {
    const element = ordered[index]!;
    const last = lastIndexById.get(element.id) ?? index;
    lastIndexById.set(element.id, last);
    const parent = parentOf.get(element.id);
    if (parent !== undefined) lastIndexById.set(parent, Math.max(lastIndexById.get(parent) ?? 0, last));
  }
  const arrowsAfter = new Map<number, ArrowElement[][]>();
  for (const [sourceId, arrows] of arrowsFrom) {
    const last = lastIndexById.get(sourceId);
    if (last === undefined) continue;
    let groups = arrowsAfter.get(last);
    if (!groups) arrowsAfter.set(last, (groups = []));
    groups.push(arrows);
  }
  const rankOfSource = (arrows: readonly ArrowElement[]): number => rankById.get(arrowDirectedEnds(arrows[0]!).from as ElementId) ?? 0;
  const result: BoardElement[] = [];
  ordered.forEach((element, index) => {
    result.push(element);
    const groups = arrowsAfter.get(index);
    if (!groups) return;
    groups.sort((a, b) => rankOfSource(b) - rankOfSource(a));
    for (const arrows of groups) result.push(...arrows);
  });
  return result;
}
