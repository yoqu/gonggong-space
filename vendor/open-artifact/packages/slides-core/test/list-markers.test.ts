import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileSlide,
  createSourceDeck,
  flattenSlide,
  mapRuns,
  patchNodeStyle,
  patchSourceSlide,
  readSourceSlide,
  serializeSlide,
  setListKind,
  setPlainText,
  setRuns,
  type ListNode,
  type TextBoxNode,
} from '../src/index.ts';

const compile = (body: string) => compileSlide(`<section id="a">${body}</section>`, { id: 'a', lints: false });
const firstList = (body: string) => compile(body).slide.children[0] as ListNode;

describe('list markers in the inline format', () => {
  it('keeps the marker kind and its position on a list', () => {
    const list = firstList('<ul style="list-style-type:square;list-style-position:inside"><li>a</li></ul>');
    assert.deepEqual(list.style, { 'list-style-type': 'square', 'list-style-position': 'inside' });
    assert.deepEqual(firstList(`<ol style="list-style:'→ ' inside"><li>a</li></ol>`).style, { 'list-style-type': '"→ "', 'list-style-position': 'inside' });
    assert.deepEqual(firstList('<ol style="list-style-type:upper-roman"><li>a</li></ol>').style, { 'list-style-type': 'upper-roman' });
    assert.deepEqual(firstList('<ul style="list-style:none"><li>a</li></ul>').style, { 'list-style-type': 'none', 'list-style-position': 'outside' });
    const latin = compile('<ol style="list-style-type:lower-latin"><li>a</li></ol>');
    assert.deepEqual(latin.slide.children[0]!.style, { 'list-style-type': 'lower-alpha' });
    assert.ok(latin.diagnostics.some((d) => d.level === 'note' && /lower-alpha/.test(d.message)));
  });

  it('drops markers it cannot draw, and markers on other elements', () => {
    const result = compile('<ul style="list-style-type:hebrew"><li>a</li></ul><ul style="list-style-type:\'far too long\'"><li>b</li></ul><ul style="list-style-image:url(a.png)"><li>c</li></ul><p style="list-style-type:disc">d</p>');
    assert.deepEqual(result.slide.children.map((n) => n.style), [{}, {}, {}, {}]);
    assert.equal(result.diagnostics.filter((d) => d.level === 'unsupported' && /list-style/.test(d.message)).length, 4);
  });

  it('lets each nested level choose its own marker and nothing else', () => {
    const result = compile('<ol><li>a<ol style="list-style-type:lower-roman;color:#ff0000"><li>b<ul style="list-style-position:inside"><li>c</li></ul></li></ol></li></ol>');
    const list = result.slide.children[0] as ListNode;
    assert.deepEqual(list.levels, { 1: { 'list-style-type': 'lower-roman' }, 2: { 'list-style-position': 'inside' } });
    assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /color/.test(d.message)));
  });

  it('warns when two lists at one level disagree, and draws the default there', () => {
    const result = compile('<ul><li>a<ul style="list-style-type:square"><li>b</li></ul></li><li>c<ul><li>d</li></ul></li></ul>');
    assert.equal((result.slide.children[0] as ListNode).levels, undefined);
    assert.ok(result.diagnostics.some((d) => d.level === 'warning' && /level 2/.test(d.message)));
  });

  it('counts from start, and down when reversed', () => {
    const list = firstList('<ol start="3" reversed><li>a</li><li>b</li></ol>');
    assert.equal(list.start, 3);
    assert.equal(list.reversed, true);
    assert.equal(firstList('<ol start="-2"><li>a</li></ol>').start, -2);
  });

  it('ignores start and reversed where they cannot count, with a warning', () => {
    const nested = compile('<ol><li>a<ol start="5" reversed><li>b</li></ol></li></ol>');
    assert.equal((nested.slide.children[0] as ListNode).start, undefined);
    assert.ok(nested.diagnostics.some((d) => d.level === 'warning' && /start/.test(d.message) && /1/.test(d.message)));
    const boxed = compile('<div data-text><ol start="4"><li>a</li></ol></div>');
    assert.equal(((boxed.slide.children[0] as TextBoxNode).blocks[0] as ListNode).start, undefined);
    assert.ok(boxed.diagnostics.some((d) => d.level === 'warning' && /start/.test(d.message)));
    const bad = compile('<ol start="two"><li>a</li></ol><ul start="2"><li>b</li></ul>');
    assert.deepEqual(bad.slide.children.map((n) => (n as ListNode).start), [undefined, undefined]);
    assert.equal(bad.diagnostics.filter((d) => d.level === 'warning' && /start/.test(d.message)).length, 2);
  });

  it('takes the marker, and only the marker, on a list inside a text box', () => {
    const result = compile('<div data-text><ul style="list-style-type:circle;color:#ff0000"><li>a</li></ul></div>');
    const block = (result.slide.children[0] as TextBoxNode).blocks[0] as ListNode;
    assert.deepEqual(block.style, { 'list-style-type': 'circle' });
    assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /color/.test(d.message)));
  });

  it('writes markers back and reads them again the same after another edit', () => {
    const html = [
      '<section id="a">',
      '  <ol start="3" reversed style="list-style-type:&quot;→&quot;;list-style-position:inside">',
      '    <li>one',
      '      <ol style="list-style-type:lower-roman">',
      '        <li>two</li>',
      '      </ol>',
      '    </li>',
      '    <li>three</li>',
      '  </ol>',
      '  <div data-text>',
      '    <ul style="list-style-type:square">',
      '      <li>four</li>',
      '    </ul>',
      '  </div>',
      '  <p>b</p>',
      '</section>',
      '',
    ].join('\n');
    const once = compileSlide(html, { id: 'a', lints: false });
    assert.deepEqual(once.diagnostics.filter((d) => d.level !== 'note'), []);
    assert.equal(serializeSlide(once.slide), html);
    const edited = serializeSlide(patchNodeStyle(once.slide, [2], { color: '#336699' }));
    const again = compileSlide(edited, { id: 'a', lints: false });
    assert.deepEqual(again.slide.children.slice(0, 2), once.slide.children.slice(0, 2));
  });
});

describe('list markers through text edits', () => {
  const list = firstList('<ol start="2" reversed style="list-style-type:upper-alpha"><li>a<ol style="list-style-type:lower-roman"><li>b</li></ol></li><li>c</li></ol>');
  const looks = (node: ListNode) => ({ style: node.style, start: node.start, reversed: node.reversed, levels: node.levels, levelsOfItems: node.items.map((item) => item.level) });

  it('keeps the markers, numbering and item levels when the words change', () => {
    const want = looks(list);
    assert.deepEqual(looks(mapRuns(list, (runs) => runs.map((run) => ({ ...run, text: run.text.toUpperCase() }))) as ListNode), want);
    const slide = { id: 'a', hidden: false, style: {}, children: [list], notes: '' };
    assert.deepEqual(looks(setRuns(slide, [0], [{ text: 'B!' }], undefined, 1).children[0] as ListNode), want);
    assert.deepEqual(looks(setPlainText(list, 'x\ny\nz') as ListNode), want);
  });

  it('keeps what still fits when the list kind changes', () => {
    const bullets = setListKind(list, 'ul') as ListNode;
    assert.equal(bullets.start, undefined);
    assert.equal(bullets.reversed, undefined);
    assert.equal(bullets.style['list-style-type'], undefined);
    assert.equal(bullets.levels, undefined);
    const kept = setListKind(firstList('<ul style="list-style-type:&quot;-&quot;;list-style-position:inside"><li>a</li></ul>'), 'ol') as ListNode;
    assert.deepEqual(kept.style, { 'list-style-type': '"-"', 'list-style-position': 'inside' });
    const paragraph = setListKind(list, null);
    assert.equal(paragraph.kind, 'text');
    assert.deepEqual(paragraph.style, {});
    assert.equal('start' in paragraph || 'levels' in paragraph || 'reversed' in paragraph, false);
  });
});

describe('list markers in a source deck', () => {
  const deck = createSourceDeck('.steps{list-style-type:upper-alpha;list-style-position:inside;color:#333333}.steps ol{list-style-type:lower-roman}');
  const source = '<section id="a">\n  <ol class="steps" start="2" reversed>\n    <li>one\n      <ol><li>two</li></ol>\n    </li>\n    <li>three</li>\n  </ol>\n  <p>b</p>\n</section>\n';
  const read = () => readSourceSlide(source, deck, { id: 'a', index: 0, lints: false });

  it('reads markers from the sheet and numbering from the tag', () => {
    const result = read();
    const list = result.slide.children[0] as ListNode;
    assert.deepEqual(list.style, { 'list-style-type': 'upper-alpha', 'list-style-position': 'inside', color: '#333333' });
    assert.deepEqual(list.levels, { 1: { 'list-style-type': 'lower-roman' } });
    assert.equal(list.start, 2);
    assert.equal(list.reversed, true);
  });

  it('keeps the list as written when something else changes, and after its words change', () => {
    const saved = read().slide;
    const recolored = patchNodeStyle(saved, [1], { color: '#336699' });
    assert.equal(patchSourceSlide(source, saved, recolored, deck, { id: 'a', index: 0 }), source.replace('<p>b</p>', '<p style="color:#336699">b</p>'));
    const reworded = setRuns(saved, [0], [{ text: 'ONE' }], undefined, 0);
    const out = patchSourceSlide(source, saved, reworded, deck, { id: 'a', index: 0 });
    assert.ok(out);
    assert.match(out, /<ol class="steps" start="2" reversed>/);
    const back = readSourceSlide(out, deck, { id: 'a', index: 0, lints: false }).slide.children[0] as ListNode;
    assert.deepEqual(looksOf(back), looksOf(reworded.children[0] as ListNode));
  });
});

function looksOf(node: ListNode) {
  return { style: node.style, start: node.start, reversed: node.reversed, levels: node.levels, items: node.items };
}

describe('nested markers edited in a source deck', () => {
  it('writes a changed nested marker into the list', () => {
    const deck = createSourceDeck('.steps ol{list-style-type:lower-roman}');
    const source = '<section id="a">\n  <ol class="steps">\n    <li>one\n      <ol><li>two</li></ol>\n    </li>\n  </ol>\n  <p>b</p>\n</section>\n';
    const saved = readSourceSlide(source, deck, { id: 'a', index: 0, lints: false }).slide;
    const list = saved.children[0] as ListNode;
    const edited = { ...saved, children: [{ ...list, levels: { 1: { 'list-style-type': 'upper-alpha' } } }, saved.children[1]!] };
    const out = patchSourceSlide(source, saved, edited, deck, { id: 'a', index: 0 });
    assert.ok(out);
    const back = readSourceSlide(out, deck, { id: 'a', index: 0, lints: false }).slide.children[0] as ListNode;
    assert.deepEqual(back.levels, { 1: { 'list-style-type': 'upper-alpha' } });
  });
});

describe('item styles in a source deck', () => {
  it('moves a font or colour every item shares onto the list, and reports one they do not share', () => {
    const deck = createSourceDeck('.a li{color:#aa0000;font-size:40px;font-weight:600}.b li{color:#aa0000}.b li.odd{color:#0000aa}.c li{margin-top:12px}');
    const source = '<section id="a">\n  <ul class="a" style="color:#111111"><li>one<ul><li>two</li></ul></li><li>three</li></ul>\n  <ul class="b"><li>x</li><li class="odd">y</li></ul>\n  <ul class="c"><li>z</li></ul>\n</section>\n';
    const result = readSourceSlide(source, deck, { id: 'a', index: 0, lints: false });
    const [shared, mixed, spaced] = result.slide.children as ListNode[];
    assert.deepEqual(shared!.style, { color: '#aa0000', 'font-size': '40px', 'font-weight': '600' });
    assert.equal(mixed!.style.color, undefined);
    assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /<li>/.test(d.message) && /color/.test(d.message) && d.line === 3));
    assert.ok(!result.diagnostics.some((d) => /<li>/.test(d.message) && d.line === 2));
    assert.deepEqual(spaced!.style, {});
    assert.deepEqual(spaced!.itemMargin, { top: 12, bottom: 0 });
    assert.ok(!result.diagnostics.some((d) => d.line === 4), JSON.stringify(result.diagnostics));
    const reread = patchSourceSlide(source, result.slide, patchNodeStyle(result.slide, [2], { color: '#336699' }), deck, { id: 'a', index: 0 });
    assert.equal(reread, source.replace('<ul class="c">', '<ul class="c" style="color:#336699">'));
  });

  it('writes a colour or size given to the whole list onto its items when their rule would win', () => {
    const deck = createSourceDeck('.pts{font-size:36px}.pts li{color:#b03030;font-size:40px}');
    const source = '<section id="a">\n  <ul class="pts"><li>one<ul><li>two</li></ul></li><li>three</li></ul>\n  <p>b</p>\n</section>\n';
    const saved = readSourceSlide(source, deck, { id: 'a', index: 0, lints: false }).slide;
    for (const [name, value] of [['color', '#336699'], ['font-size', '50px']] as const) {
      const out = patchSourceSlide(source, saved, patchNodeStyle(saved, [0], { [name]: value }), deck, { id: 'a', index: 0 });
      assert.ok(out, name);
      const back = readSourceSlide(out, deck, { id: 'a', index: 0, lints: false });
      assert.equal((back.slide.children[0] as ListNode).style[name], value);
      assert.ok(!back.diagnostics.some((d) => /<li>/.test(d.message)));
    }
  });

  it('reads a list with no markers as plain lines and says nothing of its list-style', () => {
    const deck = createSourceDeck('.n{list-style:none}');
    const result = readSourceSlide('<section id="a">\n  <ul class="n"><li>one</li><li>two</li></ul>\n</section>\n', deck, { id: 'a', index: 0, lints: false });
    assert.equal(result.slide.children[0]!.kind, 'box');
    assert.ok(!result.diagnostics.some((d) => /list-style/.test(d.message)), JSON.stringify(result.diagnostics));
  });
});

describe('the space between list items', () => {
  const spaced = (margin: string) => `<li style="margin:${margin}">`;

  it('reads a top and bottom margin every item shares, nested items too, and writes it back the same', () => {
    const html = [
      '<section id="a">',
      '  <ul>',
      '    <li style="margin:12px 0">one',
      '      <ul>',
      '        <li style="margin:12px 0">two</li>',
      '      </ul>',
      '    </li>',
      '    <li style="margin:12px 0">three</li>',
      '  </ul>',
      '  <ol>',
      '    <li style="margin:0 0 8px">a',
      '      <ol>',
      '        <li data-indent="1" style="margin:0 0 8px">b</li>',
      '      </ol>',
      '    </li>',
      '  </ol>',
      '</section>',
      '',
    ].join('\n');
    const once = compileSlide(html, { id: 'a', lints: false });
    assert.deepEqual(once.diagnostics.filter((d) => d.level !== 'note'), []);
    const [bullets, numbers] = once.slide.children as ListNode[];
    assert.deepEqual(bullets!.itemMargin, { top: 12, bottom: 12 });
    assert.deepEqual(numbers!.itemMargin, { top: 0, bottom: 8 });
    assert.equal(serializeSlide(once.slide), html);
  });

  it('drops margins the items do not share, negative margins and other item styles, with a report, and keeps the top and bottom of a sideways one', () => {
    for (const items of [
      `${spaced('12px 0')}a</li><li>b</li>`,
      `${spaced('12px 0')}a</li>${spaced('16px 0')}b</li>`,
      `${spaced('-4px 0')}a</li>${spaced('-4px 0')}b</li>`,
      `${spaced('1em 0')}a</li>${spaced('1em 0')}b</li>`,
      '<li style="color:#aa0000">a</li><li style="color:#aa0000">b</li>',
    ]) {
      const result = compile(`<ul>${items}</ul>`);
      assert.equal((result.slide.children[0] as ListNode).itemMargin, undefined, items);
      assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /<li>/.test(d.message)), items);
    }
    const sideways = compile(`<ul>${spaced('12px 8px')}a</li>${spaced('12px 8px')}b</li></ul>`);
    assert.deepEqual((sideways.slide.children[0] as ListNode).itemMargin, { top: 12, bottom: 12 });
    assert.ok(sideways.diagnostics.some((d) => d.level === 'unsupported' && /<li>/.test(d.message) && /left|right|sideways/.test(d.message)));
  });

  it('keeps no item margins on a list inside a text box', () => {
    const result = compile(`<div data-text><ul>${spaced('12px 0')}a</li>${spaced('12px 0')}b</li></ul></div>`);
    const box = result.slide.children[0] as TextBoxNode;
    assert.equal((box.blocks[0] as ListNode).itemMargin, undefined);
    assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /margin/.test(d.message)));
  });

  it('keeps the space through word edits and a change of list kind, and not on a paragraph', () => {
    const list = firstList(`<ul>${spaced('12px 0')}a</li>${spaced('12px 0')}b</li></ul>`);
    const slide = { id: 'a', hidden: false, style: {}, children: [list], notes: '' };
    assert.deepEqual((setRuns(slide, [0], [{ text: 'B!' }], undefined, 1).children[0] as ListNode).itemMargin, { top: 12, bottom: 12 });
    assert.deepEqual((setPlainText(list, 'x\ny\nz') as ListNode).itemMargin, { top: 12, bottom: 12 });
    assert.deepEqual((setListKind(list, 'ol') as ListNode).itemMargin, { top: 12, bottom: 12 });
    assert.equal('itemMargin' in setListKind(list, null), false);
  });
});

describe('the space between list items in a source deck', () => {
  const css = '.agenda li{margin:12px 0}.mixed li{margin-top:8px}.mixed li.b{margin-top:16px}.neg li{margin-top:-4px}.pct li{margin-bottom:5%}.em{font-size:40px}.em li{margin-bottom:0.5em}.wide li{margin:12px 24px}';
  const deck = createSourceDeck(css);
  const opts = { id: 'a', index: 0 };
  const read = (source: string) => readSourceSlide(source, deck, { ...opts, lints: false });

  it('keeps a positive px top and bottom margin every item shares, and reports the rest', () => {
    const source = [
      '<section id="a">',
      '  <ul class="agenda"><li>one<ul><li>two</li></ul></li><li>three</li></ul>',
      '  <ul class="mixed"><li>x</li><li class="b">y</li></ul>',
      '  <ul class="neg"><li>x</li><li>y</li></ul>',
      '  <ul class="pct"><li>x</li><li>y</li></ul>',
      '  <ul class="em"><li>x</li><li>y</li></ul>',
      '  <ul class="wide"><li>x</li><li>y</li></ul>',
      '</section>',
      '',
    ].join('\n');
    const result = read(source);
    const [agenda, mixed, neg, pct, em, wide] = result.slide.children as ListNode[];
    assert.deepEqual(agenda!.itemMargin, { top: 12, bottom: 12 });
    assert.deepEqual(em!.itemMargin, { top: 0, bottom: 20 });
    assert.deepEqual(wide!.itemMargin, { top: 12, bottom: 12 });
    for (const list of [mixed, neg, pct]) assert.equal(list!.itemMargin, undefined);
    const reported = (line: number) => result.diagnostics.some((d) => d.level === 'unsupported' && /<li>/.test(d.message) && /margin/.test(d.message) && d.line === line);
    assert.deepEqual([2, 3, 4, 5, 6, 7].map(reported), [false, true, true, true, false, true]);
  });

  for (const [what, css2, items] of [
    ['a rule of the sheet', '.agenda li{margin:12px 0}', '<li>one</li><li>two</li>'],
    ['each item', '', '<li style="margin:12px 0">one</li><li style="margin:12px 0">two</li>'],
  ] as const) {
    it(`writes an edited list back with the space when ${what} gives it`, () => {
      const sheet = createSourceDeck(css2);
      const source = `<section id="a">\n  <ul class="agenda">${items}</ul>\n  <p>b</p>\n</section>\n`;
      const saved = readSourceSlide(source, sheet, { ...opts, lints: false }).slide;
      assert.deepEqual((saved.children[0] as ListNode).itemMargin, { top: 12, bottom: 12 });
      const reworded = setRuns(saved, [0], [{ text: 'TWO' }], undefined, 1);
      const out = patchSourceSlide(source, saved, reworded, sheet, opts);
      assert.ok(out);
      if (css2) assert.doesNotMatch(out, /<li style/);
      const back = readSourceSlide(out, sheet, { ...opts, lints: false });
      assert.deepEqual((back.slide.children[0] as ListNode).itemMargin, { top: 12, bottom: 12 });
      assert.equal((back.slide.children[0] as ListNode).items[1]!.runs[0]!.text, 'TWO');
      assert.ok(!back.diagnostics.some((d) => /<li>/.test(d.message)));
    });
  }

  it('keeps the space when the slide is saved flat', () => {
    const saved = read('<section id="a">\n  <ul class="agenda"><li>one</li><li>two</li></ul>\n</section>\n').slide;
    const flat = compileSlide(flattenSlide(saved), { id: 'a', lints: false });
    assert.deepEqual(flat.diagnostics.filter((d) => d.level !== 'note'), []);
    assert.deepEqual((flat.slide.children[0] as ListNode).itemMargin, { top: 12, bottom: 12 });
  });
});
