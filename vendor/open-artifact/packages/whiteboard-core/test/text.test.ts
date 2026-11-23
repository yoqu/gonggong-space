import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { NoteElement, ShapeElement, TextElement } from '../src/schema.ts';
import { createFontFitContent, FIT_EXACT, FIT_LOOSE, fitBoxToText, fittedBoxPatch, longestWordWidth, overflowFitSize, splitBreakableWords, widenTextWrapToFit } from '../src/text/fit.ts';
import { decodeMarkdownEscapes, encodeMarkdownEscapes, escapeInlineMarkdown, markdownLinkUrls, tokenizeCodeSpans, tokenizeInlineMarkdown } from '../src/text/inline-markdown.ts';
import { isLinkableHref, linkableTextSpans, linkEditCost } from '../src/text/links.ts';
import {
  hasBlankText,
  nestListRows,
  normalizeTextForProfile,
  parseMarkdownBlocks,
  parseRichText,
  parseTextRows,
  plainTextOfMarkup,
  TEXT_PROFILES,
  textLinesWithHang,
  textProfileForElement,
  textWithListPrefixes,
} from '../src/text/markup.ts';
import { getTextMetricsEpoch, measureLabelWordWidth, measureRunsWidth, measureTextBlock, setTextMeasurer, subscribeTextMetrics } from '../src/text/measure.ts';
import { canWrapInlineCode, escapeListMarker, parseNoteBlocks, wrapInlineCode } from '../src/text/note-markdown.ts';
import { drawArrowsInLines, dropArrowJoiners } from '../src/text/text-arrows.ts';

/** Every character half an em wide (italics a little wider), for predictable layout. */
function installFixedMeasurer(): void {
  setTextMeasurer((text, font) => [...text].length * font.px * (font.italic === true ? 0.6 : 0.5));
}

after(() => setTextMeasurer());

describe('typed arrows', () => {
  it('draws arrows outside code, links and right-to-left text', () => {
    assert.equal(drawArrowsInLines('a -> b <- c <-> d'), 'a → b ← c ←→ d');
    assert.equal(drawArrowsInLines('`a -> b` and https://x.dev/-> c'), '`a -> b` and https://x.dev/-> c');
    assert.equal(drawArrowsInLines('x-1 -- y'), 'x-1 -- y');
    assert.equal(drawArrowsInLines('-\u200C>'), '-\u200C>');
    assert.equal(dropArrowJoiners('a\u200Cb -\u200C>'), 'a\u200Cb ->');
  });
});

describe('inline markdown', () => {
  it('tokenizes emphasis, code and links', () => {
    assert.deepEqual(tokenizeInlineMarkdown('a **b** *c* ***d*** `e` [f](https://g.dev)'), [
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'bolditalic', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'e' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'f', href: 'https://g.dev' },
    ]);
  });

  it('lets code spans win and trims their padding only around backticks', () => {
    assert.deepEqual(tokenizeInlineMarkdown('`*a*` *b*'), [
      { kind: 'code', text: '*a*' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'b' },
    ]);
    assert.deepEqual(tokenizeCodeSpans('x `` `a` `` y'), [
      { kind: 'text', text: 'x ' },
      { kind: 'code', text: '`a`' },
      { kind: 'text', text: ' y' },
    ]);
    assert.deepEqual(tokenizeCodeSpans('`  a  `'), [{ kind: 'code', text: '  a  ' }]);
  });

  it('keeps unsafe links as text and honors escapes', () => {
    assert.deepEqual(tokenizeInlineMarkdown('[x](javascript:alert)'), [{ kind: 'text', text: 'x' }]);
    assert.deepEqual(tokenizeInlineMarkdown('[x](javascript:alert)', { literalUnsafeLinks: true }), [{ kind: 'text', text: '[x](javascript:alert)' }]);
    assert.deepEqual(tokenizeInlineMarkdown('[x](https://a.dev)', { linksTo: new Set(['https://b.dev']) }), [{ kind: 'text', text: 'x' }]);
    assert.deepEqual(tokenizeInlineMarkdown('\\*not\\* `\\*`', { escapes: true }), [
      { kind: 'text', text: '*not* ' },
      { kind: 'code', text: '\\*' },
    ]);
    assert.equal(decodeMarkdownEscapes(encodeMarkdownEscapes('a\\*b\\\\')), 'a*b\\');
    assert.equal(escapeInlineMarkdown('*[x]*'), '\\*\\[x\\]\\*');
    assert.deepEqual([...markdownLinkUrls('[a](https://a.dev) [b](ftp://b) [c](http://c.dev)')], ['https://a.dev', 'http://c.dev']);
  });

  it('draws arrows in text but not in code when pretty', () => {
    assert.deepEqual(tokenizeInlineMarkdown('a -> `b -> c` **d -> e**', { pretty: true }), [
      { kind: 'text', text: 'a → ' },
      { kind: 'code', text: 'b -> c' },
      { kind: 'text', text: ' ' },
      { kind: 'bold', text: 'd → e' },
    ]);
  });
});

describe('note markdown', () => {
  it('splits note text into paragraphs and lists', () => {
    assert.deepEqual(parseNoteBlocks('intro\n- a\n* b\n3. c\n4. d\n\\- not a list\n'), [
      { kind: 'p', text: 'intro' },
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', start: 3, items: ['c', 'd'] },
      { kind: 'p', text: '- not a list' },
    ]);
    assert.deepEqual(parseNoteBlocks('- a', { lists: false }), [{ kind: 'p', text: '- a' }]);
    assert.equal(escapeListMarker('- a'), '\\- a');
    assert.equal(escapeListMarker('12. a'), '12\\. a');
  });

  it('wraps text in the shortest code span that reads back exactly', () => {
    assert.equal(wrapInlineCode('a'), '`a`');
    assert.equal(wrapInlineCode('a`b'), '``a`b``');
    assert.equal(wrapInlineCode('`a'), '`` `a ``');
    assert.equal(canWrapInlineCode('x'), true);
  });
});

describe('markup', () => {
  it('reads nested list rows by indentation', () => {
    const { rows } = parseTextRows('- a\n  - b\n    1. c\n- d\npara', TEXT_PROFILES.block);
    assert.deepEqual(
      rows.map((row) => [row.kind, row.level, row.n, row.text]),
      [
        ['ul', 0, 0, 'a'],
        ['ul', 1, 0, 'b'],
        ['ol', 2, 1, 'c'],
        ['ul', 0, 0, 'd'],
        ['p', 0, 0, 'para'],
      ],
    );
    const blocks = nestListRows(rows);
    assert.equal(blocks.length, 2);
    const list = blocks[0]!;
    assert.ok(list.kind === 'ul');
    assert.deepEqual(
      list.items.map((item) => item.text),
      ['a', 'd'],
    );
    assert.equal(list.items[0]!.lists[0]!.items[0]!.lists[0]!.kind, 'ol');
  });

  it('splits numbered lists where numbering breaks', () => {
    assert.deepEqual(parseMarkdownBlocks('1. a\n2. b\n5. c'), [
      { kind: 'ol', start: 1, items: ['a', 'b'] },
      { kind: 'ol', start: 5, items: ['c'] },
    ]);
  });

  it('applies profiles', () => {
    assert.equal(normalizeTextForProfile('**x**', TEXT_PROFILES.label), '\\*\\*x\\*\\*');
    assert.equal(normalizeTextForProfile('a\r\nb\u00A0c', TEXT_PROFILES.title), 'a\nb c');
    assert.equal(textProfileForElement({ type: 'arrow' }), TEXT_PROFILES.label);
    assert.equal(textProfileForElement({ type: 'image' }), undefined);
  });

  it('gives copyable and visible text', () => {
    assert.equal(plainTextOfMarkup('\\*a\\* [b](https://b.dev) [c](javascript:x)'), '*a* [b](https://b.dev) [c] (javascript:x)');
    assert.equal(textWithListPrefixes('- **a**\n2. b -> c'), '- a\n2. b → c');
    assert.equal(hasBlankText({ text: ' \n  ' }), true);
    assert.equal(hasBlankText({ text: '- ' }), false);
    assert.equal(hasBlankText({ text: '- x' }), false);
  });

  it('parses rich text into blocks, a single line, or lines', () => {
    const inline = parseRichText('**a** -> b');
    assert.deepEqual(inline, {
      kind: 'inline',
      spans: [
        { kind: 'bold', text: 'a' },
        { kind: 'text', text: ' → b' },
      ],
    });
    assert.deepEqual(parseRichText('a\n\nb\n'), {
      kind: 'lines',
      lines: [[{ kind: 'text', text: 'a' }], [], [{ kind: 'text', text: 'b' }]],
      trailingNewline: true,
    });
    const blocks = parseRichText('top\n- one\n- ', TEXT_PROFILES.block, (sample) => sample.length);
    assert.ok(blocks.kind === 'blocks');
    assert.equal(blocks.hang, 3);
    assert.deepEqual(blocks.blocks[0], { kind: 'p', row: 0, text: [{ kind: 'text', text: 'top' }] });
    const list = blocks.blocks[1]!;
    assert.ok(list.kind === 'ul');
    assert.deepEqual(
      list.items.map((item) => item.text),
      [[{ kind: 'text', text: 'one' }], []],
    );
  });

  it('hangs list lines by their widest mark and level', () => {
    const lines = textLinesWithHang('para\n9. a\n10. b\n    - c', 10, (sample) => sample.length * 5);
    assert.deepEqual(
      lines.map((line) => [line.mark, line.hang]),
      [
        ['', 0],
        ['9.', 20],
        ['10.', 20],
        ['◦', 35],
      ],
    );
  });
});

describe('text measurement', () => {
  it('falls back to estimates for glyphs the table does not know', () => {
    setTextMeasurer();
    assert.ok(measureTextBlock('Hello', 'body').w > 20);
    assert.deepEqual(measureTextBlock('', 'body'), { w: 16, h: 16 * 1.35 });
    assert.equal(measureTextBlock('中文', 'body').w, 2 * 16 * 0.55);
    assert.equal(measureLabelWordWidth('中'), 6.5);
  });

  it('uses an installed measurer and tells subscribers', () => {
    let calls = 0;
    const unsubscribe = subscribeTextMetrics(() => calls++);
    const epoch = getTextMetricsEpoch();
    installFixedMeasurer();
    unsubscribe();
    assert.equal(calls, 1);
    assert.equal(getTextMetricsEpoch(), epoch + 1);
    assert.deepEqual(measureTextBlock('abcd\nab', 'body'), { w: 32, h: Math.round(2 * 16 * 1.35) });
    assert.equal(measureRunsWidth([{ text: 'ab', italic: false }], 'body'), 16);
    assert.equal(measureRunsWidth([{ text: 'ab', italic: false }, { text: 'cd', italic: 'plain' }], 'body', true), 16 + 2 * 16 * 0.6);
    assert.equal(measureLabelWordWidth('word', getTextMetricsEpoch()), 4 * 14 * 0.5);
  });
});

describe('box fitting', () => {
  const shape: ShapeElement = { type: 'shape', id: 's', kind: 'rect', color: 'white', text: 'hello world', size: 'body', x: 100, y: 100, w: 40, h: 20 };

  it('breaks CJK between characters and keeps other words whole', () => {
    assert.deepEqual(splitBreakableWords('（中文）abc'), ['（中', '文）', 'abc']);
    assert.deepEqual(splitBreakableWords('hello'), ['hello']);
  });

  it('grows a box until its text fits', () => {
    installFixedMeasurer();
    assert.equal(longestWordWidth(shape), 40);
    assert.deepEqual(fitBoxToText(shape, shape.w, shape.h, FIT_LOOSE), { w: 64, h: 63 });
    assert.deepEqual(fitBoxToText({ text: '', size: 'body' }, 10, 10, FIT_LOOSE), { w: 10, h: 10 });
    assert.ok(fitBoxToText(shape, 40, 20, FIT_EXACT).h > 20);
    assert.deepEqual(overflowFitSize(shape), { w: 64, h: 63 });
    assert.equal(overflowFitSize({ ...shape, w: 200, h: 100 }), undefined);
    assert.deepEqual(fittedBoxPatch(shape), { x: 88, y: 78.5, w: 64, h: 63 });
  });

  it('widens notes to their widest word', () => {
    installFixedMeasurer();
    const note: NoteElement = { type: 'note', id: 'n', color: 'yellow', text: 'hello world', tilt: 0, size: 'body', x: 0, y: 0, w: 50, h: 50 };
    assert.deepEqual(fittedBoxPatch(note), { w: 88 });
    assert.equal(fittedBoxPatch({ ...note, w: 200 }), undefined);
  });

  it('widens a text wrap that is only slightly too narrow', () => {
    installFixedMeasurer();
    const text: TextElement = { type: 'text', id: 't', x: 0, y: 0, text: 'abcdefghij', size: 'body', color: 'ink', wrap: 78 };
    assert.equal(widenTextWrapToFit(text).wrap, 80);
    const narrow = { ...text, wrap: 50 };
    assert.equal(widenTextWrapToFit(narrow), narrow);
  });

  it('fits whole boards, memoized', () => {
    installFixedMeasurer();
    const fit = createFontFitContent();
    const raw = { elements: [shape] };
    const fitted = fit(raw);
    assert.notEqual(fitted, raw);
    const grown = fitted.elements[0]!;
    assert.ok(grown.type === 'shape');
    assert.deepEqual([grown.w, grown.h], [64, 63]);
    assert.equal(fit(raw), fitted);
    const roomy = { elements: [{ ...shape, w: 200, h: 100 }] };
    assert.equal(fit(roomy), roomy);
  });
});

describe('note links', () => {
  it('decides what may be linked and what it costs', () => {
    assert.equal(isLinkableHref('https://a.dev/x'), true);
    assert.equal(isLinkableHref('https://a.dev/*x*'), false);
    assert.equal(isLinkableHref('mailto:a@b'), false);
    assert.deepEqual(linkableTextSpans(' [ab cd]\n ef '), [
      [2, 7],
      [10, 12],
    ]);
    assert.equal(linkEditCost(0, 'https://a.dev'), 30);
    assert.equal(linkEditCost(2, 'https://a.dev'), 58);
  });
});
