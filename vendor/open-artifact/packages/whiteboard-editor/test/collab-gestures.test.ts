/**
 * Tests of live gestures: the wire format (splitting frames into parts,
 * reading them back defensively, putting parts together), when a closed
 * gesture's frame has landed on the board, how a peer's hand is drawn
 * (gliding between frames, this page's own gesture kept, settle glides)
 * and the sketches of a pen stroke or arrow being drawn.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArrowElement, BoardElement, NoteElement, ShapeElement } from '@open-artifact/whiteboard-core';
import {
  GESTURE_MAX_ELEMENTS,
  GESTURE_PART_BUDGET_BYTES,
  createGestureAssembler,
  encodeGestureFrame,
  frameLanded,
  nearlySame,
  readGestureFrame,
  readGestureMessage,
  splitByBytes,
  type GestureFrame,
} from '../src/collab/gesture-wire.ts';
import {
  PEER_EASED_MAX,
  PEER_GLIDE_MS,
  SETTLE_GLIDE_MAX,
  easeElement,
  glideStart,
  handGliding,
  handSketches,
  handsOverrides,
  sameOverrides,
  settleGlides,
  type PeerHand,
} from '../src/collab/peer-hands.ts';

const shape = (id: string, x: number, y: number): ShapeElement => ({ type: 'shape', id, kind: 'rect', x, y, w: 100, h: 60, color: 'blue' }) as ShapeElement;
const note = (id: string, x: number, y: number, text: string): NoteElement => ({ type: 'note', id, x, y, w: 160, h: 160, text, color: 'yellow' }) as NoteElement;
const arrow = (id: string, from: string, to: string): ArrowElement => ({ type: 'arrow', id, from, to, head: 'end' }) as ArrowElement;
const index = (elements: BoardElement[]) => new Map(elements.map((element) => [element.id, element]));

describe('splitByBytes', () => {
  it('keeps slices within the byte budget and never splits a surrogate pair', () => {
    const text = 'ab😀cd😀'.repeat(50);
    const slices = splitByBytes(text, 7);
    assert.equal(slices.join(''), text);
    for (const slice of slices) {
      assert.ok(new TextEncoder().encode(slice).length <= 7);
      assert.ok(!/[\ud800-\udbff]$/.test(slice), 'no slice ends inside a pair');
    }
  });

  it('returns one empty slice for empty text', () => {
    assert.deepEqual(splitByBytes('', 10), ['']);
  });
});

describe('gesture frames on the wire', () => {
  it('round-trips a frame through parts and the assembler', () => {
    const frame: GestureFrame = {
      elements: [note('n1', 10, 20, 'x'.repeat(GESTURE_PART_BUDGET_BYTES * 2)), shape('s1', 5, 5)],
      gone: ['old'],
      ink: { color: 'terracotta', width: 4, points: [0.04, 0.06, 10.25, 20.75] },
      draft: { from: [1.23, 4.56], to: [7.89, 0.12], color: 'blue' },
    };
    const parts = encodeGestureFrame(7, 1, frame);
    assert.ok(parts && parts.length >= 3);
    for (const part of parts) assert.ok(new TextEncoder().encode(part.d).length <= GESTURE_PART_BUDGET_BYTES);
    const assembler = createGestureAssembler();
    // Parts may arrive out of order.
    const heard = [...parts].reverse().map((part) => assembler.hear('peer', readGestureMessage(JSON.parse(JSON.stringify(part)))!));
    const whole = heard.at(-1);
    assert.equal(heard.slice(0, -1).every((value) => value === undefined), true);
    assert.equal(whole?.kind, 'frame');
    assert.ok(whole?.kind === 'frame');
    assert.deepEqual(
      whole.frame.elements.map((element) => element.id),
      ['n1', 's1'],
    );
    assert.deepEqual(whole.frame.gone, ['old']);
    assert.deepEqual(whole.frame.ink, { color: 'terracotta', width: 4, points: [0, 0.1, 10.3, 20.8] });
    assert.deepEqual(whole.frame.draft, { from: [1.2, 4.6], to: [7.9, 0.1], color: 'blue' });
  });

  it('does not send a frame with too many elements', () => {
    const elements = Array.from({ length: GESTURE_MAX_ELEMENTS + 1 }, (_, at) => shape(`s${at}`, at, 0));
    assert.equal(encodeGestureFrame(1, 1, { elements }), undefined);
  });

  it('ignores parts of an older frame and closes on the end message', () => {
    const assembler = createGestureAssembler();
    const second = encodeGestureFrame(3, 2, { elements: [shape('a', 20, 0)] })!;
    const first = encodeGestureFrame(3, 1, { elements: [shape('a', 10, 0)] })!;
    const heard = assembler.hear('p', second[0]!);
    assert.equal(heard?.kind, 'frame');
    assert.equal(assembler.hear('p', first[0]!), undefined);
    assert.deepEqual(assembler.hear('p', { n: 3, end: 1 }), { kind: 'end', n: 3 });
  });

  it('rejects malformed messages and frames', () => {
    assert.equal(readGestureMessage(null), undefined);
    assert.equal(readGestureMessage({ n: -1, end: 1 }), undefined);
    assert.equal(readGestureMessage({ n: 1, s: 1, i: 2, of: 2, d: '' }), undefined);
    assert.equal(readGestureMessage({ n: 1, s: 1, i: 0, of: 99, d: '' }), undefined);
    assert.equal(readGestureFrame('not json'), undefined);
    assert.equal(readGestureFrame('{"elements":{}}'), undefined);
    const frame = readGestureFrame(
      JSON.stringify({
        elements: [shape('ok', 0, 0), { type: 'nope' }],
        ink: { color: 'url(x)', width: 2, points: [0, 0] },
        draft: { from: [0, 0], to: [1e12, 0], color: 'blue' },
      }),
    );
    assert.deepEqual(
      frame?.elements.map((element) => element.id),
      ['ok'],
    );
    assert.equal(frame?.ink, undefined, 'an unknown ink color is dropped');
    assert.equal(frame?.draft, undefined, 'a point past the coordinate limit is dropped');
  });
});

describe('frameLanded', () => {
  it('matches within the tolerance and ignores key order', () => {
    assert.equal(nearlySame({ a: 1, b: [1, 2] }, { b: [1.5, 2], a: 1.4 }), true);
    assert.equal(nearlySame({ a: 1 }, { a: 3 }), false);
    assert.equal(nearlySame({ a: 1, b: undefined }, { a: 1 }), true);
  });

  it('lands when every element is stored as drawn and gone ones are gone', () => {
    const moved = shape('s', 200, 100);
    const frame: GestureFrame = { elements: [moved], gone: ['x'] };
    assert.equal(frameLanded(frame, index([shape('s', 0, 0), shape('x', 0, 0)])), false);
    assert.equal(frameLanded(frame, index([shape('s', 200.4, 100), shape('x', 0, 0)])), false);
    assert.equal(frameLanded(frame, index([shape('s', 200.4, 100)])), true);
  });
});

const hand = (peer: string, frame: GestureFrame, from: Map<string, BoardElement> = new Map(), glideAt = 0): PeerHand => ({ peer, n: 1, frame, heardAt: 0, from, glideAt });

describe('peer hands', () => {
  it('glides position and size toward the frame, other fields as framed', () => {
    const from = note('n', 0, 0, 'old');
    const to = { ...note('n', 100, 50, 'new'), w: 200 };
    assert.deepEqual(easeElement(from, to, 0.5), { ...to, x: 50, y: 25, w: 180 });
    assert.equal(easeElement(from, to, 1), to);
    assert.equal(easeElement(to, to, 0.5), to, 'nothing to ease keeps the frame element');
  });

  it('starts glides from where elements are drawn, never for arrows or big frames', () => {
    const drawn = index([shape('a', 0, 0), arrow('ab', 'a', 'b')]);
    const frame: GestureFrame = { elements: [shape('a', 10, 0), arrow('ab', 'a', 'c'), shape('new', 5, 5)] };
    assert.deepEqual([...glideStart(frame, (id) => drawn.get(id)).keys()], ['a']);
    const big: GestureFrame = { elements: Array.from({ length: PEER_EASED_MAX + 1 }, (_, i) => shape(`s${i}`, i, 0)) };
    assert.equal(glideStart(big, (id) => shape(id, -1, 0)).size, 0);
  });

  it('draws carried elements eased, hides gone ones and keeps this page\'s own', () => {
    const a = shape('a', 100, 0);
    const first = hand('p1', { elements: [a, shape('mine', 9, 9)], gone: ['x'] }, new Map([['a', shape('a', 0, 0)]]), 0);
    const overrides = handsOverrides([first], PEER_GLIDE_MS / 2, (id) => id === 'mine');
    assert.deepEqual([...overrides.keys()], ['a', 'x']);
    assert.equal((overrides.get('a') as ShapeElement).x, 50);
    assert.equal(overrides.get('x'), null);
    assert.equal(handsOverrides([first], PEER_GLIDE_MS, () => false).get('a'), a, 'the glide ends on the frame');
    const later = hand('p2', { elements: [shape('a', 300, 0)] });
    assert.equal((handsOverrides([first, later], PEER_GLIDE_MS, () => false).get('a') as ShapeElement).x, 300, 'a later hand wins');
    assert.equal(handGliding(first, PEER_GLIDE_MS / 2), true);
    assert.equal(handGliding(first, PEER_GLIDE_MS), false);
    assert.equal(sameOverrides(overrides, new Map(overrides)), true);
    assert.equal(sameOverrides(overrides, new Map([['a', a]])), false);
  });

  it('settles elements that moved without resizing, not arrows or held ones', () => {
    const before = index([shape('a', 0, 0), shape('b', 0, 0), shape('c', 0, 0), shape('held', 0, 0), arrow('ab', 'a', 'b'), shape('tiny', 0, 0)]);
    const after = index([shape('a', 40, -10), { ...shape('b', 40, 0), w: 300 }, shape('c', 0, 0), shape('held', 40, 0), arrow('ab', 'b', 'a'), shape('tiny', 0.4, 0)]);
    const glides = settleGlides(['a', 'b', 'c', 'held', 'ab', 'tiny', 'missing'], (id) => before.get(id), (id) => after.get(id), new Set(['held']));
    assert.deepEqual(glides, [{ id: 'a', dx: -40, dy: 10 }]);
    const many = Array.from({ length: SETTLE_GLIDE_MAX + 1 }, (_, i) => `m${i}`);
    assert.deepEqual(settleGlides(many, (id) => shape(id, 0, 0), (id) => shape(id, 50, 0), new Set()), [], 'too many jump without gliding');
  });

  it('sketches the pen stroke and the arrow being drawn', () => {
    const sketches = handSketches({ elements: [], ink: { color: 'terracotta', width: 3, points: [0, 0, 10, 10] }, draft: { from: [0, 0], to: [5, 5], color: 'blue' } });
    assert.deepEqual(
      sketches.map((item) => item.kind),
      ['ink', 'draft'],
    );
    assert.deepEqual(handSketches({ elements: [shape('a', 0, 0)] }), []);
  });
});
