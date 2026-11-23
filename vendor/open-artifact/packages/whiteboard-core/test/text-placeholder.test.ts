import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elementLayoutBox, type ElementMeasures } from '../src/geometry.ts';
import { topElementAt } from '../src/hit-test.ts';
import type { BoardElement, ContainerElement, NoteElement, ShapeElement, TextElement } from '../src/schema.ts';
import { showsTextPlaceholder, textOrPlaceholder } from '../src/text/placeholder.ts';
import { planTextPush, textPushGrowth } from '../src/text/push-down.ts';
import { keepTurnedAnchor } from '../src/text/turned-anchor.ts';

function text(id: string, x: number, y: number, extra: Partial<TextElement> = {}): TextElement {
  return { type: 'text', id, x, y, text: 'Hello', size: 'body', color: 'ink', wrap: 200, ...extra };
}

function shape(id: string, x: number, y: number, extra: Partial<ShapeElement> = {}): ShapeElement {
  return { type: 'shape', id, kind: 'rect', color: 'white', text: '', x, y, w: 100, h: 60, ...extra };
}

function note(id: string, x: number, y: number, extra: Partial<NoteElement> = {}): NoteElement {
  return { type: 'note', id, x, y, w: 160, h: 160, color: 'yellow', text: '', tilt: 0, ...extra };
}

function section(id: string, x: number, y: number, w: number, h: number): ContainerElement {
  return { type: 'container', id, x, y, w, h, color: 'white', text: 'Area' };
}

const measured = (entries: Array<[string, number, number]>): ElementMeasures => new Map(entries.map(([id, w, h]) => [id, { w, h }]));

describe('text placeholders', () => {
  it('show only while the text is blank after trimming', () => {
    assert.equal(showsTextPlaceholder(text('t', 0, 0, { text: '', placeholder: 'First idea' })), true);
    assert.equal(showsTextPlaceholder(text('t', 0, 0, { text: '  \n ', placeholder: 'First idea' })), true);
    assert.equal(showsTextPlaceholder(text('t', 0, 0, { text: 'Hi', placeholder: 'First idea' })), false);
    assert.equal(showsTextPlaceholder(text('t', 0, 0, { text: '' })), false);
    assert.equal(showsTextPlaceholder(shape('s', 0, 0)), false);
  });

  it('lay out with the hint while the text is empty', () => {
    const hinted = text('t', 0, 0, { text: '', placeholder: 'A much longer hint than the text', wrap: undefined });
    assert.equal(textOrPlaceholder(hinted), 'A much longer hint than the text');
    const empty = elementLayoutBox({ ...hinted, placeholder: undefined } as TextElement)!;
    const withHint = elementLayoutBox(hinted)!;
    assert.ok(withHint.w > empty.w * 4);
  });

  it('are hit over at least 40 screen pixels, and only where nothing else is', () => {
    const hinted = text('t', 0, 0, { text: '', placeholder: 'Hint' });
    const measures = measured([['t', 200, 20]]);
    // 20 board units tall at zoom 1: the hit grows to 40 about its middle.
    assert.equal(topElementAt([hinted], 50, 28, 0, measures, undefined, 1)?.id, 't');
    assert.equal(topElementAt([hinted], 50, 34, 0, measures, undefined, 1), undefined);
    // At zoom 2 the 20 units are already 40 pixels.
    assert.equal(topElementAt([hinted], 50, 24, 0, measures, undefined, 2), undefined);
    // A shape under the hint wins even though the text is drawn above it.
    const below = shape('s', 40, 0, { w: 40, h: 40 });
    assert.equal(topElementAt([below, hinted], 50, 10, 0, measures, undefined, 1)?.id, 's');
    assert.equal(topElementAt([below, hinted], 10, 10, 0, measures, undefined, 1)?.id, 't');
  });
});

describe('push-down while a text grows', () => {
  const measures = measured([['t', 200, 40]]);

  it('pushes unlocked items below that overlap it, by the growth', () => {
    const elements: BoardElement[] = [
      text('t', 0, 0),
      shape('below', 50, 60),
      shape('far-below', 120, 400),
      shape('aside', 300, 60),
      shape('above', 0, -100),
      shape('locked', 0, 120, { locked: true }),
    ];
    const plan = planTextPush(elements, 't', measures)!;
    assert.equal(plan.bottom, 40);
    assert.deepEqual([...plan.ids].sort(), ['below', 'far-below']);
    assert.equal(textPushGrowth(plan, { x: 0, y: 0, w: 200, h: 40 }), 0);
    assert.equal(textPushGrowth(plan, { x: 0, y: 0, w: 200, h: 61 }), 21);
    assert.equal(textPushGrowth(plan, { x: 0, y: 0, w: 200, h: 20 }), 0);
  });

  it('stays within the text’s section and group', () => {
    const elements: BoardElement[] = [
      section('area', -20, -20, 300, 300),
      text('t', 0, 0),
      shape('inside', 0, 100),
      shape('outside', 0, 400),
      shape('grouped', 100, 100, { groups: ['g'] }),
      shape('grouped-2', 100, 200, { groups: ['g'] }),
    ];
    const plan = planTextPush(elements, 't', measures)!;
    assert.deepEqual([...plan.ids], ['inside']);
  });

  it('carries a pushed section’s content and a pushed host’s stickers', () => {
    const elements: BoardElement[] = [
      text('t', 0, 0),
      section('area', 0, 100, 300, 200),
      shape('in-area', 20, 150),
      note('host', 0, 400),
      { type: 'sticker', id: 'star', x: 40, y: 420, w: 40, h: 40, art: 'star' } as BoardElement,
    ];
    const plan = planTextPush(elements, 't', measures)!;
    assert.deepEqual([...plan.ids].sort(), ['area', 'host', 'in-area', 'star']);
    assert.equal(plan.frames.length, 1);
  });

  it('does not push for a turned text', () => {
    assert.equal(planTextPush([text('t', 0, 0, { turn: 30 }), shape('below', 0, 100)], 't', measures), undefined);
  });
});

describe('turned anchor corners', () => {
  const close = (actual: { x: number; y: number }, expected: { x: number; y: number }): void => {
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9 && Math.abs(actual.y - expected.y) < 1e-9, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  };
  /** Where the top edge point at share `share` of a box turned `degrees` lands. */
  const topPoint = (box: { x: number; y: number; w: number; h: number }, degrees: number, share: number) => {
    const r = (degrees * Math.PI) / 180;
    const dx = share * box.w - box.w / 2;
    const dy = -box.h / 2;
    return { x: box.x + box.w / 2 + dx * Math.cos(r) - dy * Math.sin(r), y: box.y + box.h / 2 + dx * Math.sin(r) + dy * Math.cos(r) };
  };

  it('keeps an unturned left-aligned box where it is', () => {
    assert.deepEqual(keepTurnedAnchor({ x: 10, y: 20, w: 100, h: 40 }, 0, 160, 90, 'left'), { x: 10, y: 20 });
  });

  it('keeps the top corner of the aligned side on the same point', () => {
    const box = { x: 100, y: 50, w: 200, h: 60 };
    for (const [align, share] of [['left', 0], ['center', 0.5], ['right', 1]] as const) {
      for (const degrees of [30, -45, 90, 180]) {
        const at = keepTurnedAnchor(box, degrees, 260, 140, align);
        close(topPoint({ ...at, w: 260, h: 140 }, degrees, share), topPoint(box, degrees, share));
      }
    }
  });

  it('moves a turned box when only its height grows', () => {
    const at = keepTurnedAnchor({ x: 0, y: 0, w: 100, h: 100 }, 90, 100, 140, 'left');
    // Turned a quarter clockwise, the top edge is the right side: growing down grows to the left.
    close(at, { x: -20, y: -20 });
  });
});
