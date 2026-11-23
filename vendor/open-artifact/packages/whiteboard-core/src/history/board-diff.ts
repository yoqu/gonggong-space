/**
 * Board diffs for undo: what one edit changed (elements before and after,
 * and their drawing order), and how to apply that change forward or back to
 * a board that others may have changed since.
 *
 * Applying merges by field groups: only the fields the step changed (and the
 * fields that go with them) are written, so undoing a move does not revert
 * someone else's text edit of the same note. Tables, SVG drawings and
 * multi-element steps are applied as whole values, except a step that only
 * moved or resized its elements.
 */

import { canonicalValuesEqual } from '../json.ts';
import { isSvgBase64DataUrl } from '../image-source.ts';
import { tryNormalizeElement } from '../normalize.ts';
import {
  MAX_BOARD_ELEMENTS,
  arrowHeads,
  elementTurn,
  isElementLocked,
  isRotatableElement,
  withElementTurn,
  type BoardContent,
  type BoardElement,
  type ElementId,
} from '../schema.ts';
import { mergeTableEdit } from '../table.ts';
import { everyArrowEndId, keepEmbedStatesFrom, normalizeBoardContent, sameGroupList, setArrowHeads, withElementGroups } from './content.ts';

/** One element's change: absent `before` means added, absent `after` removed. */
export interface ElementChange {
  before?: BoardElement;
  after?: BoardElement;
}

/** The drawing order around a step, and the ids whose place it changed. */
export interface OrderChange {
  before: ElementId[];
  after: ElementId[];
  ids: Set<ElementId>;
}

/** What one step changed. */
export interface BoardDiff {
  touched: Map<ElementId, ElementChange>;
  order?: OrderChange;
}

/** Which way a diff is applied. */
export type DiffDirection = 'forward' | 'back';

/** Fields that change together. */
export const FIELD_GROUPS = {
  place: ['x', 'y', 'tilt'],
  box: ['w', 'h'],
  paint: ['color', 'ink'],
  from: ['from', 'fromSide'],
  to: ['to', 'toSide'],
  heads: ['head', 'heads'],
} as const;

/** When one field of a group changed, every field of the group is written. */
export const LINKED_FIELD_GROUPS: readonly (readonly string[])[] = [
  ...Object.values(FIELD_GROUPS),
  ['text', 'words', 'author'],
  ['label', 'words'],
  ['color', 'hollow', 'stroke', 'ink'],
  ['size', 'wrap'],
  ['durationMs', 'endsAt', 'remainingMs'],
  ['from', 'fromSide', 'to', 'toSide', 'jog', 'bends'],
];

/** Elements applied whole (their fields do not merge meaningfully). */
export function isWholeValueElement(element: BoardElement): boolean {
  return element.type === 'table' || (element.type === 'image' && isSvgBase64DataUrl(element.src));
}

/** Fields a move or resize changes. */
export const GEOMETRY_FIELDS: ReadonlySet<string> = new Set([...FIELD_GROUPS.place, ...FIELD_GROUPS.box, 'turn']);

/** True when every element the step modified changed only {@link GEOMETRY_FIELDS}. */
export function diffChangesOnlyGeometry(diff: BoardDiff): boolean {
  for (const { before, after } of diff.touched.values()) {
    if (before === undefined || after === undefined) continue;
    const beforeFields = new Map(Object.entries(before));
    const afterFields = new Map(Object.entries(after));
    for (const key of new Set([...beforeFields.keys(), ...afterFields.keys()])) {
      if (!GEOMETRY_FIELDS.has(key) && !canonicalValuesEqual(beforeFields.get(key), afterFields.get(key))) return false;
    }
  }
  return true;
}

/** True when the step modified more than one existing element. */
export function diffChangesSeveral(diff: BoardDiff): boolean {
  let count = 0;
  for (const change of diff.touched.values()) if (change.before !== undefined && change.after !== undefined && ++count > 1) return true;
  return false;
}

/**
 * What changed between two contents. With a `scope`, only those ids count
 * (plus arrows that lost an end removed in scope). `null` when nothing did.
 */
export function diffBoardContents(before: BoardContent, after: BoardContent, scope?: Iterable<ElementId>): BoardDiff | null {
  const beforeById = new Map(before.elements.map((element) => [element.id, element]));
  const afterById = new Map(after.elements.map((element) => [element.id, element]));
  const scopeIds = scope === undefined ? undefined : new Set(scope);
  if (scopeIds !== undefined) {
    const removedInScope = (id: ElementId): boolean => scopeIds.has(id) && !afterById.has(id);
    for (const [id, element] of beforeById) {
      if (!afterById.has(id) && element.type === 'arrow' && !everyArrowEndId(element, (end) => !removedInScope(end))) scopeIds.add(id);
    }
  }
  const inScope = (id: ElementId): boolean => scopeIds === undefined || scopeIds.has(id);
  const touched = new Map<ElementId, ElementChange>();
  for (const [id, element] of beforeById) {
    if (!inScope(id)) continue;
    const next = afterById.get(id);
    if (next === undefined) touched.set(id, { before: element });
    else if (next !== element && JSON.stringify(next) !== JSON.stringify(element)) touched.set(id, { before: element, after: next });
  }
  for (const [id, element] of afterById) if (!beforeById.has(id) && inScope(id)) touched.set(id, { after: element });
  const beforeOrder = before.elements.map((element) => element.id).filter((id) => afterById.has(id));
  const afterOrder = after.elements.map((element) => element.id).filter((id) => beforeById.has(id));
  const orderIds = new Set<ElementId>();
  beforeOrder.forEach((id, index) => {
    if (afterOrder[index] !== id && inScope(id)) orderIds.add(id);
  });
  for (const [id, change] of touched) if (change.before === undefined || change.after === undefined) orderIds.add(id);
  if (touched.size === 0 && orderIds.size === 0) return null;
  return {
    touched,
    ...(orderIds.size > 0
      ? { order: { before: before.elements.map((element) => element.id), after: after.elements.map((element) => element.id), ids: orderIds } }
      : {}),
  };
}

/** Moves the `ids` back to where `order` had them, relative to their neighbours. */
export function restoreRecordedOrder(elements: readonly BoardElement[], order: readonly ElementId[], ids: ReadonlySet<ElementId>): BoardElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const kept = elements.filter((element) => !ids.has(element.id));
  order.forEach((id, index) => {
    const element = byId.get(id);
    if (!ids.has(id) || element === undefined) return;
    const positions = new Map(kept.map((item, at) => [item.id, at]));
    let insertAt = 0;
    for (let back = index - 1; back >= 0; back--) {
      const position = positions.get(order[back]!);
      if (position !== undefined) {
        insertAt = position + 1;
        break;
      }
    }
    kept.splice(insertAt, 0, element);
  });
  return kept;
}

/** Keeps a link or drawing style someone else set on an image when the step did not change it. */
export function rebaseImageHref(next: BoardElement, current: BoardElement, base: BoardElement | undefined): BoardElement {
  if (next.type !== 'image' || current.type !== 'image' || base?.type !== 'image') return next;
  let result = next;
  if (next.href === base.href && next.href !== current.href) {
    const { href: _href, ...rest } = result;
    result = current.href === undefined ? rest : { ...rest, href: current.href };
  }
  if (next.style === base.style && next.style !== current.style) {
    const { style: _style, ...rest } = result;
    result = current.style === undefined ? rest : { ...rest, style: current.style };
  }
  return result;
}

/** Keeps a rotation someone else set when the step did not rotate. */
export function rebaseTurn(next: BoardElement, current: BoardElement, base: BoardElement | undefined): BoardElement {
  if (!isRotatableElement(next) || base === undefined || elementTurn(next) !== elementTurn(base) || elementTurn(next) === elementTurn(current)) return next;
  return withElementTurn(next, elementTurn(current));
}

/** Keeps a lock someone else set when the step did not lock or unlock. */
export function rebaseLock(next: BoardElement, current: BoardElement, base: BoardElement | undefined): BoardElement {
  if (base === undefined || isElementLocked(next) !== isElementLocked(base) || isElementLocked(next) === isElementLocked(current)) return next;
  const { locked: _locked, ...rest } = next;
  const relocked = isElementLocked(current) ? { ...rest, locked: true as const } : rest;
  return tryNormalizeElement(relocked) ?? next;
}

/** Keeps a sticker's current host when the step moved the sticker. */
export function rebaseStickerHost(next: BoardElement, current: BoardElement, base: BoardElement): BoardElement {
  if (next.type !== 'sticker' || current.type !== 'sticker' || base.type !== 'sticker' || (next.x === base.x && next.y === base.y) || canonicalValuesEqual(next.on, current.on)) return next;
  const { on: _on, ...rest } = next;
  return tryNormalizeElement(current.on === undefined ? rest : { ...rest, on: current.on }) ?? next;
}

/** Keeps the groups the element has now (group changes are separate steps). */
export function rebaseGroups(next: BoardElement, current: BoardElement): BoardElement {
  return next === current || sameGroupList(next.groups, current.groups) ? next : withElementGroups(next, current.groups);
}

/**
 * `current` with the fields that changed from `from` to `to` (and their
 * linked groups) set as in `to`. Returns a plain record; normalize it.
 */
export function mergeChangedFields(current: object, from: object | undefined, to: object): Record<string, unknown> {
  const result = new Map(Object.entries(current));
  const fromFields = new Map(Object.entries(from ?? {}));
  const toFields = new Map(Object.entries(to));
  const changed = new Set([...fromFields.keys(), ...toFields.keys()].filter((key) => !canonicalValuesEqual(fromFields.get(key), toFields.get(key))));
  const keys = new Set([...changed, ...LINKED_FIELD_GROUPS.filter((group) => group.some((key) => changed.has(key))).flat()]);
  for (const key of keys) {
    const value = toFields.get(key);
    if (value === undefined) result.delete(key);
    else result.set(key, value);
  }
  return Object.fromEntries(result);
}

/** True when applying the diff keeps the board within {@link MAX_BOARD_ELEMENTS}. */
export function diffFitsBoardLimit(content: BoardContent, diff: BoardDiff, direction: DiffDirection): boolean {
  const ids = new Set(content.elements.map((element) => element.id));
  let count = ids.size;
  for (const [id, change] of diff.touched) {
    const target = direction === 'forward' ? change.after : change.before;
    if (target === undefined) {
      if (ids.delete(id)) count -= 1;
    } else if (!ids.has(id) && (change.before === undefined || change.after === undefined)) {
      if (count >= MAX_BOARD_ELEMENTS) return false;
      ids.add(id);
      count += 1;
    }
  }
  return true;
}

/**
 * Applies a diff forward (redo) or back (undo) to `content`, merging with
 * what changed since. `force` applies whole values. Returns `content` when
 * nothing changes. Arrows go last and are skipped while an end is missing.
 */
export function applyBoardDiff(content: BoardContent, diff: BoardDiff, direction: DiffDirection, force = false): BoardContent {
  let elements = [...content.elements];
  let changed = false;
  const endsPresent = (element: BoardElement): boolean => everyArrowEndId(element, (id) => elements.some((item) => item.id === id));
  const arrowRank = (change: ElementChange): number => Number(change.before?.type === 'arrow' && change.after?.type === 'arrow');
  const onlyLockChanged = [...diff.touched.values()].every((change) =>
    canonicalValuesEqual({ ...change.before, locked: undefined }, { ...change.after, locked: undefined }),
  );
  const wholeValues = force || (diffChangesSeveral(diff) && !onlyLockChanged && !diffChangesOnlyGeometry(diff));
  const entries = [...diff.touched].sort(([, a], [, b]) => arrowRank(a) - arrowRank(b));
  for (const [id, change] of entries) {
    const [target, source] = direction === 'forward' ? [change.after, change.before] : [change.before, change.after];
    const index = elements.findIndex((element) => element.id === id);
    const current = index >= 0 ? elements[index] : undefined;
    const merged = (base: object, wanted: BoardElement): BoardElement | undefined => {
      const element = tryNormalizeElement(mergeChangedFields(base, source, wanted));
      return element === undefined || !endsPresent(element) ? undefined : element;
    };
    const mergeInto = (base: BoardElement, wanted: BoardElement): BoardElement => {
      const result =
        wholeValues || isWholeValueElement(base) || isWholeValueElement(wanted) || source?.type !== wanted.type || base.type !== wanted.type
          ? wanted
          : (merged(base, wanted) ?? merged(mergeChangedFields(base, undefined, wanted), wanted) ?? wanted);
      return canonicalValuesEqual(result, wanted) ? wanted : result;
    };
    const next =
      target !== undefined && current !== undefined ? (canonicalValuesEqual(current, source) ? target : mergeInto(current, target)) : target;
    const rebased =
      target !== undefined && next !== undefined && current !== undefined
        ? rebaseStickerHost(
            rebaseTurn(rebaseImageHref(rebaseGroups(rebaseLock(mergeTableEdit(next, current, source), current, source), current), current, source), current, source),
            current,
            target,
          )
        : next;
    if (rebased === undefined) {
      if (current === undefined) continue;
      // Removing: remember what the element is now so the opposite step brings that back.
      const side = direction === 'forward' ? 'before' : 'after';
      const recorded = change[side];
      if (current.type === 'html' && recorded?.type === 'html' && recorded.state !== current.state) {
        const { state: _state, ...rest } = recorded;
        change[side] = current.state === undefined ? rest : { ...rest, state: current.state };
      }
      if (recorded?.type === 'table') change[side] = mergeTableEdit(recorded, current);
      elements.splice(index, 1);
      changed = true;
    } else if (current !== undefined) {
      if (!endsPresent(rebased)) continue;
      const sourceHadHeads = source?.type === 'arrow' && source.heads !== undefined;
      const withHeads =
        rebased.type === 'arrow' && rebased.heads === undefined && current.type === 'arrow' && current.heads !== undefined
          ? setArrowHeads(rebased, sourceHadHeads ? arrowHeads(rebased) : current.heads)
          : rebased;
      if (current !== withHeads) {
        elements[index] = withHeads;
        changed = true;
      }
    } else if (change.before === undefined || change.after === undefined) {
      if (elements.length >= MAX_BOARD_ELEMENTS) continue;
      elements.push(rebased);
      changed = true;
    }
  }
  if (diff.order !== undefined) {
    const ordered = restoreRecordedOrder(elements, direction === 'forward' ? diff.order.after : diff.order.before, diff.order.ids);
    if (ordered.some((element, index) => element !== elements[index])) {
      elements = ordered;
      changed = true;
    }
  }
  return changed ? normalizeBoardContent(keepEmbedStatesFrom({ ...content, elements }, content)) : content;
}
