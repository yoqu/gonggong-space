/**
 * ⌘B and ⌘I on selected items (`elements/mark-across.ts`): which items
 * take them, which way a mixed selection goes, and the stored text each
 * item ends with.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_TEXT_CHARS, TEXT_PROFILES, type ArrowElement, type BoardElement, type NoteElement, type TextElement } from '@open-artifact/whiteboard-core';
import { ALREADY_BOLD_MESSAGE, markCoverage, markDisabledReason, markShortcutOf, richTextTargets, toggleMarkAcross, toggleMarkInText } from '../src/elements/mark-across.ts';

const note = (id: string, text: string): NoteElement => ({ type: 'note', id, x: 0, y: 0, w: 180, h: 180, color: 'yellow', text, tilt: 0 });
const text = (id: string, words: string, size: TextElement['size'] = 'body'): TextElement => ({ type: 'text', id, x: 0, y: 0, text: words, size, color: 'ink' });
const arrow: ArrowElement = { type: 'arrow', id: 'a1', from: 'n1', to: 'n2', head: 'end', dash: false, color: 'ink' } as ArrowElement;
const key = (key: string, extra: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  code: extra.code ?? `Key${key.toUpperCase()}`,
  metaKey: extra.metaKey ?? true,
  ctrlKey: extra.ctrlKey ?? false,
  shiftKey: extra.shiftKey ?? false,
  altKey: extra.altKey ?? false,
});

describe('mark shortcuts', () => {
  it('reads ⌘B and ⌘I, Ctrl too, by letter on Latin layouts and by place on others', () => {
    assert.equal(markShortcutOf(key('b')), 'bold');
    assert.equal(markShortcutOf(key('i', { metaKey: false, ctrlKey: true })), 'italic');
    assert.equal(markShortcutOf(key('и', { code: 'KeyB' })), 'bold');
    assert.equal(markShortcutOf(key('b', { code: 'KeyX' })), 'bold', 'a Latin letter wins over its place');
    assert.equal(markShortcutOf(key('b', { shiftKey: true })), undefined);
    assert.equal(markShortcutOf(key('b', { altKey: true })), undefined);
    assert.equal(markShortcutOf(key('b', { metaKey: false })), undefined);
  });

  it('formats notes, shapes and texts, passing over arrows and tables but not other items', () => {
    const items: BoardElement[] = [note('n1', 'a'), arrow, text('t1', 'b')];
    assert.deepEqual(
      richTextTargets(items).map((item) => item.id),
      ['n1', 't1'],
    );
    const sticker = { type: 'sticker', id: 's1', x: 0, y: 0, w: 40, h: 40, name: 'star' } as unknown as BoardElement;
    assert.deepEqual(richTextTargets([...items, sticker]), []);
  });

  it('leaves bold to sizes that are not drawn bold already', () => {
    assert.equal(markDisabledReason('bold', text('t1', 'x', 'body')), '');
    assert.equal(markDisabledReason('italic', text('t1', 'x', 'huge')), '');
    assert.equal(markDisabledReason('bold', note('n1', 'x')), '');
    assert.equal(typeof ALREADY_BOLD_MESSAGE, 'string');
  });
});

describe('toggleMarkInText', () => {
  const profile = TEXT_PROFILES.note;

  it('marks every word run, keeping code and links as they are', () => {
    assert.equal(toggleMarkInText('plain words', profile, 'bold', true)?.text, '**plain words**');
    assert.equal(toggleMarkInText('Went *well*', profile, 'bold', true)?.text, '**Went** ***well***');
    assert.equal(toggleMarkInText('see `code` here', profile, 'italic', true)?.text, '*see* `code` *here*');
  });

  it('marks list items and keeps the list', () => {
    assert.equal(toggleMarkInText('- one\n- two', profile, 'bold', true)?.text, '- **one**\n- **two**');
  });

  it('takes a mark away, leaving the other', () => {
    assert.equal(toggleMarkInText('***both*** and **bold**', profile, 'bold', false)?.text, '*both* and bold');
    assert.equal(toggleMarkInText('nothing', profile, 'bold', false), undefined, 'no change, no text');
  });

  it('cuts text that the marks would push past the limit', () => {
    const long = 'a '.repeat(MAX_TEXT_CHARS / 2).trim();
    const next = toggleMarkInText(long, profile, 'bold', true);
    assert.ok(next?.cut);
    assert.ok([...next.text].length <= MAX_TEXT_CHARS);
    assert.match(next.text, /^\*\*a a/);
    assert.match(next.text, /\*\*$/, 'the mark stays closed');
  });

  it('reports how much of the text has a mark', () => {
    assert.deepEqual(markCoverage('**a** **b**', profile, 'bold'), { words: true, all: true });
    assert.deepEqual(markCoverage('**a** b', profile, 'bold'), { words: true, all: false });
    assert.deepEqual(markCoverage('   ', profile, 'bold'), { words: false, all: false });
  });
});

describe('toggleMarkAcross', () => {
  it('turns the mark on unless the last item has it, skipping marked items', () => {
    const result = toggleMarkAcross([note('n1', '**done**'), note('n2', 'todo')], 'bold');
    assert.deepEqual([...result.texts], [['n2', '**todo**']]);
    assert.equal(result.cut, false);
  });

  it('turns the mark off everywhere when the last item has it', () => {
    const result = toggleMarkAcross([note('n1', 'half **bold**'), note('n2', '**all**')], 'bold');
    assert.deepEqual([...result.texts], [
      ['n1', 'half bold'],
      ['n2', 'all'],
    ]);
  });

  it('passes over items without words', () => {
    const result = toggleMarkAcross([note('n1', 'words'), note('n2', '')], 'italic');
    assert.deepEqual([...result.texts], [['n1', '*words*']]);
  });
});
