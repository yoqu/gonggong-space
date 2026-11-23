import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { emptySlide, type Slide } from '@open-artifact/slides-core';
import {
  cornerRadii,
  cornerRadius,
  objectContentRect,
  officeShadow,
  parseAngle,
  parseBoxShadow,
  parseColor,
  parseLinearGradient,
  pictureOutline,
  pptxFont,
  splitTop,
} from '../src/services/export/css.ts';
import { exportFileName, fileBase, formatBytes, slideFileName } from '../src/services/export/files.ts';
import { deckText } from '../src/services/export/fonts.ts';
import { ExportNotes, paginate, slideList, wrapLines } from '../src/services/export/notes.ts';
import { centerSingleLine, collapseGaps, edgeSpaceAsInset, fillXml, geometryXml, lineXml, pptxEntries, shadowXml, writePptx, xml, type Paragraph, type PptxDeck, type TextBody } from '../src/services/export/ooxml.ts';

const text = (data: Uint8Array | string): string => (typeof data === 'string' ? data : new TextDecoder().decode(data));

describe('css readers', () => {
  it('reads colors', () => {
    assert.deepEqual(parseColor('#abc'), { hex: 'AABBCC', alpha: 1 });
    assert.deepEqual(parseColor('#11223380')!.hex, '112233');
    assert.ok(Math.abs(parseColor('#11223380')!.alpha - 128 / 255) < 1e-9);
    assert.deepEqual(parseColor('rgb(255, 0, 10)'), { hex: 'FF000A', alpha: 1 });
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { hex: '000000', alpha: 0.5 });
    assert.deepEqual(parseColor('rgb(0 128 255 / 25%)'), { hex: '0080FF', alpha: 0.25 });
    assert.deepEqual(parseColor('color(srgb 1 0 0 / 0.25)'), { hex: 'FF0000', alpha: 0.25 });
    assert.deepEqual(parseColor('transparent'), { hex: '000000', alpha: 0 });
    assert.equal(parseColor('currentcolor'), null);
    assert.equal(parseColor('color-mix(in srgb, red, blue)'), null);
  });

  it('splits at the top level only', () => {
    assert.deepEqual(splitTop('rgb(1, 2, 3) 0px, red 1px'), ['rgb(1, 2, 3) 0px', 'red 1px']);
    assert.deepEqual(splitTop('rgb(1, 2, 3) 4px 5px', ' '), ['rgb(1, 2, 3)', '4px', '5px']);
  });

  it('reads shadows, angles and gradients', () => {
    assert.deepEqual(parseBoxShadow('rgba(0, 0, 0, 0.2) 0px 8px 24px 0px'), { x: 0, y: 8, blur: 24, spread: 0, color: { hex: '000000', alpha: 0.2 } });
    assert.equal(parseBoxShadow('none'), null);
    assert.equal(parseBoxShadow('rgb(0, 0, 0) 0px 2px 4px 0px inset'), null);
    assert.equal(parseAngle('0.25turn'), 90);
    assert.equal(parseAngle('100grad'), 90);
    const gradient = parseLinearGradient('linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255) 80%)');
    assert.equal(gradient?.angle, 90);
    assert.deepEqual(
      gradient?.stops.map((stop) => [stop.pos, stop.color.hex]),
      [
        [0, 'FF0000'],
        [0.8, '0000FF'],
      ],
    );
    assert.equal(parseLinearGradient('radial-gradient(red, blue)'), null);
    assert.equal(parseLinearGradient('linear-gradient(red, blue), url(x.png)'), null);
  });

  it('shrinks a shadow with a negative spread instead of dropping the spread', () => {
    const shadow = (spread: number) => ({ x: 0, y: 4, blur: 10, spread, color: { hex: '000000', alpha: 0.2 } });
    assert.deepEqual(officeShadow(shadow(0), { w: 200, h: 100 }), { x: 0, y: 4, blur: 10 });
    assert.deepEqual(officeShadow(shadow(-10), { w: 200, h: 100 }), { x: 0, y: 4, blur: 10, scale: { x: 0.9, y: 0.8 } });
    // A shadow pulled in past the middle of the box shows nothing.
    assert.equal(officeShadow(shadow(-50), { w: 200, h: 100 }), null);
    // A growing shadow keeps the shape's size (the export notes say so).
    assert.deepEqual(officeShadow(shadow(6), { w: 200, h: 100 }), { x: 0, y: 4, blur: 10 });
  });

  it('places pictures and radii', () => {
    assert.equal(cornerRadius('50%', 200, 100), 50);
    assert.equal(cornerRadius('12px 8px', 200, 100), 12);
    // A 2:1 picture covering a square box overflows left and right equally.
    assert.deepEqual(objectContentRect('cover', '50% 50%', { x: 0, y: 0, w: 100, h: 100 }, { w: 200, h: 100 }), { x: -50, y: 0, w: 200, h: 100 });
    assert.deepEqual(objectContentRect('contain', 'left top', { x: 0, y: 0, w: 100, h: 100 }, { w: 200, h: 100 }), { x: 0, y: 0, w: 100, h: 50 });
  });

  it('reads corner radii per axis and shrinks them where they would overlap', () => {
    const all = (value: string): [string, string, string, string] => [value, value, value, value];
    assert.deepEqual(cornerRadii(all('50%'), 200, 100), Array(4).fill({ x: 100, y: 50 }));
    assert.deepEqual(cornerRadii(all('12px 6px'), 200, 100), Array(4).fill({ x: 12, y: 6 }));
    assert.deepEqual(cornerRadii(['80px', '80px', '0px', '0px'], 100, 100), [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
  });

  it('cuts a letterboxed picture only where it reaches into a rounded corner', () => {
    const frame = { x: 0, y: 0, w: 100, h: 100 };
    const radii = (r: number) => Array(4).fill({ x: r, y: r });
    // A 2:1 picture contained in a square sits 25px from the top and bottom.
    const picture = { x: 0, y: 25, w: 100, h: 50 };
    // The corners curve within 20px of each edge: the picture stays a plain rectangle.
    assert.equal(pictureOutline(picture, frame, radii(20)), undefined);
    assert.equal(pictureOutline({ x: 20, y: 20, w: 60, h: 60 }, frame, radii(50)), undefined);
    // A 40px radius reaches 15px into the picture at its left and right edges.
    const outline = pictureOutline(picture, frame, radii(40))!;
    assert.ok(outline.length > 4);
    for (const [x, y] of outline) assert.ok(x >= -1e-6 && x <= 100 + 1e-6 && y >= -1e-6 && y <= 50 + 1e-6, `${x},${y} stays on the picture`);
    assert.ok(outline.some(([x, y]) => Math.abs(x) < 1e-6 && Math.abs(y - 15) < 0.01));
    assert.ok(outline.some(([x, y]) => Math.abs(x) < 1e-6 && Math.abs(y - 35) < 0.01));
    assert.ok(!outline.some(([x, y]) => x < 1 && y < 1), 'the top-left corner is cut');
    // A circle around a square picture: only the picture's corners go.
    const round = pictureOutline({ x: 0, y: 20, w: 100, h: 60 }, frame, radii(50))!;
    assert.ok(round.some(([x, y]) => Math.abs(y) < 1e-6 && x > 5 && x < 95), 'the top edge keeps its middle');
  });

  it('names fonts for PowerPoint', () => {
    assert.equal(pptxFont('"Inter", system-ui, sans-serif', 'current'), 'Inter');
    assert.equal(pptxFont('system-ui, sans-serif', 'current'), 'Arial');
    assert.equal(pptxFont('"Playfair Display", serif', 'basic'), 'Georgia');
    assert.equal(pptxFont('"JetBrains Mono", monospace', 'basic'), 'Courier New');
  });
});

describe('ooxml', () => {
  it('escapes text and drops characters XML cannot hold', () => {
    assert.equal(xml('a<b>&"c"\u0001'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  });

  it('writes fills, lines and geometry', () => {
    assert.equal(fillXml({ type: 'none' }), '<a:noFill/>');
    assert.equal(fillXml({ type: 'solid', color: { hex: 'FF0000', alpha: 0.5 } }), '<a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>');
    // CSS 180deg (top to bottom) is DrawingML 90deg.
    assert.match(fillXml({ type: 'gradient', angle: 180, stops: [{ pos: 0, color: { hex: '000000', alpha: 1 } }, { pos: 1, color: { hex: 'FFFFFF', alpha: 1 } }] }), /<a:lin ang="5400000"/);
    assert.match(lineXml({ width: 2, color: { hex: '000000', alpha: 1 }, head: 'triangle', tail: 'arrow' }), /<a:headEnd type="triangle"[^]*<a:tailEnd type="arrow"/);
    assert.match(geometryXml({ preset: 'roundRect', radius: 25 }, { x: 0, y: 0, w: 200, h: 100 }), /fmla="val 25000"/);
    assert.match(geometryXml({ preset: 'roundRect', radius: 500 }, { x: 0, y: 0, w: 200, h: 100 }), /fmla="val 50000"/);
    assert.match(geometryXml({ path: [[0, 0], [10, 10]], closed: false }, { x: 0, y: 0, w: 10, h: 10 }), /fill="none"/);
    assert.match(shadowXml({ x: 0, y: 4, blur: 10, color: { hex: '000000', alpha: 1 }, scale: { x: 0.9, y: 0.8 } }), /<a:outerShdw [^>]*sx="90000" sy="80000"/);
    assert.doesNotMatch(shadowXml({ x: 0, y: 4, blur: 10, color: { hex: '000000', alpha: 1 } }), /sx=/);
  });

  const deck: PptxDeck = {
    title: 'Q3 <Review>',
    created: new Date(Date.UTC(2026, 0, 1)),
    media: [{ key: 'image1', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'png' }],
    slides: [
      {
        background: { type: 'fill', fill: { type: 'solid', color: { hex: 'FFFFFF', alpha: 1 } } },
        notes: 'Say hello',
        elements: [
          {
            type: 'shape',
            name: 'Text 1',
            box: { x: 100, y: 100, w: 800, h: 120 },
            geometry: { preset: 'rect' },
            fill: { type: 'none' },
            textBox: true,
            text: {
              inset: { l: 0, t: 0, r: 0, b: 0 },
              paragraphs: [{ runs: [{ text: 'Hello', size: 64, bold: true, href: 'https://example.com' }], endSize: 64 }],
            },
          },
          { type: 'picture', name: 'Picture 1', box: { x: 0, y: 0, w: 100, h: 100 }, media: 'image1', crop: { l: 0.1, t: 0, r: 0.1, b: 0 } },
          { type: 'picture', name: 'Picture 2', box: { x: 200, y: 0, w: 200, h: 100 }, media: 'image1', oval: true },
          { type: 'picture', name: 'Picture 3', box: { x: 0, y: 200, w: 100, h: 50 }, media: 'image1', outline: [[3, 0], [97, 0], [100, 15], [100, 35], [97, 50], [3, 50], [0, 35], [0, 15]] },
          {
            type: 'table',
            name: 'Table 1',
            box: { x: 0, y: 500, w: 400, h: 80 },
            columns: [200, 200],
            rows: [{ height: 80, cells: [0, 1].map(() => ({ text: { paragraphs: [{ runs: [{ text: 'x', size: 24 }], endSize: 24 }], inset: { l: 4, t: 4, r: 4, b: 4 } }, fill: { type: 'none' as const }, borders: {} })) }],
          },
        ],
      },
      { elements: [], transition: 'push', background: { type: 'picture', media: 'image1' } },
    ],
  };

  it('lists every part with content types and relationships', () => {
    const entries = pptxEntries(deck);
    const names = entries.map((entry) => entry.name);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/notesSlides/notesSlide1.xml',
      'ppt/media/image1.png',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/theme/theme1.xml',
      'docProps/core.xml',
    ]) {
      assert.ok(names.includes(part), part);
    }
    const byName = new Map(entries.map((entry) => [entry.name, text(entry.data)]));
    const types = byName.get('[Content_Types].xml')!;
    for (const name of names) {
      if (name.endsWith('.rels') || name.startsWith('ppt/media/') || name === '[Content_Types].xml') continue;
      assert.ok(types.includes(`PartName="/${name}"`), `content type of ${name}`);
    }
    const slide1 = byName.get('ppt/slides/slide1.xml')!;
    assert.match(slide1, /<a:t>Hello<\/a:t>/);
    assert.match(slide1, /<a:hlinkClick r:id="rId\d+"\/>/);
    assert.match(slide1, /<a:srcRect l="10000" t="0" r="10000" b="0"\/>/);
    assert.match(slide1, /name="Picture 2"[^]*?<a:prstGeom prst="ellipse">/);
    assert.match(slide1, /name="Picture 3"[^]*?<a:ext cx="635000" cy="317500"\/><\/a:xfrm><a:custGeom>[^]*?<a:moveTo><a:pt x="19050" y="0"\/><\/a:moveTo>[^]*?<a:close\/>/);
    assert.match(slide1, /<a:tbl>/);
    const rels1 = byName.get('ppt/slides/_rels/slide1.xml.rels')!;
    assert.match(rels1, /Target="https:\/\/example\.com" TargetMode="External"/);
    assert.match(rels1, /notesSlide/);
    assert.match(byName.get('ppt/notesSlides/notesSlide1.xml')!, /Say hello/);
    assert.match(byName.get('ppt/slides/slide2.xml')!, /<p:push dir="l"\/>/);
    assert.match(byName.get('docProps/core.xml')!, /Q3 &lt;Review&gt;/);
    // Every relationship target inside the package exists.
    for (const [name, body] of byName) {
      if (!name.endsWith('.rels')) continue;
      const base = name.replace(/_rels\/[^/]*\.rels$/, '');
      for (const match of body.matchAll(/Target="([^"]+)"(?! TargetMode)/g)) {
        const target = match[1]!;
        const resolved = target.startsWith('/') ? target.slice(1) : new URL(target, `http://x/${base}`).pathname.slice(1);
        assert.ok(names.includes(resolved), `${name} → ${target}`);
      }
    }
  });

  it('collapses the margins between list paragraphs the way CSS does', () => {
    const gaps = (list: Array<[number?, number?]>) => collapseGaps(list.map(([spaceBefore, spaceAfter]) => ({ spaceBefore, spaceAfter }))).map((p) => [p.spaceBefore, p.spaceAfter]);
    // `li { margin: 8px 0 }`: 8px between items, not 16px.
    assert.deepEqual(gaps([[8, 8], [8, 8], [8, 8]]), [[8, 8], [undefined, 8], [undefined, 8]]);
    // The larger margin wins; only the part beyond the one before is added.
    assert.deepEqual(gaps([[undefined, 4], [12, undefined], [undefined, 10], [6, undefined]]), [[undefined, 4], [8, undefined], [undefined, 10], [undefined, undefined]]);
  });

  it('moves the space above the first item and below the last into the insets', () => {
    const body: TextBody = {
      inset: { l: 0, t: 4, r: 0, b: 0 },
      paragraphs: [
        { runs: [{ text: 'a', size: 32 }], spaceBefore: 12, spaceAfter: 12, endSize: 32 },
        { runs: [{ text: 'b', size: 32 }], spaceAfter: 12, endSize: 32 },
      ],
    };
    const moved = edgeSpaceAsInset(body);
    assert.deepEqual(moved.inset, { l: 0, t: 16, r: 0, b: 12 });
    assert.deepEqual(moved.paragraphs.map((p) => [p.spaceBefore, p.spaceAfter]), [[undefined, 12], [undefined, undefined]]);
    assert.equal(body.inset.t, 4, 'the body passed in stays as it was');
  });

  it('writes one tall line at single spacing with the rest of its height split above and below', () => {
    const line = (lineHeight: number, size = 40): Paragraph => ({ runs: [{ text: 'Title', size }], lineHeight, endSize: size });
    const body = (paragraphs: Paragraph[]): TextBody => ({ inset: { l: 0, t: 2, r: 0, b: 2 }, paragraphs });
    // A 40px line 80px tall: 46px at single spacing, 17px more above and below.
    const tall = centerSingleLine(body([line(80)]), 84);
    assert.equal(tall.paragraphs[0]!.lineHeight, 46);
    assert.deepEqual(tall.inset, { l: 0, t: 19, r: 0, b: 19 });
    // Close to single spacing already, two paragraphs, a line break, or no room in the box: unchanged.
    for (const [given, height] of [
      [body([line(44)]), 48],
      [body([line(80), line(80)]), 200],
      [body([{ ...line(80), runs: [{ text: 'a', size: 40 }, { text: '', size: 40, lineBreak: true }, { text: 'b', size: 40 }] }]), 200],
      [body([line(80)]), 60],
    ] as const) {
      assert.deepEqual(centerSingleLine(given, height), given);
    }
  });

  it('writes list markers: kind, first number, text and colour', () => {
    const paragraph = (bullet: NonNullable<Paragraph['bullet']>): Paragraph => ({ runs: [{ text: 'a', size: 32 }], bullet, marginLeft: 40, endSize: 32 });
    const listDeck: PptxDeck = {
      title: 'Lists',
      created: new Date(Date.UTC(2026, 0, 1)),
      media: [],
      slides: [
        {
          elements: [
            {
              type: 'shape',
              name: 'List 1',
              box: { x: 0, y: 0, w: 800, h: 400 },
              geometry: { preset: 'rect' },
              fill: { type: 'none' },
              textBox: true,
              text: {
                inset: { l: 0, t: 0, r: 0, b: 0 },
                paragraphs: [
                  paragraph({ type: 'number', start: 4, scheme: 'romanUcPeriod', color: { hex: 'CC0000', alpha: 1 } }),
                  paragraph({ type: 'number', start: 1 }),
                  paragraph({ type: 'char', char: '→', ownFont: true }),
                  paragraph({ type: 'char', char: '•' }),
                ],
              },
            },
          ],
        },
      ],
    };
    const slide = text(pptxEntries(listDeck).find((entry) => entry.name === 'ppt/slides/slide1.xml')!.data);
    const props = [...slide.matchAll(/<a:pPr[^>]*>(.*?)<\/a:pPr>/g)].map((m) => m[1]);
    assert.deepEqual(props, [
      '<a:buClr><a:srgbClr val="CC0000"/></a:buClr><a:buFont typeface="+mj-lt"/><a:buAutoNum type="romanUcPeriod" startAt="4"/>',
      '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>',
      '<a:buFontTx/><a:buChar char="→"/>',
      '<a:buFont typeface="Arial"/><a:buChar char="•"/>',
    ]);
  });

  it('writes a deflated zip with [Content_Types].xml first', async () => {
    const bytes = await writePptx(deck);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50);
    const end = bytes.length - 22;
    const count = view.getUint16(end + 10, true);
    const parts = new Map(pptxEntries(deck).map((entry) => [entry.name, text(entry.data)]));
    assert.equal(count, parts.size);
    let at = view.getUint32(end + 16, true);
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const local = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const body = bytes.subarray(start, start + size);
      const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
      assert.equal(zlib.crc32(data), view.getUint32(at + 16, true), name);
      if (name.endsWith('.xml')) {
        assert.equal(method, 8, `${name} is deflated`);
        assert.equal(data.toString('utf8'), parts.get(name));
      }
      names.push(name);
      at += 46 + nameLength;
    }
    assert.equal(names[0], '[Content_Types].xml');
  });
});

describe('export notes', () => {
  it('lists slides', () => {
    assert.equal(slideList([3]), '3');
    assert.equal(slideList([7, 3]), '3 and 7');
    assert.equal(slideList([5, 3, 7, 3]), '3, 5 and 7');
  });

  it('collects one sentence per kind, in a fixed order', () => {
    const notes = new ExportNotes();
    notes.add('video', 7);
    notes.add('hidden', 2);
    notes.add('video', 3);
    notes.add('fontsNotEmbedded');
    notes.text('Something else.');
    notes.text('Something else.');
    assert.deepEqual(notes.list(), [
      'Hidden slides were left out (slide 2).',
      'Videos became their poster pictures (slides 3 and 7).',
      'Fonts are not embedded: PowerPoint uses installed fonts or substitutes.',
      'Something else.',
    ]);
    assert.ok(notes.has('video'));
    assert.ok(!notes.has('embed'));
  });

  it('wraps text by measured width', () => {
    const measure = (value: string): number => value.length;
    assert.deepEqual(wrapLines('one two three four', 9, measure), ['one two', 'three', 'four']);
    assert.deepEqual(wrapLines('a\n\nb', 10, measure), ['a', '', 'b']);
    assert.deepEqual(wrapLines('abcdefghij', 4, measure), ['abcd', 'efgh', 'ij']);
    assert.deepEqual(wrapLines('你好世界', 2, measure), ['你好', '世界']);
  });

  it('paginates lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `l${i}`);
    assert.deepEqual(paginate(lines, 3, 4, 4), { pages: [lines.slice(0, 3), lines.slice(3, 7), lines.slice(7, 10)], cut: false });
    assert.equal(paginate(lines, 2, 2, 2).cut, true);
    assert.deepEqual(paginate(['a', '', ''], 5, 5, 1), { pages: [['a']], cut: false });
  });
});

describe('file names', () => {
  it('cleans titles', () => {
    assert.equal(fileBase('  Q3: Plan / Review?  '), 'Q3 Plan Review');
    assert.equal(fileBase('...'), 'presentation');
    assert.equal(fileBase(''), 'presentation');
    assert.equal([...fileBase('长'.repeat(300))].length <= 120, true);
  });

  it('adds extensions and slide numbers within the byte limit', () => {
    assert.equal(exportFileName('Deck', 'pdf'), 'Deck.pdf');
    assert.equal(slideFileName('Deck', 4, 'png'), 'Deck-slide-4.png');
    const long = exportFileName('長'.repeat(200), 'pptx');
    assert.ok(new TextEncoder().encode(long).length <= 240);
    assert.ok(long.endsWith('.pptx'));
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(3.5 * 1024 * 1024), '3.5 MB');
  });
});

describe('fonts', () => {
  it('collects the characters a deck shows', () => {
    const slide: Slide = {
      ...emptySlide('s-1'),
      children: [
        { kind: 'text', tag: 'h1', style: {}, runs: [{ text: '你好' }] },
        { kind: 'svg', style: {}, markup: '<svg><text>Ω</text></svg>' },
      ],
    };
    const points = deckText([slide]);
    assert.ok(points.has('你'.codePointAt(0)!));
    assert.ok(points.has('Ω'.codePointAt(0)!));
    assert.ok(points.has('A'.codePointAt(0)!));
  });
});
