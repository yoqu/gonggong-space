import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FilmModule } from '../src/documents.ts';
import {
  MAX_HUE_GROUPS,
  chooseDistinctRecolorSample,
  collectNonColorHexTokens,
  colorMixSecondShare,
  colorName,
  compareRecoloredPixels,
  deriveHueGroups,
  equalColorPairs,
  hasUnsafePaletteSources,
  paletteCardNames,
  paletteCardStates,
  paletteCards,
  paletteRecolor,
  paletteReplacementPairs,
  parseScenePaletteOptions,
  readScenePalettes,
  recolorSampleTimes,
  recordForChoice,
  schemeForColors,
  stripNeutralColorMixes,
  summarizeRecoloredPixels,
} from '../src/palettes/index.ts';
import { applyRecolored } from '../src/recolor/index.ts';
import { filmSources } from '../src/retype/index.ts';

const css = (name: string, text: string): FilmModule => ({ name, kind: 'css', text });
const json = (name: string, text: string): FilmModule => ({ name, kind: 'json', text });

const LIGHT = ['#fafafa', '#1e293b', '#64748b', '#2563eb'];
const DARK = ['#0f172a', '#f8fafc', '#94a3b8', '#f43f5e'];
const BASE = `:root { --ground: ${LIGHT[0]}; --main: ${LIGHT[1]}; --second: ${LIGHT[2]}; --accent: ${LIGHT[3]}; }`;

const filmWith = (script: string, extra: FilmModule[] = [], palettes: unknown = [DARK, ['#fffbeb', '#1c1917', '#78716c', '#16a34a']], theirs = 0) => ({
  script,
  modules: [css('base.css', BASE), json('scenes.json', JSON.stringify({ palettes, theirs })), ...extra],
});

describe('scene palettes', () => {
  it('reads one to five palettes of four colors', () => {
    assert.deepEqual(parseScenePaletteOptions('{"palettes":[["#AAAAAA","#000000","#111111","#222222"]],"theirs":1}'), {
      options: [['#aaaaaa', '#000000', '#111111', '#222222']],
      theirs: 1,
    });
    assert.equal(parseScenePaletteOptions('{"palettes":[["#aaaaaa","#000000","#111111"]]}'), null);
    assert.equal(parseScenePaletteOptions('{"palettes":[]}'), null);
    assert.equal(parseScenePaletteOptions('{"palettes":[["#aaaaaa","#000000","#111111","red"]]}'), null);
    assert.equal(parseScenePaletteOptions('{"palettes":[["#aaaaaa","#000000","#111111","#222222"]],"theirs":4}')?.theirs, 0);
  });

  it('maps the own palette onto another role by role', () => {
    assert.deepEqual(paletteReplacementPairs(LIGHT, DARK), LIGHT.map((was, index) => ({ was, v: DARK[index]! })));
    assert.deepEqual(paletteReplacementPairs(['#000000', '#ffffff', '#000000', '#ff0000'], ['#111111', '#eeeeee', '#111111', '#00ff00']), [
      { was: '#000000', v: '#111111' },
      { was: '#ffffff', v: '#eeeeee' },
      { was: '#ff0000', v: '#00ff00' },
    ]);
    assert.equal(paletteReplacementPairs(['#000000', '#ffffff', '#000000', '#ff0000'], ['#111111', '#eeeeee', '#222222', '#00ff00']), null);
    assert.deepEqual(paletteRecolor(LIGHT, LIGHT), { colors: [] });
  });

  it('offers the palettes over the own one, a dark one only when every color follows the palette', () => {
    const safe = readScenePalettes(filmSources(filmWith("ctx.fillStyle = '#2563eb';")));
    assert.ok(safe !== null);
    assert.deepEqual(safe.own.bars, LIGHT);
    assert.equal(safe.options.length, 2);
    const unsafe = readScenePalettes(filmSources(filmWith("ctx.fillStyle = 'hsl(10, 50%, 50%)';")));
    assert.deepEqual(
      unsafe?.options.map((option) => option.bars[0]),
      ['#fffbeb'],
    );
    const asked = readScenePalettes(filmSources(filmWith("ctx.fillStyle = 'hsl(10, 50%, 50%)';", [], [DARK], 1)));
    assert.deepEqual(asked?.options.map((option) => option.role), [{ theirs: true }]);
  });

  it('marks the own palette as theirs when they asked for it', () => {
    const scenes = readScenePalettes(filmSources(filmWith('', [], [LIGHT, DARK], 1)));
    assert.deepEqual(scenes?.own.role, { theirs: true });
    assert.equal(scenes?.options.length, 1);
  });
});

describe('unsafe palette sources', () => {
  const sources = (script: string, extra: FilmModule[] = []) => filmSources(filmWith(script, extra));

  it('is safe when every color is one of the palette', () => {
    assert.equal(hasUnsafePaletteSources(sources("ctx.fillStyle = '#2563eb'; shadow = 'rgba(0, 0, 0, .3)';"), LIGHT), false);
  });

  it('is unsafe for other colors, color functions, short hex, names and numeric colors', () => {
    assert.equal(hasUnsafePaletteSources(sources("ctx.fillStyle = '#ff0000';"), LIGHT), true);
    assert.equal(hasUnsafePaletteSources(sources("ctx.fillStyle = 'oklch(50% 0.1 20)';"), LIGHT), true);
    assert.equal(hasUnsafePaletteSources(sources('', [css('look.css', 'p { color: #fff; }')]), LIGHT), true);
    assert.equal(hasUnsafePaletteSources(sources('', [css('look.css', 'p { color: white; }')]), LIGHT), true);
    assert.equal(hasUnsafePaletteSources(sources('const c = 0xff8800;'), LIGHT), true);
    assert.equal(hasUnsafePaletteSources(sources('', [json('data.json', '{"c":"#ff0000"}')]), LIGHT), true);
  });

  it('ignores words that only look like color names', () => {
    assert.equal(hasUnsafePaletteSources(sources("say('The red fox');", [css('look.css', '.red-box { color: var(--main); }')]), LIGHT), false);
  });

  it('strips the color mixes a palette leaves alone', () => {
    assert.equal(colorMixSecondShare(undefined, undefined), 0.5);
    assert.equal(colorMixSecondShare('80', undefined), 0.2);
    assert.equal(stripNeutralColorMixes('a: color-mix(in srgb, var(--main) 80%, black); b'), 'a: ; b');
    assert.equal(stripNeutralColorMixes('a: color-mix(in srgb, white 20%, var(--main))'), 'a: ');
    assert.equal(stripNeutralColorMixes('color-mix(in srgb, var(--main), white)'), 'color-mix(in srgb, var(--main), white)');
    assert.equal(stripNeutralColorMixes('color-mix(in oklab, black 40%, transparent)'), '');
  });
});

describe('hue groups', () => {
  const blueFilm = {
    script: "a.fill = '#2563eb'; b.fill = '#1d4ed8'; c.fill = '#93c5fd'; d.fill = '#111111';",
    modules: [],
  };

  it('offers turns of the film’s vivid hues', () => {
    const schemes = deriveHueGroups(filmSources(blueFilm));
    assert.equal(schemes.length, 1);
    const scheme = schemes[0]!;
    assert.deepEqual(scheme.own.pairs, []);
    assert.ok(scheme.shifts.length >= 1 && scheme.shifts.length <= MAX_HUE_GROUPS);
    assert.ok(scheme.probe.some((pair) => pair.was === '#2563eb'));
    assert.ok(['#2563eb', '#1d4ed8'].includes(scheme.own.bars[0]!));
    for (const shift of scheme.shifts) assert.ok(shift.pairs.every((pair) => pair.was !== '#111111'));
    const turned = applyRecolored(blueFilm, recordForChoice(scheme.shifts[0]!));
    assert.equal(turned.met, scheme.shifts[0]!.pairs.length);
  });

  it('turns nothing in a film of warm and gray tones', () => {
    assert.deepEqual(deriveHueGroups(filmSources({ script: "a.fill = '#c8a27a'; b.fill = '#777777';", modules: [] })), []);
  });

  it('reads digit-only hex tokens in words as no color', () => {
    const tokens = collectNonColorHexTokens([{ name: '', kind: 'js', text: "say('Order #123456 shipped'); const list = ['#2563eb', '#654321']; tag('#999999');" }]);
    assert.deepEqual([...tokens], ['#123456', '#999999']);
  });
});

describe('palette cards', () => {
  const schemes = deriveHueGroups(filmSources({ script: "a.fill = '#2563eb'; b.fill = '#1d4ed8';", modules: [] }));

  it('lists the own palette, the turns, and keeps colors set elsewhere as a card', () => {
    const plain = paletteCards({ schemes, scheme: 0, scenes: null, timed: true, colors: [], kept: null });
    assert.equal(plain.cards?.length, 1 + schemes[0]!.shifts.length);
    assert.equal(plain.kept, null);
    const odd = [{ was: schemes[0]!.own.bars[0]!, v: '#000000' }];
    const withOdd = paletteCards({ schemes, scheme: 0, scenes: null, timed: true, colors: odd, kept: null });
    assert.deepEqual(withOdd.kept, odd);
    assert.deepEqual(withOdd.cards?.at(-1)?.pairs, odd);
    assert.equal(withOdd.cards?.at(-1)?.bars[0], '#000000');
  });

  it('shows the code and the changed colors when nothing else is offered', () => {
    const colors = [{ was: '#2563eb', v: '#000000' }];
    const { cards } = paletteCards({ schemes: [], scheme: -1, scenes: null, timed: true, colors, kept: null });
    assert.deepEqual(cards?.map((card) => card.bars), [['#2563eb'], ['#000000']]);
    assert.equal(paletteCards({ schemes: [], scheme: -1, scenes: null, timed: true, colors: [], kept: null }).cards, null);
  });

  it('marks the card the film shows, and finds the scheme the colors come from', () => {
    const { cards } = paletteCards({ schemes, scheme: 0, scenes: null, timed: true, colors: [], kept: null });
    const shift = cards![1]!;
    const states = paletteCardStates(cards!, shift.pairs, { fell: false, original: false });
    assert.deepEqual(
      states.map((state) => state.on),
      cards!.map((_card, index) => index === 1),
    );
    assert.equal(paletteCardStates(cards!, shift.pairs, { fell: false, original: true })[0]!.on, true);
    assert.equal(schemeForColors(schemes, null, shift.pairs), 0);
    assert.equal(schemeForColors(schemes, null, []), -1);
    assert.equal(equalColorPairs(shift.pairs, [...shift.pairs].reverse()), true);
  });

  it('names cards by hue, and the person’s palettes as theirs', () => {
    assert.equal(colorName('#ff0000'), 'Red');
    assert.equal(colorName('#0000ff'), 'Blue');
    assert.equal(colorName('#808080'), 'Gray');
    assert.equal(colorName('#8b4513'), 'Brown');
    const names = paletteCardNames([
      { bars: LIGHT, role: { theirs: false } },
      { bars: DARK, role: { theirs: true } },
      { bars: ['#0f172a', '#f8fafc', '#94a3b8', '#e11d48'], role: { theirs: false } },
      { bars: ['#0f172a', '#f8fafc', '#94a3b8', '#be123c'], role: { theirs: false } },
      { bars: ['#16a34a'] },
      { bars: LIGHT, role: { theirs: true } },
    ]);
    assert.deepEqual(names, ['This animation’s own palette', 'Yours', 'Red on dark', 'Red on dark 2', 'Green palette', 'Yours 2']);
  });
});

describe('recolor samples', () => {
  it('compares pictures and picks a set that shows clearly', () => {
    const before = new Uint8ClampedArray([37, 99, 235, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]);
    const after = new Uint8ClampedArray([235, 99, 37, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]);
    const tally = compareRecoloredPixels(before, after, [262]);
    assert.deepEqual(tally, [2, 1, 1, 1]);
    assert.deepEqual(summarizeRecoloredPixels([tally]), { changes: 0.5, covered: 1 });
    assert.equal(chooseDistinctRecolorSample([{ changes: 0.5, covered: 1 }, { changes: 0.1, covered: 1 }]), 0);
    assert.equal(chooseDistinctRecolorSample([{ changes: 0.5, covered: 1 }, { changes: 0.3, covered: 1 }]), -1);
    assert.equal(chooseDistinctRecolorSample([{ changes: 0.5, covered: 0.2 }]), -1);
    assert.deepEqual(recolorSampleTimes(12), [1, 3, 5, 7, 9, 11]);
  });
});
