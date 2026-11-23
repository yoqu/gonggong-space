import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_FILE_DEFAULT_TITLE,
  BOARD_FILE_FORMAT,
  BOARD_FILE_VERSION,
  boardFileJsonReplacer,
  boardFileName,
  boardFileOutline,
  buildBoardFile,
  htmlDocumentTitle,
  htmlTitleTagFor,
  parseBoardFile,
  serializeBoardFile,
} from '../src/board-file.ts';
import { checkBoardDocuments } from '../src/check.ts';
import type { Board, BoardElement, HtmlElement, NoteElement, TableElement } from '../src/schema.ts';
import { suggestedColumnWidth, tableFromGrid } from '../src/table.ts';

const note = (id: string, text: string, x = 0, extra: Partial<NoteElement> = {}): NoteElement => ({
  type: 'note',
  id,
  x,
  y: 0,
  w: 180,
  h: 180,
  color: 'yellow',
  text,
  tilt: 0,
  ...extra,
});

const embed: HtmlElement = { type: 'html', id: 'h1', x: 0, y: 300, w: 200, h: 100, html: '<title> My  chart </title><script>alert(1)</script>' };
const table: TableElement = { type: 'table', id: 't1', x: 0, y: 600, head: true, color: 'white', ...tableFromGrid([['Name', 'Score'], ['Ann', '3']]) };

const sample: Board = {
  title: 'Retro',
  content: { elements: [note('n1', 'Went **well**', 0, { by: 'agent' }), note('n2', 'Line one\nline two', 200), embed, table] },
};

describe('board file', () => {
  it('builds a file with an outline and items without authorship or markup', () => {
    const file = buildBoardFile(sample, { url: 'https://example.com/board' });
    assert.equal(file.format, BOARD_FILE_FORMAT);
    assert.equal(file.version, BOARD_FILE_VERSION);
    assert.equal(file.title, 'Retro');
    assert.equal(file.url, 'https://example.com/board');
    assert.equal(file.preview, undefined);
    assert.equal(file.outline, 'Went well\nLine one line two\nName Score\nAnn 3');
    const first = file.items[0] as NoteElement & { by?: string };
    assert.equal(first.by, undefined);
    const html = file.items.find((item) => item.type === 'html') as HtmlElement;
    assert.equal(html.html, '<title>My chart</title>');
  });

  it('follows the reading order it is given', () => {
    const file = buildBoardFile(sample, { readingOrder: (elements) => [...elements].reverse() });
    assert.equal(file.outline.split('\n')[0], 'Name Score');
  });

  it('removes sharing keys from exported links and titles, preserving unrelated URL escapes', () => {
    const url = 'https://example.org/artifact/diagram';
    const key = 'abcDEF0123456789';
    assert.equal(boardFileJsonReplacer('href', url + '?sk=' + key + '&page=1'), url + '?page=1');
    assert.equal(boardFileJsonReplacer('text', url + '%253Fsk%253D' + key), url);
    assert.equal(boardFileJsonReplacer('href', url + '?sk=' + key + '&sk=' + key + '&page=1'), url + '?page=1');
    assert.equal(boardFileJsonReplacer('text', 'See: ' + url + '?q=a%20b'), 'See: ' + url + '?q=a%20b');
    assert.equal(boardFileName('Review sk=' + key), 'Review.json');
  });

  it('round-trips through JSON', () => {
    const text = serializeBoardFile(buildBoardFile(sample));
    const parsed = parseBoardFile(text);
    assert.ok(parsed);
    assert.equal(parsed.title, 'Retro');
    assert.deepEqual(
      parsed.elements.map((element: BoardElement) => element.id),
      ['n1', 'n2', 'h1', 't1'],
    );
  });

  it('rejects other formats and versions', () => {
    assert.equal(parseBoardFile('{'), undefined);
    assert.equal(parseBoardFile({ format: 'something-else', version: 1, items: [] }), undefined);
    assert.equal(parseBoardFile({ format: BOARD_FILE_FORMAT, version: 99, items: [] }), undefined);
    assert.deepEqual(parseBoardFile({ format: BOARD_FILE_FORMAT, version: 1, items: [{ type: 'bogus' }] }), { title: BOARD_FILE_DEFAULT_TITLE, elements: [] });
  });

  it('replaces unpaired surrogates but keeps image data URLs', () => {
    assert.equal(boardFileJsonReplacer('', 'a\uD800b'), 'a\uFFFDb');
    assert.equal(boardFileJsonReplacer('', 'ok 😀'), 'ok 😀');
    assert.equal(boardFileJsonReplacer('', 'data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(boardFileJsonReplacer('', 3), 3);
  });

  it('names files after the title', () => {
    assert.equal(boardFileName('  Retro  '), 'Retro.json');
    assert.equal(boardFileName(''), `${BOARD_FILE_DEFAULT_TITLE}.json`);
    assert.equal(boardFileName('x'.repeat(150)), `${'x'.repeat(100)}.json`);
    assert.equal(buildBoardFile({ title: ' ', content: { elements: [] } }).title, BOARD_FILE_DEFAULT_TITLE);
  });

  it('reads HTML titles', () => {
    assert.equal(htmlDocumentTitle('<html><title>A &amp; B</title></html>'), 'A &amp; B');
    assert.equal(htmlDocumentTitle('<p>none</p>'), undefined);
    assert.equal(htmlTitleTagFor('<title>a<b</title>'), '<title>a&lt;b</title>');
    assert.equal(htmlTitleTagFor(''), '');
  });

  it('skips elements without text in the outline', () => {
    assert.equal(boardFileOutline([note('n1', ''), note('n2', 'x')]), 'x');
  });
});

describe('board check', () => {
  const docs = (entries: Record<string, Record<string, unknown>>) => new Map(Object.entries(entries));
  const stored = (element: BoardElement): Record<string, unknown> => {
    const { id: _id, ...rest } = element;
    return rest;
  };

  it('passes a well-formed board', () => {
    const findings = checkBoardDocuments(
      docs({
        'board/meta': { v: 1, title: 'Board', order: ['n1', 'n2', 'a1'] },
        'board/inks': { colors: { ff8800: 1 } },
        'elements/n1': stored(note('n1', 'a')),
        'elements/n2': stored(note('n2', 'b')),
        'elements/a1': { type: 'arrow', from: 'n1', to: 'n2', head: 'end', dash: false, color: 'ink' },
      }),
    );
    assert.deepEqual(findings, []);
  });

  it('reports what the board drops, refuses or repairs', () => {
    const findings = checkBoardDocuments(
      docs({
        'board/meta': { v: 1, title: 7, order: ['n1', 'n1', 'gone', 'bad id!'] },
        'board/inks': { colors: { FF8800: 1 } },
        'board/claim-c1234567': {},
        'elements/n1': stored(note('n1', 'a')),
        'elements/n3': stored(note('n3', 'unlisted')),
        'elements/x1': { type: 'mystery' },
        'elements/a1': { type: 'arrow', from: 'n1', to: 'missing', head: 'end', dash: false, color: 'ink' },
        'elements/big': stored(note('big', 'x'.repeat(210_000))),
        'other/doc': { a: 1 },
      }),
      { describe: (path) => `db/${path}.json` },
    );
    const has = (path: string, level: string, pattern: RegExp): boolean =>
      findings.some((finding) => finding.path === path && finding.level === level && pattern.test(finding.message));
    assert.ok(has('board/meta', 'warning', /"title"/));
    assert.ok(has('board/meta', 'warning', /lists n1 more than once/));
    assert.ok(has('board/meta', 'warning', /not an element id/));
    assert.ok(has('board/meta', 'warning', /lists gone, but db\/elements\/gone\.json does not exist/));
    assert.ok(has('board/inks', 'warning', /"FF8800"/));
    assert.ok(!findings.some((finding) => finding.path === 'board/claim-c1234567'), 'a claim set to {} is over and says nothing');
    assert.ok(has('elements/n3', 'warning', /Not listed in db\/board\/meta\.json/));
    assert.ok(has('elements/x1', 'error', /Not a valid "mystery" element/));
    assert.ok(has('elements/a1', 'error', /points to missing/));
    assert.ok(has('elements/big', 'error', /too large to sync/));
    assert.ok(has('other/doc', 'info', /does not read/));
  });

  it('requires the meta document', () => {
    const findings = checkBoardDocuments(docs({ 'elements/n1': stored(note('n1', 'a')) }));
    assert.ok(findings.some((finding) => finding.path === 'board/meta' && finding.level === 'error'));
  });

  it('checks table column widths', () => {
    const cols = { c1: { at: 1, w: 160 }, c2: { at: 2, w: 'wide' }, c3: { at: 3, w: 20 }, c4: { at: 4 } };
    const findings = checkBoardDocuments(
      docs({
        'board/meta': { v: 1, title: 'Board', order: ['t1'] },
        'elements/t1': { type: 'table', x: 0, y: 0, cols, rows: { r1: { at: 1, c1: 'Name', c2: 'Score', c3: '', c4: '' } } },
      }),
    );
    assert.deepEqual(
      findings.map(({ level, message }) => [level, /Column (c\d)/.exec(message)?.[1]]),
      [
        ['warning', 'c2'],
        ['info', 'c3'],
      ],
    );
    assert.match(findings[0]!.message, /a number from 48 to 800/);
    assert.match(findings[1]!.message, /draws it 48 wide/);
  });

  it('checks column widths against the longest word', () => {
    const cols = { c1: { at: 1, w: 90 }, c2: { at: 2, w: 120 } };
    const findings = checkBoardDocuments(
      docs({
        'board/meta': { v: 1, title: 'Board', order: ['t1'] },
        'elements/t1': { type: 'table', x: 0, y: 0, cols, rows: { r1: { at: 1, c1: 'Enterprise plan', c2: 'Price' } } },
      }),
    );
    // "Enterprise" has 10 letters: 10 × 10 + 26 = 126; "Price" wants 76.
    assert.deepEqual(
      findings.map(({ level, message }) => [level, message]),
      [['info', 'Column c1 is 90 wide, narrower than its longest word wants: give it a "w" of at least 126 (10 for each letter of that word, plus 26).']],
    );
    assert.equal(suggestedColumnWidth({ cols: { c1: { at: 1 } }, rows: { r1: { at: 1, c1: '**Bold** x' } } }, 'c1'), 66);
    assert.equal(suggestedColumnWidth({ size: 'large', cols: { c1: { at: 1 } }, rows: { r1: { at: 1, c1: 'Ab' } } }, 'c1'), 81);
  });
});
