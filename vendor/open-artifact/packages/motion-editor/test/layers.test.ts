import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_LAYER_MOTION_CHOICE, MAX_RETOUCHED_LAYERS, RETOUCH_ID_PATTERN, playSeconds, filmSeconds, type ClockPart, type RetouchedRecord } from '@open-artifact/motion-core';
import type { LayerLook, LayerRow } from '@open-artifact/motion-stage/protocol';
import { describeMotionChoice } from '../src/layers/motion-words.ts';
import { layerStretch, partIndexAt, stretchTakesRetouch } from '../src/layers/stretch.ts';
import { findLayerAgain, holdersOf, layerIconKind, layerKey, layerSummary, layerToggleName, layerTypeLabel, showsLayerCaretColumn, visibleLayers } from '../src/layers/tree.ts';
import { applyChange, entryCounts, entryTarget, freshEntryId, opaqueHexColor, pairChange, pickedColor, takesEntries, touchKey } from '../src/layers/entry.ts';
import { appearanceRow, collectLayerTints } from '../src/layers/tints.ts';
import { hideKey, hidesToTell } from '../src/layers/lapsed-hides.ts';
import { boldToggle, isClearInk, trackingPx, typeRange } from '../src/layers/type-style.ts';

const motion = (how: LayerRow['enter']['how'], from: number, to: number) => ({ how, from: playSeconds(from), to: playSeconds(to) });

function look(over: Partial<LayerLook> = {}): LayerLook {
  return {
    cls: 'card',
    kin: '0/1',
    at: filmSeconds(1),
    fill: '#ff0000',
    ink: null,
    radius: null,
    most: 0,
    size: 1,
    hidden: 0,
    svgfill: null,
    svgstroke: null,
    entry: null,
    loose: false,
    home: false,
    lapsed: [],
    ...over,
  };
}

function row(over: Partial<LayerRow> = {}): LayerRow {
  return {
    id: 'intro:0.1/div',
    kind: 'shape',
    round: false,
    name: '',
    hidden: false,
    under: null,
    own: false,
    many: 0,
    texts: [],
    spans: [[playSeconds(0), playSeconds(5)]],
    at: playSeconds(1),
    enter: motion([], 0, 0),
    leave: motion([], 5, 5),
    box: [10, 10, 100, 50],
    wordsBox: null,
    look: look(),
    kids: [],
    sole: null,
    whole: false,
    drawn: '',
    full: false,
    ...over,
  };
}

function part(key: string | null, playStart: number, playDur: number): ClockPart {
  return {
    key,
    own: key ?? 'Chapter',
    label: key ?? 'Chapter',
    renamed: null,
    filmStart: filmSeconds(playStart),
    filmDur: filmSeconds(playDur),
    playStart: playSeconds(playStart),
    playDur: playSeconds(playDur),
    retimed: false,
  };
}

test('the stretch is the part the playhead is in, named by its scene in a film of scenes', () => {
  const parts = [part('intro', 0, 4), part('outro', 4, 6)];
  assert.equal(partIndexAt(parts, 0), 0);
  assert.equal(partIndexAt(parts, 3.99), 0);
  assert.equal(partIndexAt(parts, 4), 1);
  assert.equal(partIndexAt(parts, 99), 1);
  assert.equal(partIndexAt([], 2), -1);
  const scenes = [
    { id: 'intro', state: 'final' as const },
    { id: 'outro', state: 'rough' as const },
  ];
  const second = layerStretch(parts, scenes, 5, 10);
  assert.deepEqual([second.from, second.to, second.scene, second.index, second.count], [4, 10, 'outro', 1, 2]);
  assert.equal(stretchTakesRetouch(second, scenes), false);
  assert.equal(stretchTakesRetouch(layerStretch(parts, scenes, 1, 10), scenes), true);
  const chapters = layerStretch(parts, null, 5, 10);
  assert.equal(chapters.scene, null);
  assert.equal(stretchTakesRetouch(chapters, null), true);
  const none = layerStretch([], null, 2, 8);
  assert.deepEqual([none.from, none.to, none.scene], [0, 8, null]);
  assert.notEqual(layerStretch(parts, scenes, 1, 10).key, second.key);
});

test('rows are labelled by name, then by what they are; packs by what they hold', () => {
  assert.equal(layerTypeLabel(row({ name: 'Logo' })), 'Logo');
  assert.equal(layerTypeLabel(row({ kind: 'text', texts: ['Hello'] })), 'Text');
  assert.equal(layerTypeLabel(row({ round: true })), 'Oval');
  assert.equal(layerTypeLabel(row()), 'Rectangle');
  assert.equal(layerTypeLabel(row({ drawn: 'path' })), 'Path');
  assert.equal(layerTypeLabel(row({ kind: 'ground' })), 'Background');
  const pack = row({ id: 'intro:0.2/li*', many: 3, kids: [row({ kind: 'text' }), row({ kind: 'text' }), row({ kind: 'text' })] });
  assert.equal(layerTypeLabel(pack), 'Text');
  assert.equal(layerSummary(pack), '3 items');
  assert.equal(layerSummary(row({ texts: ['One', 'Two'] })), 'One');
  assert.equal(layerIconKind(pack), 'pack');
  assert.equal(layerIconKind(row({ round: true })), 'oval');
  assert.equal(layerIconKind(row({ kind: 'text' })), 'text');
  assert.equal(layerIconKind(row({ drawn: 'drawing' })), 'graphic');
});

test('eye buttons tell alike siblings apart', () => {
  const a = row({ id: 'intro:0.1/div', kind: 'text', texts: ['Go'] });
  const b = row({ id: 'intro:0.2/div', kind: 'text', texts: ['Go'] });
  const c = row({ id: 'intro:0.3/div', kind: 'text', texts: ['Stop'] });
  assert.equal(layerToggleName(b, [a, b, c]), 'Text, Go, 2 of 2');
  assert.equal(layerToggleName(c, [a, b, c]), 'Text, Stop');
});

test('the list shows rows whose holders are open, and opens the way to a pick', () => {
  const kid = row({ id: 'intro:0.1.0/span' });
  const holder = row({ id: 'intro:0.1/div', kind: 'group', kids: [kid] });
  const rows = [holder, row({ id: 'intro:0.2/div' })];
  assert.deepEqual(
    visibleLayers(rows, new Set()).map((placed) => placed.row.id),
    ['intro:0.1/div', 'intro:0.2/div'],
  );
  assert.deepEqual(
    visibleLayers(rows, new Set(['intro:0.1/div'])).map((placed) => placed.row.id),
    ['intro:0.1/div', 'intro:0.1.0/span', 'intro:0.2/div'],
  );
  assert.deepEqual(holdersOf(rows, 'intro:0.1.0/span'), ['intro:0.1/div']);
  assert.deepEqual(holdersOf(rows, null), []);
});

test('a pick is found again by id and look, or by the print of its words', () => {
  assert.equal(layerKey(row({ kind: 'text', texts: ['a  b'] })), 'text\n\n0\nab');
  const was = row({ id: 'intro:0.1/p', kind: 'text', texts: ['Hi'], look: look({ cls: 'title', kin: '0/2/abc' }) });
  const same = { ...was };
  assert.equal(findLayerAgain(was, [was], [same]), same);
  const moved = row({ id: 'intro:0.4/p', kind: 'text', texts: ['Hi'], look: look({ cls: 'title', kin: '1/2/abc' }) });
  assert.equal(findLayerAgain(was, [was], [moved]), moved);
  const other = row({ id: 'intro:0.4/p', kind: 'text', texts: ['Bye'], look: look({ cls: 'title', kin: '1/2/zzz' }) });
  assert.equal(findLayerAgain(was, [was], [other]), null);
  // A row with no look is found by id and the same words.
  const plain = row({ id: 'intro:0.5/p', kind: 'text', texts: ['Plain'], look: null });
  assert.equal(findLayerAgain(plain, [plain], [{ ...plain }])?.id, plain.id);
  assert.equal(findLayerAgain(plain, [plain], [{ ...plain, texts: ['Else'] }]), null);
});

test('the Animate summary says what was picked', () => {
  assert.equal(describeMotionChoice('text', 0, EMPTY_LAYER_MOTION_CHOICE, false), null);
  assert.equal(describeMotionChoice('text', 0, { ...EMPTY_LAYER_MOTION_CHOICE, enter: 'fade', pace: 'faster' }, false), 'Make this text fade in and move faster.');
  assert.equal(
    describeMotionChoice('image', 0, { ...EMPTY_LAYER_MOTION_CHOICE, enter: 'slide', enterFrom: 'top', leave: 'stay', when: 'later' }, true),
    'Make this image slide in from the top, stay until the scene ends and come in a little later.',
  );
  assert.equal(describeMotionChoice('shape', 4, { ...EMPTY_LAYER_MOTION_CHOICE, leave: 'shrink' }, false), 'Make each of these 4 shrink away as it leaves.');
  assert.equal(describeMotionChoice('ground', 0, { ...EMPTY_LAYER_MOTION_CHOICE, leave: 'stay' }, false), 'Make this background stay until the end.');
});

test('new entry ids name the place and tag, skip taken ones, and fit the record', () => {
  const id = freshEntryId('intro:0.3.1/h1', new Set(), 123456);
  assert.equal(id, 'intro:0.3.1.123.456/h1');
  assert.match(id, RETOUCH_ID_PATTERN);
  assert.equal(freshEntryId('intro:0.3.1/h1', new Set([id]), 123456), 'intro:0.3.1.123.457/h1');
  const deep = `intro:${Array.from({ length: 23 }, () => '1').join('.')}/span`;
  const short = freshEntryId(deep, new Set(), 5);
  assert.equal(short, 'intro:999.0.5/span');
  assert.match(short, RETOUCH_ID_PATTERN);
});

test('a change goes in the entry that marks the thing, a like one with the same words, or a new one', () => {
  const thing = row({ id: 'intro:0.1/p', texts: ['Hi'] });
  const fresh = entryTarget(thing, { ...look(), kin: '0/1' }, null, [], [], () => 7);
  assert.deepEqual(fresh, { id: 'intro:0.1.0.7/p', cls: 'card', kin: '0/1', at: 1, label: 'Hi' });
  const record: RetouchedRecord = { layers: [{ id: 'intro:0.1.9.9/p', cls: 'card', kin: '0/1/abc', at: 2, fill: { was: '#ff0000', v: '#00ff00' } }] };
  const marked = entryTarget(thing, { ...look({ entry: 'intro:0.1.9.9/p' }), kin: '0/1' }, record, [], [], () => 7);
  assert.deepEqual([marked.id, marked.kin, marked.at], ['intro:0.1.9.9/p', '0/1/abc', 2]);
  const byWords = entryTarget(thing, { ...look({ kin: '0/1/abc' }), kin: '0/1/abc' }, record, [], [], () => 7);
  assert.equal(byWords.id, 'intro:0.1.9.9/p');
  const lost = entryTarget(thing, { ...look({ kin: '0/1/abc' }), kin: '0/1/abc' }, record, [], ['intro:0.1.9.9/p'], () => 7);
  assert.equal(lost.id, 'intro:0.1.0.7/p');
  const seen = entryTarget(thing, { ...look(), kin: '0/1' }, record, [{ thing: thing.id, cls: 'card', kin: '0/1', entry: 'intro:0.1.4.4/p' }], [], () => 7);
  assert.equal(seen.id, 'intro:0.1.4.4/p');
  assert.equal(takesEntries(row({ id: 'intro:0.1/p+' }), look()), false);
  assert.equal(takesEntries(row(), look({ kin: null })), false);
  assert.equal(takesEntries(row(), look()), true);
});

test('a hide on a g keeps its parts, and one made again on a loose look is found as the stage sees it now', () => {
  const thing = row({ id: 'intro:0.1.2/g' });
  const g = { ...look({ cls: 'fish', kin: '1/2', parts: '0a1b2c.1f0000' }), kin: '1/2' };
  assert.deepEqual(entryTarget(thing, g, null, [], [], () => 7, 'hidden'), { id: 'intro:0.1.2.0.7/g', cls: 'fish', kin: '1/2', parts: '0a1b2c.1f0000', at: 1 });
  const record: RetouchedRecord = { layers: [{ id: 'intro:0.1.2.9.9/g', cls: 'fish', kin: '0/2', at: 3, hidden: { was: 0, v: 1 } }] };
  const marking = { ...g, entry: 'intro:0.1.2.9.9/g' };
  assert.deepEqual(entryTarget(thing, marking, record, [], [], () => 7, 'hidden'), { id: 'intro:0.1.2.9.9/g', cls: 'fish', kin: '0/2', at: 3 });
  const loose = { ...marking, loose: true };
  assert.deepEqual(entryTarget(thing, loose, record, [], [], () => 7, 'svgfill'), { id: 'intro:0.1.2.9.9/g', cls: 'fish', kin: '0/2', at: 3 });
  assert.deepEqual(entryTarget(thing, loose, record, [], [], () => 7, 'hidden'), { id: 'intro:0.1.2.9.9/g', cls: 'fish', kin: '1/2', parts: '0a1b2c.1f0000', at: 1 });
});

test('hides that may be showing again are told once, and not while another hide hides the thing', () => {
  const hide = (id: string) => ({ id, cls: 'fish', kin: '0/1', at: 1, hidden: { was: 0 as const, v: 1 as const } });
  const layers = [hide('intro:0.1.1/g'), hide('intro:0.1.2/g'), hide('intro:0.1.3/g'), hide('outro:0.1/g')];
  const lapsedLook = look({ entry: 'intro:0.1.3/g', home: true, lapsed: ['hidden'] });
  const report = { rows: [row({ look: lapsedLook })], lost: ['intro:0.1.1/g', 'intro:0.1.2/g', 'outro:0.1/g'], underHide: ['intro:0.1.2/g'] };
  const said = new Set<string>();
  assert.deepEqual(hidesToTell(layers, report, 'intro', false, said, null), { now: 2, ifKept: 0, told: null });
  assert.deepEqual(hidesToTell(layers, report, 'intro', false, said, null).now, 0, 'told once in a page');
  // Read first in this page: told only where the browser keeps the told list.
  assert.deepEqual(hidesToTell(layers, report, 'intro', true, new Set(), null), { now: 0, ifKept: 0, told: null });
  const kept = hidesToTell(layers, report, 'intro', true, new Set(), []);
  assert.equal(kept.ifKept, 2);
  assert.deepEqual(kept.told, [hideKey(layers[0]!), hideKey(layers[2]!)]);
  assert.equal(hidesToTell(layers, report, 'intro', false, new Set(), kept.told).now, 0, 'told once in this browser');
  // Holding again, a hide is forgotten, so it is told should it lapse again.
  const holds = { rows: [row({ look: look({ entry: 'intro:0.1.3/g', home: true }) })], lost: [], underHide: [] };
  assert.deepEqual(hidesToTell(layers, holds, 'intro', false, new Set(), kept.told).told, [hideKey(layers[0]!)]);
  assert.deepEqual(hidesToTell([], holds, 'intro', false, new Set(), kept.told).told, [], 'a hide taken back is forgotten');
});

test('pairs keep what the film gave; the film’s own value takes the change back; a full record refuses', () => {
  assert.deepEqual(pairChange('fill', '#ff0000', '#00ff00'), { property: 'fill', value: { was: '#ff0000', v: '#00ff00' } });
  assert.deepEqual(pairChange('fill', '#ff0000', '#ff0000'), { property: 'fill', value: null });
  assert.deepEqual(pairChange('fill', '#ff0000', null), { property: 'fill', value: null });
  assert.equal(pairChange('fill', null, '#00ff00'), null);
  assert.deepEqual(pairChange('hidden', 0, 1), { property: 'hidden', value: { was: 0, v: 1 } });
  assert.deepEqual(pairChange('hidden', 0, null), { property: 'hidden', value: null });
  assert.deepEqual(pairChange('leading', 'normal', 1.4), { property: 'leading', value: { was: 'normal', v: 1.4 } });
  const target = { id: 'intro:0.1.0.1/div', cls: 'card', kin: '0/1', at: 1 };
  const once = applyChange(null, target, { property: 'size', value: { was: 1, v: 2 } });
  assert.equal(once.took, true);
  assert.equal(once.record.layers.length, 1);
  const full: RetouchedRecord = {
    layers: Array.from({ length: MAX_RETOUCHED_LAYERS }, (_, index) => ({ id: `intro:0.${index}/div`, cls: '', kin: '0/1', at: 0, size: { was: 1, v: 2 } })),
  };
  assert.equal(applyChange(full, target, { property: 'size', value: { was: 1, v: 2 } }).took, false);
  assert.equal(applyChange(full, { ...target, id: 'intro:0.3/div' }, { property: 'size', value: null }).took, true);
});

test('an entry counts where the stage says it marks the thing, or where it was set since the reading', () => {
  const entry = { id: 'intro:0.1.1.1/div', cls: 'card', kin: '0/1', at: 1, fill: { was: '#ff0000', v: '#00ff00' } };
  assert.equal(entryCounts(entry, look({ entry: entry.id }), 'fill', new Set()), true);
  assert.equal(entryCounts(entry, look({ entry: entry.id, lapsed: ['fill'] }), 'fill', new Set()), false);
  assert.equal(entryCounts(entry, look(), 'fill', new Set()), false);
  assert.equal(entryCounts(entry, look(), 'fill', new Set([touchKey(entry.id, 'fill')])), true);
  assert.equal(entryCounts(entry, look({ entry: entry.id }), 'size', new Set()), false);
});

test('colors: opaque hex, and a picked color keeps the film’s alpha where asked', () => {
  assert.equal(opaqueHexColor('#FF0000'), '#ff0000');
  assert.equal(opaqueHexColor('#ff000080'), '#ff0000');
  assert.equal(opaqueHexColor('#ff000000'), undefined);
  assert.equal(opaqueHexColor(null), undefined);
  assert.equal(pickedColor('#00FF00', '#ff000080', true), '#00ff0080');
  assert.equal(pickedColor('#00ff00', '#ff000080', false), '#00ff00');
  assert.equal(pickedColor('rgb(0, 0, 255)', null, true), '#0000ff');
  assert.equal(pickedColor('nonsense', null, true), null);
  assert.equal(isClearInk('#11223300'), true);
  assert.equal(isClearInk('#112233'), false);
});

test('a drawing’s colors are gathered by hue, the largest first', () => {
  const part = (id: string, svgfill: string | null, svgstroke: string | null, box: [number, number, number, number]) =>
    row({ id, kind: 'shape', drawn: '', look: look({ svgfill, svgstroke, fill: null, size: null }), box });
  const big = part('intro:0.1.0/path', '#00ff00', null, [0, 0, 100, 100]);
  const small = part('intro:0.1.1/path', '#ff0000cc', '#00ff00', [0, 0, 10, 10]);
  const drawing = row({ id: 'intro:0.1/svg', kind: 'group', drawn: 'group', kids: [big, small], look: null });
  const tints = collectLayerTints(drawing);
  assert.deepEqual(
    tints.map((tint) => [tint.hue, tint.at.length]),
    [
      ['#00ff00', 2],
      ['#ff0000', 1],
    ],
  );
  assert.equal(tints[1]!.at[0]!.was, '#ff0000cc');
  assert.deepEqual(collectLayerTints(row()), []);
  assert.equal(appearanceRow(row({ sole: big })), big);
  assert.equal(appearanceRow(row({ sole: big, whole: true })).id, 'intro:0.1/div');
});

test('text style ranges widen to the film’s value, and letter spacing shows in pixels', () => {
  const px = typeRange('px', 24, 1080);
  assert.deepEqual([px.min, px.max], [8, 600]);
  assert.equal(px.keep(12.34), 12.3);
  assert.equal(px.keep(4000), 600);
  assert.equal(typeRange('px', 24, 360).max, 360);
  assert.equal(typeRange('px', 900, 1080).max, 900);
  const leading = typeRange('leading', 'normal', 1080);
  assert.deepEqual([leading.min, leading.max], [0.6, 3]);
  const tracking = typeRange('tracking', 0.02, 1080, 20);
  assert.deepEqual([tracking.min, tracking.max], [-3, 12]);
  assert.equal(tracking.keep(2), 0.1);
  assert.equal(trackingPx(0.05, 24), 1.2);
  assert.equal(trackingPx(0, 24), 0);
});

test('Bold turns the weight across 600, to the film’s own or the nearest to 700 or 400', () => {
  const weights = [300, 400, 500, 700, 900];
  assert.deepEqual(boldToggle(400, 400, weights), { pressed: false, to: 700 });
  assert.deepEqual(boldToggle(700, 400, weights), { pressed: true, to: 400 });
  assert.deepEqual(boldToggle(700, 500, weights), { pressed: true, to: 500 });
  assert.deepEqual(boldToggle(900, 900, [700, 900]), { pressed: true, to: 700 });
  assert.equal(boldToggle(400, 400, [400]), null);
  assert.equal(boldToggle(null, null, weights), null);
});

test('flat top-level layer lists omit the empty caret spacer; nested or expandable rows keep it', () => {
  const flat = [row({ id: 'a:0/p' }), row({ id: 'a:1/div' })];
  const withGroup = [row({ id: 'a:0/p' }), row({ id: 'a:1/g', kids: [row({ id: 'a:1.0/path' })] })];
  assert.equal(showsLayerCaretColumn(0, flat), false);
  assert.equal(showsLayerCaretColumn(0, withGroup), true);
  assert.equal(showsLayerCaretColumn(1, flat), true);
});
