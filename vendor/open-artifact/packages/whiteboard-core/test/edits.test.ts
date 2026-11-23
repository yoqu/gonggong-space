import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeElement } from '../src/normalize.ts';
import {
  appendElement,
  arrowNeedsEndsMessage,
  duplicateSelection,
  isPastedTable,
  keepEmbedStatesFrom,
  linkCardFromPaste,
  moveElements,
  newArrowEnds,
  nextNoteBeside,
  normalizeBoardContent,
  pasteElements,
  pastePlacementOffset,
  patchElement,
  recolorElements,
  removeElements,
  reorderElements,
  restampPastedStickers,
  restoreGeometryFrom,
  setArrowEnds,
  setArrowHeads,
  stepElementOrder,
  tableFromPaste,
  tidyUpSelection,
  DEFAULT_ARROW_LENGTH,
} from '../src/edits.ts';
import {
  alignSelection,
  applyMoveDrag,
  applyResizeDrag,
  captureRotationStart,
  collectMoveIds,
  findFreePasteOffset,
  rotatableSelection,
  rotateElements,
  rotationKeyStep,
  selectionChromeFor,
  ELEMENT_KIND_AFFORDANCES,
  topLevelSelectedIds,
  type TextResizeFitting,
} from '../src/selection.ts';
import type { ArrowElement, ContainerElement, ShapeElement, BoardContent, BoardElement, HtmlElement, NoteElement, StickerElement } from '../src/schema.ts';
import { FACE_STICKER_ART, MAX_BOARD_ELEMENTS } from '../src/schema.ts';

const note = (id: string, x: number, y: number, extra: Partial<NoteElement> = {}): NoteElement => ({
  type: 'note',
  id,
  x,
  y,
  w: 160,
  h: 160,
  color: 'yellow',
  text: '',
  tilt: 0,
  ...extra,
});

const arrow = (id: string, from: ArrowElement['from'], to: ArrowElement['to']): ArrowElement => ({ type: 'arrow', id, from, to, head: 'end', dash: false, color: 'ink' });

const ids = (content: BoardContent): string[] => content.elements.map((element) => element.id);

describe('basic edits', () => {
  it('normalizes the original author stamp on imported shapes', () => {
    const shape = normalizeElement({ type: 'shape', id: 's', kind: 'rect', x: 0, y: 0, w: 100, h: 100, by: 'agent', text: 'From an agent' });
    assert.ok(shape?.type === 'shape' && shape.by === 'agent');
  });

  it('keeps the same object when normalization changes nothing', () => {
    const content: BoardContent = { elements: [note('a', 0, 0)] };
    assert.equal(normalizeBoardContent(content), content);
  });

  it('appends within the element limit and keeps other content fields', () => {
    const timer = { durationMs: 60_000, endsAt: null };
    const content = { elements: [note('a', 0, 0)], timer } as BoardContent;
    const next = appendElement(content, note('b', 10, 10));
    assert.deepEqual(ids(next), ['a', 'b']);
    assert.equal(next.timer, timer);
    const full: BoardContent = { elements: Array.from({ length: MAX_BOARD_ELEMENTS }, (_, index) => note(`n${index}`, 0, 0)) };
    assert.equal(appendElement(full, note('x', 0, 0)), full);
  });

  it('removes attached arrows with their ends', () => {
    const content: BoardContent = { elements: [note('a', 0, 0), note('b', 300, 0), arrow('x', 'a', 'b'), arrow('y', [0, 0], [50, 50])] };
    assert.deepEqual(ids(removeElements(content, new Set(['a']))), ['b', 'y']);
  });

  it('patches, recolors and restores geometry', () => {
    const content: BoardContent = { elements: [note('a', 0, 0), note('b', 300, 0, { color: 'pink' })] };
    assert.equal(patchElement(content, 'missing', { x: 5 }), content);
    const moved = patchElement(content, 'a', { x: 40, type: 'shape' } as Partial<BoardElement>);
    assert.equal(moved.elements[0]!.type, 'note');
    assert.equal((moved.elements[0] as NoteElement).x, 40);
    assert.equal(recolorElements(content, ['a'], 'yellow'), null);
    const recolored = recolorElements(content, ['a', 'b'], 'green')!;
    assert.deepEqual(
      recolored.elements.map((element) => (element as NoteElement).color),
      ['green', 'green'],
    );
    const restored = restoreGeometryFrom(moved, content, ['a']);
    assert.equal((restored.elements[0] as NoteElement).x, 0);
  });

  it('keeps an embed’s saved state', () => {
    const embed = (state?: string): HtmlElement => ({ type: 'html', id: 'h', x: 0, y: 0, w: 100, h: 100, html: '<p>', ...(state ? { state } : {}) });
    const previous: BoardContent = { elements: [embed('{"n":2}')] };
    const content: BoardContent = { elements: [embed('{"n":1}')] };
    assert.equal((keepEmbedStatesFrom(content, previous).elements[0] as HtmlElement).state, '{"n":2}');
  });
});

describe('moving and arrows', () => {
  it('moves elements with the free ends of selected arrows', () => {
    const content: BoardContent = { elements: [note('a', 0, 0), arrow('x', 'a', [400, 0])] };
    const next = moveElements(content, new Set(['a', 'x']), 10, 5);
    assert.deepEqual([(next.elements[0] as NoteElement).x, (next.elements[0] as NoteElement).y], [10, 5]);
    assert.deepEqual((next.elements[1] as ArrowElement).to, [410, 5]);
    assert.equal(moveElements(content, new Set(['a']), 0, 0), content);
  });

  it('sets arrow ends and heads in stored field order', () => {
    const base = arrow('x', 'a', 'b');
    assert.equal(setArrowEnds(base, { to: { end: 'a' } }), undefined);
    const changed = setArrowEnds(base, { to: { end: 'c', side: 'left' } })!;
    assert.deepEqual(Object.keys(changed), ['type', 'id', 'from', 'to', 'toSide', 'head', 'dash', 'color']);
    const heads = setArrowHeads(base, ['arrow', 'none']);
    assert.equal(heads.head, 'both');
    assert.deepEqual(heads.heads, ['arrow', 'none']);
  });

  it('makes a default-length arrow from a tool click', () => {
    assert.deepEqual(newArrowEnds({ start: { x: 10, y: 20 }, from: { end: [10, 20] }, byTool: true }), {
      from: [10, 20],
      to: [10 + DEFAULT_ARROW_LENGTH, 20],
    });
    assert.equal(newArrowEnds({ start: { x: 0, y: 0 }, from: { end: 'a' }, drop: { end: 'a' } }), undefined);
  });

  it('tidies a selection into a grid and drops note tilt', () => {
    const content: BoardContent = { elements: [note('a', 0, 0, { tilt: 3 }), note('b', 500, 333), note('c', 41, 900)] };
    const result = tidyUpSelection(content, new Set(['a', 'b', 'c']))!;
    assert.ok(result.scope.has('a'));
    assert.equal((result.after.elements[0] as NoteElement).tilt, 0);
  });
});

describe('copies', () => {
  it('duplicates with arrows between copies and fresh groups', () => {
    const content: BoardContent = {
      elements: [note('a', 0, 0, { groups: ['g1'] }), note('b', 300, 0, { groups: ['g1'] }), arrow('x', 'a', 'b')],
    };
    const { content: next, newIds } = duplicateSelection(content, new Set(['a', 'b', 'x']));
    assert.equal(newIds.length, 3);
    const copies = next.elements.slice(3);
    const copiedArrow = copies.find((element): element is ArrowElement => element.type === 'arrow')!;
    assert.deepEqual([copiedArrow.from, copiedArrow.to], [newIds[0], newIds[1]]);
    assert.equal((copies[0] as NoteElement).x, 24);
    const group = copies[0]!.groups?.[0];
    assert.ok(group !== undefined && group !== 'g1');
    assert.equal(copies[1]!.groups?.[0], group);
  });

  it('pastes elements offset, skipping arrows whose ends were not pasted', () => {
    const content: BoardContent = { elements: [] };
    const { content: next, newIds } = pasteElements(content, [note('a', 0, 0), arrow('x', 'a', 'missing')], 5, 5);
    assert.equal(newIds.length, 1);
    assert.equal((next.elements[0] as NoteElement).x, 5);
  });

  it('restamps pasted stickers and drops copied votes', () => {
    const host = note('n', 0, 0);
    const vote: StickerElement = { type: 'sticker', id: 'v', x: 10, y: 10, w: 48, h: 48, glyph: '🙂', art: FACE_STICKER_ART, authorId: 'u1' };
    const loose: StickerElement = { type: 'sticker', id: 's', x: 900, y: 900, w: 48, h: 48, glyph: '👍', authorId: 'u1' };
    const result = restampPastedStickers([host, vote, loose], 'me');
    assert.deepEqual(
      result.map((element) => element.id),
      ['n', 's'],
    );
    assert.equal((result[1] as StickerElement).authorId, 'me');
  });

  it('starts the next note beside the last one in the author’s color', () => {
    const next = nextNoteBeside(note('a', 0, 0, { text: 'hello', author: 'Old' }), { id: 'person', name: 'Pat' }, -2);
    assert.equal(next.x, 184);
    assert.equal(next.text, '');
    assert.equal(next.author, 'Pat');
    assert.equal(next.tilt, -2);
    assert.notEqual(next.id, 'a');
  });
});

describe('order and paste placement', () => {
  it('reorders and steps through layers', () => {
    const content: BoardContent = { elements: [note('a', 0, 0), note('b', 0, 0), note('c', 0, 0)] };
    assert.deepEqual(ids(reorderElements(content, new Set(['a']), 'front')), ['b', 'c', 'a']);
    assert.equal(reorderElements(content, new Set(['c']), 'front'), content);
    assert.deepEqual(ids(reorderElements(content, new Set(['c']), { under: 'b' })), ['a', 'c', 'b']);
    assert.deepEqual(ids(stepElementOrder(content, new Set(['a']), 'forward')), ['b', 'a', 'c']);
  });

  it('centers a paste and steps past existing elements', () => {
    const pasted = [note('a', 0, 0)];
    const offset = pastePlacementOffset(pasted, [], { x: 80, y: 80 }, 24);
    assert.deepEqual(offset, { dx: 0, dy: 0 });
    const stepped = pastePlacementOffset(pasted, [note('b', 0, 0)], { x: 80, y: 80 }, 24);
    assert.deepEqual(stepped, { dx: 24, dy: 24 });
  });

  it('turns pasted tab-separated rows into a table', () => {
    assert.equal(isPastedTable('a\tb'), false);
    const result = tableFromPaste('Name\tScore\n*Ann*\t3', [], { x: 0, y: 0 }, 24);
    assert.ok(typeof result === 'object');
    assert.equal(result.cut, false);
    assert.equal(result.el.type, 'table');
    assert.ok(JSON.stringify(result.el.rows).includes('\\\\*Ann\\\\*'));
    assert.equal(arrowNeedsEndsMessage('copy'), 'To copy an arrow, select what it is attached to as well.');
  });

  it('makes a link card only for Open Artifact addresses', () => {
    const center = { x: 0, y: 0 };
    const href = 'open-artifact://artifact/art_abc1234567';
    const card = linkCardFromPaste(`  ${href}\n`, [], center, 24);
    assert.equal(card?.type, 'link');
    assert.equal(card?.href, href);

  });
});

describe('selection', () => {
  const section = (id: string, x: number, y: number, w: number, h: number): ContainerElement => ({ type: 'container', id, x, y, w, h, color: 'white', text: '' });
  const shape = (id: string, x: number, y: number): ShapeElement => ({ type: 'shape', id, kind: 'rect', x, y, w: 200, h: 100, color: 'blue', text: '' });

  it('moves a section with its content and the arrows held inside', () => {
    const elements: BoardElement[] = [section('sec', 0, 0, 800, 600), note('a', 50, 50), note('b', 300, 50), arrow('x', 'a', 'b'), note('out', 1000, 0)];
    assert.deepEqual([...collectMoveIds(elements, new Set(['sec']))].sort(), ['a', 'b', 'sec', 'x']);
  });

  it('drops a sticker riding on a selected host from the top level', () => {
    const vote: StickerElement = { type: 'sticker', id: 'k', x: 20, y: 20, w: 48, h: 48, glyph: '👍', on: ['a', 0, 0, 20, 20] };
    const elements: BoardElement[] = [note('a', 0, 0), vote];
    assert.deepEqual([...topLevelSelectedIds(elements, new Set(['a', 'k']))], ['a']);
  });

  it('aligns units to the left edge and straightens a tilted note', () => {
    const content: BoardContent = { elements: [note('a', 0, 0), note('b', 300, 200, { tilt: 2 })] };
    const result = alignSelection(content, new Set(['a', 'b']), 'left')!;
    const moved = result.after.elements[1] as NoteElement;
    assert.equal(moved.x, 0);
    assert.equal(moved.tilt, 0);
    assert.equal(alignSelection(content, new Set(['a']), 'left'), undefined);
  });

  it('steps a pasted section clear of an existing one', () => {
    const existing = [section('old', 0, 0, 400, 300)];
    const offset = findFreePasteOffset([section('new', 100, 100, 400, 300)], existing, { dx: 0, dy: 0 }, 24);
    assert.ok(offset.dx > 0 || offset.dy > 0);
    assert.deepEqual(findFreePasteOffset([note('n', 0, 0)], existing, { dx: 5, dy: 5 }, 24), { dx: 5, dy: 5 });
  });

  it('rotates around the pivot and keeps upright types upright', () => {
    const elements: BoardElement[] = [shape('s1', 0, 0), shape('s2', 400, 0), section('sec', 0, 400, 300, 200)];
    const picked = rotatableSelection(elements, new Set(['s1', 's2', 'sec']));
    assert.deepEqual(picked.upright, ['container']);
    const start = captureRotationStart(picked.items, elements);
    assert.deepEqual(start.pivot, { x: 300, y: 50 });
    const turned = rotateElements(elements, start, 180);
    const first = turned[0] as ShapeElement;
    assert.deepEqual([first.x, first.y, first.turn], [400, 0, 180]);
    assert.equal(turned[2], elements[2]);
    assert.equal(rotationKeyStep({ key: 'ArrowLeft', altKey: true, metaKey: false, ctrlKey: false, shiftKey: false }), -15);
    assert.equal(rotationKeyStep({ key: 'ArrowLeft', altKey: false, metaKey: false, ctrlKey: false, shiftKey: false }), undefined);
  });

  it('applies move and resize drags', () => {
    const content: BoardContent = { elements: [shape('s', 0, 0), arrow('x', 's', [400, 0])] };
    const moved = applyMoveDrag(content, { dx: 10, dy: 20, origins: new Map([['s', { x: 0, y: 0 }]]), freeEnds: new Map([['x', { to: [400, 0] }]]) });
    assert.deepEqual([(moved.elements[0] as ShapeElement).x, (moved.elements[1] as ArrowElement).to], [10, [410, 20]]);
    const fitting: TextResizeFitting = { fitTextToWidth: (element) => element, minResizeSizeForText: (_element, _frame, w, h) => ({ w, h }) };
    const box = { x: 0, y: 0, w: 200, h: 100 };
    const resized = applyResizeDrag(content.elements, { before: content, members: new Map([['s', box]]), start: box, edge: { x: 'right', y: 'bottom' }, freeEnds: new Map() }, { x: 0, y: 0, w: 400, h: 50 }, fitting);
    assert.deepEqual([(resized[0] as ShapeElement).w, (resized[0] as ShapeElement).h], [400, 50]);
  });

  it('picks selection chrome by state and tool', () => {
    assert.deepEqual(selectionChromeFor('note', 'selected', { tool: 'select' }), { outline: 'full', dots: 'adds, connects', bar: true });
    assert.deepEqual(selectionChromeFor('arrow', 'selected', { tool: 'arrow' }), { outline: 'none', dots: 'none', bar: true });
    assert.equal(selectionChromeFor('image', 'typing', { tool: 'select' }).bar, false);
    assert.equal(selectionChromeFor('text', 'typing', { tool: 'select', empty: true }).dots, 'none');
  });

  it('gives side dots to notes and shapes only', () => {
    const withDots = (Object.keys(ELEMENT_KIND_AFFORDANCES) as (keyof typeof ELEMENT_KIND_AFFORDANCES)[]).filter((kind) => ELEMENT_KIND_AFFORDANCES[kind].dots !== 'none');
    assert.deepEqual(withDots.sort(), ['note', 'shape']);
    assert.equal(selectionChromeFor('text', 'typing', { tool: 'arrow' }).dots, 'none');
    assert.equal(selectionChromeFor('table', 'selected', { tool: 'select' }).dots, 'none');
  });
});
