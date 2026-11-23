import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileSlide,
  createSourceDeck,
  patchNodeStyle,
  patchSourceSlide,
  readSourceSlide,
  serializeSlide,
  type TableNode,
} from '../src/index.ts';

describe('table column widths', () => {
  it('takes % and px widths on the first row, mixed, and leaves the other columns to share the rest', () => {
    const html = '<section id="a">\n  <table>\n    <tr><td style="width:30%">a</td><td style="width:240px">b</td><td>c</td></tr>\n    <tr><td>d</td><td>e</td><td>f</td></tr>\n  </table>\n  <p>b</p>\n</section>\n';
    const result = compileSlide(html, { id: 'a', lints: false });
    assert.deepEqual(result.diagnostics.filter((d) => d.level !== 'note'), []);
    const table = result.slide.children[0] as TableNode;
    assert.deepEqual(table.rows[0]!.cells.map((cell) => cell.style.width), ['30%', '240px', undefined]);
    const edited = serializeSlide(patchNodeStyle(result.slide, [1], { color: '#336699' }));
    assert.deepEqual((compileSlide(edited, { id: 'a', lints: false }).slide.children[0] as TableNode).rows, table.rows);
  });
});

describe('row fills in a source deck', () => {
  const deck = createSourceDeck('thead{background:#e8eef7}.dark{background:#223344}.sheen{background:linear-gradient(#fff,#000)}td.hot{background:#ffeeee}');
  const source = [
    '<section id="a">',
    '  <table>',
    '    <thead><tr><th>Name</th><th>Score</th></tr></thead>',
    '    <tbody><tr><td>a</td><td class="hot">1</td></tr><tr><td class="hot">b</td><td class="hot">2</td></tr></tbody>',
    '  </table>',
    '  <table>',
    '    <thead class="dark"><tr style="background:#ffffff"><th>x</th></tr><tr><th>y</th></tr></thead>',
    '  </table>',
    '  <table>',
    '    <thead class="sheen"><tr><th>z</th></tr></thead>',
    '  </table>',
    '  <p>b</p>',
    '</section>',
    '',
  ].join('\n');
  const read = () => readSourceSlide(source, deck, { id: 'a', index: 0, lints: false });

  it('gives a flat <thead> background to its rows, under their own', () => {
    const result = read();
    const [first, second, third] = result.slide.children as TableNode[];
    assert.deepEqual(first!.rows.map((row) => row.style.background), ['#e8eef7', undefined, '#ffeeee']);
    assert.ok(result.diagnostics.some((d) => d.level === 'warning' && /<tr>/.test(d.message) && /fill/.test(d.message) && d.line === 4));
    assert.ok(!result.diagnostics.some((d) => /<td>/.test(d.message)));
    assert.deepEqual(second!.rows.map((row) => row.style.background), ['#ffffff', '#223344']);
    assert.equal(third!.rows[0]!.style.background, undefined);
    assert.ok(result.diagnostics.some((d) => d.level === 'unsupported' && /thead/.test(d.message) && /flat/.test(d.message)));
    assert.ok(!result.diagnostics.some((d) => /thead/.test(d.message) && /#e8eef7|dark/.test(d.message)));
  });

  it('keeps the source as written when something else changes, and writes a row fill on the <tr>', () => {
    const saved = read().slide;
    const recolored = patchNodeStyle(saved, [3], { color: '#336699' });
    assert.equal(patchSourceSlide(source, saved, recolored, deck, { id: 'a', index: 0 }), source.replace('<p>b</p>', '<p style="color:#336699">b</p>'));
    const table = saved.children[0] as TableNode;
    const filled = { ...saved, children: [{ ...table, rows: [{ ...table.rows[0]!, style: { background: '#000000' } }, table.rows[1]!] }, ...saved.children.slice(1)] };
    const out = patchSourceSlide(source, saved, filled, deck, { id: 'a', index: 0 });
    assert.ok(out);
    const back = readSourceSlide(out, deck, { id: 'a', index: 0, lints: false }).slide.children[0] as TableNode;
    assert.equal(back.rows[0]!.style.background, '#000000');
  });
});
