import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectFontUses,
  embedDeckFonts,
  fontNoticeText,
  fontsourceId,
  googleFamily,
  licenceAllowsEmbedding,
  noteFontEmbedding,
  pickSubset,
  readCatalogFamily,
  styleOf,
  wantedCuts,
  FONTSOURCE_API,
  type EmbeddingOptions,
  type FontUse,
} from '../src/services/export/font-embedding.ts';
import { containsGlyph, EOT_MAGIC, EOT_VERSION, fsTypeAllowsEmbedding, panoseHex, readFontTables, wrapEot } from '../src/services/export/font-tables.ts';
import { ExportNotes, nameList } from '../src/services/export/notes.ts';
import { fetchRetrying } from '../src/services/export/assets.ts';
import { lateFontFamilies } from '../src/render/fonts.ts';
import { pptxEntries, type Paragraph, type PptxSlide } from '../src/services/export/ooxml.ts';

const text = (data: Uint8Array | string): string => (typeof data === 'string' ? data : new TextDecoder().decode(data));

/** A minimal sfnt with OS/2, head, name, glyf (and fvar when asked). */
function makeFont(options: { family?: string; subfamily?: string; fsType?: number; weight?: number; italic?: boolean; variable?: boolean; cff?: boolean; pad?: number } = {}): Uint8Array {
  const { family = 'Test Sans', subfamily = 'Regular', fsType = 0, weight = 400, italic = false } = options;
  const os2 = new Uint8Array(96);
  const o = new DataView(os2.buffer);
  o.setUint16(4, weight);
  o.setUint16(8, fsType);
  os2.set([2, 11, 5, 3, 3, 4, 3, 2, 2, 4], 32);
  o.setUint32(42, 1);
  o.setUint16(62, italic ? 1 : 0x40);
  o.setUint32(78, 1);
  const head = new Uint8Array(54);
  new DataView(head.buffer).setUint32(8, 0x12345678);
  const names: [number, string][] = [
    [0, 'Copyright 2020 The Test Project Authors'],
    [1, family],
    [2, subfamily],
    [4, `${family} ${subfamily}`],
    [5, 'Version 1.000'],
  ];
  const strings = names.map(([, value]) => {
    const bytes = new Uint8Array(value.length * 2);
    const v = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++) v.setUint16(i * 2, value.charCodeAt(i));
    return bytes;
  });
  const nameHeader = 6 + names.length * 12;
  const name = new Uint8Array(nameHeader + strings.reduce((sum, s) => sum + s.length, 0));
  const n = new DataView(name.buffer);
  n.setUint16(2, names.length);
  n.setUint16(4, nameHeader);
  let offset = 0;
  names.forEach(([id], i) => {
    const at = 6 + i * 12;
    n.setUint16(at, 3);
    n.setUint16(at + 2, 1);
    n.setUint16(at + 4, 1033);
    n.setUint16(at + 6, id);
    n.setUint16(at + 8, strings[i]!.length);
    n.setUint16(at + 10, offset);
    name.set(strings[i]!, nameHeader + offset);
    offset += strings[i]!.length;
  });
  const tables: [string, Uint8Array][] = [
    ['OS/2', os2],
    [options.cff ? 'CFF ' : 'glyf', new Uint8Array(16 + (options.pad ?? 0))],
    ['head', head],
    ['name', name],
  ];
  if (options.variable) tables.push(['fvar', new Uint8Array(16)]);
  let size = 12 + tables.length * 16;
  const offsets = tables.map(([, data]) => {
    const at = size;
    size += Math.ceil(data.length / 4) * 4;
    return at;
  });
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, options.cff ? 0x4f54544f : 0x00010000);
  view.setUint16(4, tables.length);
  tables.forEach(([tag, data], i) => {
    const at = 12 + i * 16;
    for (let c = 0; c < 4; c++) out[at + c] = tag.charCodeAt(c);
    view.setUint32(at + 8, offsets[i]!);
    view.setUint32(at + 12, data.length);
    out.set(data, offsets[i]!);
  });
  return out;
}

describe('font tables', () => {
  it('reads flavor, names and OS/2', () => {
    const info = readFontTables(makeFont({ fsType: 8, weight: 700, italic: true, subfamily: 'Bold Italic' }));
    assert.equal(info.flavor, 'truetype');
    assert.ok(info.tables.includes('glyf'));
    assert.equal(info.names.family, 'Test Sans');
    assert.equal(info.names.subfamily, 'Bold Italic');
    assert.equal(info.names.copyright, 'Copyright 2020 The Test Project Authors');
    assert.equal(info.os2?.fsType, 8);
    assert.equal(info.os2?.weightClass, 700);
    assert.equal(info.os2?.italic, true);
    assert.equal(info.checkSumAdjustment, 0x12345678);
    assert.equal(panoseHex(info), '020B0503030403020204');
  });

  it('tells other kinds of file apart', () => {
    assert.equal(readFontTables(makeFont({ cff: true })).flavor, 'cff');
    const woff2 = new Uint8Array(24);
    new DataView(woff2.buffer).setUint32(0, 0x774f4632);
    new DataView(woff2.buffer).setUint32(16, 5000);
    assert.deepEqual(readFontTables(woff2).flavor, 'woff2');
    assert.equal(readFontTables(woff2).extent, 5000);
    assert.equal(readFontTables(new Uint8Array(4)).flavor, 'unknown');
    assert.equal(readFontTables(new TextEncoder().encode('ttcf........')).flavor, 'collection');
  });

  it('allows embedding by fsType', () => {
    assert.equal(fsTypeAllowsEmbedding(0), true); // installable
    assert.equal(fsTypeAllowsEmbedding(2), false); // restricted
    assert.equal(fsTypeAllowsEmbedding(4), false); // preview & print
    assert.equal(fsTypeAllowsEmbedding(8), true); // editable
    assert.equal(fsTypeAllowsEmbedding(4 | 8), true);
    assert.equal(fsTypeAllowsEmbedding(8 | 0x200), false); // bitmap only
  });

  it('wraps TrueType as EOT', () => {
    const ttf = makeFont({ fsType: 8, weight: 700 });
    const eot = wrapEot(ttf);
    const view = new DataView(eot.buffer);
    assert.equal(view.getUint32(0, true), eot.byteLength);
    assert.equal(view.getUint32(4, true), ttf.byteLength);
    assert.equal(view.getUint32(8, true), EOT_VERSION);
    assert.equal(view.getUint32(12, true), 0);
    assert.equal(eot[26], 1); // charset
    assert.equal(view.getUint32(28, true), 700);
    assert.equal(view.getUint16(32, true), 8);
    assert.equal(view.getUint16(34, true), EOT_MAGIC);
    assert.equal(view.getUint32(60, true), 0x12345678);
    // Family name follows the 80-byte fixed part (after 2 bytes of padding), UTF-16LE.
    const familySize = view.getUint16(82, true);
    assert.equal(familySize, 'Test Sans'.length * 2);
    assert.equal(new TextDecoder('utf-16le').decode(eot.subarray(84, 84 + familySize)), 'Test Sans');
    assert.deepEqual(eot.subarray(eot.byteLength - ttf.byteLength), ttf);
  });
});

describe('font embedding: choices', () => {
  it('names families', () => {
    assert.equal(fontsourceId('Playfair Display'), 'playfair-display');
    assert.equal(fontsourceId('M PLUS 1p'), 'm-plus-1p');
    assert.equal(googleFamily({ family: 'Body', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap' }), 'Inter');
    assert.equal(googleFamily({ family: 'Lora' }), 'Lora');
    assert.equal(styleOf(400, false), 'regular');
    assert.equal(styleOf(700, true), 'boldItalic');
  });

  it('accepts open licenses only', () => {
    assert.ok(licenceAllowsEmbedding('OFL-1.1'));
    assert.ok(licenceAllowsEmbedding('Apache-2.0'));
    assert.ok(licenceAllowsEmbedding('UFL-1.0'));
    assert.ok(!licenceAllowsEmbedding('Proprietary'));
    assert.ok(!licenceAllowsEmbedding(undefined));
  });

  it('picks the subset covering most of the text', () => {
    const family = { subsets: ['cyrillic', 'latin', 'greek'], unicodeRange: { latin: 'U+0000-00FF', cyrillic: 'U+0400-045F', greek: 'U+0370-03FF' } };
    assert.deepEqual(pickSubset(family, new Set([...'Hello'].map((c) => c.codePointAt(0)!))), { subset: 'latin', partial: false });
    assert.deepEqual(pickSubset(family, new Set([...'Привет мир'].map((c) => c.codePointAt(0)!))), { subset: 'cyrillic', partial: false });
    assert.deepEqual(pickSubset(family, new Set([...'Hi Привет'].map((c) => c.codePointAt(0)!))), { subset: 'cyrillic', partial: true });
    // Characters no subset has do not make the choice partial.
    assert.deepEqual(pickSubset(family, new Set([...'Hi 你好'].map((c) => c.codePointAt(0)!))), { subset: 'latin', partial: false });
  });

  it('wants regular and bold, italics when used, and only cuts that exist', () => {
    assert.deepEqual(wantedCuts({ weights: [300, 400, 700], styles: ['normal', 'italic'] }, false), [
      { weight: 400, style: 'normal' },
      { weight: 700, style: 'normal' },
    ]);
    assert.equal(wantedCuts({ weights: [400, 700], styles: ['normal', 'italic'] }, true).length, 4);
    assert.deepEqual(wantedCuts({ weights: [400], styles: ['normal'] }, true), [{ weight: 400, style: 'normal' }]);
    assert.deepEqual(wantedCuts({ weights: [300, 900], styles: ['normal'] }, false), [{ weight: 300, style: 'normal' }]);
  });

  it('reads the catalog', () => {
    const family = readCatalogFamily(
      {
        family: 'Inter',
        subsets: ['latin'],
        weights: [400, 700],
        styles: ['normal'],
        license: 'OFL-1.1',
        unicodeRange: { latin: 'U+0000-00FF' },
        variants: { 400: { normal: { latin: { url: { ttf: 'https://cdn.example/inter-400.ttf' } } } } },
      },
      'inter',
    );
    assert.equal(family?.licence, 'OFL-1.1');
    assert.equal(family?.ttf(400, 'normal', 'latin'), 'https://cdn.example/inter-400.ttf');
    assert.match(family!.ttf(700, 'normal', 'latin'), /fontsource\/fonts\/inter@latest\/latin-700-normal\.ttf$/);
    assert.equal(readCatalogFamily({ error: 'not found' }, 'x'), null);
  });

  it('collects the families of exported text', () => {
    const run = (value: string, font: string, italic = false) => ({ text: value, size: 20, font, italic: italic || undefined });
    const slides: PptxSlide[] = [
      {
        elements: [
          { type: 'shape', name: 'Text 1', box: { x: 0, y: 0, w: 10, h: 10 }, geometry: { preset: 'rect' }, fill: { type: 'none' }, text: { inset: { l: 0, t: 0, r: 0, b: 0 }, paragraphs: [{ endSize: 20, runs: [run('Hello', 'Inter'), run('Hi', 'Lora', true)] }] } },
          {
            type: 'table',
            name: 'Table 1',
            box: { x: 0, y: 0, w: 10, h: 10 },
            columns: [10],
            rows: [{ height: 10, cells: [{ fill: { type: 'none' }, borders: {}, text: { inset: { l: 0, t: 0, r: 0, b: 0 }, paragraphs: [{ endSize: 20, runs: [run('Cell', 'inter')] }] } }] }],
          },
        ],
      },
    ];
    const uses = collectFontUses(slides);
    assert.deepEqual([...uses.keys()].sort(), ['inter', 'lora']);
    assert.equal(uses.get('inter')!.chars, 9);
    assert.equal(uses.get('inter')!.italic, false);
    assert.equal(uses.get('lora')!.italic, true);
  });

  it('counts a marker drawn in the text font among that font\u2019s characters', () => {
    const body = (bullet: NonNullable<Paragraph['bullet']>) => ({ inset: { l: 0, t: 0, r: 0, b: 0 }, paragraphs: [{ endSize: 20, bullet, runs: [{ text: 'ab', size: 20, font: 'Inter' }] }] });
    const shape = (bullet: NonNullable<Paragraph['bullet']>) => ({ type: 'shape' as const, name: 'List 1', box: { x: 0, y: 0, w: 10, h: 10 }, geometry: { preset: 'rect' as const }, fill: { type: 'none' as const }, text: body(bullet) });
    const uses = collectFontUses([{ elements: [shape({ type: 'char', char: '→ ', ownFont: true }), shape({ type: 'char', char: '•' })] }]);
    const inter = uses.get('inter')!;
    assert.ok(inter.codePoints.has('→'.codePointAt(0)!));
    assert.ok(!inter.codePoints.has('•'.codePointAt(0)!));
    assert.equal(inter.chars, 6);
  });
});

describe('font embedding: fetching and the budget', () => {
  const use = (family: string, sample: string, italic = false): [string, FontUse] => [
    family.toLowerCase(),
    { family, codePoints: new Set([...sample].map((c) => c.codePointAt(0)!)), italic, chars: sample.length },
  ];
  const catalog = (licence = 'OFL-1.1', weights = [400, 700]) => ({ family: 'X', subsets: ['latin'], weights, styles: ['normal', 'italic'], license: licence, unicodeRange: { latin: 'U+0000-00FF' } });

  /** Fetchers serving the given catalog answers and font files by URL fragment. */
  function fetchers(answers: Record<string, unknown>, files: (url: string) => Uint8Array | null): EmbeddingOptions {
    return {
      async fetchJson(url) {
        const id = url.slice(FONTSOURCE_API.length);
        if (!(id in answers)) throw new Error('fetch 404');
        return answers[id];
      },
      async fetchBytes(url) {
        const data = files(url);
        if (!data) throw new Error('fetch 404');
        return data;
      },
    };
  }

  it('carries open fonts and leaves out the rest with a reason', async () => {
    const uses = new Map([use('Inter', 'Hello world, this is long'), use('Closed', 'Hi'), use('Wavy', 'Hey'), use('Locked', 'Yo'), use('Gone', 'Ok'), use('Arial', 'Not declared')]);
    const faces = ['Inter', 'Closed', 'Wavy', 'Locked', 'Gone'].map((family) => ({ family, href: `https://fonts.googleapis.com/css2?family=${family}` }));
    const result = await embedDeckFonts(
      uses,
      faces,
      fetchers({ inter: catalog(), closed: catalog('Proprietary'), wavy: catalog(), locked: catalog() }, (url) => {
        if (url.includes('/inter@')) return makeFont({ family: 'Inter', weight: url.includes('-700-') ? 700 : 400 });
        if (url.includes('/wavy@')) return makeFont({ family: 'Wavy', variable: true });
        if (url.includes('/locked@')) return makeFont({ family: 'Locked', fsType: 2 });
        return null;
      }),
    );
    assert.deepEqual(
      result.families.map((f) => [f.family, f.outcome]),
      [
        ['Inter', 'carried'],
        ['Wavy', 'variable'],
        ['Closed', 'licence'],
        ['Locked', 'licence'],
        ['Gone', 'fetch'],
      ],
    );
    assert.deepEqual(
      result.fonts.map((f) => [f.typeface, f.style]),
      [
        ['Inter', 'regular'],
        ['Inter', 'bold'],
      ],
    );
    assert.equal(result.fonts[0]!.pitchFamily, 0x22);
    assert.equal(new DataView(result.fonts[0]!.data.buffer).getUint16(34, true), EOT_MAGIC);
    assert.match(fontNoticeText(result)!, /Inter \(OFL-1\.1\): Copyright 2020/);

    const notes = new ExportNotes();
    noteFontEmbedding(notes, result);
    assert.deepEqual(notes.list(), [
      'Closed and Locked: not embedded because their licenses do not allow it, so a substitute shows where they are not installed.',
      'Wavy: not embedded because they are only published as variable fonts, which PowerPoint cannot embed.',
      'Gone: not embedded because their files could not be downloaded.',
    ]);
  });

  it('tells files that took too long apart from files that failed', async () => {
    const uses = new Map([use('Slow', 'Taking its time'), use('Gone', 'Ok')]);
    const faces = ['Slow', 'Gone'].map((family) => ({ family, href: `https://fonts.googleapis.com/css2?family=${family}` }));
    const options: EmbeddingOptions = {
      async fetchJson(url) {
        if (url.endsWith('gone')) throw new Error('fetch 404');
        return catalog();
      },
      fetchBytes: (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      deadlineMs: 20,
    };
    const result = await embedDeckFonts(uses, faces, options);
    assert.deepEqual(result.families.map((f) => [f.family, f.outcome]), [['Slow', 'slow'], ['Gone', 'fetch']]);
    const notes = new ExportNotes();
    noteFontEmbedding(notes, result);
    assert.deepEqual(notes.list(), [
      'Gone: not embedded because their files could not be downloaded.',
      'Slow: not embedded because their files took too long to download; exporting again may carry them.',
    ]);
  });

  it('gives the budget to the most used families first', async () => {
    const uses = new Map([use('Small', 'ab'), use('Big', 'a lot of text set in this family')]);
    const faces = [{ family: 'Small', href: 'https://fonts.googleapis.com/css2?family=Small' }, { family: 'Big', href: 'https://fonts.googleapis.com/css2?family=Big' }];
    const font = makeFont({ pad: 2000 });
    const result = await embedDeckFonts(uses, faces, { ...fetchers({ small: catalog('OFL-1.1', [400]), big: catalog('OFL-1.1', [400]) }, () => font), budget: font.byteLength + 100 });
    assert.deepEqual(result.families, [
      { family: 'Big', outcome: 'carried' },
      { family: 'Small', outcome: 'budget', afterOthers: true },
    ]);
    const notes = new ExportNotes();
    noteFontEmbedding(notes, result);
    assert.match(notes.list()[0]!, /^Small: not embedded because there was no room left/);
  });

  it('adds italics when used and notes missing styles', async () => {
    const uses = new Map([use('Serif', 'Words', true)]);
    const result = await embedDeckFonts(
      uses,
      [{ family: 'Serif', href: 'https://fonts.googleapis.com/css2?family=Serif' }],
      fetchers({ serif: catalog() }, (url) => (url.includes('-700-italic') ? null : makeFont({ family: 'Serif', weight: url.includes('-700-') ? 700 : 400, italic: url.includes('italic') }))),
    );
    assert.deepEqual(
      result.fonts.map((f) => f.style),
      ['regular', 'bold', 'italic'],
    );
    assert.deepEqual(result.stylesMissing, ['Serif']);
  });

  it('carries an uploaded TrueType file by its own weight and style', async () => {
    const uses = new Map([use('Brand', 'Brand text')]);
    const result = await embedDeckFonts(uses, [{ family: 'Brand', src: '/_blob/abc' }], {
      ...fetchers({}, () => null),
      readFile: async (src) => (src === '/_blob/abc' ? makeFont({ family: 'Brand', weight: 700 }) : null),
    });
    assert.deepEqual(
      result.fonts.map((f) => [f.typeface, f.style]),
      [['Brand', 'bold']],
    );
    const otf = await embedDeckFonts(uses, [{ family: 'Brand', src: '/_blob/otf' }], { ...fetchers({}, () => null), readFile: async () => makeFont({ cff: true }) });
    assert.deepEqual(otf.families, [{ family: 'Brand', outcome: 'format' }]);
  });
});

describe('fetching for an export', () => {
  const answer = (status: number) => new Response(status === 200 ? 'ok' : null, { status });
  /** A fetch answering the statuses in turn ('throw' fails like a dropped connection) and recording each request's cache mode. */
  function scripted(...answers: Array<number | 'throw'>) {
    const calls: Array<RequestCache | undefined> = [];
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init?.cache);
      const next = answers.shift() ?? 200;
      if (next === 'throw') throw new TypeError('Failed to fetch');
      return answer(next);
    }) as typeof fetch;
    return { fetcher, calls };
  }

  it('tries once more, past the cache, after a network error or a busy server', async () => {
    for (const first of ['throw', 503, 429, 408] as const) {
      const { fetcher, calls } = scripted(first, 200);
      assert.equal((await fetchRetrying('https://x.test/a.woff2', {}, fetcher)).status, 200, String(first));
      assert.deepEqual(calls, [undefined, 'reload']);
    }
  });

  it('takes a missing file or a second failure as the answer', async () => {
    const missing = scripted(404);
    assert.equal((await fetchRetrying('https://x.test/a.woff2', {}, missing.fetcher)).status, 404);
    assert.equal(missing.calls.length, 1);
    const twice = scripted(503, 502);
    assert.equal((await fetchRetrying('https://x.test/a.woff2', {}, twice.fetcher)).status, 502);
    assert.equal(twice.calls.length, 2);
  });

  it('does not try again once the export gave up', async () => {
    const stop = new AbortController();
    stop.abort();
    const { fetcher, calls } = scripted('throw');
    await assert.rejects(fetchRetrying('https://x.test/a.woff2', { signal: stop.signal }, fetcher));
    assert.equal(calls.length, 1);
  });
});

describe('fonts still loading when a slide is drawn', () => {
  it('names each family once, without quotes', () => {
    const faces = [
      { family: '"Inter"', status: 'loading' },
      { family: 'Inter', status: 'loading' },
      { family: "'Lora'", status: 'loading' },
      { family: 'Mono', status: 'loaded' },
      { family: 'Gone', status: 'error' },
    ];
    assert.deepEqual(lateFontFamilies(faces), ['Inter', 'Lora']);
  });

  it('notes them once, and not for a family another font note already names', () => {
    const notes = new ExportNotes();
    notes.family('fontLate', 'Inter');
    notes.family('fontLate', 'Lora');
    notes.family('fontLate', 'Inter');
    notes.family('fontFetch', 'Lora');
    assert.deepEqual(notes.list(), [
      'Lora: not embedded because their files could not be downloaded.',
      'Inter: had not finished loading when the slides were drawn, so some of their text may show in a fallback font; exporting again may help.',
    ]);
  });
});

describe('embedded fonts in the package', () => {
  it('writes fntdata parts, relationships and the font list', () => {
    const data = new Uint8Array([1, 2, 3]);
    const entries = pptxEntries({
      title: 'Deck',
      slides: [{ elements: [] }],
      media: [],
      fonts: [
        { typeface: 'Inter', style: 'bold', data, charset: 0, pitchFamily: 34 },
        { typeface: 'Inter', style: 'regular', data, charset: 0, pitchFamily: 34, panose: '020B0503030403020204' },
      ],
      description: 'Fonts: Inter (OFL-1.1)',
    });
    const part = (name: string): string => text(entries.find((entry) => entry.name === name)!.data);
    assert.ok(entries.some((entry) => entry.name === 'ppt/fonts/font1.fntdata'));
    assert.ok(entries.some((entry) => entry.name === 'ppt/fonts/font2.fntdata'));
    assert.match(part('[Content_Types].xml'), /<Default Extension="fntdata" ContentType="application\/x-fontdata"\/>/);
    const rels = part('ppt/_rels/presentation.xml.rels');
    assert.match(rels, /relationships\/font" Target="fonts\/font1\.fntdata"/);
    const presentation = part('ppt/presentation.xml');
    assert.match(presentation, /embedTrueTypeFonts="1"/);
    assert.match(presentation, /<p:embeddedFont><p:font typeface="Inter" pitchFamily="34" charset="0"\/><p:regular r:id="rId\d+"\/><p:bold r:id="rId\d+"\/><\/p:embeddedFont>/);
    // Schema order: notesSz, embeddedFontLst, defaultTextStyle.
    assert.ok(presentation.indexOf('<p:notesSz') < presentation.indexOf('<p:embeddedFontLst>'));
    assert.ok(presentation.indexOf('</p:embeddedFontLst>') < presentation.indexOf('<p:defaultTextStyle>'));
    assert.match(part('docProps/core.xml'), /<dc:description>Fonts: Inter \(OFL-1\.1\)<\/dc:description>/);
  });

  it('writes nothing extra without fonts', () => {
    const entries = pptxEntries({ title: 'Deck', slides: [{ elements: [] }], media: [] });
    assert.ok(!entries.some((entry) => entry.name.startsWith('ppt/fonts/')));
    assert.doesNotMatch(text(entries.find((entry) => entry.name === 'ppt/presentation.xml')!.data), /embeddedFontLst|embedTrueTypeFonts/);
  });
});

describe('export notes: fonts and effects', () => {
  it('lists families', () => {
    assert.equal(nameList(['A']), 'A');
    assert.equal(nameList(['A', 'B', 'A']), 'A and B');
    assert.equal(nameList(['A', 'B', 'C']), 'A, B and C');
  });

  it('orders slide notes, then font notes, then free text', () => {
    const notes = new ExportNotes();
    notes.text('The deck was still being written: only 3 of 8 planned slides were included.');
    notes.family('fontPartial', 'Noto Sans');
    notes.add('shadowInset', 4);
    notes.add('backgroundPicture', 2);
    notes.add('backgroundPicture', 5);
    assert.deepEqual(notes.list(), [
      'Backgrounds PowerPoint cannot draw (pictures, patterns, radial or see-through gradients) became pictures (slides 2 and 5).',
      'Inner shadows were left out (PowerPoint shapes carry outer shadows only) (slide 4).',
      'Noto Sans: embedded for one script only: characters of other scripts show in a substitute font.',
      'The deck was still being written: only 3 of 8 planned slides were included.',
    ]);
  });
});

describe('embedded font glyph coverage', () => {
  it('looks up BMP glyphs and rejects a missing glyph or an invalid offset', () => {
    const cmap = new DataView(new ArrayBuffer(38));
    cmap.setUint16(2, 1);
    cmap.setUint32(8, 12);
    cmap.setUint16(12, 4);
    cmap.setUint16(14, 26);
    cmap.setUint16(18, 2);
    cmap.setUint16(26, 0x4e01);
    cmap.setUint16(30, 0x4e00);
    cmap.setUint16(34, 2);
    cmap.setUint16(36, 7);
    assert.equal(containsGlyph(cmap, 0x4e00), true);
    assert.equal(containsGlyph(cmap, 0x4e01), false);
    cmap.setUint16(36, 0);
    assert.equal(containsGlyph(cmap, 0x4e00), false);
    cmap.setUint16(34, 0xfffe);
    assert.equal(containsGlyph(cmap, 0x4e00), false);
  });

  it('reads full Unicode groups including supplementary Han characters', () => {
    const cmap = new DataView(new ArrayBuffer(40));
    cmap.setUint16(2, 1);
    cmap.setUint32(8, 12);
    cmap.setUint16(12, 12);
    cmap.setUint32(16, 28);
    cmap.setUint32(24, 1);
    cmap.setUint32(28, 0x20000);
    cmap.setUint32(32, 0x20002);
    cmap.setUint32(36, 0);
    assert.equal(containsGlyph(cmap, 0x20000), false);
    assert.equal(containsGlyph(cmap, 0x20002), true);
    assert.equal(containsGlyph(cmap, 0x20003), false);
    cmap.setUint32(24, 9999);
    assert.equal(containsGlyph(cmap, 0x20002), false);
  });
});
