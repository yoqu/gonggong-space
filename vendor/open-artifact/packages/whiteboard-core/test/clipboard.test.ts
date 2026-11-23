import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARTIFACT_CLIPBOARD_ATTRIBUTE,
  BOARD_CLIPBOARD_KIND,
  artifactClipboardHtml,
  boardClipboardCopy,
  boardClipboardPayload,
  clipboardFileBaseName,
  clipboardTextIsFileNames,
  decodeClipboardUtf8,
  encodeClipboardUtf8,
  escapeClipboardHtml,
  escapeSpreadsheetFormula,
  parseArtifactClipboardHtml,
  readBoardClipboardElements,
  sanitizeClipboardTableCell,
  sanitizeClipboardText,
  selectionAsPlainText,
} from '../src/clipboard.ts';
import type { ArrowElement, BoardElement, LinkElement, NoteElement, TableElement } from '../src/schema.ts';
import { tableFromGrid } from '../src/table.ts';

const note = (id: string, text: string, extra: Partial<NoteElement> = {}): NoteElement => ({
  type: 'note',
  id,
  x: 0,
  y: 0,
  w: 180,
  h: 180,
  color: 'yellow',
  text,
  tilt: 0,
  ...extra,
});

const table = (id: string, grid: string[][]): TableElement => ({ type: 'table', id, x: 0, y: 0, head: true, color: 'white', ...tableFromGrid(grid) });

describe('clipboard payload', () => {
  it('round-trips UTF-8 through base64', () => {
    const text = 'héllo 👋 世界';
    assert.equal(decodeClipboardUtf8(encodeClipboardUtf8(text)), text);
    assert.equal(decodeClipboardUtf8('***'), undefined);
  });

  it('encodes large payloads', () => {
    const text = 'x'.repeat(200_000);
    assert.equal(decodeClipboardUtf8(encodeClipboardUtf8(text)), text);
  });

  it('carries the payload inside clipboard HTML', () => {
    const html = artifactClipboardHtml({ kind: BOARD_CLIPBOARD_KIND, data: [{ a: 1 }] }, '<b> & "q"');
    assert.ok(html.startsWith(`<span ${ARTIFACT_CLIPBOARD_ATTRIBUTE}="`));
    assert.ok(html.endsWith('>&lt;b&gt; &amp; &quot;q&quot;</span>'));
    assert.deepEqual(parseArtifactClipboardHtml(`<meta charset="utf-8">${html}`), { kind: BOARD_CLIPBOARD_KIND, data: [{ a: 1 }] });
  });

  it('reads existing Open Artifact copies alongside the interoperable envelope', () => {
    const data = [note('n1', 'Shared note')];
    const old = encodeClipboardUtf8(JSON.stringify({ openArtifact: 1, kind: BOARD_CLIPBOARD_KIND, data }));
    assert.deepEqual(parseArtifactClipboardHtml(`<span data-open-artifact-object="${old}">Shared note</span>`), { kind: BOARD_CLIPBOARD_KIND, data });
    const html = artifactClipboardHtml({ kind: BOARD_CLIPBOARD_KIND, data }, 'Shared note');
    const encoded = /data-appifact-object="([^"]+)"/.exec(html)?.[1];
    assert.ok(encoded);
    const stored = JSON.parse(decodeClipboardUtf8(encoded)!);
    assert.equal(stored.appifact, 1);
    assert.equal(stored.openArtifact, 1);
    assert.equal(/data-open-artifact-object="([^"]+)"/.exec(html)?.[1], encoded);
  });

  it('ignores HTML without a valid payload', () => {
    assert.equal(parseArtifactClipboardHtml(''), undefined);
    assert.equal(parseArtifactClipboardHtml('<p>hello</p>'), undefined);
    const wrongVersion = `<span ${ARTIFACT_CLIPBOARD_ATTRIBUTE}="${encodeClipboardUtf8(JSON.stringify({ openArtifact: 2, kind: 'k', data: 1 }))}"></span>`;
    assert.equal(parseArtifactClipboardHtml(wrongVersion), undefined);
    const noData = `<span ${ARTIFACT_CLIPBOARD_ATTRIBUTE}="${encodeClipboardUtf8(JSON.stringify({ openArtifact: 1, kind: 'k' }))}"></span>`;
    assert.equal(parseArtifactClipboardHtml(noData), undefined);
  });

  it('escapes HTML', () => {
    assert.equal(escapeClipboardHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('recognizes pasted file names and paths', () => {
    const files = [{ name: 'photo.png' }, { name: 'notes.txt' }];
    assert.equal(clipboardTextIsFileNames(files, 'photo.png\nnotes.txt'), true);
    assert.equal(clipboardTextIsFileNames(files, '/Users/me/photo.png'), true);
    assert.equal(clipboardTextIsFileNames(files, 'https://example.com/a.png'), true);
    assert.equal(clipboardTextIsFileNames(files, 'a real sentence'), false);
    assert.equal(clipboardFileBaseName('file:///C:/My%20Files/photo.png'), 'photo.png');
    assert.equal(clipboardFileBaseName('"C:\\Temp\\notes.txt"'), 'notes.txt');
    assert.equal(clipboardFileBaseName('  plain  '), 'plain');
  });
});

describe('clipboard text', () => {
  it('neutralizes spreadsheet formulas', () => {
    assert.equal(escapeSpreadsheetFormula('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(escapeSpreadsheetFormula(' "+1'), `' "+1`);
    assert.equal(escapeSpreadsheetFormula('plain'), 'plain');
  });

  it('drops control and invisible characters', () => {
    assert.equal(sanitizeClipboardText('a\u0000b\u200bc\u202ed'), 'abcd');
    assert.equal(sanitizeClipboardText('\u200d =x'), ' =x');
    assert.equal(sanitizeClipboardTableCell('line one\nline two'), 'line one line two');
    assert.equal(sanitizeClipboardTableCell('\u2028=1+1'), "' =1+1");
  });

  it('turns a selection into plain text', () => {
    const arrow: ArrowElement = { type: 'arrow', id: 'a1', from: 'n1', to: 'n2', head: 'end', dash: false, color: 'ink', label: 'leads to' };
    const link: LinkElement = { type: 'link', id: 'l1', x: 0, y: 0, href: 'https://example.com' };
    const text = selectionAsPlainText([note('n1', 'See [docs](https://x.dev) *now*'), arrow, link, note('n2', '   ')]);
    assert.equal(text, 'See docs now\nleads to\nhttps://example.com');
  });

  it('makes every line spreadsheet-safe when a table is copied', () => {
    const text = selectionAsPlainText([note('n1', '=cmd'), table('t1', [['h1', 'h2'], ['=1+1', 'a\tb']])]);
    assert.equal(text, "'=cmd\nh1\th2\n'=1+1\ta b");
  });

  it('uses a custom markup converter', () => {
    assert.equal(
      selectionAsPlainText([note('n1', 'abc')], (markup) => markup.toUpperCase()),
      'ABC',
    );
  });
});

describe('board copies', () => {
  it('keeps only groups copied whole', () => {
    const elements: BoardElement[] = [note('n1', 'a', { groups: ['g1', 'g2'] }), note('n2', 'b', { groups: ['g1'] }), note('n3', 'c', { groups: ['g2'] })];
    const copy = boardClipboardCopy(elements.slice(0, 2), elements);
    assert.deepEqual(
      copy.data.map((element) => element.groups),
      [['g1'], ['g1']],
    );
    assert.equal(copy.text, 'a\nb');
    assert.deepEqual(boardClipboardPayload(copy), { kind: BOARD_CLIPBOARD_KIND, data: copy.data });
  });

  it('does not let loose arrows keep a group from being whole', () => {
    const arrow: ArrowElement = { type: 'arrow', id: 'a1', from: 'n1', to: 'n9', head: 'end', dash: false, color: 'ink', groups: ['g1'] };
    const elements: BoardElement[] = [note('n1', 'a', { groups: ['g1'] }), arrow];
    const copy = boardClipboardCopy([elements[0]!], elements);
    assert.deepEqual(copy.data[0]?.groups, ['g1']);
  });

  it('reads pasted elements through normalization', () => {
    const elements = readBoardClipboardElements([note('n1', 'a'), { type: 'nonsense' }, 'junk']);
    assert.deepEqual(
      elements.map((element) => element.id),
      ['n1'],
    );
    assert.deepEqual(readBoardClipboardElements('not a list'), []);
  });
});
