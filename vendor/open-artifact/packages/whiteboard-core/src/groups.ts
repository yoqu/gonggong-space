/**
 * Groups: elements list their group ids innermost first (`groups`), so
 * groups nest. Clicking an element selects its outermost group; clicking
 * again inside a selected group "enters" it and selects the next group in,
 * and so on. Moving anything moves its whole group, the elements inside a
 * moved section, and the stickers on moved hosts.
 *
 * A group is real only with two or more members and a member list unlike
 * any other group's. A locked element does not belong to a group that has
 * unlocked members (locking takes it out of the group).
 */

import { carriedArrowEnds, elementsWithinBox, stickersOnHosts, stickersOnStraddlingHosts } from './attachments.ts';
import { persistedElementByDerived, normalizeElementOrKeep } from './derived.ts';
import { elementBounds, elementLayoutBox, unionBounds, type Box, type ElementMeasures } from './geometry.ts';
import {
  MAX_ELEMENT_GROUPS,
  arrowEndIds,
  createElementId,
  isElementLocked,
  type ArrowElement,
  type BoardContent,
  type BoardElement,
  type ElementId,
  type ShapeElement,
} from './schema.ts';

/** The groups of a board: members of each group, and each element's groups innermost first. */
export interface GroupIndex {
  members: ReadonlyMap<string, ElementId[]>;
  chain: ReadonlyMap<ElementId, string[]>;
}

/** The index of a board without groups. */
export const EMPTY_GROUP_INDEX: GroupIndex = { members: new Map(), chain: new Map() };

const groupIndexCache = new WeakMap<readonly BoardElement[], GroupIndex>();

/** True when every element-id end of the arrow satisfies the predicate. */
export function everyArrowEndId(arrow: Pick<ArrowElement, 'from' | 'to'>, predicate: (id: ElementId) => boolean): boolean {
  return arrowEndIds(arrow).every(predicate);
}

/** The group index of a board (cached per elements array). */
export function groupIndexFor(elements: readonly BoardElement[]): GroupIndex {
  const cached = groupIndexCache.get(elements);
  if (cached !== undefined) return cached;
  const members = new Map<string, ElementId[]>();
  const groupsWithUnlocked = new Set(elements.flatMap((element) => (isElementLocked(element) ? [] : (element.groups ?? []))));
  const groupsOf = (element: BoardElement): string[] =>
    isElementLocked(element) ? (element.groups ?? []).filter((group) => !groupsWithUnlocked.has(group)) : (element.groups ?? []);
  for (const element of elements)
    for (const group of groupsOf(element)) {
      let list = members.get(group);
      if (list === undefined) members.set(group, (list = []));
      list.push(element.id);
    }
  const seen = new Set<string>();
  for (const [group, ids] of members)
    if (ids.length < 2 || seen.has(ids.join())) members.delete(group);
    else seen.add(ids.join());
  const memberCount = (group: string): number => members.get(group)?.length ?? 0;
  const index: GroupIndex =
    members.size === 0
      ? EMPTY_GROUP_INDEX
      : {
          members,
          chain: new Map(
            elements.flatMap((element): Array<[ElementId, string[]]> => {
              const groups = groupsOf(element).filter((group) => members.has(group));
              return groups.length > 0 ? [[element.id, groups.sort((a, b) => memberCount(a) - memberCount(b))]] : [];
            }),
          ),
        };
  groupIndexCache.set(elements, index);
  return index;
}

/** The outermost group of an element that is not entered. */
export function outermostGroupOutside(index: GroupIndex, id: ElementId, entered: ReadonlySet<string>): string | undefined {
  return index.chain.get(id)?.findLast((group) => !entered.has(group));
}

/** The outermost group of an element. */
export function outermostGroupOf(elements: readonly BoardElement[], id: ElementId): string | undefined {
  return groupIndexFor(elements).chain.get(id)?.at(-1);
}

/** How many groups the board has. */
export function groupCount(elements: readonly BoardElement[]): number {
  return groupIndexFor(elements).members.size;
}

/** The id of the pseudo element that stands for a group in a selection frame. */
export function groupCellId(group: string): string {
  return '/' + group;
}

/** True when two group lists are the same. */
export function sameGroupList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return (a ?? []).join() === (b ?? []).join();
}

/** Messages shown when grouping or ungrouping is refused. */
export const GROUPING_REFUSALS = {
  few: 'Select two or more items to group.',
  already: 'These are already one group.',
  deep: 'Groups can be nested at most ' + String(MAX_ELEMENT_GROUPS) + ' deep. Ungroup one first.',
  nothing: 'Nothing to ungroup. Select a group.',
} as const;

/** The groups a selection is inside: groups some, but not all, of whose members are selected. */
export function enteredGroups(index: GroupIndex, ids: Iterable<ElementId>): Set<string> {
  const counts = new Map<string, number>();
  for (const id of ids) for (const group of index.chain.get(id) ?? []) counts.set(group, (counts.get(group) ?? 0) + 1);
  return new Set([...counts].flatMap(([group, count]) => (count < (index.members.get(group)?.length ?? 0) ? [group] : [])));
}

/** The ids with every member of their outermost groups outside `entered` added (the same set when nothing is added). */
export function expandToGroups(index: GroupIndex, ids: ReadonlySet<ElementId>, entered: ReadonlySet<string>): ReadonlySet<ElementId> {
  if (index === EMPTY_GROUP_INDEX) return ids;
  const expanded = new Set(ids);
  const visited = new Set<string>();
  for (const id of expanded) {
    const group = outermostGroupOutside(index, id, entered);
    if (group === undefined || visited.has(group)) continue;
    visited.add(group);
    for (const member of index.members.get(group) ?? []) expanded.add(member);
  }
  return expanded.size === ids.size ? ids : expanded;
}

/** A selection grown to whole groups, staying inside the groups `insideIds` entered. */
export function expandSelectionToGroups(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>, insideIds: Iterable<ElementId> = []): ReadonlySet<ElementId> {
  const index = groupIndexFor(elements);
  return expandToGroups(index, ids, enteredGroups(index, insideIds));
}

/**
 * What clicking an element selects, given the current selection: its
 * outermost group not yet entered (which is then entered), or the element.
 */
export function groupSelectionFor(elements: readonly BoardElement[], id: ElementId, insideIds: Iterable<ElementId>): ReadonlySet<ElementId> {
  const index = groupIndexFor(elements);
  const entered = enteredGroups(index, insideIds);
  const group = outermostGroupOutside(index, id, entered);
  return group === undefined ? new Set([id]) : expandToGroups(index, new Set([id]), entered.add(group));
}

/** The selection after leaving the innermost entered group of an element (`undefined` when none is entered). */
export function exitInnermostGroup(elements: readonly BoardElement[], id: ElementId, insideIds: Iterable<ElementId>): ReadonlySet<ElementId> | undefined {
  const index = groupIndexFor(elements);
  const entered = enteredGroups(index, insideIds);
  const group = index.chain.get(id)?.find((candidate) => entered.has(candidate));
  return group === undefined || !entered.delete(group) ? undefined : expandToGroups(index, new Set([id]), entered);
}

/** One cell of a selection: a group (by its outermost group outside the entered ones) or a single element. */
export interface SelectionGroupCell {
  group?: string;
  ids: ElementId[];
}

/** The selection split into groups and loose elements. */
export function selectionGroupCells(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): SelectionGroupCell[] {
  const index = groupIndexFor(elements);
  const entered = enteredGroups(index, ids);
  const cells = new Map<string, SelectionGroupCell>();
  for (const element of elements) {
    if (!ids.has(element.id)) continue;
    const group = outermostGroupOutside(index, element.id, entered);
    const key = group !== undefined ? groupCellId(group) : element.id;
    const cell = cells.get(key) ?? { ...(group !== undefined ? { group } : {}), ids: [] };
    cell.ids.push(element.id);
    cells.set(key, cell);
  }
  return [...cells.values()];
}

/** What {@link collectMovingSet} found. */
export interface MovingSet {
  /** Everything that moves. */
  ids: Set<ElementId>;
  /** The areas of the sections that move (with their ids). */
  frames: Array<Box & { id: ElementId }>;
  /** Elements that move because a section or group holds them. */
  held: Set<ElementId>;
  /** Stickers that move with their hosts. */
  riders: Set<ElementId>;
}

/** Options of {@link collectMovingSet}. */
export interface MovingSetOptions {
  /** Whether an element may join (with the section that holds it). */
  among?: (id: ElementId, sectionId?: ElementId) => boolean;
  /** Whether a free arrow end inside a moving section moves. */
  ends?: (arrowId: ElementId, end: 'from' | 'to', box: Box) => boolean;
  /** Stickers ride on moving hosts (default true). */
  stickers?: boolean;
  /** Whole groups move (default true). */
  groups?: boolean;
  /** Sticker host cache (sticker id → host id). */
  hosts?: Map<ElementId, ElementId | undefined>;
  /** The selection that decides which groups are entered (default `ids`). */
  within?: Iterable<ElementId>;
}

/**
 * Everything that moves when `ids` move: the content of moving sections,
 * stickers on moving hosts, grouped arrows whose ends all move, and the
 * rest of each moving element's group, repeated until nothing joins.
 */
export function collectMovingSet(
  elements: readonly BoardElement[],
  ids: ReadonlySet<ElementId>,
  measures?: ElementMeasures,
  { among = () => true, ends, stickers = true, groups = true, hosts = new Map(), within = ids }: MovingSetOptions = {},
): MovingSet {
  const index = groups ? groupIndexFor(elements) : EMPTY_GROUP_INDEX;
  const entered = enteredGroups(index, within);
  const moving = new Set(ids);
  const pendingSections = new Set(ids);
  const held = new Set<ElementId>();
  const riders = new Set<ElementId>();
  const frames: Array<Box & { id: ElementId }> = [];
  for (;;) {
    for (const element of elements) {
      if (element.type !== 'container' || !pendingSections.delete(element.id)) continue;
      const area = elementLayoutBox(element, measures)!;
      frames.push({ ...area, id: element.id });
      const inside = elementsWithinBox(area, elements, measures, element.id);
      const staying = stickersOnStraddlingHosts(area, inside, elements, measures, hosts);
      for (const id of inside)
        if (among(id, element.id) && !staying.includes(id)) {
          moving.add(id);
          held.add(id);
        }
    }
    for (const id of stickers ? stickersOnHosts(moving, elements, measures, hosts) : [])
      if (among(id)) {
        moving.add(id);
        riders.add(id);
      }
    const arrowPool = index === EMPTY_GROUP_INDEX ? [] : elements;
    const freeArrows = carriedArrowEnds(arrowPool, new Set(), frames, ends);
    for (const element of arrowPool) {
      if (element.type !== 'arrow' || !index.chain.has(element.id) || moving.has(element.id) || !among(element.id)) continue;
      const anchors: ReadonlySet<ElementId> | undefined =
        arrowEndIds(element).length === 2
          ? held
          : freeArrows.has(element.id)
            ? new Set([...moving, ...expandToGroups(index, new Set([element.id]), entered)])
            : undefined;
      if (anchors !== undefined && everyArrowEndId(element, (id) => anchors.has(id))) {
        moving.add(element.id);
        held.add(element.id);
      }
    }
    const sizeBefore = moving.size;
    for (const id of expandToGroups(index, moving, entered))
      if (among(id) && !moving.has(id)) {
        moving.add(id);
        held.add(id);
        pendingSections.add(id);
      }
    if (moving.size === sizeBefore) return { ids: moving, frames, held, riders };
  }
}

/** A selection frame cell: an element, or a pseudo shape standing for a whole group. */
export type GroupBoundsCell = BoardElement | (ShapeElement & { id: string });

/**
 * The cells a selection frame draws for the picked elements: loose
 * elements, and one rectangle per group (id from {@link groupCellId}) with
 * what moving that group moves. A group already carried by another group's
 * move is left out.
 */
export function groupBoundsCells(
  picked: readonly BoardElement[],
  elements: readonly BoardElement[],
  measures?: ElementMeasures,
): { cells: GroupBoundsCell[]; moves: Map<string, MovingSet | undefined> } {
  const byId = new Map(picked.map((element) => [element.id, element]));
  const cells = selectionGroupCells(elements, new Set(byId.keys()));
  const moving = cells.map((cell) => (cell.group === undefined ? undefined : collectMovingSet(elements, new Set(cell.ids), measures)));
  const overlaps = (mover: number, cell: number): boolean => cells[cell]?.ids.some((id) => moving[mover]?.ids.has(id)) === true;
  const groupedIndexes = moving.flatMap((set, index) => (set !== undefined ? [index] : []));
  const moves = new Map<string, MovingSet | undefined>();
  return {
    cells: cells.flatMap((cell, index): GroupBoundsCell[] => {
      if (groupedIndexes.some((other) => other !== index && overlaps(other, index) && !(other > index && overlaps(index, other)))) return [];
      const members = cell.ids.flatMap((id) => byId.get(id) ?? []);
      const bounds = cell.group === undefined ? undefined : unionBounds(members.flatMap((element) => elementBounds(element, measures) ?? []));
      if (cell.group === undefined || bounds === undefined) return cell.group === undefined ? members : [];
      moves.set(groupCellId(cell.group), moving[index]);
      return [{ type: 'shape', id: groupCellId(cell.group), kind: 'rect', ...bounds, color: 'white', text: '' }];
    }),
    moves,
  };
}

/** A refusal to group or ungroup, with the message to show. */
export interface GroupingRefusal {
  refused: string;
}

/**
 * The new group lists that group the selection: every cell joins one new
 * group, inside the groups the selection shares and is inside of. Refused
 * for fewer than two cells or nesting past {@link MAX_ELEMENT_GROUPS}.
 */
export function planGroupSelection(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): Map<ElementId, string[]> | GroupingRefusal {
  const cells = selectionGroupCells(elements, ids);
  if (cells.length < 2) return { refused: cells[0]?.group !== undefined ? GROUPING_REFUSALS.already : GROUPING_REFUSALS.few };
  const index = groupIndexFor(elements);
  const entered = enteredGroups(index, ids);
  const memberIds = cells.flatMap((cell) => cell.ids);
  const isShared = (group: string): boolean => entered.has(group) && memberIds.every((id) => index.chain.get(id)?.includes(group));
  const groupId = createElementId();
  const chains = new Map(
    memberIds.map((id): [ElementId, string[]] => {
      const chain = index.chain.get(id) ?? [];
      return [id, [...chain.filter((group) => !entered.has(group)), groupId, ...chain.filter(isShared)]];
    }),
  );
  return [...chains.values()].some((chain) => chain.length > MAX_ELEMENT_GROUPS) ? { refused: GROUPING_REFUSALS.deep } : chains;
}

/** The new group lists that ungroup the selection's outermost groups (refused when there is none). */
export function planUngroupSelection(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): Map<ElementId, string[]> | GroupingRefusal {
  const index = groupIndexFor(elements);
  const groups = new Set(selectionGroupCells(elements, ids).flatMap((cell) => (cell.group !== undefined ? [cell.group] : [])));
  if (groups.size === 0) return { refused: GROUPING_REFUSALS.nothing };
  return new Map(
    [...groups]
      .flatMap((group) => index.members.get(group) ?? [])
      .map((id): [ElementId, string[]] => [id, (index.chain.get(id) ?? []).filter((group) => !groups.has(group))]),
  );
}

/** The element with a new group list (none when empty); a derived element keeps its stored twin in step. */
export function withElementGroups<T extends BoardElement>(element: T, groups: readonly string[] | undefined): T {
  const patch = groups !== undefined && groups.length > 0 ? { groups: [...groups] } : {};
  const { groups: _previous, ...rest } = element;
  const next = normalizeElementOrKeep({ ...rest, ...patch } as T);
  const stored = persistedElementByDerived.get(element);
  if (stored !== undefined) {
    const { groups: _storedGroups, ...storedRest } = stored;
    persistedElementByDerived.set(next, { ...storedRest, ...patch } as BoardElement);
  }
  return next;
}

/** Applies new group lists (by element id); the same content when nothing changes. */
export function applyGroupChanges<T extends BoardContent>(content: T, groupsById: ReadonlyMap<ElementId, readonly string[]>): T {
  let changed = false;
  const elements = content.elements.map((element) => {
    const groups = groupsById.get(element.id);
    if (groups === undefined || sameGroupList(groups, element.groups)) return element;
    changed = true;
    return withElementGroups(element, groups);
  });
  return changed ? { ...content, elements } : content;
}

/** Copies the group lists of `source`'s elements onto the same elements of `content`. */
export function restoreGroupsFrom<T extends BoardContent>(content: T, source: BoardContent): T {
  if (content === source) return content;
  const byId = new Map(source.elements.map((element) => [element.id, element]));
  return applyGroupChanges(
    content,
    new Map(
      content.elements.flatMap((element): Array<[ElementId, string[]]> => {
        const original = byId.get(element.id);
        return original === undefined || original === element ? [] : [[element.id, original.groups ?? []]];
      }),
    ),
  );
}

/** What happens to a group when its members are copied. */
export type CopiedGroupFate = 'new' | 'same' | undefined;

/**
 * Rewrites copied elements' groups: groups the copy holds wholly become new
 * groups (`'new'`), groups only partly copied stay (`'same'`), others are
 * dropped.
 */
export function remapCopiedGroups(elements: readonly BoardElement[], fateOf: (group: string) => CopiedGroupFate): BoardElement[] {
  const renamed = new Map<string, string>();
  const renameGroup = (group: string): string => {
    let next = renamed.get(group);
    if (next === undefined) renamed.set(group, (next = createElementId()));
    return next;
  };
  const members = groupIndexFor(elements).members;
  return elements.map((element) =>
    element.groups === undefined
      ? element
      : withElementGroups(
          element,
          element.groups.flatMap((group) => {
            const fate = fateOf(group);
            return fate === 'same' ? [group] : fate === 'new' && members.has(group) ? [renameGroup(group)] : [];
          }),
        ),
  );
}

/**
 * The fate of each group when `copiedIds` are copied: `'new'` when every
 * member is copied (arrows not attached at both ends to copied elements do
 * not count), `'same'` when some are, `undefined` for unknown groups.
 */
export function copiedGroupFate(elements: readonly BoardElement[], copiedIds: ReadonlySet<ElementId>): (group: string) => CopiedGroupFate {
  const index = groupIndexFor(elements);
  const looseArrows = new Set(
    index === EMPTY_GROUP_INDEX
      ? []
      : elements.flatMap((element) => (element.type === 'arrow' && !everyArrowEndId(element, (id) => copiedIds.has(id)) ? [element.id] : [])),
  );
  return (group) => {
    const members = index.members.get(group);
    if (members === undefined) return undefined;
    return members.every((id) => copiedIds.has(id) || looseArrows.has(id)) ? 'new' : 'same';
  };
}

/** Copied elements keep only the groups that were copied whole. */
export function pruneCopiedGroups(copied: readonly BoardElement[], elements: readonly BoardElement[]): BoardElement[] {
  const fateOf = copiedGroupFate(elements, new Set(copied.map((element) => element.id)));
  return copied.map((element) =>
    element.groups === undefined || element.groups.every((group) => fateOf(group) === 'new')
      ? element
      : withElementGroups(
          element,
          element.groups.filter((group) => fateOf(group) === 'new'),
        ),
  );
}
