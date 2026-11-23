import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFilmFontSlots, type FontModule, type MissingFont } from '@open-artifact/motion-core';
import { fallbacksToTell, fontRows, googleFamiliesInUse, overFamilyLimit, refacedEditable, refacedTextFor, standInName, type FontRowsInput } from '../src/style/font-rows.ts';
import { MAX_CATALOG_MATCHES, searchFonts } from '../src/style/font-search.ts';

const css = (name: string, text: string): FontModule => ({ name, kind: 'css', text });
const json = (name: string, text: string): FontModule => ({ name, kind: 'json', text });

const STAGE_CSS = css('base.css', '#stage { font-family: var(--sans); } h1 { font-family: var(--display); }');
const SCENES = json('scenes.json', JSON.stringify({ v: 1, fonts: { sans: 'manrope' } }));
const SCRIPT = "title.textContent = 'Hello there';";

const input = (over: Partial<FontRowsInput> = {}): FontRowsInput => {
  const modules = over.modules ?? [STAGE_CSS, SCENES];
  return {
    script: SCRIPT,
    modules,
    shown: { script: SCRIPT, modules },
    ownCovered: true,
    retyped: false,
    refacedText: null,
    assets: [],
    families: ['Roboto', 'Lora'],
    fetches: true,
    touched: new Set(),
    ...over,
  };
};

test('a row for the headline and one for the body, the film’s own typeface first', () => {
  const { rows, notice } = fontRows(input());
  assert.equal(notice, null);
  assert.deepEqual(
    rows?.map((row) => [row.row, row.slot]),
    [
      ['head', 'display'],
      ['body', 'sans'],
    ],
  );
  const body = rows?.[1];
  assert.equal(body?.value, '');
  assert.equal(body?.options[0]?.value, '');
  assert.equal(body?.options[0]?.name, 'Manrope');
  assert.ok(!body?.options.slice(1).some((option) => option.value === 'manrope'));
  assert.ok(body?.options.some((option) => option.value === 'google:Lora' && option.google));
  assert.equal(rows?.[0]?.asBody, true);
});

test('no Google families are offered where none can be fetched', () => {
  const { rows } = fontRows(input({ fetches: false }));
  assert.ok(rows?.every((row) => row.options.every((option) => !option.google)));
});

test('a pick shows on its row and is written to refaced.json; Original clears it', () => {
  const slots = readFilmFontSlots([STAGE_CSS, SCENES], 'film');
  const text = refacedTextFor(null, slots, 'sans', 'fraunces');
  assert.ok(typeof text === 'string');
  const record = JSON.parse(text) as { v: number; sans: unknown };
  assert.equal(record.v, 1);
  assert.equal(record.sans, 'fraunces');
  const { rows } = fontRows(input({ refacedText: text }));
  assert.equal(rows?.find((row) => row.slot === 'sans')?.value, 'fraunces');
  assert.equal(refacedTextFor(text, slots, 'sans', ''), null);
  const google = refacedTextFor(null, slots, 'sans', 'google:Lora');
  assert.ok(typeof google === 'string');
  assert.deepEqual((JSON.parse(google) as { sans: unknown }).sans, { family: 'Lora', or: 'manrope' });
});

test('a slot a person picked for keeps its row though the code no longer names it', () => {
  const modules = [css('base.css', '#stage { font-family: var(--sans); }'), SCENES];
  const { rows } = fontRows(input({ modules, shown: { script: SCRIPT, modules }, touched: new Set(['mono']) }));
  assert.ok(rows?.some((row) => row.slot === 'mono'));
});

test('a record written by a newer page is left as it is', () => {
  assert.equal(refacedEditable(null), true);
  assert.equal(refacedEditable('{"v":1,"sans":"manrope"}'), true);
  assert.equal(refacedEditable('{"v":2,"sans":"manrope"}'), false);
  assert.equal(refacedEditable('not json'), false);
});

test('letters the built-ins lack keep the film in its own fonts, and say so', () => {
  const shown = { script: "title.textContent = '你好';", modules: [STAGE_CSS, SCENES] };
  const { rows, notice } = fontRows(input({ shown }));
  assert.equal(rows, null);
  assert.equal(notice, 'Some letters in this video aren’t in its fonts, so it now shows in system fonts.');
  const restore = fontRows(input({ shown, retyped: true, ownCovered: true }));
  assert.ok(restore.notice?.endsWith('Change the word back to get them back.'));
});

test('a film at its Google family limit takes no new family', () => {
  const own = json('scenes.json', JSON.stringify({ v: 1, fonts: { sans: { family: 'Roboto', or: 'manrope' }, serif: { family: 'Lora', or: 'fraunces' } } }));
  const film = readFilmFontSlots([STAGE_CSS, own], 'film');
  const picks = { mono: { family: 'Inconsolata', or: 'dm-mono' }, display: { family: 'Oswald', or: 'inter-display' } };
  assert.deepEqual([...googleFamiliesInUse(film, {})], ['Roboto', 'Lora']);
  assert.equal(overFamilyLimit(film, {}, 'display', 'google:Oswald'), false);
  assert.equal(googleFamiliesInUse(film, picks).size, 4);
  // The film's own families stay stored where a pick hides them, so a fifth family is one too many.
  assert.equal(overFamilyLimit(film, picks, 'sans', 'google:Anton'), true);
  assert.equal(overFamilyLimit(film, picks, 'sans', 'google:Oswald'), false);
  assert.equal(overFamilyLimit(film, picks, 'sans', 'manrope'), false);
  const modules = [STAGE_CSS, own];
  const rows = fontRows(input({ modules, shown: { script: SCRIPT, modules }, families: ['Anton', 'Oswald'], refacedText: JSON.stringify({ v: 1, ...picks }) })).rows;
  const sans = rows?.find((row) => row.slot === 'sans')?.options;
  assert.equal(sans?.find((option) => option.value === 'google:Anton')?.disabled, true);
  assert.equal(sans?.find((option) => option.value === 'google:Oswald')?.disabled, undefined);
});

test('search narrows the list by name and finds any catalog family', () => {
  const { rows } = fontRows(input());
  const options = rows?.[1]?.options ?? [];
  const found = searchFonts(options, '  LO ', ['Lora', 'Lobster', 'Manrope', 'Roboto']);
  assert.deepEqual(
    found.options.map((option) => option.value),
    ['', 'google:Lora'],
  );
  assert.deepEqual(
    found.more.map((option) => option.name),
    ['Lobster'],
  );
  assert.equal(searchFonts(options, '').options.length, options.length);
  const many = searchFonts(options, 'a', Array.from({ length: 50 }, (_unused, index) => `Family ${index} A`));
  assert.equal(many.more.length, MAX_CATALOG_MATCHES);
  const builtinOnly = options.filter((option) => !option.google);
  assert.deepEqual(searchFonts(builtinOnly, 'lo', ['Lobster']).more, []);
});

test('fallbacks are told once, and not where a person picked something else', () => {
  const missing: MissingFont[] = [
    { name: 'Lora', listed: true, slots: ['serif'], or: 'fraunces' },
    { name: 'Oswald', listed: true, slots: ['display'], or: 'inter-display' },
    { name: 'Coming', listed: true, slots: ['sans'], or: null, coming: true },
  ];
  const picks = { display: 'manrope' };
  assert.deepEqual(
    fallbacksToTell(missing, picks, new Set()).map((font) => font.name),
    ['Lora'],
  );
  assert.deepEqual(fallbacksToTell(missing, picks, new Set(['Lora'])), []);
  assert.equal(standInName(missing[0]!, picks), 'Fraunces');
  assert.equal(standInName(missing[1]!, picks), null);
});
