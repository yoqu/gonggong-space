import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alignArrowEndPoint, findArrowEndTarget, pointToBoxDistance } from '../src/arrows/end-snap.ts';
import { estimateLabelWordWidth, measureLabelWords, normalizeArrowLabel, placeArrowLabel, wrapLabelWords } from '../src/arrows/labels.ts';
import { arrowGeometry, indexElementsById, type ElementLayoutBoxResolver } from '../src/arrows/layout.ts';
import {
  bendsFromRoute,
  buildRouteFromBends,
  checkArrowRoute,
  isArrowRouteValid,
  planElbowRoute,
  roundedRoutePath,
  routeLabelSegment,
  routeSegments,
  type RouteBox,
  type RoutePoint,
} from '../src/arrows/routing.ts';
import type { ArrowElement, BoardElement, ShapeElement } from '../src/schema.ts';

const left: RouteBox = { x: 0, y: 0, w: 100, h: 60 };
const right: RouteBox = { x: 300, y: 0, w: 100, h: 60 };
const lowerRight: RouteBox = { x: 300, y: 200, w: 100, h: 60 };

function shape(id: string, box: RouteBox): ShapeElement {
  return { type: 'shape', id, kind: 'rect', color: 'white', text: '', ...box };
}

const layoutBox: ElementLayoutBoxResolver = (element) => ('w' in element && 'h' in element && 'x' in element && 'y' in element ? { x: element.x, y: element.y, w: element.w, h: element.h } : undefined);

describe('arrow routing', () => {
  it('routes level boxes with a straight horizontal leg', () => {
    const plan = planElbowRoute(left, 'right', right, 'left');
    assert.ok(plan);
    assert.equal(plan.shape, 'level');
    assert.ok(plan.pts.every((point) => point[1] === 30));
    assert.ok(isArrowRouteValid(plan.pts, left, 'right', right, 'left'));
  });

  it('routes offset boxes with a Z whose middle leg honors the jog', () => {
    const plan = planElbowRoute(left, 'right', lowerRight, 'left');
    assert.ok(plan);
    assert.equal(plan.shape, 'Z');
    assert.equal(plan.pts.length, 4);
    assert.equal(checkArrowRoute(plan.pts, left, 'right', lowerRight, 'left'), undefined);
    const jogged = planElbowRoute(left, 'right', lowerRight, 'left', 40);
    assert.ok(jogged);
    assert.equal(jogged.pts[1]![0] - plan.pts[1]![0], 40);
  });

  it('refuses overlapping boxes', () => {
    assert.equal(planElbowRoute(left, 'right', { x: 50, y: 10, w: 100, h: 60 }, 'left'), undefined);
  });

  it('names what is wrong with a route', () => {
    const start: RoutePoint = [106, 30];
    assert.equal(checkArrowRoute([start, [294, 80]], left, 'right', right, 'left'), 'turns_back');
    assert.equal(checkArrowRoute([start, [110, 30]], left, 'right', { x: 116, y: 0, w: 10, h: 60 }, 'left'), 'leg_too_short');
    assert.equal(checkArrowRoute([start, [294, 30]], left, 'right', right, 'right'), 'wrong_side');
  });

  it('builds a manual route from bends and reads the bends back', () => {
    const route = buildRouteFromBends(left, 'right', lowerRight, 'left', 'h', [200]);
    assert.ok(Array.isArray(route));
    assert.deepEqual(bendsFromRoute(route), { first: 'h', at: [200] });
    assert.ok(routeSegments(route).every((segment) => segment.dx === 0 || segment.dy === 0));
    assert.equal(buildRouteFromBends(left, 'right', right, 'left', 'h', [200], 0, [Number.NaN, 0]), 'ends_overlap');
  });

  it('draws rounded corners and finds the label leg', () => {
    const points: RoutePoint[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 100],
    ];
    const path = roundedRoutePath(points, [true, true]);
    assert.match(path, /^M 0 0 L 90 0 Q 100 0 100 10 L 100 90 Q 100 100 110 100 L 200 100$/);
    const label = routeLabelSegment(points);
    assert.deepEqual([label.a, label.b, label.level], [[100, 0], [100, 100], false]);
  });
});

describe('arrow layout', () => {
  it('draws an arrow between two shapes, clear of both', () => {
    const board = indexElementsById([shape('a', left), shape('b', right)]);
    const arrow: Pick<ArrowElement, 'from' | 'to'> = { from: 'a', to: 'b' };
    const line = arrowGeometry(arrow, board, layoutBox);
    assert.ok(line);
    assert.ok(line.x1 >= 100 && line.x1 < 120, `x1 ${line.x1}`);
    assert.ok(line.x2 <= 300 && line.x2 > 280, `x2 ${line.x2}`);
    assert.equal(line.y1, 30);
    assert.equal(line.y2, 30);
  });

  it('has no geometry when an end is missing', () => {
    assert.equal(arrowGeometry({ from: 'a', to: 'missing' }, indexElementsById([shape('a', left)]), layoutBox), undefined);
  });

  it('draws free-point arrows exactly between their points', () => {
    const line = arrowGeometry({ from: [0, 0], to: [100, 50] }, new Map(), layoutBox);
    assert.ok(line);
    assert.deepEqual([line.x1, line.y1, line.x2, line.y2], [0, 0, 100, 50]);
  });
});

describe('arrow labels', () => {
  it('normalizes, measures and wraps words', () => {
    assert.equal(normalizeArrowLabel('  goes\n  to -> next '), 'goes to → next');
    const measure = measureLabelWords('alpha beta gamma');
    assert.deepEqual(measure.words, ['alpha', 'beta', 'gamma']);
    assert.equal(measure.widths[0], estimateLabelWordWidth('alpha'));
    const lines = wrapLabelWords(measure, 70);
    assert.deepEqual(
      lines.map((line) => line.text),
      ['alpha beta', 'gamma'],
    );
  });

  it('places a short label on a long line', () => {
    const placed = placeArrowLabel({ x1: 0, y1: 0, x2: 400, y2: 0 }, ['none', 'arrow'], measureLabelWords('yes'));
    assert.equal(placed.onLine, true);
    assert.deepEqual(placed.lines, ['yes']);
    assert.ok(Math.abs(placed.x + placed.w / 2 - 200) < 1);
  });
});

describe('arrow end snapping', () => {
  it('measures distance to boxes and lines ends up', () => {
    assert.equal(pointToBoxDistance(left, 50, 30), 0);
    assert.equal(pointToBoxDistance(left, 103, 64), 5);
    assert.deepEqual(alignArrowEndPoint({ x: 0, y: 0 }, undefined, 200, 6, 20), { x: 200, y: 0 });
    assert.deepEqual(alignArrowEndPoint({ x: 0, y: 0 }, undefined, 200, 60, 20), { x: 200, y: 60 });
  });

  it('finds the element an end snaps to, and the side facing the pointer', () => {
    const elements: BoardElement[] = [shape('a', left), shape('b', right)];
    assert.deepEqual(findArrowEndTarget(elements, 290, 30, 20, layoutBox), { end: 'b', side: 'left' });
    assert.equal(findArrowEndTarget(elements, 200, 30, 20, layoutBox), undefined);
  });
});
