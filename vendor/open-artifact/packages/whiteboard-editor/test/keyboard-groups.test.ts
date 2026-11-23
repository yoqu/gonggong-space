/**
 * Group keys: ⇧Enter selects the group around the item, Enter on a group
 * selected as a whole steps into it, and what Enter or F2 then does to the
 * item (`keyboard.ts`'s `itemKeyAction`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement, NoteElement } from '@open-artifact/whiteboard-core';
import { groupKeyStep, type GroupKey } from '../src/services/group-keys.ts';
import { itemKeyAction } from '../src/services/keyboard.ts';

/** A note in `groups` (innermost first). */
function note(id: string, groups?: string[]): NoteElement {
  return { type: 'note', id, x: 0, y: 0, w: 100, h: 100, color: 'yellow', text: '', tilt: 0, ...(groups ? { groups } : {}) };
}

/** Enter (or F2), plain unless given. */
function key(options: Partial<GroupKey> = {}): GroupKey {
  return { enter: true, shift: false, repeat: false, acts: true, ...options };
}

/** n1 and n2 in inner group g1, inside outer group g2 with n3; n4 loose. */
const board: BoardElement[] = [note('n1', ['g1', 'g2']), note('n2', ['g1', 'g2']), note('n3', ['g2']), note('n4')];

/** The selected ids of a step, sorted. */
function picked(step: ReturnType<typeof groupKeyStep>): string[] | undefined {
  return step !== undefined && 'select' in step ? [...step.select].sort() : undefined;
}

describe('⇧Enter', () => {
  it('selects the group around an item, then the group around that', () => {
    const inner = groupKeyStep(board, ['n1'], key({ shift: true }));
    assert.deepEqual(picked(inner), ['n1', 'n2']);
    assert.ok(inner?.done && 'announce' in inner && inner.announce === 'group');
    const outer = groupKeyStep(board, ['n1', 'n2'], key({ shift: true }));
    assert.deepEqual(picked(outer), ['n1', 'n2', 'n3']);
  });

  it('takes the key and does nothing at the outermost group, or while it repeats', () => {
    assert.deepEqual(groupKeyStep(board, ['n1', 'n2', 'n3'], key({ shift: true })), { done: true });
    assert.deepEqual(groupKeyStep(board, ['n1', 'n2'], key({ shift: true, repeat: true })), { done: true });
  });

  it('leaves a loose item to the key', () => {
    assert.equal(groupKeyStep(board, ['n4'], key({ shift: true })), undefined);
  });
});

describe('Enter on a group', () => {
  it('steps into a group selected as a whole: the next group down, then the item', () => {
    const first = groupKeyStep(board, ['n1', 'n2', 'n3'], key());
    assert.deepEqual(picked(first), ['n1', 'n2']);
    assert.ok(first?.done);
    const second = groupKeyStep(board, ['n1', 'n2'], key());
    assert.deepEqual(picked(second), ['n1']);
    // The item alone: the key goes on to act on it.
    assert.equal(second?.done, false);
  });

  it('stops at the item when Enter would do nothing to it', () => {
    const step = groupKeyStep(board, ['n1', 'n2'], key({ acts: false }));
    assert.deepEqual(picked(step), ['n1']);
    assert.ok(step?.done && 'announce' in step && step.announce === 'one');
    // F2 that would do nothing is left alone.
    assert.equal(groupKeyStep(board, ['n1', 'n2'], key({ enter: false, acts: false })), undefined);
  });

  it('keeps out of an item already entered, a loose item and a mixed selection', () => {
    assert.equal(groupKeyStep(board, ['n1'], key()), undefined);
    assert.equal(groupKeyStep(board, ['n4'], key()), undefined);
    assert.equal(groupKeyStep(board, ['n1', 'n2', 'n3', 'n4'], key()), undefined);
    assert.equal(groupKeyStep(board, [], key()), undefined);
  });
});

describe('what Enter or F2 does to an item', () => {
  it('opens link cards and edits words on an editable board', () => {
    const link: BoardElement = { type: 'link', id: 'l1', x: 0, y: 0, href: 'https://example.com' };
    assert.equal(itemKeyAction(link, true, false), 'open');
    assert.equal(itemKeyAction(note('n9'), false, true), 'edit');
    assert.equal(itemKeyAction(note('n9'), true, false), undefined);
    assert.equal(itemKeyAction({ ...note('n9'), locked: true }, true, true), undefined);
  });

  it('uses an embed on Enter (even read-only) and edits its HTML on F2', () => {
    const embed: BoardElement = { type: 'html', id: 'h1', x: 0, y: 0, w: 320, h: 240, html: '<p>Hi</p>' };
    assert.equal(itemKeyAction(embed, true, false), 'use');
    assert.equal(itemKeyAction(embed, false, true), 'edit');
    assert.equal(itemKeyAction(embed, false, false), undefined);
  });
});
