import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capText, continueList, indentListLines, keyAction, keyChord, lineBounds, nextListMarker, parseListLine, setTextEditHost, textEditHost, toggleMark } from '../src/elements/edit.ts';

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('keyChord', () => {
  it('names keys the way text profiles do', () => {
    assert.equal(keyChord(press('Enter'), true), 'Return');
    assert.equal(keyChord(press('Enter', { shiftKey: true }), true), 'Shift+Return');
    assert.equal(keyChord(press('Enter', { metaKey: true }), true), 'Mod+Return');
    assert.equal(keyChord(press('b', { ctrlKey: true }), false), 'Mod+B');
    assert.equal(keyChord(press('ContextMenu'), false), 'Menu');
    assert.equal(keyChord(press('Tab', { altKey: true, shiftKey: true }), false), 'Alt+Shift+Tab');
  });

  it('uses ⌘ as Mod on Apple platforms and Ctrl elsewhere', () => {
    assert.equal(keyChord(press('b', { ctrlKey: true }), true), 'B');
    assert.equal(keyChord(press('b', { metaKey: true }), false), 'B');
  });
});

describe('list lines', () => {
  it('finds the line around an offset', () => {
    assert.deepEqual(lineBounds('ab\ncd\nef', 4), { start: 3, end: 5 });
    assert.deepEqual(lineBounds('ab', 0), { start: 0, end: 2 });
  });

  it('parses bullets and numbers', () => {
    assert.deepEqual(parseListLine('  - item'), { indent: '  ', marker: '- ', content: 'item' });
    assert.deepEqual(parseListLine('12. step'), { indent: '', marker: '12. ', content: 'step' });
    assert.equal(parseListLine('plain'), undefined);
    assert.equal(nextListMarker('3. '), '4. ');
    assert.equal(nextListMarker('- '), '- ');
  });

  it('continues a list on Return and ends it on an empty item', () => {
    assert.deepEqual(continueList({ text: '- a', start: 3, end: 3 }), { text: '- a\n- ', start: 6, end: 6 });
    assert.deepEqual(continueList({ text: '1. a', start: 4, end: 4 }), { text: '1. a\n2. ', start: 8, end: 8 });
    assert.deepEqual(continueList({ text: '- a\n- ', start: 6, end: 6 }), { text: '- a\n', start: 4, end: 4 });
    assert.equal(continueList({ text: 'plain', start: 5, end: 5 }), undefined);
    assert.equal(continueList({ text: '- a', start: 0, end: 3 }), undefined);
  });

  it('nests and un-nests the selected list lines', () => {
    assert.deepEqual(indentListLines({ text: '- a\n- b', start: 5, end: 5 }, false), { text: '- a\n  - b', start: 7, end: 7 });
    assert.deepEqual(indentListLines({ text: '- a\n  - b', start: 9, end: 9 }, true), { text: '- a\n- b', start: 7, end: 7 });
    assert.equal(indentListLines({ text: 'plain', start: 0, end: 0 }, false), undefined);
  });
});

describe('marks and caps', () => {
  it('wraps and unwraps the selection in a mark', () => {
    const bold = toggleMark({ text: 'a b c', start: 2, end: 3 }, '**');
    assert.deepEqual(bold, { text: 'a **b** c', start: 4, end: 5 });
    assert.deepEqual(toggleMark(bold, '**'), { text: 'a b c', start: 2, end: 3 });
  });

  it('caps text without splitting emoji', () => {
    assert.equal(capText('abc', 5), 'abc');
    assert.equal(capText('ab😀', 3), 'ab');
    assert.equal(capText('ab😀c', 4), 'ab😀');
  });
});

describe('text edit host', () => {
  it('installs and removes a host', () => {
    const host = { next: () => true };
    const remove = setTextEditHost(host);
    assert.equal(textEditHost(), host);
    remove();
    assert.deepEqual(textEditHost(), {});
  });

  it('maps chords to profile actions', () => {
    assert.equal(keyAction({ Return: 'line' }, 'Return'), 'line');
    assert.equal(keyAction({ Return: 'line' }, 'Tab'), undefined);
    assert.equal(keyAction(undefined, 'Tab'), undefined);
  });
});
