import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_STEP_MESSAGES,
  HISTORY_MESSAGES,
  applyBoardDiff,
  commitGroupMembershipChange,
  createAnnouncedHistory,
  createBoardStepCommitter,
  createCommandHistory,
  createStepSaysUndo,
  diffBoardContents,
  diffFitsBoardLimit,
  mergeChangedFields,
  type HistoryStep,
} from '../src/history.ts';
import { parseBoardContent } from '../src/normalize.ts';
import { MAX_BOARD_ELEMENTS, type ArrowElement, type BoardContent, type BoardElement, type ImageElement, type NoteElement, type TableElement } from '../src/schema.ts';
import { tableFromGrid } from '../src/table.ts';

const note = (id: string, text: string, x = 0, extra: Partial<NoteElement> = {}): NoteElement => ({
  type: 'note',
  id,
  x,
  y: 0,
  w: 180,
  h: 180,
  color: 'yellow',
  text,
  tilt: 0,
  ...extra,
});

const board = (...elements: BoardElement[]): BoardContent => parseBoardContent({ elements });

/** A document that holds content in memory (what the live board offers). */
function memoryDoc(content: BoardContent) {
  let current = content;
  return {
    content: () => current,
    setContent(next: BoardContent) {
      current = next;
    },
  };
}

const find = (content: BoardContent, id: string): BoardElement | undefined => content.elements.find((element) => element.id === id);

const counter = (): { value: number; step: HistoryStep } => {
  const state = { value: 0, step: undefined as unknown as HistoryStep };
  state.step = { label: 'add', do: () => void (state.value += 1), undo: () => void (state.value -= 1) };
  return state;
};

describe('command history', () => {
  it('runs, undoes and redoes steps', () => {
    const history = createCommandHistory();
    const state = counter();
    history.exec(state.step);
    assert.equal(state.value, 1);
    assert.equal(history.canUndo(), true);
    history.undo();
    assert.equal(state.value, 0);
    assert.equal(history.canRedo(), true);
    assert.equal(history.redoDepth(), 1);
    history.redo();
    assert.equal(state.value, 1);
    assert.equal(history.canRedo(), false);
  });

  it('honours canDo and canUndo', () => {
    const history = createCommandHistory();
    let allowed = false;
    const state = counter();
    history.exec({ ...state.step, canDo: () => allowed });
    assert.equal(state.value, 0, 'a blocked step does not run');
    assert.equal(history.canUndo(), false);
    history.seed({ ...state.step, canUndo: () => allowed });
    history.undo();
    assert.equal(history.canUndo(), true, 'a blocked undo stays on the stack');
    allowed = true;
    history.undo();
    assert.equal(state.value, -1);
  });

  it('clears the redo stack on a new step and keeps at most the limit', () => {
    const history = createCommandHistory(3);
    const state = counter();
    for (let index = 0; index < 5; index++) history.exec(state.step);
    let undone = 0;
    while (history.canUndo()) {
      history.undo();
      undone += 1;
    }
    assert.equal(undone, 3);
    history.exec(state.step);
    assert.equal(history.canRedo(), false);
  });

  it('drops only the latest step and lists steps above another', () => {
    const history = createCommandHistory();
    const a: HistoryStep = { do() {}, undo() {} };
    const b: HistoryStep = { do() {}, undo() {} };
    history.seed(a);
    history.seed(b);
    assert.deepEqual(history.above(a), [b]);
    assert.equal(history.above({ do() {}, undo() {} }), undefined);
    assert.equal(history.drop(a), false);
    assert.equal(history.drop(b), true);
    assert.deepEqual(history.above(a), []);
  });

  it('notifies subscribers', () => {
    const history = createCommandHistory();
    let calls = 0;
    const stop = history.subscribe(() => void (calls += 1));
    history.seed(counter().step);
    history.undo();
    stop();
    history.redo();
    assert.equal(calls, 2);
  });

  it('announces undo and redo, and nothing to do', () => {
    const said: string[] = [];
    const history = createAnnouncedHistory(createCommandHistory(), (message) => said.push(message));
    history.undo();
    history.exec(counter().step);
    history.undo();
    history.redo();
    history.redo();
    assert.deepEqual(said, [HISTORY_MESSAGES.nothingToUndo, HISTORY_MESSAGES.undone, HISTORY_MESSAGES.redone, HISTORY_MESSAGES.nothingToRedo]);
  });

  it('lets a running step replace or silence the announcement', () => {
    const said: string[] = [];
    const { undo, stepSays } = createStepSaysUndo(createCommandHistory(), (message) => said.push(message));
    undo.seed({ do: () => stepSays(null), undo: () => stepSays('Moved back.') });
    undo.undo();
    undo.redo();
    assert.deepEqual(said, ['Moved back.']);
    undo.undo();
    assert.deepEqual(said, ['Moved back.', 'Moved back.']);
  });
});

describe('board diffs', () => {
  it('records added, removed and changed elements with their order', () => {
    const before = board(note('n1', 'a'), note('n2', 'b'));
    const after = board(note('n1', 'A'), note('n3', 'c'));
    const diff = diffBoardContents(before, after);
    assert.ok(diff);
    assert.deepEqual([...diff.touched.keys()].sort(), ['n1', 'n2', 'n3']);
    assert.equal(diff.touched.get('n2')?.after, undefined);
    assert.equal(diff.touched.get('n3')?.before, undefined);
    assert.deepEqual([...(diff.order?.ids ?? [])].sort(), ['n2', 'n3']);
    assert.equal(diffBoardContents(before, before), null);
  });

  it('limits a diff to a scope', () => {
    const before = board(note('n1', 'a'), note('n2', 'b'));
    const after = board(note('n1', 'A'), note('n2', 'B'));
    const diff = diffBoardContents(before, after, ['n2']);
    assert.deepEqual([...(diff?.touched.keys() ?? [])], ['n2']);
  });

  it('undoes only the fields a step changed', () => {
    const before = board(note('n1', 'a', 0));
    const moved = board(note('n1', 'a', 300));
    const diff = diffBoardContents(before, moved);
    assert.ok(diff);
    // Someone else edits the text after the move.
    const now = board(note('n1', 'theirs', 300));
    const undone = applyBoardDiff(now, diff, 'back');
    const element = find(undone, 'n1');
    assert.equal(element?.type === 'note' && element.x, 0, 'the move is undone');
    assert.equal(element?.type === 'note' && element.text, 'theirs', 'their text stays');
  });

  it('brings a deleted element back in its old place', () => {
    const before = board(note('n1', 'a'), note('n2', 'b'), note('n3', 'c'));
    const after = board(note('n1', 'a'), note('n3', 'c'));
    const diff = diffBoardContents(before, after);
    assert.ok(diff);
    const undone = applyBoardDiff(after, diff, 'back');
    assert.deepEqual(
      undone.elements.map((element) => element.id),
      ['n1', 'n2', 'n3'],
    );
    assert.equal(applyBoardDiff(undone, diff, 'forward').elements.length, 2);
  });

  it('skips arrows whose ends are gone', () => {
    const arrow: ArrowElement = { type: 'arrow', id: 'a1', from: 'n1', to: 'n2', head: 'end', dash: false, color: 'ink' };
    const before = board(note('n1', 'a'), note('n2', 'b'));
    const after = board(note('n1', 'a'), note('n2', 'b'), arrow);
    const diff = diffBoardContents(before, after);
    assert.ok(diff);
    const withoutEnd = board(note('n1', 'a'));
    const redone = applyBoardDiff(withoutEnd, diff, 'forward');
    assert.equal(find(redone, 'a1'), undefined);
  });

  it('merges changed fields by group', () => {
    const merged = mergeChangedFields({ x: 1, y: 2, text: 'theirs' }, { x: 1, y: 2, text: 'a' }, { x: 5, y: 2, text: 'a' });
    assert.deepEqual(merged, { x: 5, y: 2, text: 'theirs' });
  });

  it('merges a group move with a concurrent resize field by field', () => {
    const before = board(note('n1', 'a', 0, { groups: ['g1'] }), note('n2', 'b', 200, { groups: ['g1'] }));
    const moved = board(note('n1', 'a', 400, { groups: ['g1'] }), note('n2', 'b', 600, { groups: ['g1'] }));
    const diff = diffBoardContents(before, moved);
    assert.ok(diff);
    // Someone else resizes n1 while the group moves.
    const now = board(note('n1', 'a', 0, { groups: ['g1'], w: 300 }), note('n2', 'b', 200, { groups: ['g1'] }));
    const applied = applyBoardDiff(now, diff, 'forward');
    assert.deepEqual([find(applied, 'n1')?.type === 'note' && find(applied, 'n1'), find(applied, 'n2')].map((element) => element && element.type === 'note' && [element.x, element.w]), [
      [400, 300],
      [600, 180],
    ]);
    const undone = applyBoardDiff(applied, diff, 'back');
    const n1 = find(undone, 'n1');
    assert.deepEqual(n1?.type === 'note' && [n1.x, n1.w], [0, 300], 'undoing the move keeps the resize');
  });

  it('still applies a multi-element step that changes more than geometry whole', () => {
    const before = board(note('n1', 'a'), note('n2', 'b', 200));
    const after = board(note('n1', 'A', 400), note('n2', 'B', 600));
    const diff = diffBoardContents(before, after);
    assert.ok(diff);
    const applied = applyBoardDiff(board(note('n1', 'a', 0, { w: 300 }), note('n2', 'b', 200)), diff, 'forward');
    const n1 = find(applied, 'n1');
    assert.deepEqual(n1?.type === 'note' && [n1.x, n1.w, n1.text], [400, 180, 'A']);
  });

  it('keeps a drawing style someone else set', () => {
    const drawing = (id: string, extra: Partial<ImageElement> = {}): ImageElement => ({
      type: 'image',
      id,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      src: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
      ...extra,
    });
    const diff = diffBoardContents(board(drawing('d1')), board(drawing('d1', { x: 300 })));
    assert.ok(diff);
    const undone = applyBoardDiff(board(drawing('d1', { x: 300, style: 'comic' })), diff, 'back');
    const element = find(undone, 'd1');
    assert.deepEqual(element?.type === 'image' && [element.x, element.style], [0, 'comic']);
    const restyled = diffBoardContents(board(drawing('d1')), board(drawing('d1', { style: 'draft' })));
    assert.ok(restyled);
    const reverted = find(applyBoardDiff(board(drawing('d1', { style: 'draft' })), restyled, 'back'), 'd1');
    assert.equal(reverted?.type === 'image' && reverted.style, undefined, 'undoing a restyle takes the style off');
  });

  it('leaves table fills and heat maps as the board has them, like cell text', () => {
    const table = (extra: Partial<TableElement> = {}): TableElement => ({ type: 'table', id: 't1', x: 0, y: 0, head: true, color: 'white', ...tableFromGrid([['a', 'b'], ['1', '2']]), ...extra });
    const diff = diffBoardContents(board(table()), board(table({ x: 300 })));
    assert.ok(diff);
    // Someone else tints the table after the move.
    const tints = { fills: { r1: { c1: 'blue' as const } }, heat: { cols: { c2: 'green' as const } } };
    const undone = find(applyBoardDiff(board(table({ x: 300, ...tints })), diff, 'back'), 't1');
    assert.deepEqual(undone?.type === 'table' && [undone.x, undone.fills, undone.heat], [0, tints.fills, tints.heat]);
  });

  it('refuses steps that would overflow the board', () => {
    const full = board(...Array.from({ length: MAX_BOARD_ELEMENTS }, (_, index) => note(`n${index}`, '')));
    const diff = diffBoardContents(board(), board(note('extra', '')));
    assert.ok(diff);
    assert.equal(diffFitsBoardLimit(full, diff, 'forward'), false);
    assert.equal(diffFitsBoardLimit(board(), diff, 'forward'), true);
  });
});

describe('board step committer', () => {
  it('commits an edit as one undoable step', () => {
    const doc = memoryDoc(board(note('n1', 'a')));
    const history = createCommandHistory();
    const commit = createBoardStepCommitter(doc, history);
    const before = doc.content();
    assert.equal(commit('edit', before, board(note('n1', 'b'))), true);
    assert.equal((find(doc.content(), 'n1') as NoteElement).text, 'b');
    history.undo();
    assert.equal((find(doc.content(), 'n1') as NoteElement).text, 'a');
    history.redo();
    assert.equal((find(doc.content(), 'n1') as NoteElement).text, 'b');
  });

  it('returns false when nothing changed', () => {
    const doc = memoryDoc(board(note('n1', 'a')));
    const history = createCommandHistory();
    const commit = createBoardStepCommitter(doc, history);
    assert.equal(commit('edit', doc.content(), doc.content()), false);
    assert.equal(history.canUndo(), false);
  });

  it('applies a step onto content that changed since it started', () => {
    const doc = memoryDoc(board(note('n1', 'a'), note('n2', 'b')));
    const history = createCommandHistory();
    const commit = createBoardStepCommitter(doc, history);
    const before = doc.content();
    // A remote edit lands while the local gesture runs.
    doc.setContent(board(note('n1', 'a'), note('n2', 'theirs')));
    commit('move', before, board(note('n1', 'a', 400), note('n2', 'b')), ['n1']);
    assert.equal((find(doc.content(), 'n1') as NoteElement).x, 400);
    assert.equal((find(doc.content(), 'n2') as NoteElement).text, 'theirs', 'the remote edit survives');
    history.undo();
    assert.equal((find(doc.content(), 'n1') as NoteElement).x, 0);
    assert.equal((find(doc.content(), 'n2') as NoteElement).text, 'theirs');
  });

  it('never changes groups through an edit', () => {
    const doc = memoryDoc(board(note('n1', 'a', 0, { groups: ['g1'] })));
    const history = createCommandHistory();
    const commit = createBoardStepCommitter(doc, history);
    commit('edit', doc.content(), board(note('n1', 'b', 0)));
    assert.deepEqual(find(doc.content(), 'n1')?.groups, ['g1']);
  });

  it('refuses a redo that no longer fits', () => {
    const refusals: string[] = [];
    const doc = memoryDoc(board());
    const history = createCommandHistory();
    const commit = createBoardStepCommitter(doc, history, { onRefused: (message) => refusals.push(message) });
    commit('add', doc.content(), board(note('extra', '')));
    history.undo();
    doc.setContent(board(...Array.from({ length: MAX_BOARD_ELEMENTS }, (_, index) => note(`n${index}`, ''))));
    history.redo();
    assert.deepEqual(refusals, [BOARD_STEP_MESSAGES.cantRedo]);
    assert.equal(find(doc.content(), 'extra'), undefined);
  });

  it('commits group membership changes as their own step', () => {
    const doc = memoryDoc(board(note('n1', 'a'), note('n2', 'b')));
    const history = createCommandHistory();
    const changed: string[][] = [];
    const groups = new Map([
      ['n1', ['g1']],
      ['n2', ['g1']],
    ]);
    assert.equal(
      commitGroupMembershipChange(doc, history, 'group', groups, (ids) => changed.push([...ids])),
      true,
    );
    assert.deepEqual(find(doc.content(), 'n1')?.groups, ['g1']);
    history.undo();
    assert.equal(find(doc.content(), 'n1')?.groups, undefined);
    assert.deepEqual(changed, [['n1', 'n2']]);
    assert.equal(commitGroupMembershipChange(doc, history, 'group', new Map([['n1', []]])), false);
  });
});
