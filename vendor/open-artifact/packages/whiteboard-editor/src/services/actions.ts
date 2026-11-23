/**
 * Board commands on the selection: delete, duplicate, group and ungroup,
 * lock, layer order, align and tidy, nudge and turn, select all, and the
 * style changes of the selection bar (colors, text size and alignment,
 * shape kind and outline, arrow ends and dashes, image links, table rows
 * and columns).
 *
 * Every command checks that the viewer may edit, refuses with a spoken
 * reason (and a toast) when it cannot run, and announces what it did.
 * Edits go through {@link editContent}, which also keeps stickers on their
 * hosts.
 */

import {
  ARROW_HEAD_KINDS,
  DUPLICATE_OFFSET,
  GROUPING_REFUSALS,
  MAX_BOARD_ELEMENTS,
  TABLE_LIMITS,
  alignSelection,
  applyGroupChanges,
  arrowHeadFields,
  arrowHeads,
  arrowNeedsEndsMessage,
  captureRotationStart,
  collectMoveIdsWithAttached,
  collectMovingSet,
  duplicateSelection,
  elementLayoutBox,
  elementTurn,
  everyArrowEndId,
  exceedsTableCellLimit,
  gridArrangeRects,
  groupBoundsCells,
  isElementLocked,
  moveElementsWithScope,
  normalizeHttpUrl,
  planGroupSelection,
  planUngroupSelection,
  rebindStickersToHosts,
  removeElements,
  reorderElements,
  rotatableSelection,
  rotateElements,
  stepElementOrder,
  stickersOnHosts,
  tableColumnIds,
  tableRowIds,
  tidyUpSelection,
  topLevelSelectedIds,
  withoutLockedIds,
  type AlignEdge,
  type ArrowHeadKind,
  type BoardContent,
  type BoardElement,
  type EditAuthor,
  type ElementId,
  type FillColor,
  type GroupingRefusal,
  type InkColor,
  type TableElement,
  type TextAlign,
  type TextSize,
} from '@open-artifact/whiteboard-core';
import type { LayerMove } from '../lib/tools.ts';
import { blockKindOf, isKindChangeable, setKindForElements, setShapeFillMode, type BlockKind } from '../selection/kind-change.ts';
import { changeBoard, useBoard, type ChangeOptions } from '../state/board.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import {
  ALIGN_ACTION_LABELS,
  ALREADY_ALIGNED_MESSAGE,
  ARRANGE_MESSAGES,
  BOARD_FULL_MESSAGE,
  EMPTY_BOARD_MESSAGE,
  GROUPING_MESSAGES,
  LINK_EDIT_MESSAGES,
  LOCKED_MESSAGE,
  LOCK_MESSAGES,
  NOTHING_SELECTED_MESSAGE,
  READ_ONLY_MESSAGE,
  announce,
  cannotTurnMessage,
  colorUpdatedMessage,
  deletedMessage,
  duplicatedMessage,
  movedMessage,
  refuse,
  selectionCountMessage,
  shapeKindMessage,
  textAlignedMessage,
  textSizeMessage,
  turnedMessage,
  type ColorTarget,
} from './announce.ts';
import { maybeSession } from './session.ts';
import { flushTableCell, tableEditor } from './table-edits.ts';

/* ------------------------------------------------------------------------ */
/* Who, what and whether                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Whether the viewer may change the board. Without a session (tests, a
 * local preview) the board is editable; the session's role decides
 * otherwise.
 */
export function canEditBoard(): boolean {
  return maybeSession()?.canEdit ?? true;
}

/** The viewer as the author of new things (either part may be unknown). */
export function viewerAuthor(): EditAuthor {
  const viewer = maybeSession()?.viewer;
  return { id: viewer?.id ?? null, name: viewer?.name ?? null };
}

/** Refuses with the read-only reason unless the viewer may edit. */
export function ensureEditable(): boolean {
  return canEditBoard() || refuse(READ_ONLY_MESSAGE);
}

/** The board's elements, back to front. */
export function boardElements(): readonly BoardElement[] {
  return useBoard.getState().board.content.elements;
}

/** The selected ids that still exist. */
export function selectedIds(): Set<ElementId> {
  const byId = useBoard.getState().byId;
  return new Set(useSelection.getState().ids.filter((id) => byId.has(id)));
}

/** The selected elements, in drawing order. */
export function selectedElements(): BoardElement[] {
  const ids = selectedIds();
  return boardElements().filter((element) => ids.has(element.id));
}

/* ------------------------------------------------------------------------ */
/* Editing                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Changes the board's content. Stickers whose host moved or changed size
 * follow it, and every moved sticker records the host it now sits on.
 */
export function editContent(recipe: (content: BoardContent) => BoardContent, options?: ChangeOptions): boolean {
  return changeBoard((board) => {
    const next = recipe(board.content);
    if (next === board.content) return board;
    const elements = rebindStickersToHosts(board.content.elements, next.elements, currentMeasures());
    return { ...board, content: elements === next.elements ? next : { ...next, elements: [...elements] } };
  }, options);
}

/** Changes the board's elements (see {@link editContent}). */
export function editElements(recipe: (elements: readonly BoardElement[]) => readonly BoardElement[], options?: ChangeOptions): boolean {
  return editContent((content) => {
    const elements = recipe(content.elements);
    return elements === content.elements ? content : { ...content, elements: [...elements] };
  }, options);
}

/** Replaces some elements by id (`patch` returns the same element to skip one). */
export function patchElements(ids: Iterable<ElementId>, patch: (element: BoardElement) => BoardElement, options?: ChangeOptions): boolean {
  const wanted = new Set(ids);
  if (wanted.size === 0) return false;
  return editElements((elements) => {
    let changed = false;
    const next = elements.map((element) => {
      if (!wanted.has(element.id)) return element;
      const updated = patch(element);
      if (updated !== element) changed = true;
      return updated;
    });
    return changed ? next : elements;
  }, options);
}

/**
 * Adds new elements on top and selects them. Refuses (and adds nothing)
 * when the board would hold too many.
 */
export function addElements(elements: readonly BoardElement[], label: string, options: { select?: boolean } = {}): boolean {
  if (!ensureEditable() || elements.length === 0) return false;
  const content = useBoard.getState().board.content;
  if (content.elements.length + elements.length > MAX_BOARD_ELEMENTS) return refuse(BOARD_FULL_MESSAGE);
  const added = editContent((current) => ({ ...current, elements: [...current.elements, ...elements] }), { label });
  if (added && options.select !== false) useSelection.getState().select(elements.map((element) => element.id));
  return added;
}

/* ------------------------------------------------------------------------ */
/* Delete and duplicate                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Deletes elements with what goes along (section content, group members,
 * stickers on them, arrows attached to them). Locked elements stay.
 */
export function deleteIds(ids: ReadonlySet<ElementId>, message?: string): boolean {
  if (!ensureEditable() || ids.size === 0) return false;
  const elements = boardElements();
  const unlocked = withoutLockedIds(elements, ids);
  if (unlocked.size === 0) return refuse(LOCKED_MESSAGE);
  const measures = currentMeasures();
  const expanded = withoutLockedIds(elements, collectMoveIdsWithAttached(elements, unlocked, measures));
  const before = useBoard.getState().board.content;
  const after = removeElements(before, expanded);
  const gone = topLevelSelectedIds(elements, expanded, measures);
  const named = elements.filter((element) => gone.has(element.id) && (unlocked.has(element.id) || element.type !== 'arrow'));
  const arrows = before.elements.length - after.elements.length - named.length - (expanded.size - gone.size);
  const committed = editContent(() => after, { label: 'Delete' });
  if (!committed) return false;
  useSelection.getState().clear();
  announce(message ?? deletedMessage(named, Math.max(0, arrows)));
  return true;
}

/** Deletes the selection. */
export function deleteSelection(): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return refuse(NOTHING_SELECTED_MESSAGE);
  return deleteIds(ids);
}

/** True when the selection holds only arrows that would lose an end. */
export function onlyArrowsMissingEnds(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): boolean {
  const selected = elements.filter((element) => ids.has(element.id));
  return selected.length > 0 && !selected.some((element) => element.type !== 'arrow' || everyArrowEndId(element, (id) => ids.has(id)));
}

/**
 * Copies elements `offset` down and right (with what moves along) and
 * selects the copies; `undefined` when nothing was copied.
 */
export function duplicateIds(ids: ReadonlySet<ElementId>, offset: number = DUPLICATE_OFFSET, label = 'Duplicate', coalesce?: string): ElementId[] | undefined {
  if (!ensureEditable() || ids.size === 0) return undefined;
  const elements = boardElements();
  if (onlyArrowsMissingEnds(elements, ids)) return void refuse(arrowNeedsEndsMessage('duplicate'));
  const measures = currentMeasures();
  const source = collectMoveIdsWithAttached(elements, ids, measures);
  let newIds: ElementId[] = [];
  editContent(
    (content) => {
      const result = duplicateSelection(content, source, offset, viewerAuthor().id, measures);
      newIds = result.newIds;
      return result.content;
    },
    { label, ...(coalesce !== undefined ? { coalesce } : {}) },
  );
  if (newIds.length === 0) return void refuse(BOARD_FULL_MESSAGE);
  useSelection.getState().select(newIds);
  return newIds;
}

/** Duplicates the selection. */
export function duplicateSelectionNow(): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return refuse(NOTHING_SELECTED_MESSAGE);
  const copies = duplicateIds(ids);
  if (copies === undefined) return false;
  announce(duplicatedMessage(topLevelSelectedIds(boardElements(), new Set(copies), currentMeasures()).size));
  return true;
}

/* ------------------------------------------------------------------------ */
/* Groups and locks                                                         */
/* ------------------------------------------------------------------------ */

function isRefusal(plan: Map<ElementId, string[]> | GroupingRefusal): plan is GroupingRefusal {
  return 'refused' in plan;
}

/** The refusal of a grouping plan, if any. */
export function groupingRefusal(plan: Map<ElementId, string[]> | GroupingRefusal): string | undefined {
  return isRefusal(plan) ? plan.refused : undefined;
}

/** Groups the selection. */
export function groupSelection(): boolean {
  if (!ensureEditable()) return false;
  const ids = selectedIds();
  if (ids.size === 0) return refuse(GROUPING_REFUSALS.few);
  const elements = boardElements();
  if (elements.some((element) => ids.has(element.id) && isElementLocked(element))) return refuse(LOCKED_MESSAGE);
  const plan = planGroupSelection(elements, ids);
  if (isRefusal(plan)) return refuse(plan.refused);
  if (!editContent((content) => applyGroupChanges(content, plan), { label: 'Group' })) return false;
  announce(GROUPING_MESSAGES.group);
  return true;
}

/** Ungroups the selection's outermost groups. */
export function ungroupSelection(): boolean {
  if (!ensureEditable()) return false;
  const ids = selectedIds();
  const elements = boardElements();
  if (elements.some((element) => ids.has(element.id) && isElementLocked(element))) return refuse(LOCKED_MESSAGE);
  const plan = planUngroupSelection(elements, ids);
  if (isRefusal(plan)) return refuse(plan.refused);
  if (!editContent((content) => applyGroupChanges(content, plan), { label: 'Ungroup' })) return false;
  announce(GROUPING_MESSAGES.ungroup);
  return true;
}

/** Whether every selected element is locked. */
export function selectionAllLocked(): boolean {
  const selected = selectedElements();
  return selected.length > 0 && selected.every(isElementLocked);
}

/** Locks the selection, or unlocks it when all of it is locked. */
export function toggleLockSelection(): boolean {
  if (!ensureEditable()) return false;
  const ids = selectedIds();
  if (ids.size === 0) return refuse(NOTHING_SELECTED_MESSAGE);
  const unlock = selectionAllLocked();
  const changed = patchElements(
    ids,
    (element) => {
      if (unlock) {
        if (!isElementLocked(element)) return element;
        const { locked: _locked, ...rest } = element;
        return rest as BoardElement;
      }
      return isElementLocked(element) ? element : { ...element, locked: true };
    },
    { label: unlock ? 'Unlock' : 'Lock' },
  );
  if (changed) announce(unlock ? LOCK_MESSAGES.off : LOCK_MESSAGES.on);
  return changed;
}

/* ------------------------------------------------------------------------ */
/* Layer order                                                              */
/* ------------------------------------------------------------------------ */

/** The ids a layer move acts on: the selection and the stickers riding on it. */
function arrangeIds(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): Set<ElementId> {
  return new Set([...ids, ...stickersOnHosts(ids, elements, currentMeasures())]);
}

/** The content after a layer move (the same content when nothing moves). */
export function arrangedContent(content: BoardContent, ids: ReadonlySet<ElementId>, move: LayerMove): BoardContent {
  if (move === 'front' || move === 'back') return reorderElements(content, arrangeIds(content.elements, ids), move);
  return stepElementOrder(content, ids, move, currentMeasures());
}

/** Moves the selection in the drawing order. */
export function arrangeSelection(move: LayerMove): boolean {
  if (!ensureEditable()) return false;
  const ids = selectedIds();
  if (ids.size === 0) return refuse(NOTHING_SELECTED_MESSAGE);
  const elements = boardElements();
  if (elements.some((element) => ids.has(element.id) && isElementLocked(element))) return refuse(LOCKED_MESSAGE);
  const content = useBoard.getState().board.content;
  if (arrangedContent(content, ids, move) === content)
    return refuse(move === 'front' || move === 'forward' ? 'Already at the front' : 'Already at the back');
  if (!editContent((current) => arrangedContent(current, ids, move), { label: ARRANGE_MESSAGES[move] })) return false;
  announce(ARRANGE_MESSAGES[move]);
  return true;
}

/* ------------------------------------------------------------------------ */
/* Align, tidy, nudge and turn                                              */
/* ------------------------------------------------------------------------ */

/** Aligns the selection's units to an edge or center line of their bounds. */
export function alignSelectionTo(edge: AlignEdge): boolean {
  if (!ensureEditable()) return false;
  const ids = withoutLockedIds(boardElements(), selectedIds());
  if (ids.size === 0) return refuse(selectedIds().size > 0 ? LOCKED_MESSAGE : NOTHING_SELECTED_MESSAGE);
  const measures = currentMeasures();
  const result = alignSelection(useBoard.getState().board.content, ids, edge, measures);
  if (result === undefined) return refuse(ALREADY_ALIGNED_MESSAGE);
  if (!editContent((content) => alignSelection(content, ids, edge, measures)?.after ?? content, { label: ALIGN_ACTION_LABELS[edge].name })) return false;
  announce(ALIGN_ACTION_LABELS[edge].said);
  return true;
}

/** The refusal Tidy up gives for a selection it cannot arrange. */
export const TIDY_REFUSAL =
  'Tidy up needs two or more items that are not pen strokes, arrows, Sections or stickers lying on a selected item; a group counts as one item';

/** Whether Tidy up can arrange the selection. */
export function canTidy(elements: readonly BoardElement[], ids: ReadonlySet<ElementId>): boolean {
  const measures = currentMeasures();
  const selected = elements.filter((element) => ids.has(element.id));
  return gridArrangeRects(groupBoundsCells(selected, elements, measures).cells, elements, measures).length >= 2;
}

/** Tidies the selection into a grid (notes straighten). */
export function tidySelection(): boolean {
  if (!ensureEditable()) return false;
  const ids = selectedIds();
  const elements = boardElements();
  if (elements.some((element) => ids.has(element.id) && isElementLocked(element))) return refuse(LOCKED_MESSAGE);
  if (!canTidy(elements, ids)) return refuse(TIDY_REFUSAL);
  const measures = currentMeasures();
  if (!editContent((content) => tidyUpSelection(content, ids, measures)?.after ?? content, { label: 'Tidy up' })) return refuse(ALREADY_ALIGNED_MESSAGE);
  announce('Tidied up');
  return true;
}

/** Moves the selection (with what moves along) by a board offset. */
export function nudgeSelection(dx: number, dy: number, coalesce?: string): boolean {
  if (!ensureEditable()) return false;
  const elements = boardElements();
  const ids = withoutLockedIds(elements, selectedIds());
  if (ids.size === 0) return refuse(selectedIds().size > 0 ? LOCKED_MESSAGE : NOTHING_SELECTED_MESSAGE);
  const moving = collectMovingSet(elements, ids, currentMeasures());
  const moved = editContent((content) => moveElementsWithScope(content, withoutLockedIds(content.elements, moving.ids), dx, dy, moving.frames).after, {
    label: 'Move',
    ...(coalesce !== undefined ? { coalesce } : {}),
  });
  if (moved) announce(movedMessage(dx, dy));
  return moved;
}

/** Turns the selection by `degrees` around its middle. */
export function rotateSelectionBy(degrees: number, coalesce?: string): boolean {
  if (!ensureEditable()) return false;
  const elements = boardElements();
  const ids = selectedIds();
  if (ids.size === 0) return refuse(NOTHING_SELECTED_MESSAGE);
  if (elements.some((element) => ids.has(element.id) && isElementLocked(element))) return refuse(LOCKED_MESSAGE);
  const turnables = rotatableSelection(elements, ids);
  if (turnables.upright.length > 0) return refuse(cannotTurnMessage(turnables.upright));
  if (turnables.items.length === 0) return refuse(cannotTurnMessage(['arrow']));
  const start = captureRotationStart(turnables.items, elements, currentMeasures());
  const turned = editElements((current) => rotateElements(current, start, degrees), { label: 'Turn', ...(coalesce !== undefined ? { coalesce } : {}) });
  if (turned) {
    const [only] = turnables.items;
    announce(turnables.items.length === 1 && only ? turnedMessage(degrees, elementTurn(boardElements().find((element) => element.id === only.id))) : turnedMessage(degrees));
  }
  return turned;
}

/* ------------------------------------------------------------------------ */
/* Selection                                                                */
/* ------------------------------------------------------------------------ */

/** Selects every unlocked element. */
export function selectAll(): boolean {
  const elements = boardElements();
  if (elements.length === 0) return refuse(EMPTY_BOARD_MESSAGE);
  const ids = elements.filter((element) => !isElementLocked(element)).map((element) => element.id);
  useSelection.getState().select(ids);
  announce(selectionCountMessage(ids.length));
  return ids.length > 0;
}

/* ------------------------------------------------------------------------ */
/* Style                                                                    */
/* ------------------------------------------------------------------------ */

/** Applies a style patch to the unlocked selection; announces `said` when something changed. */
function restyle(patch: (element: BoardElement) => BoardElement, label: string, said: string): boolean {
  if (!ensureEditable()) return false;
  const ids = withoutLockedIds(boardElements(), selectedIds());
  if (ids.size === 0) return refuse(selectedIds().size > 0 ? LOCKED_MESSAGE : NOTHING_SELECTED_MESSAGE);
  const changed = patchElements(ids, patch, { label });
  if (changed) announce(said);
  return changed;
}

/** Sets the fill of notes, shapes, sections and table headers (a hollow shape fills again). */
export function setFillColor(color: FillColor): boolean {
  return restyle(
    (element) => {
      switch (element.type) {
        case 'note':
        case 'container':
          return element.color === color ? element : { ...element, color };
        case 'table':
          return element.color === color && element.head ? element : { ...element, color, head: true };
        case 'shape': {
          if (element.color === color && element.hollow !== true) return element;
          const { hollow: _hollow, ...filled } = element;
          return { ...filled, color };
        }
        default:
          return element;
      }
    },
    'Fill color',
    colorUpdatedMessage('fill'),
  );
}

/** The color target of an ink change for one element. */
export function inkTargetOf(element: BoardElement): ColorTarget | undefined {
  switch (element.type) {
    case 'stroke':
      return 'ink';
    case 'arrow':
      return 'line';
    case 'text':
    case 'note':
    case 'shape':
    case 'table':
      return 'text';
    default:
      return undefined;
  }
}

/** Sets the ink: a drawing's color, an arrow's line, a text's color, or the words on a note, shape or table. */
export function setInkColor(color: InkColor): boolean {
  const target = selectedElements().map(inkTargetOf).find((value) => value !== undefined) ?? 'ink';
  return restyle(
    (element) => {
      switch (element.type) {
        case 'stroke':
        case 'arrow':
        case 'text':
          return element.color === color ? element : { ...element, color };
        case 'note':
        case 'shape':
        case 'table':
          return element.ink === color ? element : { ...element, ink: color };
        default:
          return element;
      }
    },
    'Ink color',
    colorUpdatedMessage(target),
  );
}

/** Sets or removes the outline of shapes (`null`: none; a hollow shape fills again). */
export function setShapeBorder(stroke: InkColor | null): boolean {
  return restyle(
    (element) => {
      if (element.type !== 'shape') return element;
      if (stroke === null) {
        if (element.stroke === undefined && element.hollow !== true) return element;
        const { stroke: _stroke, solid: _solid, hollow: _hollow, ...rest } = element;
        return rest;
      }
      return element.stroke === stroke ? element : { ...element, stroke };
    },
    'Border',
    stroke === null ? 'Border none' : colorUpdatedMessage('outline'),
  );
}

/** Hollows the selected shapes out (`none`) or fills them again. */
export function setShapeFill(mode: 'fill' | 'none'): boolean {
  if (!ensureEditable()) return false;
  const shapes = selectedElements().filter((element): element is Extract<BoardElement, { type: 'shape' }> => element.type === 'shape' && !isElementLocked(element));
  if (shapes.length === 0) return false;
  const changed = editContent((content) => setShapeFillMode(content, shapes, mode), { label: 'Fill' });
  if (changed) announce(mode === 'fill' ? colorUpdatedMessage('fill') : 'Border none');
  return changed;
}

/** Sets the text size of notes, shapes, texts and tables. */
export function setTextSize(size: TextSize): boolean {
  return restyle(
    (element) =>
      (element.type === 'note' || element.type === 'shape' || element.type === 'text' || element.type === 'table') && element.size !== size ? { ...element, size } : element,
    'Text size',
    textSizeMessage(size),
  );
}

/** Sets the text alignment of notes, shapes, texts and tables. */
export function setTextAlign(textAlign: TextAlign): boolean {
  return restyle(
    (element) =>
      (element.type === 'note' || element.type === 'shape' || element.type === 'text' || element.type === 'table') && element.textAlign !== textAlign
        ? { ...element, textAlign }
        : element,
    'Text alignment',
    textAlignedMessage(textAlign),
  );
}

/** Turns the selected shapes and texts into another kind. */
export function setBlockKind(kind: BlockKind, label: string): boolean {
  if (!ensureEditable()) return false;
  const targets = selectedElements().filter(isKindChangeable).filter((element) => !isElementLocked(element) && blockKindOf(element) !== kind);
  if (targets.length === 0) return false;
  const measures = currentMeasures();
  const changed = editContent((content) => setKindForElements(content, targets, kind, (element) => elementLayoutBox(element, measures)), { label: 'Change kind' });
  if (changed) announce(shapeKindMessage(label));
  return changed;
}

/** Sets one end style of the selected arrows. */
export function setArrowHead(end: 'start' | 'end', kind: ArrowHeadKind): boolean {
  if (!ARROW_HEAD_KINDS.includes(kind)) return false;
  return restyle(
    (element) => {
      if (element.type !== 'arrow') return element;
      const heads = arrowHeads(element);
      const next: readonly [ArrowHeadKind, ArrowHeadKind] = end === 'start' ? [kind, heads[1]] : [heads[0], kind];
      if (next[0] === heads[0] && next[1] === heads[1]) return element;
      const { heads: _heads, ...rest } = element;
      return { ...rest, ...arrowHeadFields(next) };
    },
    'Arrow ends',
    (end === 'start' ? 'Arrow start: ' : 'Arrow end: ') + (kind === 'arrow' ? 'arrowhead' : kind),
  );
}

/** Makes the selected arrows dashed or solid. */
export function setArrowDash(dash: boolean): boolean {
  return restyle((element) => (element.type === 'arrow' && element.dash !== dash ? { ...element, dash } : element), 'Line style', dash ? 'Dashed' : 'Solid');
}

/** Drops the hand-set route of the selected arrows (they route themselves again). */
export function resetArrowRoute(): boolean {
  return restyle(
    (element) => {
      if (element.type !== 'arrow' || (element.bends === undefined && element.jog === undefined)) return element;
      const { bends: _bends, jog: _jog, ...rest } = element;
      return rest;
    },
    'Reset route',
    'Arrow route reset',
  );
}

/** Sets, changes or removes the web link of the selected image (`null` or empty: remove). */
export function setImageLink(id: ElementId, href: string | null): boolean {
  if (!ensureEditable()) return false;
  const image = useBoard.getState().byId.get(id);
  if (image?.type !== 'image') return false;
  if (isElementLocked(image)) return refuse(LOCKED_MESSAGE);
  const trimmed = href?.trim() ?? '';
  const next = trimmed === '' ? undefined : normalizeHttpUrl(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : 'https://' + trimmed);
  if (trimmed !== '' && next === undefined) return refuse('That address is not a web link');
  if (next === image.href) {
    announce(LINK_EDIT_MESSAGES.kept);
    return false;
  }
  const changed = patchElements(
    [id],
    (element) => {
      if (element.type !== 'image') return element;
      const { href: _href, ...rest } = element;
      return next === undefined ? rest : { ...rest, href: next };
    },
    { label: 'Link' },
  );
  if (changed) announce(next === undefined ? LINK_EDIT_MESSAGES.removed : image.href === undefined ? LINK_EDIT_MESSAGES.added : LINK_EDIT_MESSAGES.changed);
  return changed;
}

/** Turns a table's header row off, or on in a color. */
export function setTableHeader(color: FillColor | null): boolean {
  return restyle(
    (element) => {
      if (element.type !== 'table') return element;
      if (color === null) return element.head ? { ...element, head: false } : element;
      return element.head && element.color === color ? element : { ...element, head: true, color };
    },
    'Header',
    color === null ? 'Header off' : colorUpdatedMessage('fill'),
  );
}

/* ------------------------------------------------------------------------ */
/* Table rows and columns                                                   */
/* ------------------------------------------------------------------------ */

/** A row or column command on a table cell. */
export type TableCellCommand = 'row-above' | 'row-below' | 'row-delete' | 'col-left' | 'col-right' | 'col-delete';

/** Table refusals. */
export const TABLE_MESSAGES = {
  full: 'A table holds at most ' + TABLE_LIMITS.cells.toLocaleString('en-US') + ' cells. Start another table.',
  last: (axis: 'row' | 'column'): string => 'A table keeps at least one ' + axis,
  aboveHead: 'Set the header color to None to add a row above it',
  added: (axis: 'row' | 'column'): string => (axis === 'row' ? 'Row' : 'Column') + ' added',
  removed: (axis: 'row' | 'column'): string => (axis === 'row' ? 'Row' : 'Column') + ' deleted',
} as const;

/** Why each table command cannot run on a cell (absent when it can). */
export function tableCellRefusals(table: TableElement, cell: { row: string; col: string }): Partial<Record<TableCellCommand, string>> {
  const rows = tableRowIds(table);
  const cols = tableColumnIds(table);
  const rowsFull = exceedsTableCellLimit(rows.length + 1, cols.length) ? TABLE_MESSAGES.full : undefined;
  const colsFull = exceedsTableCellLimit(rows.length, cols.length + 1) ? TABLE_MESSAGES.full : undefined;
  const refusals: Partial<Record<TableCellCommand, string>> = {};
  const above = rowsFull ?? (table.head && rows[0] === cell.row ? TABLE_MESSAGES.aboveHead : undefined);
  if (above) refusals['row-above'] = above;
  if (rowsFull) refusals['row-below'] = rowsFull;
  if (rows.length <= 1) refusals['row-delete'] = TABLE_MESSAGES.last('row');
  if (colsFull) {
    refusals['col-left'] = colsFull;
    refusals['col-right'] = colsFull;
  }
  if (cols.length <= 1) refusals['col-delete'] = TABLE_MESSAGES.last('column');
  return refusals;
}

/** Runs a row or column command on a table cell. */
export function runTableCellCommand(tableId: ElementId, cell: { row: string; col: string }, command: TableCellCommand): boolean {
  if (!ensureEditable()) return false;
  const table = useBoard.getState().byId.get(tableId);
  if (table?.type !== 'table') return false;
  if (isElementLocked(table)) return refuse(LOCKED_MESSAGE);
  const refusal = tableCellRefusals(table, cell)[command];
  if (refusal) return refuse(refusal);
  const tables = tableEditor();
  if (tables === null) return false;
  // The cell being typed in records its step before the row or column changes.
  flushTableCell();
  const rowIndex = Math.max(0, tableRowIds(table).indexOf(cell.row));
  const colIndex = Math.max(0, tableColumnIds(table).indexOf(cell.col));
  const axis = command.startsWith('row') ? 'row' : 'column';
  const changed = ((): boolean => {
    switch (command) {
      case 'row-above':
      case 'row-below':
        return tables.addRow(tableId, command === 'row-above' ? rowIndex : rowIndex + 1) !== undefined;
      case 'col-left':
      case 'col-right':
        return tables.addCol(tableId, command === 'col-left' ? colIndex : colIndex + 1) !== undefined;
      case 'row-delete':
        return tables.removeRow(tableId, cell.row);
      case 'col-delete':
        return tables.removeCol(tableId, cell.col);
    }
  })();
  if (changed) announce(command.endsWith('delete') ? TABLE_MESSAGES.removed(axis) : TABLE_MESSAGES.added(axis));
  return changed;
}
