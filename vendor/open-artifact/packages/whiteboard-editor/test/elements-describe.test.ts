import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArrowElement, BoardElement, ContainerElement, NoteElement, TextElement } from '@open-artifact/whiteboard-core';
import {
  boardListItemProps,
  describeArrowEnd,
  describeElement,
  describeElementKind,
  editTextActionLabel,
  flattenSpokenText,
  formatItemCount,
  placeholderNeedsDescription,
  quoteSpokenText,
  whiteboardRegionLabel,
} from '../src/elements/describe.ts';

const note: NoteElement = { id: 'n1', type: 'note', x: 0, y: 0, w: 160, h: 160, color: 'yellow', text: 'Ship **it**', tilt: 0 };
const text: TextElement = { id: 't1', type: 'text', x: 0, y: 200, text: 'Heading', size: 'title', color: '#1f1e1d' };
const arrow: ArrowElement = { id: 'a1', type: 'arrow', from: 'n1', to: 't1', head: 'end', dash: false, color: '#1f1e1d', label: 'leads to' };
const section: ContainerElement = { id: 'c1', type: 'container', x: -20, y: -20, w: 400, h: 400, color: 'white', text: 'Q3' };
const byId = new Map<string, BoardElement>([note, text, arrow, section].map((element) => [element.id, element]));

describe('spoken text', () => {
  it('counts items', () => {
    assert.equal(formatItemCount(1), '1 item');
    assert.equal(formatItemCount(3), '3 items');
    assert.equal(whiteboardRegionLabel(0), 'Whiteboard, 0 items');
  });

  it('flattens and quotes text', () => {
    assert.equal(flattenSpokenText('a\n\n  b'), 'a b');
    assert.equal(quoteSpokenText('   '), undefined);
    assert.equal(quoteSpokenText('hello'), '“hello”');
    const long = quoteSpokenText('x'.repeat(60));
    assert.ok(long !== undefined && [...long].length <= 42 && long.endsWith('…”'));
  });
});

describe('describeElement', () => {
  it('names element kinds', () => {
    assert.equal(describeElementKind(note), 'yellow sticky note');
    assert.equal(describeElementKind(text), 'title text');
    assert.equal(describeElementKind(section), 'section');
  });

  it('describes notes with their text', () => {
    const spoken = describeElement(note, byId);
    assert.ok(spoken.startsWith('Yellow sticky note, “Ship'), spoken);
  });

  it('describes arrows by their ends and label', () => {
    assert.equal(describeArrowEnd('t1', byId), '“Heading”');
    assert.equal(describeArrowEnd('missing', byId), 'unknown');
    const spoken = describeElement(arrow, byId);
    assert.match(spoken, /^Arrow from .* to “Heading”, “leads to”$/);
  });

  it('describes sections with their title and item count', () => {
    assert.match(describeElement(section, byId), /^Section, “Q3”, \d+ items?$/);
  });

  it('labels text edit actions', () => {
    assert.equal(editTextActionLabel(note), 'Edit sticky note text');
    assert.equal(editTextActionLabel(section), 'Edit section title');
    assert.equal(editTextActionLabel(text), 'Edit text');
  });
});

describe('boardListItemProps', () => {
  it('adds the position when known', () => {
    assert.deepEqual(boardListItemProps('Note', 2, 5), { role: 'listitem', 'aria-label': 'Note, 2 of 5', 'aria-posinset': 2, 'aria-setsize': 5 });
    assert.deepEqual(boardListItemProps('Note'), { role: 'listitem', 'aria-label': 'Note' });
  });
});

describe('texts showing a placeholder', () => {
  it('are spoken as empty, with the hint quoted', () => {
    const hinted: TextElement = { ...text, text: ' ', size: 'large', placeholder: 'First idea' };
    assert.equal(describeElement(hinted, byId), 'Large text, empty, hint “First idea”');
    assert.equal(placeholderNeedsDescription('First idea'), false);
  });

  it('cut a long hint to 40 characters and give the whole of it as a description', () => {
    const long = 'Write the first thing that comes to mind about the launch';
    const spoken = describeElement({ ...text, text: '', size: 'body', placeholder: long }, byId);
    assert.match(spoken, /^Text, empty, hint “.{37}…”$/u);
    assert.equal(placeholderNeedsDescription(long), true);
  });
});
