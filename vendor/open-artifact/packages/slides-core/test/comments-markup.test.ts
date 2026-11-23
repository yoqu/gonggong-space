import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSlide, createSourceDeck, readSourceSlide } from '../src/index.ts';

const warnings = (html: string) => compileSlide(html, { id: 'a', lints: false }).diagnostics.filter((d) => d.level === 'warning' && /comment/.test(d.message));

describe('comments a browser reads differently', () => {
  it('warns about comments a browser closes at once', () => {
    assert.equal(warnings('<section id="a">\n<p>a <!--> b</p>\n<p>c --></p>\n</section>').length, 1);
    assert.equal(warnings('<section id="a">\n<p>a <!---> b</p>\n<p>c --></p>\n</section>').length, 1);
    assert.equal(warnings('<section id="a">\n<p>a <!-- b --!> c</p>\n<p>d --></p>\n</section>').length, 1);
    assert.equal(warnings('<section id="a"><p>a <!-- b --> c</p><!----></section>').length, 0);
    const [warning] = warnings('<section id="a">\n<p>a <!--> b</p>\n<p>c --></p>\n</section>');
    assert.equal(warning!.line, 2);
    assert.match(warning!.message, /<!-- text -->/);
  });

  it('warns about a comment inside an <iframe>, but not in an embedded page', () => {
    assert.equal(warnings('<section id="a"><iframe><!-- </iframe> --></iframe></section>').length, 1);
    assert.equal(warnings('<section id="a"><x-embed style="position:absolute;left:0;top:0;width:400px;height:300px"><iframe srcdoc="x"><!-- </iframe> --></iframe></x-embed></section>').length, 0);
  });

  it('warns in a source deck too', () => {
    const result = readSourceSlide('<section id="a">\n  <p>a <!--> b</p>\n  <p>c --></p>\n</section>\n', createSourceDeck(''), { id: 'a', index: 0, lints: false });
    assert.equal(result.diagnostics.filter((d) => d.level === 'warning' && /comment/.test(d.message) && d.line === 2).length, 1);
  });
});
