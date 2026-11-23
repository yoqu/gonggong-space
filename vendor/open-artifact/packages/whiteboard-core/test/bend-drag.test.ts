import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arrowEndClearances, arrowLegHandles, bendsForDraggedSegment } from '../src/arrows/bend-drag.ts';
import { arrowGeometry, indexElementsById, type ElementLayoutBoxResolver } from '../src/arrows/layout.ts';
import type { RouteBox } from '../src/arrows/routing.ts';
import { setArrowBends } from '../src/edits.ts';
import type { ArrowElement, BoardElement, ShapeElement } from '../src/schema.ts';

function shape(id: string, box: RouteBox): ShapeElement {
  return { type: 'shape', id, kind: 'rect', color: 'white', text: '', ...box };
}

const layoutBox: ElementLayoutBoxResolver = (element) => ('w' in element && 'h' in element && 'x' in element && 'y' in element ? { x: element.x, y: element.y, w: element.w, h: element.h } : undefined);

/** Two boxes joined right-to-left with the lower one offset, so the route is a Z. */
function zBoard() {
  const arrow: ArrowElement = { type: 'arrow', id: 'a', from: 'l', to: 'r', fromSide: 'right', toSide: 'left', head: 'end', dash: false, color: 'ink' };
  const elements: BoardElement[] = [shape('l', { x: 0, y: 0, w: 100, h: 60 }), shape('r', { x: 400, y: 200, w: 100, h: 60 }), arrow];
  const board = indexElementsById(elements);
  const line = arrowGeometry(arrow, board, layoutBox)!;
  return { arrow, board, line, route: line.elbow! };
}

describe('dragging an arrow leg', () => {
  it('bends a Z route when its middle leg is dragged sideways', () => {
    const { arrow, board, route } = zBoard();
    assert.equal(route.length, 4, 'a Z has three legs');
    const middle = 1;
    const bends = bendsForDraggedSegment(arrow, route, middle, 320, 100, 4, board, layoutBox);
    assert.ok(bends !== null && bends !== undefined && bends !== 'same', 'the drag gives manual bends');
    const bent = setArrowBends(arrow, bends);
    const bentBoard = indexElementsById([...board.values()].map((element) => (element.id === 'a' ? bent : element)));
    const line = arrowGeometry(bent, bentBoard, layoutBox);
    assert.ok(line?.bent);
    const vertical = line.elbow!.find((point, index) => index > 0 && point[0] === line.elbow![index - 1]![0]);
    assert.ok(vertical, 'the route keeps an upright leg');
    assert.ok(Math.abs(vertical[0] - 320) < 1, 'the upright leg moved to where it was dragged');
  });

  it('clears the bends when the leg is dragged back onto the automatic route', () => {
    const { arrow, board, route } = zBoard();
    const x = route[1]![0];
    assert.equal(bendsForDraggedSegment(arrow, route, 1, x + 1, 100, 4, board, layoutBox), null);
  });

  it('gives no change when the leg cannot move there', () => {
    const { arrow, board, route } = zBoard();
    assert.equal(bendsForDraggedSegment(arrow, route, 1, route[1]![0], 100, 4, board, layoutBox), 'same');
  });

  it('keeps head room at an end with a head', () => {
    const { arrow, board, route } = zBoard();
    const [start, end] = arrowEndClearances(arrow, route, board, layoutBox);
    assert.ok(end > start, 'the head end needs more room than the plain end');
  });

  it('puts a handle on each leg that can move', () => {
    const { arrow, board, line } = zBoard();
    const handles = arrowLegHandles(arrow, line, board, layoutBox, undefined, 1, false);
    assert.ok(handles.some((handle) => handle.leg === 1 && !handle.level), 'the upright middle leg has a handle');
    for (const handle of handles) {
      const a = line.elbow![handle.leg]!;
      const b = line.elbow![handle.leg + 1]!;
      const onLeg = handle.level ? Math.abs(handle.y - a[1]) < 1e-6 : Math.abs(handle.x - a[0]) < 1e-6;
      assert.ok(onLeg, 'each handle sits on its leg');
      assert.equal(handle.level, Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]));
    }
  });
});
