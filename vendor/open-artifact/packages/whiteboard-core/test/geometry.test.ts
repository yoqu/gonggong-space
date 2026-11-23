import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findStickerHost, gridArrangePositions } from '../src/attachments.ts';
import { textBackdropColors } from '../src/backdrop.ts';
import {
  boardToScreen,
  cameraToFitBox,
  clampZoom,
  elementLayoutBox,
  elementsBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  panCameraToReveal,
  rotatedBoundingBox,
  screenToBoard,
  zoomCameraAt,
} from '../src/geometry.ts';
import { GROUPING_REFUSALS, applyGroupChanges, expandSelectionToGroups, planGroupSelection } from '../src/groups.ts';
import { elementsInMarquee, hitTestElement, topElementAt } from '../src/hit-test.ts';
import { createOccupancyIndex, findFreeSpots, planSectionGrowth, sectionGrowthForContents } from '../src/layout.ts';
import { orderElementsForReading } from '../src/reading-order.ts';
import type { ArrowElement, BoardElement, ContainerElement, NoteElement, ShapeElement, StickerElement, TextElement } from '../src/schema.ts';
import { snapRectToGuides, snapRectToGuidesStraight, snapRotationDegrees, straightDragAxis } from '../src/snapping.ts';
import { followStickerHosts, rebindStickersToHosts } from '../src/sticker-hosts.ts';

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

const shape = (id: string, x: number, y: number, extra: Partial<ShapeElement> = {}): ShapeElement => ({
  type: 'shape',
  id,
  kind: 'rect',
  x,
  y,
  w: 200,
  h: 100,
  color: 'blue',
  text: '',
  ...extra,
});

const section = (id: string, x: number, y: number, w: number, h: number): ContainerElement => ({ type: 'container', id, x, y, w, h, color: 'white', text: '' });

const text = (id: string, x: number, y: number, body = 'Hi'): TextElement => ({ type: 'text', id, x, y, text: body, size: 'body', color: 'ink' });

const sticker = (id: string, x: number, y: number, extra: Partial<StickerElement> = {}): StickerElement => ({ type: 'sticker', id, x, y, w: 48, h: 48, glyph: '👍', ...extra });

const arrow = (id: string, from: ArrowElement['from'], to: ArrowElement['to']): ArrowElement => ({ type: 'arrow', id, from, to, head: 'end', dash: false, color: 'ink' });

describe('camera', () => {
  it('round-trips board and screen points', () => {
    const camera = { x: 100, y: -50, zoom: 2 };
    const screen = boardToScreen(camera, 150, 0);
    assert.deepEqual(screen, { x: 100, y: 100 });
    assert.deepEqual(screenToBoard(camera, screen.x, screen.y), { x: 150, y: 0 });
  });

  it('clamps zoom and keeps the point under the cursor when zooming', () => {
    assert.equal(clampZoom(100), MAX_ZOOM);
    assert.equal(clampZoom(0), MIN_ZOOM);
    const camera = { x: 0, y: 0, zoom: 1 };
    const zoomed = zoomCameraAt(camera, 200, 100, 2);
    assert.equal(zoomed.zoom, 2);
    assert.deepEqual(screenToBoard(zoomed, 200, 100), screenToBoard(camera, 200, 100));
  });

  it('fits a box and pans just enough to reveal one', () => {
    const fit = cameraToFitBox({ x: 0, y: 0, w: 400, h: 200 }, 896, 496);
    assert.equal(fit.zoom, 2);
    const camera = { x: 0, y: 0, zoom: 1 };
    const revealed = panCameraToReveal(camera, { x: 900, y: 100, w: 100, h: 50 }, { w: 800, h: 600 });
    assert.equal(revealed.x, 900 + 100 + 24 - 800);
    assert.equal(revealed.y, 0);
  });
});

describe('boxes', () => {
  it('estimates a note at least as tall as its text needs and unions bounds', () => {
    const tall = note('n1', 0, 0, { text: Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n') });
    assert.ok(elementLayoutBox(tall)!.h > 160);
    assert.deepEqual(elementLayoutBox(note('n2', 0, 0), new Map([['n2', { h: 300 }]])), { x: 0, y: 0, w: 160, h: 300 });
    const bounds = elementsBounds([note('a', 0, 0), shape('b', 300, 200)]);
    assert.deepEqual(bounds, { x: 0, y: 0, w: 500, h: 300 });
  });

  it('grows a rotated box to its axis-aligned bounds', () => {
    const box = rotatedBoundingBox({ x: 0, y: 0, w: 100, h: 100 }, 45);
    assert.ok(Math.abs(box.w - 100 * Math.SQRT2) < 1e-9);
    assert.ok(Math.abs(box.x + box.w / 2 - 50) < 1e-9);
  });
});

describe('hit testing', () => {
  it('finds the topmost element under a point', () => {
    const elements: BoardElement[] = [shape('s1', 0, 0), note('n1', 50, 20)];
    assert.equal(topElementAt(elements, 60, 30)?.id, 'n1');
    assert.equal(topElementAt(elements, 10, 10)?.id, 's1');
    assert.equal(topElementAt(elements, 900, 900), undefined);
    assert.equal(hitTestElement(shape('s2', 0, 0, { hollow: true, stroke: 'ink' }), 100, 50), false);
    assert.equal(hitTestElement(shape('s3', 0, 0, { hollow: true, stroke: 'ink' }), 1, 50), true);
  });

  it('selects elements touched by a marquee', () => {
    const elements: BoardElement[] = [note('a', 0, 0), note('b', 400, 0), arrow('x', 'a', 'b')];
    const picked = elementsInMarquee(elements, { x: -10, y: -10, w: 200, h: 200 });
    assert.ok(picked.includes('a'));
    assert.ok(!picked.includes('b'));
  });
});

describe('stickers', () => {
  it('finds the host under a sticker and follows a moved host', () => {
    const host = note('n1', 0, 0);
    const placed = sticker('k1', 20, 20, { on: ['n1', 0, 0, 20, 20] });
    assert.equal(findStickerHost(placed, [host, placed])?.id, 'n1');
    const moved = followStickerHosts([{ ...host, x: 100, y: 50 }, placed]);
    const followed = moved[1] as StickerElement;
    assert.deepEqual([followed.x, followed.y], [120, 70]);
    assert.deepEqual(followed.on?.slice(0, 5), ['n1', 100, 50, 120, 70]);
  });

  it('records the host a sticker was dropped on', () => {
    const host = note('n1', 0, 0);
    const before = [host, sticker('k1', 500, 500)];
    const after = [host, sticker('k1', 30, 30)];
    const rebound = rebindStickersToHosts(before, after);
    assert.deepEqual((rebound[1] as StickerElement).on, ['n1', 0, 0, 30, 30]);
  });
});

describe('groups', () => {
  it('plans a group, expands selections to it, and refuses a lone element', () => {
    const elements: BoardElement[] = [note('a', 0, 0), note('b', 200, 0), note('c', 400, 0)];
    const plan = planGroupSelection(elements, new Set(['a', 'b']));
    assert.ok(plan instanceof Map);
    const grouped = applyGroupChanges({ elements }, plan);
    assert.deepEqual([...expandSelectionToGroups(grouped.elements, new Set(['a']))].sort(), ['a', 'b']);
    assert.deepEqual(planGroupSelection(elements, new Set(['c'])), { refused: GROUPING_REFUSALS.few });
  });
});

describe('layout helpers', () => {
  it('reads sections before their contents and rows left to right', () => {
    const elements: BoardElement[] = [note('right', 300, 0), note('left', 0, 10), section('sec', 0, 400, 600, 400), note('inside', 50, 450)];
    assert.deepEqual(
      orderElementsForReading(elements).map((element) => element.id),
      ['left', 'right', 'sec', 'inside'],
    );
  });

  it('arranges a selection into a grid', () => {
    const elements: BoardElement[] = [note('a', 0, 0), note('b', 37, 500), note('c', 900, 13)];
    const positions = gridArrangePositions(elements, elements);
    assert.equal(positions.size, 3);
    const ys = new Set([...positions.values()].map((point) => point.y));
    assert.ok(ys.size < 3);
  });

  it('snaps rectangles and rotation', () => {
    const snapped = snapRectToGuides({ x: 103, y: 0, w: 50, h: 50 }, [{ axis: 'x', pos: 100, kind: 'edge' }], 5);
    assert.equal(snapped.dx, -3);
    assert.equal(snapRotationDegrees(44, true), 45);
  });

  it('holds one axis still on a straight drag', () => {
    assert.equal(straightDragAxis(30, 4), 'y', 'a mostly sideways drag keeps its height');
    assert.equal(straightDragAxis(-3, -40), 'x', 'a mostly vertical drag keeps its column');
    assert.equal(straightDragAxis(5, 5), 'y', 'a tie moves sideways');
    const guides = [
      { axis: 'x', pos: 100, kind: 'edge' },
      { axis: 'y', pos: 52, kind: 'edge' },
      { axis: 'y', pos: 0, kind: 'edge' },
    ] as const;
    const rect = { x: 103, y: 0, w: 50, h: 50 };
    const free = snapRectToGuides(rect, guides, 5);
    assert.deepEqual([free.dx, free.dy], [-3, 0]);
    assert.deepEqual(snapRectToGuidesStraight(rect, guides, 5), free, 'no axis is a plain snap');
    const sideways = snapRectToGuidesStraight(rect, guides, 5, 'y');
    assert.deepEqual([sideways.dx, sideways.dy], [-3, 0]);
    assert.deepEqual(
      sideways.guides.map((guide) => `${guide.axis}${guide.pos}`),
      ['x100', 'y0'],
      'the held axis shows the guide it sits on',
    );
    const vertical = snapRectToGuidesStraight(rect, guides, 5, 'x');
    assert.equal(vertical.dx, 0, 'the held axis never snaps');
    assert.deepEqual(
      vertical.guides.map((guide) => `${guide.axis}${guide.pos}`),
      ['y0'],
      'a held axis off its guide shows none',
    );
  });

  it('picks the fill behind text on a filled rectangle only', () => {
    const elements: BoardElement[] = [shape('s1', 0, 0, { w: 400, h: 200 }), text('t1', 20, 20), text('t2', 900, 900)];
    const colors = textBackdropColors(elements);
    assert.ok(colors.has('t1'));
    assert.ok(!colors.has('t2'));
  });
});

describe('layout', () => {
  it('finds free spots that avoid items and each other', () => {
    const content = { elements: [note('a', 0, 0)] as BoardElement[] };
    const spots = findFreeSpots({ content, sizes: [{ w: 160, h: 160 }, { w: 160, h: 160 }], area: { x: -400, y: -400, w: 1200, h: 1200 }, near: { x: 0, y: 0, w: 160, h: 160 } });
    assert.equal(spots.length, 2);
    const [first, second] = spots as Array<{ x: number; y: number }>;
    assert.deepEqual(first, { x: 184, y: 0 });
    assert.ok(Math.abs(second!.x - first!.x) >= 184 || Math.abs(second!.y - first!.y) >= 184);
    const index = createOccupancyIndex([{ x: 0, y: 0, w: 10, h: 10 }, { x: -1e6, y: 5000, w: 2e6, h: 1 }]);
    assert.ok(index.hits({ x: 20, y: 0, w: 5, h: 5 }, 24));
    assert.ok(!index.hits({ x: 100, y: 100, w: 5, h: 5 }, 24));
    assert.ok(index.hits({ x: 9000, y: 4990, w: 5, h: 5 }, 24));
  });

  it('grows a section around a note measured taller than its box', () => {
    const elements: BoardElement[] = [section('sec', 0, 0, 400, 300), note('n1', 40, 60)];
    const measures = new Map([['n1', { h: 400 }]]);
    assert.equal(sectionGrowthForContents(elements, measures).get('sec'), 60 + 400 + 24);
    const blocked: BoardElement[] = [...elements, note('below', 40, 380)];
    assert.equal(sectionGrowthForContents(blocked, measures).get('sec'), 380 - 24);
    assert.equal(planSectionGrowth(elements, [], measures).size, 0);
  });
});
