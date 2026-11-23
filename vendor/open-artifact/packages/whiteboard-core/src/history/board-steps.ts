/**
 * Turning board edits into undo steps: the committer records what an edit
 * changed as a {@link BoardDiff}, applies it (rebased onto what others
 * changed meanwhile) and seeds a step that undoes and redoes exactly that.
 * Group membership changes get their own step kind.
 */

import { canonicalValuesEqual } from '../json.ts';
import type { BoardContent, BoardElement, ContainerElement, ElementId } from '../schema.ts';
import { applyBoardDiff, diffBoardContents, diffChangesSeveral, diffFitsBoardLimit, type BoardDiff, type DiffDirection } from './board-diff.ts';
import type { HistoryStep } from './command-history.ts';
import { applyGroupChanges, normalizeBoardContent, restoreGroupsFrom, sameGroupList } from './content.ts';

/** The document a committer reads and writes (a live board fits). */
export interface StepDocument {
  content(): BoardContent;
  setContent(content: BoardContent): unknown;
}

/** The history a committer records into. */
export interface StepHistory {
  seed(step: HistoryStep): void;
}

/** How tall a section grows for a step: from its height before to its height after. */
export interface SectionGrowth {
  from: number;
  to: number;
}

/**
 * Section growth hooks (they need text measurement, so the editor supplies
 * them). `plan` says which sections must grow to fit what the step changed;
 * `stillNeedsGrowth` says whether a section must keep its grown height when
 * the step is undone.
 */
export interface SectionGrowthHooks {
  plan(elements: readonly BoardElement[], changed: readonly BoardElement[]): ReadonlyMap<ElementId, SectionGrowth>;
  stillNeedsGrowth(elements: readonly BoardElement[], section: ContainerElement, height: number, moved: ReadonlySet<ElementId>): boolean;
}

/** Options of {@link createBoardStepCommitter}. */
export interface BoardStepCommitterOptions {
  /** Told why a step could not be done, undone or redone. */
  onRefused?: (message: string) => void;
  growth?: SectionGrowthHooks;
  /** Called after each committed step. */
  onCommitted?: (diff: BoardDiff, label: string) => void;
}

/** What the committer says when the board limit blocks a step. */
export const BOARD_STEP_MESSAGES = {
  full: 'The board is full.',
  cantUndo: 'Can’t undo — the board is full.',
  cantRedo: 'Can’t redo — the board is full.',
} as const;

/**
 * Commits an edit as one step. `before` is the content the edit started
 * from, `change` the content it produced and `scope` (optional) the ids it
 * may touch. Returns `false` when nothing changed or the board is full.
 */
export type BoardStepCommit = (label: string, before: BoardContent, change: BoardContent, scope?: Iterable<ElementId>) => boolean;

function placeKey(element: BoardElement | undefined): string {
  if (element === undefined || !('x' in element)) return '[]';
  return JSON.stringify([element.x, element.y, 'w' in element && element.w, 'h' in element && element.h]);
}

/** Creates a step committer over a document and a history. */
export function createBoardStepCommitter(doc: StepDocument, history: StepHistory, options: BoardStepCommitterOptions = {}): BoardStepCommit {
  const { onRefused, growth: hooks, onCommitted } = options;
  const canStep = (direction: DiffDirection, diff: BoardDiff): boolean => {
    if (diffFitsBoardLimit(doc.content(), diff, direction)) return true;
    onRefused?.(direction === 'back' ? BOARD_STEP_MESSAGES.cantUndo : BOARD_STEP_MESSAGES.cantRedo);
    return false;
  };
  return (label, before, change, scope) => {
    const after = normalizeBoardContent(restoreGroupsFrom(change, before));
    if (after === before) return false;
    const diff = diffBoardContents(before, after, scope);
    if (diff === null) return false;
    const current = doc.content();
    if (current !== before && !diffFitsBoardLimit(current, diff, 'forward')) {
      onRefused?.(BOARD_STEP_MESSAGES.full);
      return false;
    }
    const next = current === before ? after : applyBoardDiff(current, diff, 'forward', true);
    const growth: ReadonlyMap<ElementId, SectionGrowth> =
      hooks?.plan(next.elements, [...diff.touched.values()].flatMap((entry) => (entry.after === undefined ? [] : [entry.after]))) ?? new Map();
    const moved = new Set([...diff.touched].flatMap(([id, entry]) => (placeKey(entry.before) === placeKey(entry.after) ? [] : [id])));
    const withGrowth = (content: BoardContent, side: 'to' | 'from'): BoardContent => {
      let elements = content.elements;
      for (const [id, size] of growth) {
        elements = elements.map((element) => {
          if (element.id !== id || element.type !== 'container') return element;
          if (side === 'to') return { ...element, h: Math.max(element.h, size.to) };
          return element.h === size.to && hooks?.stillNeedsGrowth(elements, element, size.from, moved) !== true ? { ...element, h: size.from } : element;
        });
      }
      return elements === content.elements ? content : { ...content, elements };
    };
    doc.setContent(withGrowth(next, 'to'));
    if (!diffChangesSeveral(diff)) {
      // Rebase the recorded result onto what the document actually holds now.
      const byId = (content: BoardContent): Map<ElementId, BoardElement> => new Map(content.elements.map((element) => [element.id, element]));
      const was = byId(current);
      const now = byId(doc.content());
      for (const [id, entry] of diff.touched) {
        const actual = now.get(id);
        if (
          entry.before !== undefined &&
          entry.after !== undefined &&
          actual !== undefined &&
          canonicalValuesEqual(was.get(id), entry.before) &&
          !canonicalValuesEqual(actual, entry.before)
        ) {
          entry.after = actual;
        }
      }
    }
    history.seed({
      label,
      do: () => void doc.setContent(withGrowth(applyBoardDiff(doc.content(), diff, 'forward'), 'to')),
      undo: () => void doc.setContent(withGrowth(applyBoardDiff(doc.content(), diff, 'back'), 'from')),
      canDo: () => canStep('forward', diff),
      canUndo: () => canStep('back', diff),
    });
    onCommitted?.(diff, label);
    return true;
  };
}

/**
 * Changes which groups elements belong to, as one step. `groupsAfter` maps
 * ids to their new group lists. Undo puts back the old lists of elements
 * whose groups nobody changed since. Returns `false` when nothing changed.
 */
export function commitGroupMembershipChange(
  doc: StepDocument,
  history: StepHistory,
  label: string,
  groupsAfter: ReadonlyMap<ElementId, readonly string[]>,
  onChanged?: (ids: ReadonlySet<ElementId>) => void,
): boolean {
  const groupsBefore = new Map<ElementId, readonly string[]>(
    doc.content().elements.flatMap((element) => (groupsAfter.has(element.id) ? [[element.id, element.groups ?? []] as const] : [])),
  );
  const applyGroups = (from: ReadonlyMap<ElementId, readonly string[]>, to: ReadonlyMap<ElementId, readonly string[]>): boolean => {
    const content = doc.content();
    const changes = new Map<ElementId, readonly string[]>();
    for (const element of content.elements) {
      const target = to.get(element.id);
      const expected = from.get(element.id);
      if (target !== undefined && expected !== undefined && sameGroupList(element.groups, expected)) changes.set(element.id, target);
    }
    const next = applyGroupChanges(content, changes);
    if (next !== content) doc.setContent(next);
    return next !== content;
  };
  if (!applyGroups(groupsBefore, groupsAfter)) return false;
  const step = (from: ReadonlyMap<ElementId, readonly string[]>, to: ReadonlyMap<ElementId, readonly string[]>) => (): void => {
    applyGroups(from, to);
    onChanged?.(new Set(groupsAfter.keys()));
  };
  history.seed({ label, do: step(groupsBefore, groupsAfter), undo: step(groupsAfter, groupsBefore) });
  return true;
}
