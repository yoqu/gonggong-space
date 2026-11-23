/**
 * Small content helpers the history and clipboard modules share.
 *
 * Internal: the public versions of these live in the editing and grouping
 * modules; these private copies keep history independent of them. The
 * `history.ts` barrel does not re-export this file.
 */

import { parseBoardContent, tryNormalizeElement } from '../normalize.ts';
import { arrowEndIds, arrowHeadFields, type ArrowElement, type ArrowHeadKind, type BoardContent, type BoardElement, type ElementId } from '../schema.ts';

/** True unless the element is an arrow with an attached end failing `test`. */
export function everyArrowEndId(element: BoardElement, test: (id: ElementId) => boolean): boolean {
  return element.type !== 'arrow' || arrowEndIds(element).every(test);
}

/** True when two group lists are the same (absent equals empty). */
export function sameGroupList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return String(a ?? '') === String(b ?? '');
}

/** The element with other groups (an empty list drops the field). */
export function withElementGroups<T extends BoardElement>(element: T, groups: readonly string[] | undefined): T {
  const { groups: _previous, ...rest } = element;
  const next = (groups !== undefined && groups.length > 0 ? { ...rest, groups: [...groups] } : rest) as T;
  return (tryNormalizeElement(next) as T | undefined) ?? next;
}

/** Applies group lists by element id; returns `content` itself when nothing changes. */
export function applyGroupChanges(content: BoardContent, groupsById: ReadonlyMap<ElementId, readonly string[]>): BoardContent {
  let changed = false;
  const elements = content.elements.map((element) => {
    const groups = groupsById.get(element.id);
    if (groups === undefined || sameGroupList(groups, element.groups)) return element;
    changed = true;
    return withElementGroups(element, groups);
  });
  return changed ? { ...content, elements } : content;
}

/** Puts back the groups each changed element had in `source` (edits never change groups). */
export function restoreGroupsFrom(content: BoardContent, source: BoardContent): BoardContent {
  if (content === source) return content;
  const byId = new Map(source.elements.map((element) => [element.id, element]));
  const groups = new Map<ElementId, readonly string[]>();
  for (const element of content.elements) {
    const old = byId.get(element.id);
    if (old !== undefined && old !== element) groups.set(element.id, old.groups ?? []);
  }
  return applyGroupChanges(content, groups);
}

/** Normalizes content, keeping the objects of elements normalization left unchanged. */
export function normalizeBoardContent(content: BoardContent): BoardContent {
  const normalized = parseBoardContent(content);
  if (JSON.stringify(normalized) === JSON.stringify(content)) return content;
  const previous = new Map(content.elements.map((element) => [element.id, element]));
  return {
    ...normalized,
    elements: normalized.elements.map((element) => {
      const old = previous.get(element.id);
      return old !== undefined && JSON.stringify(old) === JSON.stringify(element) ? old : element;
    }),
  };
}

/** Keeps each web embed's saved state from `previous` (undo never rewinds an embed's own state). */
export function keepEmbedStatesFrom(content: BoardContent, previous: BoardContent): BoardContent {
  if (content === previous || !content.elements.some((element) => element.type === 'html')) return content;
  const before = new Map(previous.elements.map((element) => [element.id, element]));
  let changed = false;
  const elements = content.elements.map((element): BoardElement => {
    const old = before.get(element.id);
    if (element.type !== 'html' || old?.type !== 'html' || old.state === element.state) return element;
    changed = true;
    const { state: _state, ...rest } = element;
    return old.state === undefined ? rest : { ...rest, state: old.state };
  });
  return changed ? { ...content, elements } : content;
}

/** The arrow with other end styles. */
export function setArrowHeads(arrow: ArrowElement, heads: readonly [ArrowHeadKind, ArrowHeadKind]): ArrowElement {
  const { head: _head, heads: _heads, ...rest } = arrow;
  const next: ArrowElement = { ...rest, ...arrowHeadFields(heads) };
  return (tryNormalizeElement(next) as ArrowElement | undefined) ?? next;
}
