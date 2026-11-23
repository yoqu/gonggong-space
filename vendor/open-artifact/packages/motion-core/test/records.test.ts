import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_RECUT_RECORD,
  EMPTY_RETOUCHED_RECORD,
  RECUT_ABOUT,
  buildClock,
  chapterClockParts,
  filmSeconds,
  isAllowedRecutDuration,
  isRetouchParts,
  parseChapters,
  parseFetchedFontsRecord,
  parseRecoloredRecord,
  parseRecutRecord,
  parseRefacedRecord,
  parseRetouchedRecord,
  parseRetypedRecord,
  playSeconds,
  recutExceedsFilmLimit,
  serializeRecoloredRecord,
  serializeRecutRecord,
  serializeRefacedRecord,
  serializeRetouchedRecord,
  serializeRetypedRecord,
  setRecoloredColor,
  setRecutScene,
  setRetouchProperty,
  setRetypedLine,
  withRefacedSceneFonts,
  type ClockPartInput,
  type RecutPart,
} from '../src/index.ts';

const parts: RecutPart[] = [
  { key: 'yard', own: 'The yard', filmDur: filmSeconds(4) },
  { key: 'gate', own: 'Gate', filmDur: filmSeconds(2) },
];
const inputs: ClockPartInput[] = parts.map((part) => ({ key: part.key, name: part.own, dur: part.filmDur }));

describe('recut', () => {
  it('bounds a scene length set by hand', () => {
    assert.equal(isAllowedRecutDuration(4, 2), true);
    assert.equal(isAllowedRecutDuration(4, 1.9), false);
    assert.equal(isAllowedRecutDuration(4, 12), true);
    assert.equal(isAllowedRecutDuration(4, 12.1), false);
    assert.equal(isAllowedRecutDuration(0.5, 0.9), true);
    assert.equal(isAllowedRecutDuration(2, 0.9), false);
  });

  it('sets, serializes and reads back lengths and names', () => {
    let record = setRecutScene(EMPTY_RECUT_RECORD, parts, 0, { kind: 'dur', dur: playSeconds(6) });
    record = setRecutScene(record, parts, 1, { kind: 'name', name: '  Way out ' });
    const text = serializeRecutRecord(record);
    assert.ok(text !== null);
    const json = JSON.parse(text) as { about: string; scenes: unknown[] };
    assert.equal(json.about, RECUT_ABOUT);
    assert.deepEqual(json.scenes, [
      { id: 'yard', dur: { was: 4, v: 6 } },
      { id: 'gate', name: { was: 'Gate', v: 'Way out' } },
    ]);
    assert.deepEqual(parseRecutRecord(text).scenes, record.scenes);
    const back = setRecutScene(record, parts, 0, { kind: 'dur', dur: playSeconds(4.0005) });
    assert.equal(back.scenes.length, 1);
  });

  it('drops a length the film no longer gives the scene', () => {
    const record = parseRecutRecord({ v: 1, scenes: [{ id: 'yard', dur: { was: 3, v: 6 } }] });
    assert.equal(buildClock(inputs, record).retimed, false);
  });

  it('plays at the film lengths when the lengths by hand pass 36000 s, keeping names', () => {
    const long: RecutPart[] = [{ key: 'a', own: 'A', filmDur: filmSeconds(12_000) }];
    const record = parseRecutRecord({ v: 1, scenes: [{ id: 'a', dur: { was: 12_000, v: 36_001 }, name: { was: 'A', v: 'Long' } }] });
    assert.equal(record.scenes[0]?.dur, undefined);
    const over = parseRecutRecord({
      v: 1,
      scenes: [
        { id: 'a', dur: { was: 12_000, v: 24_000 } },
        { id: 'b', dur: { was: 12_000, v: 18_000 }, name: { was: 'B', v: 'Bee' } },
      ],
    });
    const two: RecutPart[] = [...long, { key: 'b', own: 'B', filmDur: filmSeconds(12_000) }];
    assert.equal(recutExceedsFilmLimit(over, two), true);
    const clock = buildClock(
      two.map((part) => ({ key: part.key, name: part.own, dur: part.filmDur })),
      over,
    );
    assert.equal(clock.overLimit, true);
    assert.equal(clock.retimed, false);
    assert.equal(clock.parts[1]?.label, 'Bee');
  });
});

describe('clock', () => {
  it('maps film and play seconds through a retimed scene', () => {
    const record = setRecutScene(EMPTY_RECUT_RECORD, parts, 0, { kind: 'dur', dur: playSeconds(8) });
    const clock = buildClock(inputs, record);
    assert.equal(clock.retimed, true);
    assert.equal(clock.filmTotal, 6);
    assert.equal(clock.playTotal, 10);
    assert.equal(clock.toPlay(filmSeconds(2)), 4);
    assert.equal(clock.toPlay(filmSeconds(5)), 9);
    assert.equal(clock.toFilm(playSeconds(9)), 5);
    assert.equal(clock.toPlay(filmSeconds(7)), 11);
    assert.equal(clock.partAtPlay(playSeconds(8)), 1);
    assert.equal(clock.partAtFilm(filmSeconds(3.9)), 0);
  });

  it('is the identity with nothing set by hand', () => {
    const clock = buildClock(inputs);
    assert.equal(clock.toPlay(filmSeconds(3.3)), 3.3);
    assert.equal(clock.toFilm(playSeconds(5.5)), 5.5);
  });

  it('reads chapters into parts', () => {
    const chapters = parseChapters(
      [
        { t: 5, label: 'Two' },
        { t: -1, label: 'One' },
        { t: 1, label: '' },
      ],
      filmSeconds(9),
    );
    assert.deepEqual(chapters, [
      { t: 0, label: 'One' },
      { t: 5, label: 'Two' },
    ]);
    assert.deepEqual(
      chapterClockParts(chapters, filmSeconds(9)).map((part) => part.dur),
      [5, 4],
    );
  });
});

describe('retouched', () => {
  const target = { id: 'yard:3.1/h1', cls: 'title big', kin: '0/2/k3f9a', at: 1.5 };

  it('sets and takes back values by hand', () => {
    let record = setRetouchProperty(EMPTY_RETOUCHED_RECORD, { ...target, label: ' Hello ' }, { property: 'px', value: { was: 64, v: 80 } });
    record = setRetouchProperty(record, target, { property: 'fill', value: { was: '#ffffff', v: '#ff0000' } });
    assert.equal(record.layers[0]?.label, 'Hello');
    const text = serializeRetouchedRecord(record);
    assert.ok(text !== null);
    assert.deepEqual(parseRetouchedRecord(text), record);
    record = setRetouchProperty(record, target, { property: 'px', value: null });
    assert.equal(record.layers[0]?.label, undefined);
    record = setRetouchProperty(record, target, { property: 'fill', value: null });
    assert.equal(serializeRetouchedRecord(record), null);
  });

  it('passes over values of any other shape', () => {
    const record = parseRetouchedRecord({
      v: 1,
      layers: [
        { ...target, weight: { was: 400, v: 450 }, hidden: { was: 0, v: 1 } },
        { ...target, id: 'yard:3/div', svgfill: { was: '#000000', v: '#111111' } },
        { ...target, id: 'yard:4/path', svgfill: { was: '#000000', v: '#111111' } },
        { ...target, id: 'Bad' , fill: { was: '#000000', v: '#111111' } },
      ],
    });
    assert.deepEqual(
      record.layers.map((layer) => layer.id),
      ['yard:3.1/h1', 'yard:4/path'],
    );
    assert.equal(record.layers[0]?.weight, undefined);
    assert.deepEqual(record.layers[0]?.hidden, { was: 0, v: 1 });
  });

  it('keeps the parts of a hide only as the stage lays them out', () => {
    assert.equal(isRetouchParts('0a1b2c.1f0000.2e0000'), true);
    assert.equal(isRetouchParts('1f0000.0a1b2c'), false, 'out of order');
    assert.equal(isRetouchParts('1f0000.1f0000.1f0000.1f0000'), true);
    assert.equal(isRetouchParts('1f0000.1f0000.1f0000.1f0000.1f0000'), false, 'a fifth copy');
    const names = Array.from({ length: 13 }, (_, i) => '0' + (100000 + i).toString(16).slice(-5));
    assert.equal(isRetouchParts(names.slice(0, 12).join('.')), true);
    assert.equal(isRetouchParts(names.join('.')), false, 'a thirteenth name');
    assert.equal(isRetouchParts(Array.from({ length: 33 }, (_, i) => (0x100000 + i).toString(16)).join('.')), false, 'over 32');
    assert.equal(isRetouchParts('ABCDEF'), false);

    const g = { id: 'yard:2.1.7/g', cls: 'fish', kin: '0/1/a1b2c3', at: 1 };
    const record = parseRetouchedRecord({
      v: 1,
      layers: [
        { ...g, parts: '0a1b2c.1f0000', hidden: { was: 0, v: 1 } },
        { ...g, id: 'yard:2.1.8/g', parts: 'nope', hidden: { was: 0, v: 1 } },
      ],
    });
    assert.equal(record.layers[0]?.parts, '0a1b2c.1f0000');
    assert.equal(record.layers[1]?.parts, undefined);
    const text = serializeRetouchedRecord(record);
    assert.ok(text !== null);
    assert.deepEqual(Object.keys(JSON.parse(text).layers[0]), ['id', 'cls', 'kin', 'parts', 'at', 'hidden']);
  });

  it('finds a hide made again as its target finds the thing', () => {
    const g = { id: 'yard:2.1.7/g', cls: 'fish', kin: '0/1/a1b2c3', at: 1 };
    let record = setRetouchProperty(EMPTY_RETOUCHED_RECORD, { ...g, parts: '0a1b2c.1f0000' }, { property: 'hidden', value: { was: 0, v: 1 } });
    assert.equal(record.layers[0]?.parts, '0a1b2c.1f0000');
    record = setRetouchProperty(record, { ...g, at: 2 }, { property: 'svgfill', value: { was: '#000000', v: '#00ff00' } });
    assert.deepEqual([record.layers[0]?.at, record.layers[0]?.parts], [1, '0a1b2c.1f0000'], 'a color keeps how the entry finds it');
    record = setRetouchProperty(record, { ...g, kin: '1/2/a1b2c3', at: 3 }, { property: 'hidden', value: { was: 0, v: 1 } });
    assert.deepEqual([record.layers[0]?.kin, record.layers[0]?.at, record.layers[0]?.parts], ['1/2/a1b2c3', 3, undefined]);
    assert.deepEqual(record.layers[0]?.svgfill, { was: '#000000', v: '#00ff00' });
  });
});

describe('other records', () => {
  it('round-trips retyped lines', () => {
    const record = setRetypedLine({ lines: [] }, 'Hello', 'Hi "there"');
    assert.equal(record.lines[0]?.v, 'Hi “there”');
    assert.deepEqual(parseRetypedRecord(serializeRetypedRecord(record)).lines, record.lines);
  });

  it('round-trips recolored colors', () => {
    const record = setRecoloredColor({ colors: [] }, '#112233', '#445566');
    assert.deepEqual(parseRecoloredRecord(serializeRecoloredRecord(record)).colors, record.colors);
  });

  it('reads refaced slots and fetched fonts', () => {
    const refaced = parseRefacedRecord({ v: 1, sans: 'manrope', display: { family: 'Lobster', or: 'fraunces' } });
    assert.equal(refaced.slots.sans?.kind, 'builtin');
    assert.equal(refaced.slots.display?.kind, 'family');
    const text = serializeRefacedRecord(refaced);
    assert.ok(text !== null);
    assert.deepEqual(parseRefacedRecord(text).slots, refaced.slots);
    assert.deepEqual(parseFetchedFontsRecord({ v: 1, families: [{ family: 'Lobster', shown: 'zz', faces: [] }] }).families, []);
  });

  it('writes refaced slots into scenes.json fonts', () => {
    const refaced = parseRefacedRecord({ v: 1, sans: 'manrope', display: { family: 'Lobster', or: 'fraunces' } });
    const scenes = JSON.stringify({ scenes: [{ id: 'yard' }], fonts: { mono: 'jetbrains-mono', sans: 'inter' } });
    assert.deepEqual(JSON.parse(withRefacedSceneFonts(scenes, refaced)), {
      scenes: [{ id: 'yard' }],
      fonts: { mono: 'jetbrains-mono', sans: 'manrope', display: { family: 'Lobster', or: 'fraunces' } },
    });
    assert.equal(withRefacedSceneFonts(scenes, { slots: {} }), scenes);
    assert.equal(withRefacedSceneFonts('not json', refaced), 'not json');
  });
});
