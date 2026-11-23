/**
 * Board shortcuts: the pure readers behind `installKeyboard` (undo, group,
 * lock, duplicate, select all, the context menu key, comment mode, turning,
 * nudging, zoom), walking the reading order, and what Enter edits.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement, TableElement } from '@open-artifact/whiteboard-core';
import {
  arrowKeyDirection,
  editTargetFor,
  fieldTakesUndo,
  groupingKeyCommand,
  isCommentModeShortcut,
  isContextMenuKey,
  isDuplicateShortcut,
  isLockShortcut,
  isSelectAllShortcut,
  nextInReadingOrder,
  nudgeOffset,
  rotationKeyStep,
  undoKeyCommand,
  zoomKeyCommand,
  type FieldFacts,
  type KeyPress,
} from '../src/services/keyboard.ts';

/** A key press with no modifiers unless given. */
function press(key: string, options: Partial<KeyPress> = {}): KeyPress {
  const code = /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^[0-9]$/.test(key) ? 'Digit' + key : key;
  return { key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...options };
}

describe('undo and redo keys', () => {
  it('reads ⌘Z as undo and ⇧⌘Z, ⌘Y and Ctrl+Y as redo', () => {
    assert.equal(undoKeyCommand(press('z', { metaKey: true })), 'undo');
    assert.equal(undoKeyCommand(press('z', { ctrlKey: true })), 'undo');
    assert.equal(undoKeyCommand(press('Z', { metaKey: true, shiftKey: true })), 'redo');
    assert.equal(undoKeyCommand(press('y', { metaKey: true })), 'redo');
    assert.equal(undoKeyCommand(press('y', { ctrlKey: true })), 'redo');
  });

  it('ignores the letters alone, with ⌥, and ⇧⌘Y', () => {
    assert.equal(undoKeyCommand(press('z')), undefined);
    assert.equal(undoKeyCommand(press('z', { metaKey: true, altKey: true })), undefined);
    assert.equal(undoKeyCommand(press('Y', { metaKey: true, shiftKey: true })), undefined);
  });

  it('reads the physical key on other keyboard layouts', () => {
    assert.equal(undoKeyCommand({ ...press('я', { metaKey: true }), code: 'KeyZ' }), 'undo');
  });
});

describe('undo from a focused field', () => {
  const field = (facts: Partial<FieldFacts>): FieldFacts => ({ tag: 'input', type: '', role: null, editable: false, committed: false, ...facts });

  it('is held back in text fields, text areas, selects and editable text', () => {
    assert.equal(fieldTakesUndo(field({})), false);
    assert.equal(fieldTakesUndo(field({ type: 'search' })), false);
    assert.equal(fieldTakesUndo(field({ tag: 'textarea' })), false);
    assert.equal(fieldTakesUndo(field({ tag: 'select' })), false);
    assert.equal(fieldTakesUndo(field({ tag: 'div', editable: true })), false);
  });

  it('reaches the board from a number field only once its value is committed', () => {
    assert.equal(fieldTakesUndo(field({ type: 'number' })), false);
    assert.equal(fieldTakesUndo(field({ type: 'number', committed: true })), true);
    assert.equal(fieldTakesUndo(field({ role: 'spinbutton', committed: true })), true);
    assert.equal(fieldTakesUndo(field({ role: 'spinbutton' })), false);
  });

  it('reaches the board from checkboxes, sliders and buttons', () => {
    assert.equal(fieldTakesUndo(field({ type: 'checkbox' })), true);
    assert.equal(fieldTakesUndo(field({ type: 'range' })), true);
    assert.equal(fieldTakesUndo(field({ tag: 'button' })), true);
  });
});

describe('command shortcuts', () => {
  it('groups with ⌘G and ungroups with ⇧⌘G', () => {
    assert.equal(groupingKeyCommand(press('g', { metaKey: true })), 'group');
    assert.equal(groupingKeyCommand(press('G', { ctrlKey: true, shiftKey: true })), 'ungroup');
    assert.equal(groupingKeyCommand(press('g')), undefined);
    assert.equal(groupingKeyCommand(press('g', { metaKey: true, altKey: true })), undefined);
  });

  it('locks with ⇧⌘L only', () => {
    assert.equal(isLockShortcut(press('L', { metaKey: true, shiftKey: true })), true);
    assert.equal(isLockShortcut(press('l', { metaKey: true })), false);
    assert.equal(isLockShortcut(press('L', { metaKey: true, shiftKey: true, altKey: true })), false);
  });

  it('duplicates with ⌘D and selects all with ⌘A', () => {
    assert.equal(isDuplicateShortcut(press('d', { metaKey: true })), true);
    assert.equal(isDuplicateShortcut(press('D', { metaKey: true, shiftKey: true })), false);
    assert.equal(isSelectAllShortcut(press('a', { ctrlKey: true })), true);
    assert.equal(isSelectAllShortcut(press('a')), false);
  });

  it('opens the context menu with the Menu key and ⇧F10', () => {
    assert.equal(isContextMenuKey(press('ContextMenu')), true);
    assert.equal(isContextMenuKey(press('F10', { shiftKey: true })), true);
    assert.equal(isContextMenuKey(press('F10')), false);
  });

  it('toggles comment mode with C only while single keys are on', () => {
    assert.equal(isCommentModeShortcut(press('c'), true), true);
    assert.equal(isCommentModeShortcut(press('c'), false), false);
    assert.equal(isCommentModeShortcut(press('c', { metaKey: true }), true), false);
    assert.equal(isCommentModeShortcut(press('C', { shiftKey: true }), true), false);
  });
});

describe('turning and nudging', () => {
  it('turns by 15° with ⌥ and 1° with ⇧⌥', () => {
    assert.equal(rotationKeyStep(press('ArrowRight', { altKey: true })), 15);
    assert.equal(rotationKeyStep(press('ArrowLeft', { altKey: true })), -15);
    assert.equal(rotationKeyStep(press('ArrowLeft', { altKey: true, shiftKey: true })), -1);
    assert.equal(rotationKeyStep(press('ArrowUp', { altKey: true })), undefined);
    assert.equal(rotationKeyStep(press('ArrowRight')), undefined);
    assert.equal(rotationKeyStep(press('ArrowRight', { altKey: true, metaKey: true })), undefined);
  });

  it('knows the arrow keys', () => {
    assert.deepEqual(arrowKeyDirection('ArrowUp'), [0, -1]);
    assert.deepEqual(arrowKeyDirection('ArrowDown'), [0, 1]);
    assert.equal(arrowKeyDirection('Enter'), undefined);
  });

  it('nudges by 1, or 10 with ⇧, and not with modifiers', () => {
    assert.deepEqual(nudgeOffset(press('ArrowLeft')), { dx: -1, dy: 0 });
    assert.deepEqual(nudgeOffset(press('ArrowDown', { shiftKey: true })), { dx: 0, dy: 10 });
    assert.equal(nudgeOffset(press('ArrowDown', { metaKey: true })), undefined);
    assert.equal(nudgeOffset(press('ArrowDown', { altKey: true })), undefined);
    assert.equal(nudgeOffset(press('x')), undefined);
  });
});

describe('zoom keys', () => {
  it('fits with ⌘0 and steps with ⌘= / ⌘+ / ⌘-', () => {
    assert.equal(zoomKeyCommand(press('0', { metaKey: true }), false), 'fit');
    assert.equal(zoomKeyCommand({ ...press('=', { metaKey: true }), code: 'Equal' }, false), 'in');
    assert.equal(zoomKeyCommand({ ...press('+', { ctrlKey: true, shiftKey: true }), code: 'Equal' }, false), 'in');
    assert.equal(zoomKeyCommand({ ...press('-', { metaKey: true }), code: 'Minus' }, false), 'out');
    assert.equal(zoomKeyCommand({ ...press('=', { metaKey: true, altKey: true }), code: 'Equal' }, false), undefined);
    const altGraph = (key: string) => key === 'AltGraph';
    assert.equal(zoomKeyCommand({ ...press('+', { ctrlKey: true }), code: 'Equal', getModifierState: altGraph }, false), undefined);
    assert.equal(zoomKeyCommand({ ...press('!', { shiftKey: true }), code: 'Digit1', getModifierState: altGraph }, true), undefined);
  });

  it('reads ⇧0 / ⇧1 / ⇧2 only while single keys are on', () => {
    assert.equal(zoomKeyCommand({ ...press(')', { shiftKey: true }), code: 'Digit0' }, true), 'actual');
    assert.equal(zoomKeyCommand({ ...press('!', { shiftKey: true }), code: 'Digit1' }, true), 'board');
    assert.equal(zoomKeyCommand({ ...press('@', { shiftKey: true }), code: 'Digit2' }, true), 'selection');
    assert.equal(zoomKeyCommand({ ...press('!', { shiftKey: true }), code: 'Digit1' }, false), undefined);
  });
});

describe('walking the reading order', () => {
  const order = ['a', 'b', 'c'];

  it('starts at either end when nothing in the order is selected', () => {
    assert.equal(nextInReadingOrder(order, [], false), 'a');
    assert.equal(nextInReadingOrder(order, ['gone'], true), 'c');
    assert.equal(nextInReadingOrder([], [], false), undefined);
  });

  it('steps from the selected item furthest along the way', () => {
    assert.equal(nextInReadingOrder(order, ['a'], false), 'b');
    assert.equal(nextInReadingOrder(order, ['a', 'b'], false), 'c');
    assert.equal(nextInReadingOrder(order, ['c', 'b'], true), 'a');
  });

  it('runs out past either end, so focus can leave the board', () => {
    assert.equal(nextInReadingOrder(order, ['c'], false), undefined);
    assert.equal(nextInReadingOrder(order, ['a'], true), undefined);
  });
});

describe('what Enter edits', () => {
  it('edits the words of notes, shapes, texts and sections', () => {
    const note: BoardElement = { type: 'note', id: 'n1', x: 0, y: 0, w: 200, h: 200, color: 'yellow', text: '', tilt: 0 };
    assert.deepEqual(editTargetFor(note), { kind: 'element', id: 'n1' });
  });

  it("edits an arrow's label", () => {
    const arrow: BoardElement = { type: 'arrow', id: 'a1', from: [0, 0], to: [100, 0], head: 'end', dash: false, color: 'ink' };
    assert.deepEqual(editTargetFor(arrow), { kind: 'arrow-label', id: 'a1' });
  });

  it("edits a table's first cell", () => {
    const table: TableElement = {
      type: 'table',
      id: 't1',
      x: 0,
      y: 0,
      cols: { c2: { at: 2 }, c1: { at: 1 } },
      rows: { r2: { at: 2 }, r1: { at: 1, c1: 'Name' } },
      head: true,
      color: 'blue',
    };
    assert.deepEqual(editTargetFor(table), { kind: 'cell', id: 't1', row: 'r1', col: 'c1' });
  });

  it('has nothing to edit on strokes and stickers', () => {
    const stroke: BoardElement = { type: 'stroke', id: 's1', x: 0, y: 0, points: [0, 0, 10, 10], color: 'ink', width: 2 };
    const sticker: BoardElement = { type: 'sticker', id: 'k1', x: 0, y: 0, w: 48, h: 48, glyph: '👍' };
    assert.equal(editTargetFor(stroke), undefined);
    assert.equal(editTargetFor(sticker), undefined);
  });
});
