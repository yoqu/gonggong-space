import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LAYOUT_IDS,
  compileSlide,
  heldReason,
  layoutHtml,
  makeLayout,
  serializeSlide,
  type TextNode,
} from '../src/index.ts';

/** serialize → compile → serialize must be a fixed point. */
function assertStable(source: string, id: string): string {
  const first = compileSlide(source, { id, lints: false });
  const out = serializeSlide(first.slide);
  const second = compileSlide(out, { id, lints: false });
  assert.deepEqual(second.diagnostics.filter((d) => d.level === 'error'), [], out);
  assert.equal(serializeSlide(second.slide), out);
  return out;
}

describe('compileSlide', () => {
  it('reads a simple slide', () => {
    const result = compileSlide('<section id="s1" style="background:#fff"><h1>Hello <b>world</b></h1><p>Body</p></section>', { id: 's1' });
    assert.equal(result.held, false);
    assert.equal(result.slide.id, 's1');
    assert.equal(result.slide.children.length, 2);
    const h1 = result.slide.children[0] as TextNode;
    assert.equal(h1.kind, 'text');
    assert.equal(h1.tag, 'h1');
    assert.deepEqual(h1.runs, [{ text: 'Hello ' }, { text: 'world', marks: { b: true } }]);
  });

  it('holds a slide whose id differs from its file name', () => {
    const result = compileSlide('<section id="other"><p>x</p></section>', { id: 's1' });
    assert.equal(result.held, true);
    assert.ok(heldReason(result.diagnostics));
  });

  it('holds a file with two sections', () => {
    const result = compileSlide('<section id="a"></section><section id="b"></section>', { id: 'a' });
    assert.equal(result.held, true);
  });

  it('reads speaker notes and data-section', () => {
    const result = compileSlide('<section id="s1" data-section="Intro"><p>x</p><aside>Say hi</aside></section>', { id: 's1' });
    assert.equal(result.slide.notes, 'Say hi');
    assert.equal(result.slide.section, 'Intro');
  });

  it('collects blob assets', () => {
    const blob = `/_blob/${'a'.repeat(32)}`;
    const result = compileSlide(`<section id="s1"><img src="${blob}" alt="A"></section>`, { id: 's1' });
    assert.deepEqual(result.assets, [blob]);
  });

  it('expands the font shorthand into longhands', () => {
    const result = compileSlide('<section id="s1"><h1 style="font:italic bold 72px/1.1 Georgia, serif">Title</h1></section>', { id: 's1' });
    const h1 = result.slide.children[0] as TextNode;
    assert.equal(h1.style['font-style'], 'italic');
    assert.equal(h1.style['font-weight'], '700');
    assert.equal(h1.style['font-size'], '72px');
    assert.equal(h1.style['line-height'], '1.1');
    assert.match(h1.style['font-family'] ?? '', /Georgia/);
  });

  it('counts table cells', () => {
    const result = compileSlide('<section id="s1"><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></section>', { id: 's1' });
    assert.equal(result.cells, 4);
  });
});

describe('serializeSlide', () => {
  it('round-trips every layout', () => {
    for (const layout of LAYOUT_IDS) {
      const out = assertStable(layoutHtml(layout, `s-${layout}`), `s-${layout}`);
      assert.equal(serializeSlide(makeLayout(layout, `s-${layout}`)), out);
    }
  });

  it('round-trips pinned elements, builds and shapes', () => {
    assertStable(
      [
        '<section id="s2" data-transition="fade" style="background:#101010;color:#fafafa">',
        '<h2>Title</h2>',
        '<div style="position:absolute;left:100px;top:200px;width:400px;height:300px;background:#ff0000" data-build-in="fade 1"></div>',
        '<x-shape kind="ellipse" style="position:absolute;left:600px;top:200px;width:200px;height:200px;background:#00ff00"></x-shape>',
        '<x-connector x1="100" y1="100" x2="500" y2="100" head="none" head-end="filled"></x-connector>',
        '<aside>Notes line one\nline two</aside>',
        '</section>',
      ].join('\n'),
      's2',
    );
  });

  it('keeps double and edge spaces', () => {
    const out = assertStable('<section id="s3"><p>&nbsp;a&nbsp; b&nbsp;</p></section>', 's3');
    const again = compileSlide(out, { id: 's3' }).slide.children[0] as TextNode;
    // Non-breaking spaces survive as U+00A0 so the browser keeps them.
    assert.equal(again.runs[0]!.text.replace(/\u00a0/g, ' '), ' a  b ');
  });
});

describe('flex direction', () => {
  it('reads display:flex alone as a row and a bare box as a column', () => {
    const result = compileSlide(
      '<section id="d"><div style="display:flex;gap:24px"><p>A</p><p>B</p></div><div style="gap:8px"><p>C</p></div></section>',
      { lints: false },
    );
    assert.ok(result.slide);
    const [row, stack] = result.slide.children;
    assert.equal(row!.style['flex-direction'], 'row');
    assert.equal(stack!.style['flex-direction'], undefined);
  });
});
