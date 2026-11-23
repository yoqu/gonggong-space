import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  SLIDE_WIDTH,
  checkSlidesProject,
  compileSlide,
  createSourceDeck,
  deckFormatKind,
  flattenSlide,
  isFlatSlideHtml,
  matchesMedia,
  newDeckIndex,
  normalizeDeckIndex,
  parseSelectorList,
  parseStylesheet,
  patchSourceSlide,
  readSourceSlide,
  serializeDeckIndex,
  serializeSlide,
  setSlideSize,
  slideMarkupMadeFor,
  type BoxNode,
  type ListNode,
  type Slide,
  type TextNode,
} from '../src/index.ts';

const FIXTURE = new URL('./fixtures/source-deck/project/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, FIXTURE), 'utf8');
const deck = createSourceDeck(read('deck.css'));
const slide = (id: string, index: number) => readSourceSlide(read(`slides/${id}.html`), deck, { id, index, lints: false });

describe('deck.json format and size', () => {
  it('keeps format, size and v5 in key order', () => {
    const index = normalizeDeckIndex(JSON.parse(read('deck.json')));
    assert.equal(index.v, 5);
    assert.deepEqual(index.format, { v: 1, shared: ['project/deck.css'] });
    assert.equal(deckFormatKind(index), 'source');
    const text = serializeDeckIndex({ ...index, size: '4:3' });
    assert.deepEqual(Object.keys(JSON.parse(text)).slice(0, 6), ['v', 'createdOnFiles', 'lists', 'format', 'title', 'size']);
  });

  it('drops a size it does not know and tells formats apart', () => {
    assert.equal(normalizeDeckIndex({ size: '21:9' }).size, undefined);
    assert.equal(deckFormatKind(normalizeDeckIndex({})), 'none');
    assert.equal(deckFormatKind(normalizeDeckIndex({ format: { v: 2, shared: [] } })), 'unknown');
  });

  it('creates inline decks by default and source decks on request', () => {
    const at = new Date('2026-11-15T00:00:00Z');
    assert.equal(newDeckIndex('A', at).format, undefined);
    const source = newDeckIndex('A', at, { source: true, size: '4:3' });
    assert.equal(source.v, 5);
    assert.equal(deckFormatKind(source), 'source');
    assert.equal(source.size, '4:3');
  });
});

describe('slide markup kind', () => {
  it('tells sheet slides, inline slides and flat slides apart', () => {
    assert.equal(slideMarkupMadeFor(read('slides/cover.html')), 'sheet');
    assert.equal(slideMarkupMadeFor('<section id="a" style="padding:128px"><p>x</p></section>'), 'inline');
    assert.equal(slideMarkupMadeFor('<p>no section</p>'), undefined);
    assert.equal(isFlatSlideHtml('<section id="a" data-flat style="x">'), true);
    assert.equal(isFlatSlideHtml('<section id="a" data-flatter>'), false);
  });
});

describe('stylesheet', () => {
  it('reads @media at the slide size and drops what it cannot read, with lines', () => {
    const sheet = parseStylesheet('a{color:red}\n@media (min-width: 1600px){b{color:blue}}\n@media (max-width: 1000px){i{color:green}}\n@supports (x:y){u{color:red}}\n@import "x.css";', { width: 1920, height: 1080 });
    assert.equal(sheet.rules.length, 2);
    assert.deepEqual(sheet.drops.map((d) => d.line), [4, 5]);
    assert.equal(matchesMedia('screen and (orientation: landscape)', { width: 1440, height: 1080 }), true);
    assert.equal(matchesMedia('(prefers-reduced-motion: reduce)', { width: 1920, height: 1080 }), false);
  });

  it('rejects selectors outside what it reads', () => {
    assert.equal(parseSelectorList('[data-x] p').ok, false);
    assert.equal(parseSelectorList('a:hover').ok, false);
    const ok = parseSelectorList('.card > p:nth-child(2n+1), #x::after');
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.deepEqual(ok.selectors[0]!.specificity, [0, 2, 1]);
      assert.equal(ok.selectors[1]!.pseudo, 'after');
    }
  });
});

describe('reading a source slide', () => {
  it('works classes, variables and units out into the subset', () => {
    const cover = slide('cover', 0);
    assert.equal(cover.held, false);
    assert.equal(cover.slide.style.background, '#f7f3ea');
    assert.equal(cover.slide.style['font-family'], 'Georgia, serif');
    assert.equal(cover.slide.style['justify-content'], 'center');
    const [h1, lede, page] = cover.slide.children as [TextNode, TextNode, TextNode];
    assert.equal(h1.style['font-size'], '96px');
    assert.equal(h1.style['font-weight'], '400');
    assert.equal(h1.origin, 1);
    assert.equal(lede.style['font-size'], '64px');
    assert.deepEqual(lede.runs[1], { text: 'variables', marks: { b: true, color: '#c2410c' } });
    // section::after with counter(page): the slide number, generated.
    assert.equal(page.origin, -1);
    assert.equal(page.runs[0]!.text, '1');
    assert.equal(page.style.position, 'absolute');
  });

  it('adds padding to a content-box width and folds calc()', () => {
    const plan = slide('plan', 1);
    const cards = plan.slide.children[1] as BoxNode;
    const wide = cards.children[1] as BoxNode;
    assert.equal(wide.style.width, '464px');
    assert.equal((wide.children[1] as TextNode).style['font-size'], '28px');
    assert.equal(cards.children[0]!.style.background, '#ffffff', '@media and @supports rules do not apply');
    assert.equal((plan.slide.children[2] as TextNode).runs[0]!.text, '2');
  });

  it('reads nested lists and moves a colour all their lines share onto the list', () => {
    const steps = slide('steps', 2);
    const list = steps.slide.children[1] as ListNode;
    assert.deepEqual(list.items.map((item) => [item.runs[0]!.text, item.level ?? 0]), [['One', 0], ['One a', 1], ['One b', 1], ['Two', 0]]);
    assert.equal(list.style.color, 'red');
    assert.ok(!steps.diagnostics.some((d) => /<li>/.test(d.message)));
  });

  it('follows the cascade: inline over sheet, !important over inline, var() fallbacks', () => {
    const local = createSourceDeck('p{color:red;font-size:40px !important}.x{color:var(--missing, #00ff00)}');
    const result = readSourceSlide('<section id="a"><p class="x" style="color:blue;font-size:20px">t</p><p class="x">u</p></section>', local, { id: 'a', lints: false });
    const [first, second] = result.slide.children as [TextNode, TextNode];
    assert.equal(first.style.color, 'blue');
    assert.equal(first.style['font-size'], '40px');
    assert.equal(second.style.color, '#00ff00');
  });

  it('holds a slide with a <style> of its own', () => {
    const result = readSourceSlide('<section id="a"><style>p{color:red}</style><p>t</p></section>', deck, { id: 'a', lints: false });
    assert.equal(result.held, true);
  });

  it('maps other tags to boxes and lines, and a list without markers to lines', () => {
    const local = createSourceDeck('.plain{list-style:none;padding:0}');
    const result = readSourceSlide('<section id="a"><header><h4>Kicker</h4></header><ul class="plain"><li>a</li><li>b</li></ul><div>loose <strong>text</strong></div></section>', local, { id: 'a', lints: false });
    assert.equal(result.held, false, JSON.stringify(result.diagnostics));
    const [header, plain, loose] = result.slide.children as [BoxNode, BoxNode, TextNode];
    assert.equal(header.kind, 'box');
    assert.equal((header.children[0] as TextNode).tag, 'p');
    assert.equal(plain.kind, 'box');
    assert.equal(plain.children.length, 2);
    assert.equal(loose.kind, 'text');
    assert.deepEqual(loose.runs[1]!.marks, { b: true });
  });

  it('turns a pinned fragment into a click step', () => {
    const local = createSourceDeck('.pin{position:absolute;left:128px;top:128px;width:400px}');
    const result = readSourceSlide('<section id="a"><p class="pin fragment" data-fragment-index="1">t</p></section>', local, { id: 'a', lints: false });
    assert.deepEqual(result.slide.children[0]!.buildIn, { effect: 'fade', order: 2 });
  });
});

describe('writing edits back', () => {
  const source = read('slides/plan.html');
  const saved = slide('plan', 1).slide;
  const patch = (edit: (s: Slide) => void): string | undefined => {
    const edited = structuredClone(saved);
    edit(edited);
    return patchSourceSlide(source, saved, edited, deck, { id: 'plan', index: 1 });
  };

  it('changes only the words of a retyped line', () => {
    const out = patch((s) => ((s.children[0] as TextNode).runs = [{ text: 'The new plan' }]));
    assert.equal(out, source.replace('The plan', 'The new plan'));
  });

  it('puts a style on that one tag, keeping its classes', () => {
    const out = patch((s) => (((s.children[1] as BoxNode).children[0] as BoxNode).style.background = '#ffeedd'));
    assert.equal(out, source.replace('<div class="card">', '<div class="card" style="background:#ffeedd">'));
    const sized = patch((s) => (((s.children[1] as BoxNode).children[0] as BoxNode).style.width = '500px'));
    assert.match(sized ?? '', /<div class="card" style="width:500px;box-sizing:border-box">/);
  });

  it('removes and adds elements without touching the rest', () => {
    const removed = patch((s) => (s.children[1] as BoxNode).children.splice(1, 1));
    assert.ok(removed && !removed.includes('Second') && removed.includes('<div class="card">'));
    const added = patch((s) => s.children.splice(1, 0, { kind: 'text', tag: 'p', style: { 'font-size': '40px' }, runs: [{ text: 'Added' }] }));
    assert.match(added ?? '', /<h2 style="font-size:64px">The plan<\/h2>\n {2}<p style="font-size:40px">Added<\/p>\n {2}<div class="cards">/);
  });

  it('reads data-deck-skip as a skipped slide, and showing it again removes it', () => {
    const skipped = source.replace(/<section\b/, '<section data-deck-skip');
    const read = readSourceSlide(skipped, deck, { id: 'plan', index: 1, lints: false });
    assert.equal(read.slide.hidden, true);
    assert.equal(readSourceSlide(source.replace(/<section\b/, '<section data-deck-skip="false"'), deck, { id: 'plan', index: 1, lints: false }).slide.hidden, false);
    const shown = patchSourceSlide(skipped, read.slide, { ...read.slide, hidden: false }, deck, { id: 'plan', index: 1 });
    assert.equal(shown, source);
  });

  it('gives up on an edit to generated content, which the caller saves flat', () => {
    assert.equal(patch((s) => (s.children[2]!.style.right = '10px')), undefined);
    const flat = flattenSlide(saved);
    assert.ok(isFlatSlideHtml(flat));
    const back = compileSlide(flat, { id: 'plan', lints: false });
    assert.equal(back.held, false);
    assert.equal(back.slide.flat, true);
    assert.equal(serializeSlide(back.slide), flat);
  });
});

describe('project checks of a source deck', () => {
  const files = (): Map<string, string> => {
    const map = new Map<string, string>([['deck.json', read('deck.json')], ['deck.css', read('deck.css')]]);
    for (const name of readdirSync(new URL('slides/', FIXTURE))) map.set(`slides/${name}`, read(`slides/${name}`));
    return map;
  };

  it('reads the fixture deck without errors', () => {
    const found = checkSlidesProject(files(), { lints: false });
    assert.deepEqual(found.filter((d) => d.level === 'error'), []);
    assert.ok(found.some((d) => d.file === 'deck.css' && /@supports/.test(d.message)));
  });

  it('errors without deck.css, and warns of sheet slides in an inline deck', () => {
    const missing = files();
    missing.delete('deck.css');
    assert.ok(checkSlidesProject(missing, { lints: false }).some((d) => d.level === 'error' && /deck\.css is missing/.test(d.message)));
    const inline = files();
    inline.set('deck.json', JSON.stringify({ v: 4, title: 'x', order: [] }));
    assert.ok(checkSlidesProject(inline, { lints: false }).some((d) => d.file === 'slides/cover.html' && /"format" key/.test(d.message)));
  });
});

describe('4:3 decks', () => {
  it('sets the slide width and reads media at 1440', () => {
    setSlideSize('4:3');
    try {
      assert.equal(SLIDE_WIDTH, 1440);
      const narrow = createSourceDeck('@media (max-width: 1500px){p{color:red}}', '4:3');
      assert.equal(narrow.sheet.rules.length, 1);
    } finally {
      setSlideSize(undefined);
    }
    assert.equal(SLIDE_WIDTH, 1920);
  });

  it("checks a deck at its own size without touching the editor's width (a server checks many decks at once)", () => {
    const files = new Map([
      ['deck.json', JSON.stringify({ v: 4, title: 'x', size: '4:3', format: 'source', order: ['cover'] })],
      ['deck.css', '@media (max-width: 1500px){p{color:red}}'],
      ['slides/cover.html', '<section id="cover"><p>Hi</p></section>'],
    ]);
    checkSlidesProject(files, { lints: false });
    assert.equal(SLIDE_WIDTH, 1920);
  });
});

describe('nested lists in the inline format', () => {
  it('round-trips nesting and skipped levels', () => {
    const html = '<section id="a"><ul style="font-size:32px"><li>One<ul><li>Two<ul><li>Three</li></ul></li></ul></li><li data-indent="2">Deep</li></ul></section>';
    const first = compileSlide(html, { id: 'a', lints: false });
    assert.equal(first.held, false);
    const list = first.slide.children[0] as ListNode;
    assert.deepEqual(list.items.map((i) => i.level ?? 0), [0, 1, 2, 2]);
    const out = serializeSlide(first.slide);
    assert.deepEqual((compileSlide(out, { id: 'a', lints: false }).slide.children[0] as ListNode).items, list.items);
  });

  it('keeps margins on flow children of inline decks, not on pinned ones', () => {
    const result = compileSlide('<section id="a"><p style="margin:16px">t</p><p style="position:absolute;left:0;top:0;margin:16px">u</p></section>', { id: 'a', lints: false });
    assert.equal(result.slide.children[0]!.style.margin, '16px');
    assert.equal(result.slide.children[1]!.style.margin, undefined);
    assert.ok(result.diagnostics.some((d) => /margin/.test(d.message)));
  });
});
