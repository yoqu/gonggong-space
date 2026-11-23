import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockUnicodeRange, cssUrls, faceKey, familyName, fontFaceBlocks, fontFaceDescriptors, fontSources, parseUnicodeRange, rangeCovers } from '../src/fonts.ts';

describe('font stylesheets', () => {
  it('reads unicode ranges', () => {
    assert.deepEqual(parseUnicodeRange('U+0000-00FF, U+0131, U+4??'), [
      [0, 0xff],
      [0x131, 0x131],
      [0x400, 0x4ff],
    ]);
    assert.equal(parseUnicodeRange(undefined), null);
    assert.deepEqual(parseUnicodeRange('U+zz'), []);
    assert.ok(rangeCovers(null, new Set([1])));
    assert.ok(rangeCovers([[0x4e00, 0x9fff]], new Set([0x41, 0x4f60])));
    assert.ok(!rangeCovers([[0x4e00, 0x9fff]], new Set([0x41])));
  });

  it('splits stylesheets into faces', () => {
    const css = '/* latin */\n@font-face { font-family: "A"; src: url(a.woff2); unicode-range: U+0000-00FF; }\n@font-face{font-family:"A";src:url(b.woff2)}';
    const blocks = fontFaceBlocks(css);
    assert.equal(blocks.length, 2);
    assert.equal(blockUnicodeRange(blocks[0]!), 'U+0000-00FF');
    assert.equal(blockUnicodeRange(blocks[1]!), undefined);
  });

  it('finds url() references', () => {
    assert.deepEqual(cssUrls(`src: url("a.woff2") format("woff2"), url(b.ttf), url('c d.otf')`), [
      { match: 'url("a.woff2")', url: 'a.woff2' },
      { match: 'url(b.ttf)', url: 'b.ttf' },
      { match: "url('c d.otf')", url: 'c d.otf' },
    ]);
  });

  it('reads the descriptors of a face, data: URLs and all', () => {
    const block = `@font-face { font-family: "Ma Shan Zheng"; FONT-WEIGHT: 400; src: local("x;y"), url("data:font/woff2;base64,AA;BB") format("woff2"); font-weight: 700 }`;
    assert.deepEqual([...fontFaceDescriptors(block)], [
      ['font-family', '"Ma Shan Zheng"'],
      ['src', 'local("x;y"), url("data:font/woff2;base64,AA;BB") format("woff2")'],
      ['font-weight', '700'],
    ]);
    assert.equal(fontFaceDescriptors('@font-face{}').size, 0);
  });

  it('splits src into its entries', () => {
    assert.deepEqual(fontSources(`local("Deco"), url(a.eot?#iefix) format("embedded-opentype"), url("data:font/woff2;base64,AA,BB") format('woff2'), url(c.ttf)`), [
      { text: 'local("Deco")' },
      { text: 'url(a.eot?#iefix) format("embedded-opentype")', url: { match: 'url(a.eot?#iefix)', url: 'a.eot?#iefix' }, format: 'embedded-opentype' },
      { text: `url("data:font/woff2;base64,AA,BB") format('woff2')`, url: { match: 'url("data:font/woff2;base64,AA,BB")', url: 'data:font/woff2;base64,AA,BB' }, format: 'woff2' },
      { text: 'url(c.ttf)', url: { match: 'url(c.ttf)', url: 'c.ttf' } },
    ]);
    assert.deepEqual(fontSources(''), []);
  });

  it('gives a rule and the FontFace made from it the same key', () => {
    // As a stylesheet writes them, and as `document.fonts` reports them.
    assert.equal(faceKey({ family: '"Ma Shan  Zheng"' }), faceKey({ family: 'Ma Shan Zheng', weight: 'normal', style: 'normal', unicodeRange: 'U+0-10FFFF' }));
    assert.equal(faceKey({ family: "'Inter'", weight: 'bold', style: 'Italic' }), faceKey({ family: 'inter', weight: '700', style: 'italic', unicodeRange: '' }));
    assert.equal(faceKey({ family: 'A', unicodeRange: 'U+4e00-9fff, U+3000-303f' }), faceKey({ family: 'A', unicodeRange: 'U+3000-303F,U+4E00-9FFF' }));
    assert.equal(faceKey({ family: 'A', weight: '100 900' }), 'a|100 900|normal|*');
    assert.notEqual(faceKey({ family: 'A', weight: '400' }), faceKey({ family: 'A', weight: '700' }));
    assert.notEqual(faceKey({ family: 'A', unicodeRange: 'U+0-FF' }), faceKey({ family: 'A' }));
    assert.equal(familyName(undefined), '');
  });
});
