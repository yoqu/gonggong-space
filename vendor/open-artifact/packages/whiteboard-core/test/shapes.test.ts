import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendPenPoint,
  handDrawnShapeOutline,
  MIN_PEN_POINT_DISTANCE,
  normalizeStrokePoints,
  straightenPenTail,
  strokeBounds,
  strokePointsToPath,
} from '../src/ink.ts';
import { SHAPE_KINDS } from '../src/schema.ts';
import { boxShadowCss, NOTE_SHADOWS } from '../src/shadows.ts';
import {
  curvedShapeLineSegments,
  cylinderCapPathData,
  defaultShapeSize,
  polygonShapePoints,
  roundedPolygonPathData,
  seededRandomFromString,
  shapeCornerRadius,
  shapeEdgeInset,
  shapeOutlineCommands,
  shapePathData,
  shapeTextInsets,
} from '../src/shape-paths.ts';

describe('shape paths', () => {
  it('gives every kind an outline whose points lie in its box', () => {
    for (const kind of SHAPE_KINDS) {
      const commands = shapeOutlineCommands(kind, 160, 100);
      assert.ok(commands.length > 1, kind);
      assert.equal(commands[0]![0], 'M', kind);
      for (const command of commands) {
        // Curve control points may leave the box; the points a command ends on may not.
        const [x, y] = (command.slice(1) as number[]).slice(-2);
        if (x === undefined || y === undefined) continue;
        assert.ok(x >= -0.01 && x <= 160.01, `${kind} x ${x}`);
        assert.ok(y >= -0.01 && y <= 100.01, `${kind} y ${y}`);
      }
      assert.match(shapePathData(kind, 160, 100), /^M /);
    }
  });

  it('rounds corners by kind', () => {
    assert.equal(shapeCornerRadius('pill', 200, 40), 20);
    assert.equal(shapeCornerRadius('rounded', 200, 100), 12);
    assert.equal(shapeCornerRadius('rounded', 20, 10), 2.5);
    assert.match(shapePathData('frame', 100, 50), /A 12 12 0 0 1 100 12/);
  });

  it('places polygon corners and softens them', () => {
    assert.deepEqual(polygonShapePoints('diamond', 100, 60), [
      [50, 0],
      [100, 30],
      [50, 60],
      [0, 30],
    ]);
    const softened = roundedPolygonPathData('diamond', 100, 60, true);
    assert.equal((softened.match(/A 3 3/g) ?? []).length, 4);
    assert.equal(roundedPolygonPathData('rect', 100, 60, true), shapePathData('rect', 100, 60));
  });

  it('measures how far an outline sits inside its box', () => {
    assert.equal(shapeEdgeInset('rect', 100, 60, 'left', 0), 0);
    assert.equal(shapeEdgeInset('diamond', 100, 60, 'top', 0), 0);
    assert.equal(shapeEdgeInset('diamond', 100, 60, 'top', 50), 30);
    assert.ok(Math.abs(shapeEdgeInset('ellipse', 100, 60, 'left', 0)) < 1e-9);
    assert.ok(shapeEdgeInset('cloud', 160, 100, 'top', 0) > 0);
  });

  it('flattens curved kinds and draws cylinder caps', () => {
    assert.ok((curvedShapeLineSegments('cloud', 160, 100)?.length ?? 0) > 8);
    assert.equal(curvedShapeLineSegments('rect', 160, 100), undefined);
    assert.match(cylinderCapPathData('database', 100, 120) ?? '', /^M 0 10 A 50 10/);
    assert.equal(cylinderCapPathData('rect', 100, 120), undefined);
  });

  it('keeps text clear of the outline and sizes new shapes', () => {
    const insets = shapeTextInsets('diamond', 200, 100);
    assert.ok(insets.left > 0.1 && insets.top > 0.1);
    assert.deepEqual(shapeTextInsets('rect', 200, 100), { left: 0.06, right: 0.06, top: 0.06, bottom: 0.06 });
    const size = defaultShapeSize('person');
    assert.ok(size.w > 0 && size.h > 0);
  });

  it('draws the same random sequence for the same seed', () => {
    const [a, b, c] = [seededRandomFromString('seed'), seededRandomFromString('seed'), seededRandomFromString('other')];
    const first = [a(), a(), a()];
    assert.deepEqual(first, [b(), b(), b()]);
    assert.notDeepEqual(first, [c(), c(), c()]);
    assert.ok(first.every((value) => value >= 0 && value < 1));
  });
});

describe('hand-drawn ink', () => {
  it('outlines shapes deterministically per seed', () => {
    const outline = handDrawnShapeOutline('rect', 160, 100, 'shape-1');
    assert.match(outline, /^M[\d.-]+ [\d.-]+Q/);
    assert.equal(outline, handDrawnShapeOutline('rect', 160, 100, 'shape-1'));
    assert.notEqual(outline, handDrawnShapeOutline('rect', 160, 100, 'shape-2'));
    assert.match(handDrawnShapeOutline('frame', 300, 200, 'frame'), /^M[\d.-]/);
  });

  it('collects pen points, skipping jitter, and straightens a held tail', () => {
    const points: number[] = [];
    assert.equal(appendPenPoint(points, 0, 0), true);
    assert.equal(appendPenPoint(points, MIN_PEN_POINT_DISTANCE / 2, 0), false);
    assert.equal(appendPenPoint(points, 10, 0), true);
    appendPenPoint(points, 12, 5);
    straightenPenTail(points, 4, 50, 0);
    assert.deepEqual(points.slice(0, 4), [0, 0, 10, 0]);
    assert.deepEqual(points.slice(-4), [50, 0, 50, 0]);
    assert.ok(points.every((value, index) => index % 2 === 0 || value === 0));
  });

  it('turns points into paths and bounds', () => {
    assert.equal(strokePointsToPath([5, 5]), 'M 5 5 l 0.01 0');
    assert.equal(strokePointsToPath([0, 0, 10, 0, 20, 10]), 'M 0 0 Q 10 0 15 5 L 20 10');
    const normalized = normalizeStrokePoints([10, 20, 15.04, 30, 12, 25]);
    assert.deepEqual(normalized, { x: 10, y: 20, points: [0, 0, 5, 10, 2, 5] });
    assert.deepEqual(strokeBounds({ ...normalized, width: 4 }), { x: 8, y: 18, w: 9, h: 14 });
  });
});

describe('card shadows', () => {
  it('writes CSS box shadows', () => {
    assert.equal(boxShadowCss(NOTE_SHADOWS.light), '0px 1px 2px rgba(11,11,11,.06),0px 2px 8px rgba(0,0,0,.08)');
  });
});
