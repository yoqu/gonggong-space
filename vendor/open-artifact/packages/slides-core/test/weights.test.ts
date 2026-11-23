import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cleanMarks,
  compileSlide,
  countMarks,
  createSourceDeck,
  normalizeRuns,
  patchNodeStyle,
  patchSourceSlide,
  readSourceSlide,
  serializeSlide,
  setMark,
  setNodeMark,
  toggleMark,
  type TextNode,
} from '../src/index.ts';

const compile = (body: string) => compileSlide(`<section id="a">${body}</section>`, { id: 'a', lints: false });
const first = (body: string) => compile(body).slide.children[0] as TextNode;

describe('regular weight inside bold text', () => {
  it('reads <span style="font-weight:400"> as a regular phrase', () => {
    const heading = first('<h2>Bold <span style="font-weight:400">regular</span></h2>');
    assert.deepEqual(heading.runs, [{ text: 'Bold ' }, { text: 'regular', marks: { regular: true } }]);
    const inBold = first('<p><b>all <span style="font-weight:normal">but this</span></b></p>');
    assert.deepEqual(inBold.runs, [{ text: 'all ', marks: { b: true } }, { text: 'but this', marks: { regular: true } }]);
    const boldAgain = first('<p><span style="font-weight:400">x <b>y</b></span></p>');
    assert.deepEqual(boldAgain.runs, [{ text: 'x ', marks: { regular: true } }, { text: 'y', marks: { b: true } }]);
  });

  it('drops any other weight on a span and says which ones work', () => {
    const result = compile('<h2>a <span style="font-weight:300">light</span></h2>');
    assert.deepEqual((result.slide.children[0] as TextNode).runs, [{ text: 'a light' }]);
    assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /600/.test(d.message) && /400/.test(d.message)));
    assert.deepEqual(first('<p><span style="font-weight:700">b</span></p>').runs, [{ text: 'b', marks: { b: true } }]);
  });

  it('writes the phrase back, colour and all, and reads it again the same', () => {
    const html = '<section id="a">\n  <h2>Bold <span style="font-weight:400">regular</span> <span style="color:#ff0000;font-weight:400">red</span></h2>\n  <p>b</p>\n</section>\n';
    const once = compileSlide(html, { id: 'a', lints: false });
    assert.equal(serializeSlide(once.slide), html);
    const edited = serializeSlide(patchNodeStyle(once.slide, [1], { color: '#336699' }));
    assert.deepEqual((compileSlide(edited, { id: 'a', lints: false }).slide.children[0] as TextNode).runs, (once.slide.children[0] as TextNode).runs);
  });

  it('keeps bold and regular apart in run edits', () => {
    assert.deepEqual(cleanMarks({ b: true, regular: true }), { b: true });
    assert.deepEqual(normalizeRuns([{ text: 'a', marks: { regular: true } }, { text: 'b', marks: { regular: true } }, { text: 'c' }]), [{ text: 'ab', marks: { regular: true } }, { text: 'c' }]);
    const runs = [{ text: 'abc', marks: { regular: true as const } }];
    assert.deepEqual(toggleMark(runs, 0, 3, 'b'), [{ text: 'abc', marks: { b: true } }]);
    assert.deepEqual(setMark([{ text: 'abc', marks: { b: true as const } }], 0, 3, 'regular', true), [{ text: 'abc', marks: { regular: true } }]);
    assert.equal(countMarks(runs), 1);
    const node = first('<h2>a <span style="font-weight:400">b</span></h2>');
    assert.deepEqual((setNodeMark(node, 'b', true) as TextNode).runs, [{ text: 'a b', marks: { b: true } }]);
  });

  it('reads a regular phrase from a source deck and writes it back', () => {
    const deck = createSourceDeck('h2{font-weight:700}.soft{font-weight:400}');
    const source = '<section id="a">\n  <h2>Big <span class="soft">quiet</span></h2>\n  <p>b</p>\n</section>\n';
    const read = readSourceSlide(source, deck, { id: 'a', index: 0, lints: false });
    assert.deepEqual((read.slide.children[0] as TextNode).runs, [{ text: 'Big ' }, { text: 'quiet', marks: { regular: true } }]);
    const edited = patchNodeStyle(read.slide, [1], { color: '#336699' });
    const out = patchSourceSlide(source, read.slide, edited, deck, { id: 'a', index: 0 });
    assert.equal(out, source.replace('<p>b</p>', '<p style="color:#336699">b</p>'));
  });
});
