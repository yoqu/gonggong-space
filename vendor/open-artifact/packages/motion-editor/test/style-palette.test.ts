import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmModule } from '@open-artifact/motion-core';
import {
  NO_PALETTE_SOURCES,
  ownFilm,
  paletteView,
  previewScale,
  readPaletteSources,
  recoloredFilm,
  styleSignature,
  wantsPalettePreviews,
  type PaletteViewInput,
} from '../src/style/palette-model.ts';

const json = (name: string, text: string): FilmModule => ({ name, kind: 'json', text });
const css = (name: string, text: string): FilmModule => ({ name, kind: 'css', text });

const LIGHT = ['#fafafa', '#1e293b', '#64748b', '#2563eb'];
const DARK = ['#0f172a', '#f8fafc', '#94a3b8', '#f43f5e'];
const BASE = `:root { --ground: ${LIGHT[0]}; --main: ${LIGHT[1]}; --second: ${LIGHT[2]}; --accent: ${LIGHT[3]}; }`;

const blueFilm = { script: "a.fill = '#2563eb'; b.fill = '#1d4ed8'; c.fill = '#93c5fd'; d.fill = '#111111';", modules: [] as FilmModule[], assets: [] };

const input = (over: Partial<PaletteViewInput>): PaletteViewInput => ({
  sources: NO_PALETTE_SOURCES,
  record: null,
  rough: false,
  timed: true,
  probed: undefined,
  remembered: undefined,
  kept: null,
  fell: false,
  original: false,
  ...over,
});

test('the style key follows the code, never the page’s own records', () => {
  const film = { script: 'x();', modules: [css('base.css', BASE)], assets: [] };
  const key = styleSignature(film);
  assert.equal(styleSignature({ ...film, modules: [...film.modules, json('recolored.json', '{"v":1,"colors":[]}'), json('refaced.json', '{"v":1}')] }), key);
  assert.notEqual(styleSignature({ ...film, script: 'y();' }), key);
  assert.notEqual(styleSignature({ ...film, modules: [css('base.css', BASE.replace('#fafafa', '#ffffff'))] }), key);
  assert.notEqual(styleSignature({ ...film, assets: [{ name: 'a.png', ref: 'r', mime: 'image/png' }] }), key);
});

test('previews draw the film without the page’s records, turned when asked', () => {
  const film = { script: blueFilm.script, modules: [json('recolored.json', '{"v":1,"colors":[{"was":"#2563eb","v":"#ff0000"}]}'), css('base.css', BASE)] };
  assert.deepEqual(
    ownFilm(film).modules.map((module) => module.name),
    ['base.css'],
  );
  const turned = recoloredFilm(film, [{ was: '#2563eb', v: '#16a34a' }]);
  assert.ok(turned.script.includes('#16a34a'));
  assert.ok(!turned.script.includes('#2563eb'));
  assert.ok(!turned.modules.some((module) => module.name === 'recolored.json'));
  assert.equal(recoloredFilm(film, []).script, film.script);
});

test('no palettes are offered for a rough cut', () => {
  const sources = readPaletteSources(blueFilm);
  assert.ok(sources.schemes.length > 0);
  assert.equal(paletteView(input({ sources, rough: true, probed: 0 })).view, null);
  assert.equal(wantsPalettePreviews(sources, true, true), false);
  assert.equal(wantsPalettePreviews(sources, false, false), false);
  assert.equal(wantsPalettePreviews(sources, false, true), true);
  assert.equal(wantsPalettePreviews(NO_PALETTE_SOURCES, false, true), false);
});

test('the chosen hues give the own palette and its turns, the first on show', () => {
  const sources = readPaletteSources(blueFilm);
  const before = paletteView(input({ sources }));
  assert.equal(before.view, null);
  const { view } = paletteView(input({ sources, probed: 0 }));
  assert.ok(view !== null);
  assert.equal(view.cards.length, 1 + (sources.schemes[0]?.shifts.length ?? 0));
  assert.deepEqual(
    view.states.map((card) => card.on),
    view.states.map((_card, index) => index === 0),
  );
  assert.equal(view.names[0], 'This animation’s own palette');
  assert.equal(view.names.length, view.cards.length);
});

test('a picked turn is on show and the hues it came from are remembered', () => {
  const sources = readPaletteSources(blueFilm);
  const shift = sources.schemes[0]?.shifts[0];
  assert.ok(shift !== undefined);
  const result = paletteView(input({ sources, record: { colors: shift.pairs } }));
  assert.equal(result.scheme, 0);
  const on = result.view?.states.findIndex((card) => card.on);
  assert.equal(on, 1);
});

test('colors no card offers stay as a card of their own', () => {
  const sources = readPaletteSources(blueFilm);
  const odd = [{ was: '#2563eb', v: '#000000' }];
  const result = paletteView(input({ sources, probed: 0, record: { colors: odd } }));
  assert.deepEqual(result.kept, odd);
  assert.deepEqual(result.view?.cards.at(-1)?.pairs, odd);
  assert.equal(result.view?.states.at(-1)?.on, true);
});

test('a film with offered palettes lists them once its length is known', () => {
  const film = { script: '', modules: [css('base.css', BASE), json('scenes.json', JSON.stringify({ palettes: [DARK], theirs: 0 }))] };
  const sources = readPaletteSources(film);
  assert.ok(sources.scenes !== null);
  assert.equal(paletteView(input({ sources, timed: false })).view, null);
  const { view } = paletteView(input({ sources }));
  assert.equal(view?.cards.length, 2);
  assert.deepEqual(view?.cards[1]?.bars, DARK);
});

test('previews are drawn 480 pixels wide, never taller than four times that', () => {
  assert.equal(previewScale(1920, 1080), 0.25);
  assert.equal(previewScale(100, 10000), 0.192);
});
