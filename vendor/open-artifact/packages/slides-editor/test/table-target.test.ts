import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSlide, insertTableRow, patchNodeStyle, updateNodeAt, type TableNode } from '@open-artifact/slides-core';
import { tableTarget, targetTable } from '../src/lib/table-target.ts';

const slide = compileSlide('<section id="a">\n  <p>x</p>\n  <table>\n    <tr><td>a</td><td>b</td></tr>\n    <tr><td>c</td><td>d</td></tr>\n  </table>\n</section>\n', { id: 'a', lints: false }).slide;
const table = slide.children[1] as TableNode;

describe('the table a menu was opened on', () => {
  it('still applies when only the text or the style changed', () => {
    const target = tableTarget('a', [1], table, [1, 1]);
    assert.equal(targetTable('a', slide, target)?.kind, 'table');
    const styled = patchNodeStyle(slide, [1], { color: '#336699' });
    assert.equal(targetTable('a', styled, target)?.kind, 'table');
  });

  it('no longer applies once the table, its place or its size changed', () => {
    const target = tableTarget('a', [1], table, [1, 1]);
    assert.equal(targetTable('b', slide, target), null);
    assert.equal(targetTable('a', null, target), null);
    const grown = updateNodeAt(slide, [1], (node) => (node.kind === 'table' ? insertTableRow(node, 0) : node));
    assert.equal(targetTable('a', grown, target), null);
    const moved = { ...slide, children: [slide.children[1]!, slide.children[0]!] };
    assert.equal(targetTable('a', moved, target), null);
    const gone = { ...slide, children: [slide.children[0]!] };
    assert.equal(targetTable('a', gone, target), null);
  });

  it('no longer applies when its cell is outside the table', () => {
    assert.equal(targetTable('a', slide, tableTarget('a', [1], table, [2, 0])), null);
    assert.equal(targetTable('a', slide, tableTarget('a', [1], table, [0, 2])), null);
    assert.equal(targetTable('a', slide, tableTarget('a', [1], table))?.kind, 'table');
  });
});
