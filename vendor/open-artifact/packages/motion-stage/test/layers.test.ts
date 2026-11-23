import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlaySeconds } from '@open-artifact/motion-core';
import { flattenLayers, hitTestLayers } from '../src/layers.ts';
import type { LayerRow } from '../src/protocol.ts';
import { drawnValue } from '../src/runtime/layers/parts.ts';
import { typeRule } from '../src/runtime/retouch/type-style.ts';
import { sketchBox } from '../src/runtime/sketch/strokes.ts';
import type { SketchBoxOptions } from '../src/runtime/sketch/strokes.ts';

function row(id: string, box: [number, number, number, number] | null, kids: LayerRow[] = [], more: Partial<LayerRow> = {}): LayerRow {
  const motion: LayerRow['enter'] = { how: null, from: 0 as PlaySeconds, to: 0 as PlaySeconds };
  return {
    id,
    kind: 'shape',
    round: false,
    name: '',
    hidden: false,
    under: null,
    own: false,
    many: 0,
    texts: [],
    spans: [],
    at: 0 as PlaySeconds,
    enter: motion,
    leave: motion,
    box,
    wordsBox: null,
    look: null,
    kids,
    sole: null,
    whole: false,
    drawn: '',
    full: false,
    ...more,
  };
}

const card = row('film:0/div', [100, 100, 400, 300], [row('film:0.0/h1', [120, 120, 200, 40]), row('film:0.1/p', [120, 200, 300, 40])]);
const ground = row('film:1/div', [0, 0, 1920, 1080], [], { kind: 'ground' });
const rows = [card, ground];
const at = { x: 150, y: 130, deep: false, slack: 8, small: 0 };

test('rows flatten each before what it holds', () => {
  assert.deepEqual(
    flattenLayers(rows).map((each) => each.id),
    ['film:0/div', 'film:0.0/h1', 'film:0.1/p', 'film:1/div'],
  );
});

test('a press picks the outermost row first, then one level in each time', () => {
  assert.equal(hitTestLayers(rows, null, at)?.id, 'film:0/div');
  assert.equal(hitTestLayers(rows, 'film:0/div', at)?.id, 'film:0.0/h1');
  assert.equal(hitTestLayers(rows, null, { ...at, deep: true })?.id, 'film:0.0/h1');
  assert.equal(hitTestLayers(rows, null, { ...at, x: 1800, y: 1000 }), null, 'the Background is never picked');
  assert.equal(hitTestLayers(rows, null, { ...at, x: 505, y: 130 })?.id, 'film:0/div', 'slack finds a row just outside its box');
});

test('a hidden row is not picked', () => {
  const hidden = [row('film:0/div', [100, 100, 400, 300], [], { hidden: 'own' })];
  assert.equal(hitTestLayers(hidden, null, at), null);
});

const options: SketchBoxOptions = { u: 1, sides: [2, 2, 2, 2], onEdge: false, bar: false, broken: false, rx: 0, ry: 0, hatch: 1, skip: null };

test('a sketched box follows from its arguments alone', () => {
  assert.deepEqual(sketchBox(42, 300, 200, options), sketchBox(42, 300, 200, options));
  assert.notDeepEqual(sketchBox(42, 300, 200, options).lines[0], sketchBox(43, 300, 200, options).lines[0]);
  const box = sketchBox(42, 300, 200, options);
  assert.ok(box.lines.every((line) => line !== null && line.main.startsWith('M')));
  assert.ok(box.wash.endsWith('Z') && box.hatch.length > 0);
});

test('a bar is one stroke, and a round box one ring', () => {
  const bar = sketchBox(7, 400, 6, { ...options, bar: true });
  assert.ok(bar.lines[0] && bar.lines.slice(1).every((line) => line === null));
  const pill = sketchBox(7, 200, 80, { ...options, rx: 40, ry: 40, hatch: 0 });
  assert.ok(pill.lines[0] && pill.lines.slice(1).every((line) => line === null));
  assert.equal(pill.wash, '');
});

test('a text style becomes one declaration, with no word out of its closed set', () => {
  assert.equal(typeRule('weight', 700), 'font-weight:700!important');
  assert.equal(typeRule('italic', 1), 'font-style:italic!important');
  assert.equal(typeRule('align', 'center'), 'text-align:center!important');
  assert.equal(typeRule('align', 'x;color:red'), 'text-align:left!important');
});

test('a value read from a var() keeps only fallbacks that use one too', () => {
  assert.equal(drawnValue('red'), null);
  assert.equal(drawnValue('var(--a, red)'), 'var(--a)');
  assert.equal(drawnValue('var(--a, var(--b, red))'), 'var(--a, var(--b))');
  assert.equal(drawnValue('var(--a'), null);
});
