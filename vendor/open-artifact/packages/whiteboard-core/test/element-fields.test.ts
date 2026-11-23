import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBoardDocuments, drawingFindings } from '../src/check.ts';
import { elementLayoutBox } from '../src/geometry.ts';
import { hitTestElement } from '../src/hit-test.ts';
import { VERSION_NEW_ELEMENT_FIELDS } from '../src/ideas.ts';
import { MAX_SVG_DATA_URL_CHARS, MAX_SVG_SOURCE_CHARS } from '../src/image-source.ts';
import { strokeBounds, strokePointsToPath } from '../src/ink.ts';
import { normalizeClaimedAreas, normalizeElement } from '../src/normalize.ts';
import { DRAWING_STYLES, MAX_PLACEHOLDER_CHARS, type BoardElement } from '../src/schema.ts';

const base64 = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const drawing = base64(svg('<rect width="20" height="20" fill="#F6BD78"/>'));
const photo = 'data:image/png;base64,iVBORw0KGgo=';

const docs = (entries: Record<string, Record<string, unknown>>) =>
  new Map<string, Record<string, unknown>>([['board/meta', { v: 1, title: 'Board', order: Object.keys(entries).map((path) => path.slice('elements/'.length)) }], ...Object.entries(entries)]);

const findingsAt = (documents: ReadonlyMap<string, Record<string, unknown>>, path: string) =>
  checkBoardDocuments(documents)
    .filter((finding) => finding.path === path)
    .map(({ level, message }) => [level, message] as const);

const image = (fields: Record<string, unknown>): BoardElement | undefined => normalizeElement({ type: 'image', id: 'i1', x: 0, y: 0, w: 100, h: 100, ...fields });
const text = (fields: Record<string, unknown>): BoardElement | undefined => normalizeElement({ type: 'text', id: 't1', x: 0, y: 0, ...fields });

describe('drawing style', () => {
  it('names seven looks', () => {
    assert.deepEqual([...DRAWING_STYLES], ['watercolor', 'comic', 'draft', 'paper', 'blueprint', 'marker', 'plain']);
  });

  it('keeps a slug style on an SVG drawing only', () => {
    const styleOf = (element: BoardElement | undefined): unknown => (element?.type === 'image' ? element.style : 'not an image');
    assert.equal(styleOf(image({ src: drawing, style: 'comic' })), 'comic');
    assert.equal(styleOf(image({ src: drawing, style: 'ink-wash-2' })), 'ink-wash-2', 'a look this board does not know yet is kept');
    for (const style of ['Comic', '2d', 'oil paint', 'a'.repeat(41), '', 7]) assert.equal(styleOf(image({ src: drawing, style })), undefined, String(style));
    assert.equal(styleOf(image({ src: drawing, style: 'a'.repeat(40) })), 'a'.repeat(40));
    assert.equal(styleOf(image({ src: photo, style: 'comic' })), undefined);
  });

  it('is an error outside the seven looks, and a warning on a photo', () => {
    const [[level, message]] = findingsAt(docs({ 'elements/i1': { type: 'image', x: 0, y: 0, w: 100, h: 100, src: drawing, style: 'oil' } }), 'elements/i1');
    assert.equal(level, 'error');
    assert.match(message, /"oil"/);
    assert.match(message, new RegExp(DRAWING_STYLES.join(', ')));
    assert.deepEqual(findingsAt(docs({ 'elements/i1': { type: 'image', x: 0, y: 0, w: 100, h: 100, src: drawing, style: 'blueprint' } }), 'elements/i1'), []);
    const onPhoto = findingsAt(docs({ 'elements/i1': { type: 'image', x: 0, y: 0, w: 100, h: 100, src: photo, style: 'comic' } }), 'elements/i1');
    assert.equal(onPhoto[0]?.[0], 'warning');
    assert.match(onPhoto[0]![1], /Only SVG drawings/);
  });
});

describe('drawing size', () => {
  const errors = (src: string): string[] => drawingFindings(src).filter(([level]) => level === 'error').map(([, message]) => message);

  it('gives the size and the limit of a source that is too long', () => {
    const long = svg(`<rect width="1" height="1"/><!--${'x'.repeat(MAX_SVG_SOURCE_CHARS)}-->`);
    const message = errors(`data:image/svg+xml;utf8,${encodeURIComponent(long)}`).find((item) => item.startsWith('The SVG is'));
    assert.ok(message);
    assert.ok(message.includes(long.length.toLocaleString('en-US')));
    assert.ok(message.includes(MAX_SVG_SOURCE_CHARS.toLocaleString('en-US')));
    assert.ok(message.includes(`cut at least ${(long.length - MAX_SVG_SOURCE_CHARS).toLocaleString('en-US')}`));
  });

  it('gives the size and the limit of a data URI that is too long', () => {
    // Two bytes a character: short enough as source, too long as base64.
    const src = base64(svg(`<rect width="1" height="1"/><!--${'é'.repeat(30_000)}-->`));
    assert.ok(src.length > MAX_SVG_DATA_URL_CHARS);
    const message = errors(src).find((item) => item.startsWith('The SVG data URI'));
    assert.ok(message);
    assert.ok(message.includes(src.length.toLocaleString('en-US')));
    assert.ok(message.includes(MAX_SVG_DATA_URL_CHARS.toLocaleString('en-US')));
  });

  it('counts a text URI as it will be stored', () => {
    const body = svg(`<rect width="1" height="1"/><!--${'é'.repeat(30_000)}-->`);
    const message = errors(`data:image/svg+xml;utf8,${body}`).find((item) => item.startsWith('Stored as base64'));
    assert.ok(message);
    assert.ok(message.includes(MAX_SVG_DATA_URL_CHARS.toLocaleString('en-US')));
  });

  it('says nothing about a drawing within the limits', () => {
    assert.deepEqual(errors(drawing), []);
  });
});

describe('ending a claim', () => {
  const claimFindings = (value: Record<string, unknown>) =>
    findingsAt(new Map<string, Record<string, unknown>>([['board/meta', { v: 1, title: 'Board', order: ['n1'] }], ['elements/n1', { type: 'note', x: 0, y: 0, text: 'a' }], ['board/claim-c1234567', value]]), 'board/claim-c1234567');

  it('says nothing about a claim set to {}', () => {
    assert.deepEqual(claimFindings({}), []);
  });

  it('frames nothing once set to {}', () => {
    assert.deepEqual(normalizeClaimedAreas([{ key: 'c1234567' }]), [{ key: 'c1234567' }]);
  });

  it('warns about a claim that still frames something', () => {
    for (const value of [{ x: 0, y: 0, w: 200, h: 100 }, { ids: ['n1'] }]) {
      const [[level, message]] = claimFindings(value);
      assert.equal(level, 'warning');
      assert.match(message, /set it to \{\}/);
    }
    assert.match(claimFindings({ x: 0, y: 0, ids: ['n1'] })[0]![1], /an area and 1 element/);
  });

  it('warns about a claim the board cannot read', () => {
    const [[level, message]] = claimFindings({ x: 'left' });
    assert.equal(level, 'warning');
    assert.match(message, /frames nothing/);
  });
});

describe('text placeholder', () => {
  const placeholderOf = (value: unknown): unknown => {
    const element = text({ text: '', placeholder: value });
    return element?.type === 'text' ? element.placeholder : 'not a text';
  };

  it('keeps one cleaned line', () => {
    assert.equal(placeholderOf('  Write the\n  goal\there '), 'Write the goal here');
    assert.equal(placeholderOf('Goal​'), 'Goal');
  });

  it(`stops at ${MAX_PLACEHOLDER_CHARS} characters`, () => {
    assert.equal(MAX_PLACEHOLDER_CHARS, 200);
    assert.equal(placeholderOf(`${'a'.repeat(199)} bcd`), 'a'.repeat(199));
    assert.equal(placeholderOf('é'.repeat(250)), 'é'.repeat(200));
  });

  it('drops an empty or non-string placeholder', () => {
    for (const value of ['', '   ', '​', 5, null, ['a']]) assert.equal(placeholderOf(value), undefined, JSON.stringify(value));
  });

  it('stores blank text under a placeholder as ""', () => {
    const withPlaceholder = text({ text: '  \n ', placeholder: 'Goal' });
    assert.equal(withPlaceholder?.type === 'text' && withPlaceholder.text, '');
    const without = text({ text: '  \n ' });
    assert.equal(without?.type === 'text' && without.text, '  \n ');
  });

  it('normalizes the same twice', () => {
    const once = text({ text: ' ', placeholder: ' Goal  here ' });
    assert.deepEqual(normalizeElement(once), once);
  });
});

describe('single-point pen stroke', () => {
  const dot = normalizeElement({ type: 'stroke', id: 's1', x: 100, y: 50, points: [0, 0], color: 'ink', width: 6 });

  it('is kept as a dot', () => {
    assert.equal(dot?.type, 'stroke');
    assert.deepEqual(dot?.type === 'stroke' && dot.points, [0, 0]);
    assert.equal(normalizeElement({ type: 'stroke', id: 's2', x: 0, y: 0, points: [3], color: 'ink' }), undefined);
    assert.equal(normalizeElement({ type: 'stroke', id: 's3', x: 0, y: 0, points: [], color: 'ink' }), undefined);
  });

  it('draws, measures and hits as a dot of the pen width', () => {
    assert.ok(dot?.type === 'stroke');
    assert.equal(strokePointsToPath(dot.points), 'M 0 0 l 0.01 0');
    assert.deepEqual(strokeBounds(dot), { x: 97, y: 47, w: 6, h: 6 });
    const box = elementLayoutBox(dot);
    assert.ok(box !== undefined && box.w > 0 && box.h > 0);
    assert.equal(hitTestElement(dot, 100, 50), true);
    assert.equal(hitTestElement(dot, 140, 50), false);
  });
});

describe('version options', () => {
  it('carry the new element fields', () => {
    for (const field of ['style', 'placeholder', 'fills', 'heat']) assert.ok((VERSION_NEW_ELEMENT_FIELDS as readonly string[]).includes(field), field);
  });
});
