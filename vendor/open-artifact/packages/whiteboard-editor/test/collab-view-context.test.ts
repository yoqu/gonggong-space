/**
 * Tests of the view context the agent reads (what the viewer sees, selects
 * and edits) and of the layout problems measured into it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement, ContainerElement, NoteElement, ShapeElement, StrokeElement } from '@open-artifact/whiteboard-core';
import { coveredShare, findBoardIssues, MAX_REPORTED_ISSUES } from '../src/collab/board-issues.ts';
import { buildViewContext, fitViewContext, jsonBytes, MAX_CONTEXT_LABELS, type BoardViewContext, type ViewContextInput } from '../src/collab/view-context.ts';

const note = (id: string, x: number, y: number, text = 'Hello there'): NoteElement => ({ type: 'note', id, x, y, w: 100, h: 100, color: 'yellow', text, tilt: 0 });
const shape = (id: string, x: number, y: number, w = 100, h = 100): ShapeElement => ({ type: 'shape', id, x, y, w, h, kind: 'rect', color: 'blue', text: '' });
const section = (id: string, x: number, y: number, w: number, h: number): ContainerElement => ({ type: 'container', id, x, y, w, h, color: 'blue', text: 'Section' });
const stroke = (id: string, x: number, y: number): StrokeElement => ({ type: 'stroke', id, x, y, points: [0, 0, 200, 200], color: 'ink', width: 2 });

const VIEW = { x: -1000, y: -1000, w: 4000, h: 4000 };

function input(elements: BoardElement[], extra: Partial<ViewContextInput> = {}): ViewContextInput {
  return {
    viewer: { id: 'u1', name: 'Ada' },
    elements,
    byId: new Map(elements.map((element) => [element.id, element])),
    selected: [],
    editing: null,
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { w: 1000, h: 800, top: 50, bottom: 70 },
    tool: 'select',
    commentMode: false,
    moving: [],
    claim: 'abcdefgh',
    dirty: false,
    ...extra,
  };
}

describe('buildViewContext', () => {
  it('reports the viewer, the area clear of chrome and the claim key', () => {
    const context = buildViewContext(input([]));
    assert.deepEqual(context, { viewer: { id: 'u1', name: 'Ada' }, viewport: { x: 0, y: 50, w: 1000, h: 680, zoom: 1 }, claim: 'abcdefgh' });
  });

  it('lists the selection (labels for the most recent) and leaves out unknown ids', () => {
    const notes = Array.from({ length: 8 }, (_, index) => note(`n${index}`, index * 200, 0, `Note ${index}`));
    const context = buildViewContext(input(notes, { selected: [...notes.map((element) => element.id), 'gone'] }));
    assert.equal(context.selected?.length, 8);
    assert.equal(context.selection?.length, MAX_CONTEXT_LABELS);
    assert.deepEqual(context.selection?.at(-1), { id: 'n7', kind: 'note', label: 'Note 7' });
  });

  it('notes the mode, tool, editing target, pin, moving items and unsaved changes', () => {
    const elements = [note('a', 0, 0), shape('b', 300, 0)];
    const context = buildViewContext(
      input(elements, {
        commentMode: true,
        tool: 'note',
        editing: { kind: 'arrow-label', id: 'a' },
        pin: { x: 5, y: 6 },
        moving: ['b'],
        dirty: true,
      }),
    );
    assert.equal(context.mode, 'comment');
    assert.equal(context.tool, 'note');
    assert.deepEqual(context.editing, { id: 'a', kind: 'label' });
    assert.deepEqual(context.pin, { x: 5, y: 6 });
    assert.deepEqual(context.moving, ['b']);
    assert.equal(context.dirty, true);
  });

  it('reports a table cell being edited with its row and column', () => {
    const context = buildViewContext(input([note('a', 0, 0)], { editing: { kind: 'cell', id: 'a', row: 'r1', col: 'c2' } }));
    assert.deepEqual(context.editing, { id: 'a', kind: 'cell', row: 'r1', col: 'c2' });
  });

  it('does not report overlaps the viewer is making on purpose', () => {
    const elements = [note('a', 0, 0), shape('b', 0, 0)];
    assert.equal(buildViewContext(input(elements)).issues?.[0]?.kind, 'words_covered');
    assert.equal(buildViewContext(input(elements, { moving: ['b'] })).issues, undefined);
  });
});

describe('fitViewContext', () => {
  it('drops labels first, then most of the selection', () => {
    const big: BoardViewContext = {
      viewer: { id: 'u', name: 'U' },
      viewport: { x: 0, y: 0, w: 1, h: 1, zoom: 1 },
      claim: 'abcdefgh',
      selected: Array.from({ length: 20 }, (_, index) => `id${index}`),
      selection: [{ id: 'x', kind: 'note', label: 'y'.repeat(400) }],
    };
    const withoutLabels = fitViewContext(big, jsonBytes(big) - 100);
    assert.equal(withoutLabels.selection, undefined);
    assert.equal(withoutLabels.selected?.length, 20);
    const small = fitViewContext(big, jsonBytes({ ...big, selection: undefined, selected: big.selected?.slice(-MAX_CONTEXT_LABELS) }));
    assert.deepEqual(small.selected, ['id15', 'id16', 'id17', 'id18', 'id19']);
    assert.equal(fitViewContext(big), big);
  });
});

describe('findBoardIssues', () => {
  it('reports words covered by something drawn above them', () => {
    const { issues } = findBoardIssues({ elements: [note('a', 0, 0), shape('b', 50, 0)], view: VIEW });
    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0], { kind: 'words_covered', id: 'a', by: 'b', hidden: 0.5 });
  });

  it('ignores covers drawn below, pen drawings and items outside the view', () => {
    assert.equal(findBoardIssues({ elements: [shape('b', 50, 0), note('a', 0, 0)], view: VIEW }).issues.length, 0);
    assert.equal(findBoardIssues({ elements: [note('a', 0, 0), shape('b', 50, 0), stroke('s', 0, 0)], view: VIEW }).issues.length, 0);
    assert.equal(findBoardIssues({ elements: [note('a', 0, 0), shape('b', 50, 0)], view: { x: 5000, y: 5000, w: 10, h: 10 } }).issues.length, 0);
  });

  it('reports items sticking out of their section and tight padding', () => {
    const { issues } = findBoardIssues({ elements: [section('s', 0, 0, 400, 400), note('a', 340, 150, '')], view: VIEW });
    assert.deepEqual(issues[0], { kind: 'sticking_out', id: 'a', section: 's', by: 40 });

    const tight = findBoardIssues({ elements: [section('s', 0, 0, 400, 400), note('a', 4, 150, '')], view: VIEW });
    assert.deepEqual(tight.issues, [{ kind: 'padding', id: 's', side: 'left', gap: 4 }]);
  });

  it('reports the worst few and counts the rest', () => {
    const elements: BoardElement[] = [];
    for (let index = 0; index < MAX_REPORTED_ISSUES + 2; index += 1) elements.push(note(`n${index}`, index * 300, 0));
    for (let index = 0; index < MAX_REPORTED_ISSUES + 2; index += 1) elements.push(shape(`s${index}`, index * 300 + 10 * index, 0));
    const { issues, more } = findBoardIssues({ elements, view: VIEW });
    assert.equal(issues.length, MAX_REPORTED_ISSUES);
    assert.equal(more, 2);
    // Fully covered notes rank first.
    assert.equal(issues[0]?.kind === 'words_covered' && issues[0].hidden, 1);
  });

  it('measures overlapping covers once', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    assert.equal(coveredShare(box, [{ x: 0, y: 0, w: 50, h: 100 }, { x: 0, y: 0, w: 50, h: 100 }]), 0.5);
    assert.equal(coveredShare(box, []), 0);
  });
});
