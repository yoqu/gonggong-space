import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  builtinFontFileUrl,
  buildFilmFaces,
  catalogFamilyLicence,
  createGoogleFontFetcher,
  describeFontFallbacks,
  findCatalogFamily,
  fontFaceCss,
  fontStacks,
  getFontChoiceId,
  getFontRowLabel,
  getRepresentativeFontWeights,
  googleFontStylesheetUrl,
  hashShownFontText,
  mergeFontRequests,
  normalizeOfferedFontFamilies,
  parseCatalogFontRequest,
  parseGoogleFontStylesheet,
  pickedSlotValue,
  readFilmFontSlots,
  resolveFontFamily,
  selectFontFaces,
  stackCss,
  usableFontFaces,
  FONT_WORDS,
  SYSTEM_FONT_STACKS,
  type FontFetchIo,
  type FontModule,
  type GoogleFontFace,
} from '../src/fonts/index.ts';

const json = (name: string, value: unknown): FontModule => ({ name, kind: 'json', text: JSON.stringify(value) });
const FILE_URL = 'https://fonts.gstatic.com/s/inter/v13/latin400.woff2';
const block = (lines: readonly string[]): string => `@font-face {\n  ${lines.join(';\n  ')};\n}\n`;
const interBlock = (weight: number, url: string, range = 'U+0000-00FF'): string =>
  block([`font-family: 'Inter'`, 'font-style: normal', `font-weight: ${weight}`, `src: url(${url}) format('woff2')`, `unicode-range: ${range}`]);

describe('the Google Fonts catalog', () => {
  it('finds a family loosely and by its old name', () => {
    assert.equal(findCatalogFamily('inter'), 'Inter');
    assert.equal(findCatalogFamily('space-grotesk'), 'Space Grotesk');
    assert.equal(findCatalogFamily('Source Sans Pro'), 'Source Sans 3');
    assert.equal(findCatalogFamily('Not A Real Family'), undefined);
    assert.equal(findCatalogFamily(42), undefined);
  });

  it('knows each family’s licence', () => {
    assert.equal(catalogFamilyLicence('Inter'), 'OFL-1.1');
    assert.equal(catalogFamilyLicence('Ubuntu'), 'UFL-1.0');
    assert.equal(catalogFamilyLicence('Nope'), undefined);
  });

  it('reads requests with weights and merges them by family', () => {
    assert.deepEqual(parseCatalogFontRequest({ family: 'lato', weights: [300, 950, 'bold'] }), { family: 'Lato', weights: [300, 900] });
    assert.deepEqual(parseCatalogFontRequest('Lato'), { family: 'Lato', weights: [400, 700] });
    assert.equal(parseCatalogFontRequest('Unknown Family'), null);
    assert.deepEqual(
      mergeFontRequests([
        { family: 'Lato', weights: [400] },
        { family: 'Inter', weights: [700] },
        { family: 'Lato', weights: [900] },
      ]),
      [
        { family: 'Lato', weights: [400, 900] },
        { family: 'Inter', weights: [700] },
      ],
    );
  });
});

describe('css2 stylesheets', () => {
  it('asks for every weight by default', () => {
    assert.equal(googleFontStylesheetUrl('Space Grotesk', [400, 700]), 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700');
  });

  it('reads the family’s upright woff2 faces', () => {
    const sheet = interBlock(400, FILE_URL) + interBlock(700, 'https://fonts.gstatic.com/s/inter/v13/latin700.woff2', 'U+0400-04FF, U+0500');
    assert.deepEqual(parseGoogleFontStylesheet(sheet, 'Inter'), [
      { weight: 400, url: FILE_URL, ranges: [[0, 255]] },
      { weight: 700, url: 'https://fonts.gstatic.com/s/inter/v13/latin700.woff2', ranges: [[0x400, 0x4ff], [0x500, 0x500]] },
    ]);
  });

  it('drops a block with a property twice, another family, an italic, a foreign host or another format', () => {
    const twice = block([`font-family: 'Inter'`, 'font-style: normal', 'font-weight: 400', 'font-weight: 700', `src: url(${FILE_URL}) format('woff2')`]);
    const other = interBlock(400, FILE_URL).replace("'Inter'", "'Roboto'");
    const italic = interBlock(400, FILE_URL).replace('normal', 'italic');
    const foreign = interBlock(400, 'https://example.com/s/inter/v13/latin400.woff2');
    const truetype = interBlock(400, FILE_URL).replace("format('woff2')", "format('truetype')");
    const odd = interBlock(450, FILE_URL);
    for (const sheet of [twice, other, italic, foreign, truetype, odd]) assert.deepEqual(parseGoogleFontStylesheet(sheet, 'Inter'), []);
    assert.deepEqual(parseGoogleFontStylesheet(`${interBlock(400, FILE_URL)}/* é */`, 'Inter'), []);
  });
});

describe('choosing faces for the shown text', () => {
  const faces: GoogleFontFace[] = [
    { weight: 400, url: 'https://fonts.gstatic.com/s/x/v1/latin.woff2', ranges: [[0, 255]] },
    { weight: 400, url: 'https://fonts.gstatic.com/s/x/v1/cyrillic.woff2', ranges: [[0x400, 0x4ff]] },
    { weight: 700, url: 'https://fonts.gstatic.com/s/x/v1/latin7.woff2', ranges: [[0, 255]] },
  ];
  const points = (text: string): number[] => [...text].map((character) => character.codePointAt(0)!);

  it('takes the fewest files that show the text at the nearest weights', () => {
    const selected = selectFontFaces(faces, { weights: [400, 600] }, points('Hi Ж'), 12);
    assert.ok(Array.isArray(selected));
    assert.deepEqual(
      selected.map((face) => [face.url.split('/').at(-1), face.weight, face.sample]),
      [
        ['latin.woff2', '1 549', 'A'],
        ['cyrillic.woff2', '1 549', 'Ж'],
        ['latin7.woff2', '550 1000', 'A'],
      ],
    );
  });

  it('says why a family cannot be used', () => {
    assert.equal(selectFontFaces(faces, { weights: [400] }, points('Ā'), 12), FONT_WORDS.lacksCharacter('Ā'));
    assert.equal(selectFontFaces(faces, { weights: [400] }, points('Ж'), 1), FONT_WORDS.overFileRoom(12));
    assert.equal(selectFontFaces([], { weights: [400] }, [], 12), FONT_WORDS.stylesheetUnusable);
  });

  it('hashes the shown characters regardless of their order', () => {
    assert.equal(hashShownFontText([]), '811c9dc5');
    assert.equal(hashShownFontText([66, 65]), hashShownFontText([65, 66]));
    assert.match(hashShownFontText(points('Hello')), /^[0-9a-f]{8}$/);
  });
});

describe('refaced slots', () => {
  const modules: FontModule[] = [
    json('scenes.json', { v: 1, fonts: { sans: 'manrope', display: { family: 'Inter', or: 'inter-display' } } }),
    json('refaced.json', { v: 1, serif: 'fraunces', sans: { family: 'Lato', or: 'instrument' }, mono: 'Comic Sans' }),
  ];
  const ids = (faces: Partial<Record<string, { id: string }>>): Record<string, string> =>
    Object.fromEntries(Object.entries(faces).map(([slot, face]) => [slot, face!.id]));

  it('shows a person’s picks over the film’s own', () => {
    const slots = readFilmFontSlots(modules, 'shown');
    assert.deepEqual(ids(slots.faces), { sans: 'instrument', serif: 'fraunces', display: 'inter-display' });
    assert.deepEqual(slots.other, { sans: { family: 'Lato', or: 'instrument' }, display: { family: 'Inter', or: 'inter-display' } });
    assert.equal(slots.odd, false);
  });

  it('reads the film alone, and only the picks that are fetched', () => {
    assert.deepEqual(ids(readFilmFontSlots(modules, 'film').faces), { sans: 'manrope', display: 'inter-display' });
    const asked = readFilmFontSlots(modules, 'asked');
    assert.deepEqual(ids(asked.faces), { sans: 'instrument', display: 'inter-display' });
    assert.deepEqual(Object.keys(asked.other).sort(), ['display', 'sans']);
  });

  it('marks fonts that are not a record of slots', () => {
    assert.equal(readFilmFontSlots([json('scenes.json', { v: 1, fonts: { title: 'manrope' } })]).odd, true);
    assert.equal(readFilmFontSlots([json('scenes.json', { v: 1, fonts: 'manrope' })]).odd, true);
  });

  it('builds the stage faces, sharing a family where slots share a typeface', () => {
    const urlOf = (file: string): string => `data:font/woff2;base64,${Buffer.from(file).toString('base64')}`;
    const faces = buildFilmFaces(modules, urlOf);
    assert.ok(faces !== null);
    assert.deepEqual(faces.slots, { sans: 'Film Sans', serif: 'Film Serif', display: 'Film Display' });
    assert.equal(faces.fonts.length, 2 + 1 + 3);
    assert.equal(faces.films, true);
    assert.deepEqual(faces.shipped, { films: true });
    const shared = buildFilmFaces([json('scenes.json', { v: 1, fonts: { sans: 'instrument', display: 'instrument-sans' } })], urlOf);
    assert.deepEqual(shared?.slots, { sans: 'Film Sans', display: 'Film Sans' });
    assert.equal(shared?.fonts.length, 2);
    assert.equal(buildFilmFaces([json('scenes.json', { v: 1 })], urlOf), null);
  });
});

describe('stage css', () => {
  const face = { family: 'Film Sans', weight: '400 600', style: 'normal', url: 'data:font/woff2;base64,AAAA', range: 'U+0-FF', box: [97, 24] } as const;

  it('writes an @font-face rule with the box overrides', () => {
    assert.equal(
      fontFaceCss(face),
      '\n@font-face{font-family:"Film Sans";src:url(data:font/woff2;base64,AAAA) format("woff2");font-weight:400 600;font-style:normal;unicode-range:U+0-FF;ascent-override:97%;descent-override:24%;line-gap-override:0%;font-display:block}',
    );
  });

  it('keeps only faces whose fields are safe', () => {
    const unsafe = [{ ...face, family: 'x"}body{' }, { ...face, url: 'https://example.com/a.woff2' }, { ...face, range: 'U+0-FF;x' }, null];
    assert.deepEqual(usableFontFaces([face, ...unsafe]), [face]);
  });

  it('writes each slot’s stack and the custom properties', () => {
    const { stacks, filled } = fontStacks({ sans: 'Film Sans', mono: 'Film Mono' });
    assert.deepEqual(filled, ['sans', 'mono']);
    assert.equal(stacks.sans, `"Film Sans", ${SYSTEM_FONT_STACKS.sans}`);
    assert.equal(stacks.display, `"Film Sans", "Film Sans", ${SYSTEM_FONT_STACKS.sans}`);
    assert.equal(stacks.serif, SYSTEM_FONT_STACKS.serif);
    assert.equal(stackCss(stacks, filled), `:where(:root){--sans:${stacks.sans};--mono:${stacks.mono}}`);
  });
});

describe('the Font panel’s choices', () => {
  it('names a slot’s value by its choice id', () => {
    assert.equal(getFontChoiceId('instrument-sans'), 'instrument');
    assert.equal(getFontChoiceId({ family: 'Lato', or: 'fraunces' }), 'google:Lato');
    assert.equal(getFontChoiceId(42), null);
  });

  it('writes a choice back as the slot’s value', () => {
    assert.equal(pickedSlotValue('', undefined, 'sans', false), null);
    assert.equal(pickedSlotValue('manrope', undefined, 'sans', false), 'manrope');
    assert.deepEqual(pickedSlotValue('google:Lora', undefined, 'serif', true), { family: 'Lora', or: 'fraunces' });
    assert.deepEqual(pickedSlotValue('google:Inter', resolveFontFamily('manrope'), 'sans', false), { family: 'Inter', or: 'manrope' });
  });

  it('offers catalog families that are not built in', () => {
    assert.deepEqual(normalizeOfferedFontFamilies(['lato', 'Lato', 'Space Grotesk', 'Nope', 3]), ['Lato']);
    const common = normalizeOfferedFontFamilies();
    assert.equal(common.length, 15);
    assert.ok(!common.includes('Manrope') && !common.includes('Space Grotesk'));
  });

  it('labels rows, telling sans from serif only when both show', () => {
    assert.equal(getFontRowLabel({ row: 'body' }, [{ row: 'body' }]), 'Text');
    assert.equal(getFontRowLabel({ row: 'sans' }, [{ row: 'head' }, { row: 'sans' }]), 'Other text');
    assert.equal(getFontRowLabel({ row: 'serif' }, [{ row: 'sans' }, { row: 'serif' }]), 'Serif');
  });

  it('describes fallbacks in sentences', () => {
    const text = describeFontFallbacks(
      [
        { name: 'Lato', listed: true, slots: ['sans'] },
        { name: 'Comic', listed: false, slots: ['mono'] },
        { name: 'Lora', listed: true, slots: [], crowded: true },
      ],
      () => 'Instrument Sans',
    );
    assert.equal(
      text,
      'The font Lato couldn’t be loaded, so this video shows Instrument Sans instead. “Comic” isn’t a font this video can load, so it shows Instrument Sans instead. The font Lora couldn’t be loaded: this video already uses 4 Google Fonts families, the most it can load. Text set in Lora keeps the video’s own font.',
    );
  });

  it('lists the weights a menu offers', () => {
    assert.deepEqual(getRepresentativeFontWeights([[400, 700]]), [400, 500, 600, 700]);
    assert.deepEqual(
      getRepresentativeFontWeights([
        [1, 549],
        [550, 649],
        [650, 1000],
      ]),
      [500, 600, 700],
    );
  });
});

describe('the Google Fonts fetcher', () => {
  const fileBytes = new Uint8Array(readFileSync(builtinFontFileUrl('DMMono-500.woff2')));
  const fakeIo = (answers: Record<string, () => Response>, asked: string[]): FontFetchIo => ({
    fetch: async (url) => {
      asked.push(url);
      return (answers[url] ?? (() => new Response('', { status: 404 })))();
    },
    now: () => 0,
    after: () => () => undefined,
  });

  it('fetches the sheet and the files the text needs', async () => {
    const asked: string[] = [];
    const io = fakeIo(
      {
        [googleFontStylesheetUrl('Inter')]: () => new Response(interBlock(400, FILE_URL)),
        [FILE_URL]: () => new Response(fileBytes),
      },
      asked,
    );
    const [result] = await createGoogleFontFetcher(io)([{ family: 'Inter', weights: [400] }], () => [72, 105]);
    assert.ok(result !== undefined && result.faces !== null);
    assert.equal(result.faces.length, 1);
    assert.equal(result.faces[0]!.weight, '1 1000');
    assert.equal(result.faces[0]!.bytes.length, fileBytes.length);
    assert.ok(result.faces[0]!.data.startsWith('data:font/woff2;base64,'));
    assert.deepEqual(asked, [googleFontStylesheetUrl('Inter'), FILE_URL]);
  });

  it('says a family is unavailable when its sheet fails', async () => {
    const [result] = await createGoogleFontFetcher(fakeIo({}, []))([{ family: 'Inter', weights: [400] }], () => []);
    assert.equal(result?.faces, null);
    assert.ok(result !== undefined && result.faces === null && result.why === FONT_WORDS.unavailable);
  });

  it('refuses a file that is not woff2', async () => {
    const io = fakeIo(
      {
        [googleFontStylesheetUrl('Inter')]: () => new Response(interBlock(400, FILE_URL)),
        [FILE_URL]: () => new Response('not a font'),
      },
      [],
    );
    const [result] = await createGoogleFontFetcher(io)([{ family: 'Inter', weights: [400] }], () => [72]);
    assert.ok(result !== undefined && result.faces === null && result.cause === 'invalid_content');
  });
});
