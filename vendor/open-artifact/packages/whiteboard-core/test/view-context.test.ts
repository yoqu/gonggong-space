import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  areaAnchorFor,
  areaCommentLabel,
  commentAreaCover,
  createAnchorIdLookup,
  decodeCommentAnchor,
  describeAnchorForAgent,
  describeCommentBoxPart,
  encodeCommentAnchor,
  hashCommentAnchorId,
  nearestCommentBoxCorner,
  normalizeCommentLabelText,
  resolveCommentAnchor,
  truncateCommentLabelToBytes,
  type CommentAnchor,
} from '../src/comment-anchors.ts';
import type { BoardElement, ContainerElement, NoteElement } from '../src/schema.ts';
import {
  askFrameId,
  cameraFittingArea,
  cameraWorldRect,
  createViewReporter,
  easeCameraToward,
  followViewArea,
  isAskFrameId,
  readFollowArea,
  roomierViewport,
  VIEW_REPORT_DEBOUNCE_MS,
  type ViewTimers,
} from '../src/view-context.ts';

const note = (id: string, x: number, y: number, text = ''): NoteElement => ({ type: 'note', id, x, y, w: 160, h: 160, color: 'yellow', text, tilt: 0 });
const section = (id: string, x: number, y: number, w: number, h: number, text = ''): ContainerElement => ({ type: 'container', id, x, y, w, h, color: 'white', text });

/** Manual timers: `flush` runs what is pending. */
function manualTimers(): ViewTimers & { flush(): void; delays: number[] } {
  let pending = new Map<number, () => void>();
  let next = 1;
  const delays: number[] = [];
  return {
    delays,
    setTimeout(run, ms) {
      delays.push(ms);
      pending.set(next, run);
      return next++;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
    flush() {
      const runs = [...pending.values()];
      pending = new Map();
      for (const run of runs) run();
    },
  };
}

describe('view report', () => {
  it('reports the rounded visible area once per change, debounced', () => {
    let camera = { x: 10.4, y: 20.6, zoom: 2 };
    const listeners = new Set<() => void>();
    const told: unknown[] = [];
    const timers = manualTimers();
    const reporter = createViewReporter({
      camera: {
        get current() {
          return camera;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      window: () => ({ w: 801, h: 600 }),
      visible: () => true,
      tell: (rect) => told.push(rect),
      timers,
    });
    timers.flush();
    assert.deepEqual(told, [{ x: 10, y: 21, w: 401, h: 300 }]);
    assert.equal(timers.delays[0], VIEW_REPORT_DEBOUNCE_MS);
    reporter.moved();
    timers.flush();
    assert.equal(told.length, 1);
    camera = { ...camera, x: 100 };
    for (const listener of listeners) listener();
    timers.flush();
    assert.equal(told.length, 2);
    reporter.dispose();
    assert.equal(listeners.size, 0);
  });

  it('maps a camera to the board area it shows', () => {
    assert.deepEqual(cameraWorldRect({ x: 5, y: 6, zoom: 0.5 }, { w: 100, h: 50 }), { x: 5, y: 6, w: 200, h: 100 });
    assert.ok(isAskFrameId(askFrameId(3)));
    assert.ok(!isAskFrameId('n1'));
  });
});

describe('following a view', () => {
  const viewport = { w: 800, h: 600, top: 50, bottom: 50 };

  it('shares the area clear of chrome and fits it back', () => {
    const area = followViewArea({ x: 0, y: 0, zoom: 1 }, viewport);
    assert.deepEqual(area, { x: 0, y: 50, w: 800, h: 500 });
    const camera = cameraFittingArea(area, viewport);
    assert.deepEqual(camera, { x: 0, y: 0, zoom: 1 });
  });

  it('refuses areas that are not sane', () => {
    assert.equal(readFollowArea({ x: 0, y: 0, w: 0, h: 10 }), undefined);
    assert.equal(readFollowArea({ x: 2e6, y: 0, w: 10, h: 10 }), undefined);
    assert.equal(readFollowArea('nope'), undefined);
    assert.deepEqual(readFollowArea({ x: 1, y: 2, w: 3, h: 4, extra: true }), { x: 1, y: 2, w: 3, h: 4 });
  });

  it('eases toward a camera and lands on it', () => {
    const from = { x: 0, y: 0, zoom: 1 };
    const to = { x: 400, y: 0, zoom: 1 };
    const step = easeCameraToward(from, to, 90, viewport);
    assert.ok(step.x > 200 && step.x < 400);
    assert.equal(easeCameraToward(to, to, 16, viewport), to);
    assert.equal(roomierViewport(viewport, { w: 900, h: 100, top: 50, bottom: 40 }).w, 900);
  });
});

describe('comment anchors', () => {
  const elements: BoardElement[] = [section('sec', 0, 0, 1000, 800, 'Ideas'), note('n1', 100, 100, 'First idea'), note('n2', 400, 100, 'Second')];
  const lookup = createAnchorIdLookup(elements.map((element) => element.id));

  it('round-trips every kind of anchor', () => {
    const anchors: CommentAnchor[] = [
      { kind: 'board', x: -120, y: 45 },
      { kind: 'item', id: 'n1', fx: 0, fy: 1 },
      { kind: 'area', x: 10, y: -20, w: 300, h: 200, corner: 3 },
      { kind: 'item-area', id: 'sec', dx: 5, dy: 6, w: 70, h: 80, corner: 1 },
    ];
    for (const anchor of anchors) assert.deepEqual(decodeCommentAnchor(encodeCommentAnchor(anchor), lookup), anchor);
    assert.equal(encodeCommentAnchor(anchors[0]!), 'wp1000012000000045:nth-of-type(1)');
  });

  it('hashes ids that are not valid selectors and finds them again', () => {
    const odd = 'id.with.dots';
    const encoded = encodeCommentAnchor({ kind: 'item', id: odd, fx: 0.5, fy: 0.5 });
    assert.ok(encoded.startsWith('wi' + hashCommentAnchorId(odd)));
    const decoded = decodeCommentAnchor(encoded, createAnchorIdLookup([odd]));
    assert.equal(decoded?.kind === 'item' ? decoded.id : undefined, odd);
    assert.equal(decodeCommentAnchor('#wb-gone > wx50005000:nth-of-type(1)', lookup), null);
  });

  it('covers an area with its section and items', () => {
    const rect = { x: 80, y: 80, w: 520, h: 220 };
    const cover = commentAreaCover(rect, elements);
    assert.equal(cover.frame?.el.id, 'sec');
    assert.deepEqual(cover.items.map((element) => element.id).sort(), ['n1', 'n2']);
    assert.equal(cover.frame?.part, 'top half');
    const anchor = areaAnchorFor(rect, nearestCommentBoxCorner(rect, { x: 600, y: 300 }), cover);
    assert.deepEqual(anchor, { kind: 'item-area', id: 'sec', dx: 80, dy: 80, w: 520, h: 220, corner: 3 });
    assert.equal(areaCommentLabel(cover, 'Area'), 'Section, “Ideas” (top half) · 2 items');
  });

  it('resolves and describes anchors for the agent', () => {
    const resolved = resolveCommentAnchor(encodeCommentAnchor({ kind: 'board', x: 120, y: 120 }), elements);
    assert.deepEqual(resolved, { selected: ['n1'], pin: { x: 120, y: 120 } });
    assert.deepEqual(resolveCommentAnchor(null, elements), { selected: [] });
    const described = describeAnchorForAgent(encodeCommentAnchor({ kind: 'item', id: 'n1', fx: 0.5, fy: 0.5 }), elements);
    assert.equal(described, 'selected: elements/n1 note "First idea"');
    assert.equal(describeAnchorForAgent('garbage', elements), '');
  });

  it('names box parts and trims labels', () => {
    assert.equal(describeCommentBoxPart({ x0: 0, y0: 0, x1: 0.1, y1: 1 }, 0.1), 'left edge');
    assert.equal(describeCommentBoxPart({ x0: 0, y0: 0, x1: 1, y1: 1 }, 1), '');
    assert.equal(normalizeCommentLabelText('a  "b"\n c', 40), 'a ’b’ c');
    assert.equal(normalizeCommentLabelText('abcdef', 4), 'abc…');
    const cut = truncateCommentLabelToBytes('é'.repeat(100), 20);
    assert.ok(new TextEncoder().encode(cut).length <= 20);
    assert.ok(cut.endsWith('…'));
  });
});
