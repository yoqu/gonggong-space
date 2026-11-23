import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileSlide,
  createSourceDeck,
  patchNodeStyle,
  patchSourceSlide,
  readSourceSlide,
  serializeSlide,
  type BoxNode,
  type TableNode,
} from '../src/index.ts';

const compile = (body: string) => compileSlide(`<section id="a">${body}</section>`, { id: 'a', lints: false });

describe('margins in the inline format', () => {
  it('keeps a margin on a flow child, in one to four values or auto', () => {
    const result = compile('<p style="margin:24px 0 0 40px">a</p><h2 style="margin-left:-30px">b</h2><p style="margin:0 auto">c</p>');
    assert.equal(result.held, false);
    assert.deepEqual(result.slide.children.map((n) => n.style.margin), ['24px 0 0 40px', '0 0 0 -30px', '0 auto']);
    assert.deepEqual(result.diagnostics.filter((d) => /margin/.test(d.message) && d.level !== 'note'), []);
  });

  it('clamps a margin to ±1920px', () => {
    const result = compile('<div style="margin-top:2000px">a</div><div style="margin:-2500px">b</div>');
    assert.deepEqual(result.slide.children.map((n) => n.style.margin), ['1920px 0 0', '-1920px']);
    assert.equal(result.diagnostics.filter((d) => d.level === 'warning' && /1920/.test(d.message)).length, 2);
  });

  it('drops a margin on a pinned element and points to its offsets', () => {
    const result = compile('<p style="position:absolute;left:10px;top:10px;width:200px;margin:20px">a</p>');
    assert.equal(result.slide.children[0]!.style.margin, undefined);
    assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /margin/.test(d.message) && /left/.test(d.message) && /top/.test(d.message)));
  });

  it('takes no margin on the section, a row or a cell', () => {
    const result = compile('<table><tr style="margin:4px"><td style="margin:4px">a</td></tr></table>');
    const table = result.slide.children[0] as TableNode;
    assert.equal(table.rows[0]!.style.margin, undefined);
    assert.equal(table.rows[0]!.cells[0]!.style.margin, undefined);
    assert.equal(compileSlide('<section id="a" style="margin:10px"><p>a</p></section>', { id: 'a', lints: false }).slide.style.margin, undefined);
  });

  it('writes a margin back and reads it again the same after another edit', () => {
    const first = compile('<p style="margin:24px 0 0 40px">a</p><p>b</p>');
    const edited = patchNodeStyle(first.slide, [1], { color: '#336699' });
    const html = serializeSlide(edited);
    assert.match(html, /<p style="margin:24px 0 0 40px">a<\/p>/);
    const again = compileSlide(html, { id: 'a', lints: false });
    assert.equal(again.slide.children[0]!.style.margin, '24px 0 0 40px');
    assert.equal(serializeSlide(again.slide), html);
  });
});

describe('padding caps', () => {
  it('takes padding up to 1920px, and 64px on a cell', () => {
    const result = compile('<div style="padding:1800px 10px">a</div><p style="padding:2400px">b</p><table><tr><td style="padding:100px">c</td></tr></table>');
    const [box, text, table] = result.slide.children as [BoxNode, BoxNode, TableNode];
    assert.equal(box.style.padding, '1800px 10px');
    assert.equal(text.style.padding, '1920px');
    assert.equal(table.rows[0]!.cells[0]!.style.padding, '64px');
  });
});

describe('margins in a source deck', () => {
  const deck = createSourceDeck('.flow{margin:0 auto 24px}.big{margin-top:3000px}.pin{position:absolute;left:100px;top:100px;width:300px;margin:20px}');
  const source = '<section id="a">\n  <p class="flow">flow</p>\n  <p class="big">big</p>\n  <p class="pin">pinned</p>\n  <p>plain</p>\n</section>\n';
  const read = () => readSourceSlide(source, deck, { id: 'a', index: 0, lints: false });

  it('reads margins from the sheet, ±1920px, on pinned elements too', () => {
    const result = read();
    assert.equal(result.held, false);
    assert.deepEqual(result.slide.children.map((n) => n.style.margin), ['0 auto 24px', '1920px 0 0', '20px', undefined]);
  });

  it('keeps sheet margins when something else changes, and writes an edited margin on the tag', () => {
    const saved = read().slide;
    const recolored = patchNodeStyle(saved, [3], { color: '#336699' });
    const out = patchSourceSlide(source, saved, recolored, deck, { id: 'a', index: 0 });
    assert.equal(out, source.replace('<p>plain</p>', '<p style="color:#336699">plain</p>'));
    const spaced = patchNodeStyle(saved, [3], { margin: '0 0 0 48px' });
    const written = patchSourceSlide(source, saved, spaced, deck, { id: 'a', index: 0 });
    assert.equal(written, source.replace('<p>plain</p>', '<p style="margin:0 0 0 48px">plain</p>'));
    const back = readSourceSlide(written!, deck, { id: 'a', index: 0, lints: false });
    assert.deepEqual(back.slide.children.map((n) => n.style.margin), ['0 auto 24px', '1920px 0 0', '20px', '0 0 0 48px']);
  });

  it('takes an undone margin off the tag instead of writing a zero', () => {
    const saved = read().slide;
    const spaced = patchNodeStyle(saved, [3], { margin: '0 0 0 48px' });
    const written = patchSourceSlide(source, saved, spaced, deck, { id: 'a', index: 0 })!;
    const reread = readSourceSlide(written, deck, { id: 'a', index: 0, lints: false }).slide;
    assert.equal(patchSourceSlide(written, reread, saved, deck, { id: 'a', index: 0 }), source);
    const sheetSpaced = patchNodeStyle(saved, [0], { margin: '8px' });
    const onFlow = patchSourceSlide(source, saved, sheetSpaced, deck, { id: 'a', index: 0 })!;
    const flowBack = readSourceSlide(onFlow, deck, { id: 'a', index: 0, lints: false }).slide;
    assert.equal(patchSourceSlide(onFlow, flowBack, saved, deck, { id: 'a', index: 0 }), source);
  });
});
