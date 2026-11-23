// The engine through its TypeScript API, headless (the wasm core without a GPU).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanvasEngine, type CanvasEvents, type CanvasItem } from '../src/index.ts';

const NO_MODS = { shift: false, alt: false, ctrl: false, meta: false };

function rect(id: string, x: number, y: number, w = 100, h = 100, extra: Partial<CanvasItem> = {}): CanvasItem {
  return { id, kind: 'rect', x, y, w, h, fill: '#fff', ...extra } as CanvasItem;
}

async function engine(items: CanvasItem[] = []) {
  const e = await CanvasEngine.createHeadless({ width: 1000, height: 800, snap: false });
  e.applyPatch(items);
  e.tick(0);
  return e;
}

function record<K extends keyof CanvasEvents>(e: CanvasEngine, name: K): CanvasEvents[K][] {
  const out: CanvasEvents[K][] = [];
  e.on(name, ev => out.push(ev));
  return out;
}

function drag(e: CanvasEngine, from: [number, number], to: [number, number], mods: { shift?: boolean } = {}) {
  e.input.pointerDown({ x: from[0], y: from[1], ...mods });
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    e.input.pointerMove({ x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t, buttons: 1, ...mods });
  }
  e.input.pointerUp({ x: to[0], y: to[1], ...mods });
}

test('drag emits exactly one move commit with the world delta', async () => {
  const e = await engine([rect('a', 100, 100)]);
  e.setCamera({ x: 0, y: 0, zoom: 2 });
  const commits = record(e, 'commit');
  const gestures = record(e, 'gesture');
  drag(e, [300, 300], [380, 340]);
  assert.deepEqual(commits, [{ op: 'move', ids: ['a'], dx: 40, dy: 20, modifiers: NO_MODS }]);
  assert.deepEqual(
    gestures.map(g => `${g.kind}:${g.phase}`),
    ['move:start', 'move:end'],
  );
  assert.equal(e.hitTest({ x: 2 * 230, y: 2 * 210 }), 'a', 'the mirror shows the moved item');
  assert.equal(e.hitTest({ x: 2 * 120, y: 2 * 110 }), null, 'not where it was');
  e.destroy();
});

test('click selects, shift toggles, empty click clears', async () => {
  const e = await engine([rect('a', 0, 0), rect('b', 200, 0)]);
  const sel = record(e, 'selection');
  e.input.pointerDown({ x: 50, y: 50 });
  e.input.pointerUp({ x: 50, y: 50 });
  e.input.pointerDown({ x: 250, y: 50, shift: true });
  e.input.pointerUp({ x: 250, y: 50, shift: true });
  assert.deepEqual(e.selection, ['a', 'b']);
  e.input.pointerDown({ x: 600, y: 600 });
  e.input.pointerUp({ x: 600, y: 600 });
  assert.deepEqual(sel.map(s => s.ids), [['a'], ['a', 'b'], []]);
  e.destroy();
});

test('marquee selects what it touches; controlled mode only proposes', async () => {
  const e = await engine([rect('a', 0, 0, 50, 50), rect('b', 100, 0, 50, 50), rect('c', 400, 400, 50, 50)]);
  drag(e, [-10, -10], [120, 30]);
  assert.deepEqual(e.selection, ['a', 'b']);
  e.setSelection([]);
  e.setOptions({ selection: 'controlled' });
  const commits = record(e, 'commit');
  drag(e, [390, 390], [460, 460]);
  assert.deepEqual(commits, [{ op: 'select', ids: ['c'], modifiers: NO_MODS }]);
  assert.deepEqual(e.selection, []);
  e.setSelection(['c']);
  assert.deepEqual(e.selection, ['c']);
  e.destroy();
});

test('resize handle commits the new rect; escape cancels a drag', async () => {
  const e = await engine([rect('a', 100, 100, 100, 50)]);
  e.setSelection(['a']);
  const commits = record(e, 'commit');
  drag(e, [200, 150], [260, 170]);
  assert.deepEqual(commits, [{ op: 'resize', id: 'a', rect: { x: 100, y: 100, w: 160, h: 70 }, modifiers: NO_MODS }]);
  commits.length = 0;
  e.input.pointerDown({ x: 150, y: 120 });
  e.input.pointerMove({ x: 300, y: 120, buttons: 1 });
  e.input.key('escape', true);
  e.input.pointerUp({ x: 300, y: 120 });
  assert.deepEqual(commits, []);
  assert.equal(e.hitTest({ x: 150, y: 120 }), 'a', 'back where it was');
  e.destroy();
});

test('wheel pans, ctrl+wheel zooms about the pointer; camera events throttle and settle', async () => {
  const e = await engine();
  const cams = record(e, 'camera');
  const moving = record(e, 'moving');
  let t = 1000;
  e.tick(t);
  for (let i = 0; i < 30; i++) {
    e.input.wheel({ x: 500, y: 400, dx: 0, dy: 10 });
    e.tick((t += 16));
  }
  assert.deepEqual(e.camera, { x: 0, y: 300, zoom: 1 });
  const before = e.screenToWorld({ x: 500, y: 400 });
  e.input.wheel({ x: 500, y: 400, dx: 0, dy: -50, ctrl: true });
  const after = e.screenToWorld({ x: 500, y: 400 });
  assert.ok(e.camera.zoom > 1);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  e.tick((t += 16));
  assert.ok(cams.length >= 4 && cams.length <= 7, `${cams.length} camera events over ~500ms`);
  e.tick((t += 500));
  assert.deepEqual(
    moving.map(m => m.moving),
    [true, false],
  );
  assert.equal(cams.at(-1)!.settled, true);
  e.destroy();
});

test('textures: asked for when visible, stored, holes reported with a CSS transform', async () => {
  const e = await engine([rect('img', 0, 0, 200, 100, { texture: 'k1', kind: 'image' }), { id: 'h', kind: 'hole', x: 300, y: 100, w: 200, h: 100 }]);
  const needed = record(e, 'textureNeeded');
  const holes = record(e, 'holes');
  e.setCamera({ x: 0, y: 0, zoom: 2 });
  e.tick(16);
  assert.deepEqual(needed, []);
  // The first frame (in `engine()`) already asked; nothing is asked twice.
  e.applyPatch([rect('img2', 0, 200, 50, 50, { texture: 'k2' })]);
  e.tick(32);
  assert.deepEqual(needed, [{ keys: ['k2'] }]);
  const h = holes.at(-1)!.holes;
  assert.equal(h.length, 1);
  assert.deepEqual({ ...h[0], transform: undefined }, { id: 'h', x: 600, y: 200, w: 400, h: 200, rotation: 0, zoom: 2, transform: undefined });
  assert.equal(h[0]!.transform, 'matrix(2, 0, 0, 2, 600, 200)');
  e.destroy();
});

test('paths and stats', async () => {
  const e = await engine();
  e.applyPatch([
    { id: 'p', kind: 'path', x: 0, y: 0, w: 100, h: 100, d: 'M0 0 C 50 100 50 -100 100 0', stroke: '#000', strokeWidth: 3, layer: 1 },
    rect('r', 0, 200),
  ]);
  e.tick(16);
  const s = e.stats();
  assert.equal(s.items, 2);
  assert.ok(s.pathVertices > 10, `${s.pathVertices} path vertices`);
  assert.equal(s.batches, 2);
  assert.equal(e.hitTest({ x: 0, y: 0 }), 'p', 'on the stroke');
  assert.equal(e.hitTest({ x: 50, y: 90 }), null, 'off the curve inside its box');
  e.applyPatch({ remove: ['p'] });
  assert.equal(e.stats().items, 1);
  e.destroy();
});

test('events carry the modifiers held', async () => {
  const e = await engine([rect('a', 0, 0), rect('b', 200, 0)]);
  e.setOptions({ selection: 'controlled' });
  const commits = record(e, 'commit');
  e.input.pointerDown({ x: 250, y: 50, shift: true, meta: true });
  e.input.pointerUp({ x: 250, y: 50, shift: true, meta: true });
  assert.deepEqual(commits, [{ op: 'select', ids: ['b'], modifiers: { shift: true, alt: false, ctrl: false, meta: true } }]);
  e.destroy();
});

test('dblclick and contextmenu report the item and the point', async () => {
  const e = await engine([rect('a', 100, 100)]);
  e.setCamera({ x: 0, y: 0, zoom: 2 });
  const dbl = record(e, 'dblclick');
  const menu = record(e, 'contextmenu');
  e.input.dblclick({ x: 300, y: 300, alt: true });
  e.input.contextmenu({ x: 10, y: 20 });
  assert.deepEqual(dbl, [{ id: 'a', world: { x: 150, y: 150 }, screen: { x: 300, y: 300 }, modifiers: { ...NO_MODS, alt: true }, event: undefined }]);
  assert.deepEqual(menu, [{ id: null, world: { x: 5, y: 10 }, screen: { x: 10, y: 20 }, modifiers: NO_MODS, event: undefined }]);
  e.destroy();
});

test('hitHandle names the handle; per-item handle sets limit it', async () => {
  const e = await engine([rect('a', 100, 100, 100, 50), rect('img', 400, 100, 100, 50, { handles: 'corners' })]);
  e.setSelection(['a']);
  assert.deepEqual(e.hitHandle({ x: 200, y: 150 }), { id: 'a', handle: 'se' });
  assert.deepEqual(e.hitHandle({ x: 150, y: 100 }), { id: 'a', handle: 'n' });
  assert.deepEqual(e.hitHandle({ x: 100, y: 125 }), { id: 'a', handle: 'w' });
  assert.equal(e.hitHandle({ x: 150, y: 125 }), null);
  e.setSelection(['img']);
  assert.deepEqual(e.hitHandle({ x: 400, y: 100 }), { id: 'img', handle: 'nw' });
  assert.equal(e.hitHandle({ x: 450, y: 100 }), null, 'no edge handles');
  e.destroy();
});

test('resizing reports progress with dragEvents; itemRect follows the gesture', async () => {
  const e = await engine([rect('a', 100, 100, 100, 50)]);
  e.setOptions({ dragEvents: true });
  e.setSelection(['a']);
  const resizing = record(e, 'resizing');
  e.input.pointerDown({ x: 200, y: 150 });
  e.input.pointerMove({ x: 230, y: 160, buttons: 1 });
  assert.deepEqual(resizing.at(-1), { id: 'a', rect: { x: 100, y: 100, w: 130, h: 60 }, modifiers: NO_MODS });
  assert.deepEqual(e.itemRect('a'), { x: 100, y: 100, w: 130, h: 60, rotation: 0 });
  e.input.pointerUp({ x: 230, y: 160 });
  assert.equal(e.itemRect('missing'), null);
  e.destroy();
});

test('startMove drags from a press the host received; tool getter', async () => {
  const e = await engine([rect('a', 100, 100)]);
  const commits = record(e, 'commit');
  assert.equal(e.tool, 'select');
  assert.equal(e.startMove('a', { x: 500, y: 20 }), true);
  e.input.pointerMove({ x: 540, y: 25, buttons: 1, shift: true });
  e.input.pointerUp({ x: 540, y: 25, shift: true });
  assert.deepEqual(commits, [{ op: 'move', ids: ['a'], dx: 40, dy: 0, modifiers: { ...NO_MODS, shift: true } }], 'shift locks the axis');
  e.setTool('pan');
  assert.equal(e.tool, 'pan');
  assert.equal(e.startMove('a', { x: 500, y: 20 }), false);
  e.destroy();
});

test('path cuts, multiply blending and no-hover items encode and batch apart', async () => {
  const e = await engine();
  e.applyPatch([
    { id: 'p', kind: 'path', x: 0, y: 0, w: 100, h: 10, points: [0, 5, 100, 5], stroke: '#000', cuts: [{ x: 40, y: 0, w: 20, h: 10 }] },
    { id: 'ink', kind: 'path', x: 0, y: 20, w: 100, h: 10, points: [0, 5, 100, 5], stroke: '#00f', blend: 'multiply', hover: false, selectionOutline: false },
  ]);
  e.tick(16);
  assert.equal(e.stats().batches, 2);
  e.destroy();
});
