import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeFontCatalog,
  findGoogleFont,
  fontFamilyCss,
  fontMatchScore,
  fontRenders,
  googleFontStylesheetUrl,
  loadGoogleFontCatalog,
  normalizeFontName,
  searchFonts,
  type GoogleFont,
} from '../src/fonts.ts';
import { evaluateNumberInput, formatNumber, stepDecimals } from '../src/numbers.ts';

describe('font catalog', () => {
  it('loads and decodes the bundled catalog', async () => {
    const catalog = await loadGoogleFontCatalog();
    assert.ok(catalog.length > 1500, `only ${catalog.length} families`);
    assert.equal(await loadGoogleFontCatalog(), catalog, 'cached');
    const inter = findGoogleFont(catalog, 'inter')!;
    assert.equal(inter.category, 'sans-serif');
    assert.deepEqual(inter.weights, [100, 200, 300, 400, 500, 600, 700, 800, 900]);
    assert.ok(inter.axes.some((axis) => axis.tag === 'wght' && axis.min === 100 && axis.max === 900));
    const nunito = findGoogleFont(catalog, 'Nunito')!;
    assert.equal(nunito.weights.at(-1), 1000);
    const mono = findGoogleFont(catalog, 'JetBrains Mono')!;
    assert.equal(mono.category, 'monospace');
    // Ranks follow popularity order.
    assert.deepEqual(catalog.slice(0, 3).map((font) => font.rank), [0, 1, 2]);
    for (const font of catalog) {
      assert.ok(font.weights.length || font.italics.length, `${font.family} has no styles`);
      assert.ok(['sans-serif', 'serif', 'display', 'handwriting', 'monospace'].includes(font.category));
    }
  });

  it('decodes rows', () => {
    const [font] = decodeFontCatalog({ source: '', categories: ['sans-serif', 'serif'], families: [['Foo Serif', 1, '47', '4', 'wght:400:700']] });
    assert.deepEqual(font, { family: 'Foo Serif', category: 'serif', weights: [400, 700], italics: [400], axes: [{ tag: 'wght', min: 400, max: 700 }], rank: 0 });
  });
});

describe('font search', () => {
  const catalog: GoogleFont[] = decodeFontCatalog({
    source: '',
    categories: ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'],
    families: [
      ['Roboto', 0, '123456789', '123456789'],
      ['Open Sans', 0, '345678', '345678'],
      ['Roboto Mono', 4, '1234567', '1234567'],
      ['Playfair Display', 1, '456789', '456789'],
      ['IBM Plex Sans', 0, '1234567', '1234567'],
      ['Source Sans 3', 0, '23456789', '23456789'],
      ['Crimson Pro', 1, '23456789', '23456789'],
      ['Ròboto Slab', 1, '123456789', ''],
    ],
  });

  it('normalizes names', () => {
    assert.equal(normalizeFontName('  Ròboto_Slab!! '), 'roboto slab');
  });

  it('scores exact > prefix > word > substring > initials', () => {
    const scores = ['roboto', 'robo', 'mono', 'boto', 'pd'].map((q) => fontMatchScore(q === 'pd' ? 'Playfair Display' : q === 'mono' ? 'Roboto Mono' : 'Roboto', q));
    assert.deepEqual(scores, [100, 80, 60, 40, 30]);
    assert.equal(fontMatchScore('Roboto', 'xyz'), 0);
    assert.equal(fontMatchScore('IBM Plex Sans', 'plex sa'), 50);
    assert.equal(fontMatchScore('IBM Plex Sans', 'ibm sans'), 50);
    assert.equal(fontMatchScore('Source Sans 3', 'sourcesans'), 80);
  });

  it('ranks matches, then popularity', () => {
    assert.deepEqual(searchFonts(catalog, 'roboto').map((font) => font.family), ['Roboto', 'Roboto Mono', 'Ròboto Slab']);
    assert.deepEqual(searchFonts(catalog, 'sans').map((font) => font.family), ['Open Sans', 'IBM Plex Sans', 'Source Sans 3']);
    assert.deepEqual(searchFonts(catalog, '', { category: 'serif' }).map((font) => font.family), ['Playfair Display', 'Crimson Pro', 'Ròboto Slab']);
    assert.deepEqual(searchFonts(catalog, 'ro', { category: 'monospace' }).map((font) => font.family), ['Roboto Mono']);
    assert.equal(searchFonts(catalog, '', { limit: 2 }).length, 2);
    assert.deepEqual(searchFonts(catalog, 'zzz'), []);
  });

  it('searches the real catalog', async () => {
    const real = await loadGoogleFontCatalog();
    assert.equal(searchFonts(real, 'inter')[0]?.family, 'Inter');
    assert.equal(searchFonts(real, 'playfair disp')[0]?.family, 'Playfair Display');
    assert.ok(searchFonts(real, 'mono', { category: 'monospace' }).length > 10);
  });

  it('builds stylesheet URLs for weights the family has', () => {
    const roboto = catalog[0]!;
    const playfair = catalog[3]!;
    const slab = catalog[7]!;
    assert.equal(googleFontStylesheetUrl('Roboto', {}, roboto), 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
    assert.equal(googleFontStylesheetUrl('Roboto', { weights: [700, 300, 950] }, roboto), 'https://fonts.googleapis.com/css2?family=Roboto:wght@300;700&display=swap');
    assert.equal(
      googleFontStylesheetUrl('Playfair Display', { italic: true, weights: [400, 900] }, playfair),
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,900;1,400;1,900&display=swap',
    );
    // No italics in the family: none requested.
    assert.equal(googleFontStylesheetUrl('Ròboto Slab', { italic: true, weights: [400] }, slab), 'https://fonts.googleapis.com/css2?family=R%C3%B2boto+Slab&display=swap');
    // Unknown family: as asked.
    assert.equal(googleFontStylesheetUrl('Some Font', { weights: [500] }), 'https://fonts.googleapis.com/css2?family=Some+Font:wght@500&display=swap');
    assert.equal(
      googleFontStylesheetUrl('Inter', { variable: true, italic: true }, { family: 'Inter', category: 'sans-serif', weights: [400], italics: [400], axes: [{ tag: 'wght', min: 100, max: 900 }], rank: 0 }),
      'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&display=swap',
    );
    assert.equal(googleFontStylesheetUrl('Roboto', { weights: [400], text: 'Roboto' }, roboto), 'https://fonts.googleapis.com/css2?family=Roboto&display=swap&text=Roboto');
  });

  it('writes font-family values', () => {
    assert.equal(fontFamilyCss('Playfair Display', 'serif'), '"Playfair Display", serif');
    assert.equal(fontFamilyCss('Inter'), 'Inter, sans-serif');
    assert.equal(fontFamilyCss('monospace'), 'monospace');
    assert.equal(fontFamilyCss('Fira Code', 'monospace'), '"Fira Code", monospace');
  });

  it('detects rendering by measurement', () => {
    const widths: Record<string, number> = { '100px monospace': 600, '100px serif': 500, '100px "Here", monospace': 550, '100px "Here", serif': 550 };
    const measure = (font: string) => widths[font] ?? (font.includes('monospace') ? 600 : 500);
    assert.equal(fontRenders('Here', measure), true);
    assert.equal(fontRenders('Missing', measure), false);
    assert.equal(fontRenders('serif', measure), true);
    assert.equal(fontRenders('bad"name', measure), false);
  });
});

describe('number input', () => {
  it('reads numbers, units and arithmetic', () => {
    assert.deepEqual(evaluateNumberInput('12'), { value: 12 });
    assert.deepEqual(evaluateNumberInput(' 12px '), { value: 12, unit: 'px' });
    assert.deepEqual(evaluateNumberInput('-.5'), { value: -0.5 });
    assert.deepEqual(evaluateNumberInput('10 + 4 * 2'), { value: 18 });
    assert.deepEqual(evaluateNumberInput('(8+2)*2px'), { value: 20, unit: 'px' });
    assert.deepEqual(evaluateNumberInput('100/4%'), { value: 25, unit: '%' });
    assert.deepEqual(evaluateNumberInput('1,5'), { value: 1.5 });
    for (const text of ['', 'abc', '1px + 2em', '2 +', '1/0', '(1', 'alert(1)']) assert.equal(evaluateNumberInput(text), null, text);
  });

  it('rounds to the step', () => {
    assert.equal(stepDecimals(1), 0);
    assert.equal(stepDecimals(0.25), 2);
    assert.equal(stepDecimals(1e-7), 7);
    assert.equal(formatNumber(1.005, 1), '1');
    assert.equal(formatNumber(-0.0001, 2), '0');
  });
});
