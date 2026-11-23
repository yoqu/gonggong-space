import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addSectionAtSlide,
  buildViewContext,
  checkSlidesProject,
  compileSlide,
  contextId,
  deleteSection,
  duplicateNodes,
  fnv1a,
  groupNodes,
  mergeDeckIndex,
  mergeOrder,
  mintedId,
  moveNode,
  newDeckIndex,
  newTable,
  parseDeckIndex,
  parseVideoUrl,
  positionedElements,
  removeNodes,
  resolveContextId,
  sectionGroups,
  sectionedDeck,
  serializeDeckIndex,
  serializeSlide,
  ungroupNode,
  validateViewContext,
  videoEmbedUrl,
  insertTableColumn,
  insertTableRow,
  tableColumns,
} from '../src/index.ts';

describe('ids', () => {
  it('hashes with FNV-1a', () => {
    assert.equal(fnv1a(''), 2166136261);
    assert.equal(mintedId('s1', 3), `e3-${fnv1a('s1').toString(36)}`);
  });

  it('addresses and resolves elements', () => {
    const { slide } = compileSlide(
      '<section id="s1"><h1>A</h1><div style="position:absolute;left:0;top:0;width:100px;height:100px"><p>x</p></div></section>',
      { id: 's1' },
    );
    const positioned = positionedElements(slide);
    assert.equal(positioned[0]!.index, null);
    const pinned = contextId(slide, [1])!;
    assert.ok(pinned.startsWith('e1-'));
    assert.deepEqual(resolveContextId(slide, pinned)?.path, [1]);
    const inner = contextId(slide, [1, 0])!;
    assert.equal(inner, `${pinned}/0`);
    assert.deepEqual(resolveContextId(slide, inner)?.path, [1, 0]);
    const heading = contextId(slide, [0])!;
    assert.deepEqual(resolveContextId(slide, heading)?.path, [0]);
  });
});

describe('edit', () => {
  const source = [
    '<section id="s1">',
    '<p>flow</p>',
    '<div style="position:absolute;left:100px;top:100px;width:100px;height:100px;background:#000000"></div>',
    '<div style="position:absolute;left:300px;top:200px;width:100px;height:100px;background:#000000"></div>',
    '</section>',
  ].join('\n');

  it('groups pinned nodes at their bounds and ungroups back', () => {
    const { slide } = compileSlide(source, { id: 's1' });
    const grouped = groupNodes(slide, [[1], [2]], { group: true })!;
    assert.deepEqual(grouped.path, [1]);
    const box = grouped.slide.children[1]!;
    assert.equal(box.kind, 'box');
    assert.equal(box.style.left, '100px');
    assert.equal(box.style.width, '300px');
    const back = ungroupNode(grouped.slide, grouped.path);
    assert.equal(serializeSlide(back.slide), serializeSlide(slide));
  });

  it('duplicates, moves and removes', () => {
    const { slide } = compileSlide(source, { id: 's1' });
    const dup = duplicateNodes(slide, [[1]]);
    assert.deepEqual(dup.paths, [[2]]);
    assert.equal(dup.slide.children[2]!.style.left, '124px');
    const moved = moveNode(dup.slide, [3], [], 0);
    assert.deepEqual(moved.path, [0]);
    const removed = removeNodes(moved.slide, [[0], [1]]);
    assert.equal(removed.children.length, 2);
  });

  it('edits tables', () => {
    let table = newTable({ x: 0, y: 0, w: 800, h: 300 }, 3, 2, 'Column');
    assert.equal(tableColumns(table), 2);
    table = insertTableColumn(table, 2, 'Column');
    table = insertTableRow(table, 3);
    assert.equal(tableColumns(table), 3);
    assert.equal(table.rows.length, 4);
    assert.equal(table.rows[3]!.cells[0]!.tag, 'td');
  });
});

describe('deck', () => {
  it('round-trips the index and keeps unknown keys', () => {
    const index = { ...newDeckIndex('Deck', new Date('2026-01-01T00:00:00Z')), extra: { a: 1 } };
    const text = serializeDeckIndex(index);
    const parsed = parseDeckIndex(text);
    assert.equal(parsed.error, undefined);
    assert.equal(serializeDeckIndex(parsed.index), text);
    assert.deepEqual(parsed.index.extra, { a: 1 });
  });

  it('merges order three ways', () => {
    assert.deepEqual(mergeOrder(['a', 'b', 'c'], ['a', 'c', 'b'], ['a', 'b', 'c', 'd']), ['a', 'c', 'b', 'd']);
    assert.deepEqual(mergeOrder(['a', 'b'], ['b'], ['a', 'b']), ['b']);
  });

  it('merges index fields with theirs winning conflicts', () => {
    const base = newDeckIndex('Base');
    const mine = { ...base, title: 'Mine' };
    const theirs = { ...base, title: 'Theirs', cover: 's1' };
    const merged = mergeDeckIndex(base, mine, theirs);
    assert.equal(merged.title, 'Theirs');
    assert.equal(merged.cover, 's1');
    const onlyMine = mergeDeckIndex(base, mine, base);
    assert.equal(onlyMine.title, 'Mine');
  });
});

describe('sections', () => {
  it('adds, groups and deletes sections', () => {
    const order = ['a', 'b', 'c'];
    let deck = sectionedDeck({ sections: {} }, order);
    deck = addSectionAtSlide(deck, 'b', 'Second part', 'sec-1')!;
    const groups = sectionGroups(deck.sections, deck.order);
    assert.deepEqual(groups.map((g) => [g.section?.key ?? null, g.ids]), [[null, ['a']], ['sec-1', ['b', 'c']]]);
    deck = deleteSection(deck, 'sec-1')!;
    assert.equal(deck.sections.length, 0);
  });
});

describe('video links', () => {
  it('parses provider URLs', () => {
    const link = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
    assert.deepEqual(link, { provider: 'youtube', id: 'dQw4w9WgXcQ', start: 42 });
    assert.ok(videoEmbedUrl(link)?.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'));
    assert.equal(parseVideoUrl('https://example.com/video'), null);
  });
});

describe('view context', () => {
  it('builds a record that validates', () => {
    const record = buildViewContext({
      mode: 'edit',
      slideId: 's1',
      slideTitle: 'Hello',
      slideIndex: 1,
      slideCount: 3,
      dirty: false,
      selected: [{ id: 'e1-abc', kind: 'shape', label: 'Rectangle' }],
    });
    assert.deepEqual(validateViewContext(record), record);
    assert.equal(validateViewContext({ ...record, mode: 'other' }), null);
    assert.equal(validateViewContext({ ...record, selected: ['bad id!'] }), null);
  });
});

describe('checkSlidesProject', () => {
  it('reports a missing index and held slides', () => {
    const files = new Map([['slides/s1.html', '<section id="nope"></section>']]);
    const findings = checkSlidesProject(files);
    assert.ok(findings.some((f) => f.file === 'deck.json' && f.level === 'error'));
    assert.ok(findings.some((f) => f.file === 'slides/s1.html' && f.level === 'error'));
  });

  it('passes a clean deck', () => {
    const index = { ...newDeckIndex('Deck'), order: ['s1'] };
    const files = new Map([
      ['deck.json', serializeDeckIndex(index)],
      ['slides/s1.html', '<section id="s1" style="background:#ffffff;color:#1a1a1a"><h1>Hi</h1></section>\n'],
    ]);
    const errors = checkSlidesProject(files).filter((f) => f.level === 'error');
    assert.deepEqual(errors, []);
  });
});
