import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CMD_C,
  CMD_L,
  CMD_M,
  CMD_Q,
  CMD_Z,
  F_HITTABLE,
  F_LOCK_ASPECT,
  F_HANDLES_CORNERS,
  F_MOVABLE,
  F_MULTIPLY,
  F_NO_HOVER,
  F_NO_OUTLINE,
  F_RESIZABLE,
  F_SELECTABLE,
  F_SNAP,
  F_VISIBLE,
  IdRegistry,
  MAX_CUTS,
  OP_CLEAR,
  OP_REMOVE,
  OP_UPSERT,
  PatchEncoder,
  REC,
  encodeFlags,
  parseColor,
  parseSvgPath,
  polylineCommands,
} from '../src/protocol.ts';

test('colours parse to 0xRRGGBBAA', () => {
  assert.equal(parseColor('#fff'), 0xffffffff);
  assert.equal(parseColor('#1234'), 0x11223344);
  assert.equal(parseColor('#2563eb'), 0x2563ebff);
  assert.equal(parseColor('#2563eb80'), 0x2563eb80);
  assert.equal(parseColor('rgb(255, 0, 0)'), 0xff0000ff);
  assert.equal(parseColor('rgba(0 128 255 / 0.5)'), 0x0080ff80);
  assert.equal(parseColor('transparent'), 0);
  assert.equal(parseColor(0xff00ff00), 0xff00ff00);
  assert.equal(parseColor(undefined, 7), 7);
  assert.throws(() => parseColor('var(--x)'), /unsupported colour/);
});

test('colours: every CSS form the editors pass', () => {
  // Named colours, any case, and transparent.
  assert.equal(parseColor('RebeccaPurple'), 0x663399ff);
  assert.equal(parseColor('cornflowerblue'), 0x6495edff);
  assert.equal(parseColor('Transparent'), 0);
  // rgb()/rgba(): commas or spaces, percentages, alpha as number or %.
  assert.equal(parseColor('rgba(0,0,0,0.2)'), 0x00000033);
  assert.equal(parseColor('rgb(0 0 0 / 0.1)'), 0x0000001a);
  assert.equal(parseColor('rgb(100%, 50%, 0%)'), 0xff8000ff);
  assert.equal(parseColor('rgb(37 99 235 / 12%)'), 0x2563eb1f);
  assert.equal(parseColor('rgba(255, 255, 255, 0.035)'), 0xffffff09);
  assert.equal(parseColor(' RGB( 1 , 2 , 3 ) '), 0x010203ff);
  // hsl()/hsla(): hue units, legacy and modern syntax.
  assert.equal(parseColor('hsl(0, 100%, 50%)'), 0xff0000ff);
  assert.equal(parseColor('hsl(120deg 100% 25%)'), 0x008000ff);
  assert.equal(parseColor('hsla(240, 100%, 50%, 0.5)'), 0x0000ff80);
  assert.equal(parseColor('hsl(0.5turn 100% 50% / 50%)'), 0x00ffff80);
  assert.equal(parseColor('hsl(3.14159rad 100% 50%)'), 0x00ffffff);
  assert.equal(parseColor('hsl(0 0% 100%)'), 0xffffffff);
  // Out-of-range channels clamp.
  assert.equal(parseColor('rgb(300, -5, 0, 2)'), 0xff0000ff);
  for (const bad of ['currentColor', 'rgb(1, 2)', 'rgb(1 2 3 4)', 'hsl(1px 2% 3%)', '#12345', 'oklch(0.5 0.1 200)', 'notacolour']) {
    assert.throws(() => parseColor(bad), /unsupported colour/, bad);
  }
});

test('flags default on, opt-ins off', () => {
  assert.equal(encodeFlags({}), F_VISIBLE | F_HITTABLE | F_SELECTABLE | F_MOVABLE | F_RESIZABLE | F_SNAP);
  assert.equal(encodeFlags({ movable: false, resizable: false, lockAspect: true }), F_VISIBLE | F_HITTABLE | F_SELECTABLE | F_SNAP | F_LOCK_ASPECT);
  const base = encodeFlags({});
  assert.equal(encodeFlags({ hover: false, selectionOutline: false, handles: 'corners', blend: 'multiply' }), base | F_NO_HOVER | F_NO_OUTLINE | F_HANDLES_CORNERS | F_MULTIPLY);
  assert.equal(encodeFlags({ hover: true, handles: 'all', blend: 'normal' }), base);
});

test('path cut-out rects follow the commands in the path stream', () => {
  const enc = new PatchEncoder();
  const cuts = [{ x: 1, y: 2, w: 3, h: 4 }, { x: 5, y: 6, w: 7, h: 8 }, { x: 9, y: 9, w: 9, h: 9 }];
  const p = enc.encode({
    upsert: [
      { id: 'a', kind: 'path', x: 0, y: 0, w: 1, h: 1, points: [0, 0, 1, 1], cuts },
      { id: 'b', kind: 'path', x: 0, y: 0, w: 1, h: 1, points: [0, 0, 1, 1] },
    ],
  });
  assert.equal(p.ops[31], MAX_CUTS, 'extra cuts are dropped');
  assert.deepEqual([p.ops[23], p.ops[24]], [0, 6]);
  assert.deepEqual([p.ops[REC + 23], p.ops[REC + 24], p.ops[REC + 31]], [14, 6, 0], 'the next path starts after the cuts');
  assert.deepEqual(Array.from(p.paths.subarray(6, 14)), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('SVG path data: absolute, relative, implicit repeats, H/V, S/T reflection, Z', () => {
  assert.deepEqual(parseSvgPath('M0 0 L10 0 10 10z'), [CMD_M, 0, 0, CMD_L, 10, 0, CMD_L, 10, 10, CMD_Z]);
  assert.deepEqual(parseSvgPath('m5 5 10 0 h5 v-5 H0 V0'), [CMD_M, 5, 5, CMD_L, 15, 5, CMD_L, 20, 5, CMD_L, 20, 0, CMD_L, 0, 0, CMD_L, 0, 0]);
  assert.deepEqual(parseSvgPath('M0,0C1,2,3,4,5,6S9,10,11,12'), [CMD_M, 0, 0, CMD_C, 1, 2, 3, 4, 5, 6, CMD_C, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(parseSvgPath('M0 0Q5 5 10 0T20 0'), [CMD_M, 0, 0, CMD_Q, 5, 5, 10, 0, CMD_Q, 15, -5, 20, 0]);
  assert.deepEqual(parseSvgPath('M1-2.5.5.5e1'), [CMD_M, 1, -2.5, CMD_L, 0.5, 5]);
  // After Z the pen is back at the subpath start, so relative moves start from there.
  assert.deepEqual(parseSvgPath('M10 10 l5 0 z m1 1'), [CMD_M, 10, 10, CMD_L, 15, 10, CMD_Z, CMD_M, 11, 11]);
  assert.throws(() => parseSvgPath('L0'), /must start|bad path/);
});

test('arcs become cubics that end exactly on the arc end point and stay on the circle', () => {
  const cmds = parseSvgPath('M0 50 A50 50 0 0 1 100 50');
  assert.equal(cmds[0], CMD_M);
  const cubics = (cmds.length - 3) / 7;
  assert.equal(cubics, 2, 'a half circle is two quarter cubics');
  assert.deepEqual(cmds.slice(-2), [100, 50]);
  // The midpoint of the half circle (sweep 1 from the left goes over the top in SVG's y-down space).
  const mid = cmds.slice(3 + 5, 3 + 7);
  assert.ok(Math.abs(mid[0]! - 50) < 1e-9 && Math.abs(mid[1]! - 0) < 1e-9, `mid ${mid}`);
  // Flags without separators ("a1 1 0 01 2 2" style) parse too.
  const compact = parseSvgPath('M0 0a1 1 0 012 0');
  assert.deepEqual(compact.slice(-2), [2, 0]);
  // Zero radius degrades to a line.
  assert.deepEqual(parseSvgPath('M0 0 A0 5 0 0 1 10 0'), [CMD_M, 0, 0, CMD_L, 10, 0]);
});

test('polylines', () => {
  assert.deepEqual(polylineCommands([0, 0, 10, 0, 10, 10], true), [CMD_M, 0, 0, CMD_L, 10, 0, CMD_L, 10, 10, CMD_Z]);
  assert.deepEqual(polylineCommands([]), []);
});

test('id registry reuses handles only after flush', () => {
  const r = new IdRegistry();
  assert.equal(r.ensure('a'), 0);
  assert.equal(r.ensure('b'), 1);
  assert.equal(r.ensure('a'), 0);
  assert.equal(r.release('a'), 0);
  assert.equal(r.ensure('c'), 2, 'not reused before flush');
  r.flush();
  assert.equal(r.ensure('d'), 0);
  assert.deepEqual(r.ids([1, 2, 0, 99]), ['b', 'c', 'd']);
  assert.equal(r.id(1), 'b');
});

test('patch encoding: records, kinds, styles, path stream', () => {
  const enc = new PatchEncoder();
  const p = enc.encode({
    upsert: [
      { id: 'r', kind: 'rect', x: 1, y: 2, w: 3, h: 4, fill: '#ff0000', stroke: '#000', radius: 6, layer: 1, z: 2, texture: 'img', shadow: { color: '#0004', blur: 8, dy: 2 } },
      { id: 'p', kind: 'path', x: 0, y: 0, w: 10, h: 10, d: 'M0 0L10 10', stroke: '#00f', strokeWidth: 2, cap: 'round', join: 'bevel', viewBox: [20, 20] },
      { id: 'h', kind: 'hole', x: 0, y: 0, w: 5, h: 5, radius: 2 },
      { id: 'q', kind: 'path', x: 0, y: 0, w: 1, h: 1, points: [0, 0, 1, 1], closed: true, fill: '#0f0' },
    ],
  });
  assert.equal(p.records, 4);
  assert.equal(p.ops.length, 4 * REC);
  const rec = (i: number) => Array.from(p.ops.subarray(i * REC, (i + 1) * REC));
  const r = rec(0);
  assert.deepEqual(r.slice(0, 12), [OP_UPSERT, 0, 0, 1, 2, 1, 2, 3, 4, 0, encodeFlags({}), 1]);
  assert.equal(r[12], 0xff0000ff);
  assert.equal(r[13], 0x000000ff);
  assert.equal(r[14], 1, 'a stroke colour defaults to width 1');
  assert.equal(r[15], 6);
  assert.deepEqual(r.slice(18, 23), [0x00000044, 8, 0, 2, 0]);
  const path = rec(1);
  assert.equal(path[2], 2);
  assert.deepEqual([path[23], path[24]], [0, 6]);
  assert.deepEqual(path.slice(25, 30), [20, 20, 1, 2, 4]);
  assert.equal(rec(2)[2], 1);
  assert.deepEqual([rec(3)[23], rec(3)[24]], [6, 7]);
  assert.deepEqual(Array.from(p.paths), [CMD_M, 0, 0, CMD_L, 10, 10, CMD_M, 0, 0, CMD_L, 1, 1, CMD_Z]);
  assert.equal(enc.textures.get('img'), 0);

  const rm = enc.encode({ remove: ['p', 'missing'] });
  assert.equal(rm.records, 1, 'unknown ids are skipped');
  assert.deepEqual(Array.from(rm.ops.subarray(0, 2)), [OP_REMOVE, 1]);
  const again = enc.encode({ upsert: [{ id: 'new', kind: 'rect', x: 0, y: 0, w: 1, h: 1 }] });
  assert.equal(again.ops[1], 1, 'freed handle reused by the next patch');

  const cl = enc.encode({ clear: true });
  assert.equal(cl.ops[0], OP_CLEAR);
  assert.equal(enc.items.size, 0);
});

test('path commands are parsed once while the input is unchanged', () => {
  const enc = new PatchEncoder();
  const item = { id: 'p', kind: 'path' as const, x: 0, y: 0, w: 1, h: 1, d: 'M0 0L1 1' };
  const a = enc.encode({ upsert: [item] });
  const b = enc.encode({ upsert: [{ ...item, x: 5 }] });
  assert.deepEqual(Array.from(a.paths), Array.from(b.paths));
  const c = enc.encode({ upsert: [{ ...item, d: 'M0 0L2 2' }] });
  assert.deepEqual(Array.from(c.paths), [CMD_M, 0, 0, CMD_L, 2, 2]);
});
