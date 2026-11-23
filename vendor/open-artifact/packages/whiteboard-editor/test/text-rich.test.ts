/**
 * The formatted text editor's pure half (`elements/rich-text.ts`): stored
 * text → editor nodes → stored text round trips (over small fake nodes),
 * marks the browser makes, list shortcuts, typed arrows, plain-text paste,
 * copied text and web links.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARROW_TEXT_TRANSFORM, TEXT_PROFILES, type TextProfile } from '@open-artifact/whiteboard-core';
import {
  buildEditorNodes,
  editorBlocks,
  fitTextToRoom,
  listShortcutOf,
  listShortcutStart,
  normalizeTextLinkUrl,
  planArrowInput,
  planPaste,
  plainCopyText,
  serializeEditorText,
  serializeNoteMarkdown,
  storedTextCost,
  toggleBulletLines,
  visibleLinkHref,
  type RichNode,
  type RichNodeFactory,
} from '../src/elements/rich-text.ts';

/** A minimal node: what the round trip reads. */
class FakeNode implements RichNode {
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  constructor(nodeType: number, nodeName: string, nodeValue: string | null, attributes: Readonly<Record<string, string>> = {}) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.nodeValue = nodeValue;
    this.attributes = attributes;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
}

const make: RichNodeFactory<FakeNode> = {
  element(tag, attributes, children) {
    const node = new FakeNode(1, tag.toUpperCase(), null, attributes);
    for (const child of children) {
      child.parentNode = node;
      node.childNodes.push(child);
    }
    return node;
  },
  text: (value) => new FakeNode(3, '#text', value),
};

/** Shorthand for hand-built editor content. */
const el = (tag: string, ...children: Array<FakeNode | string>): FakeNode =>
  make.element(
    tag,
    {},
    children.map((child) => (typeof child === 'string' ? make.text(child) : child)),
  );

/** The editing surface for stored text. */
function surface(text: string, profile: TextProfile): FakeNode {
  return make.element('div', { contenteditable: 'true' }, buildEditorNodes(editorBlocks(text, profile), make));
}

/** Stored text after a trip through the editor. */
function roundTrip(text: string, profile: TextProfile = TEXT_PROFILES.note): string {
  return serializeEditorText(surface(text, profile), profile);
}

test('stored text survives a trip through the editor', () => {
  for (const text of [
    'plain words',
    '**bold** and *italic* and ***both***',
    'some `code` and a [link](https://example.com/a)',
    '- one\n- two\n  - nested\n    - deeper\n- three',
    '1. first\n2. second\n  1. inner',
    '3. starts at three\n4. four',
    'a paragraph\n- then a list\nthen text',
    'a\n\nb',
    '\\- not a list',
    '3\\. not a list',
    '\\*not italic\\* and a \\[bracket\\]',
    'an arrow → here',
  ]) {
    assert.equal(roundTrip(text), text, text);
  }
});

test('the editor shows lists as nested lists right after their item', () => {
  const root = surface('- a\n  - b\n- c', TEXT_PROFILES.note);
  const list = root.childNodes[0]!;
  assert.equal(list.nodeName, 'UL');
  assert.deepEqual(
    list.childNodes.map((node) => node.nodeName),
    ['LI', 'UL', 'LI'],
  );
  const numbered = surface('5. five\n6. six', TEXT_PROFILES.note).childNodes[0]!;
  assert.equal(numbered.getAttribute('start'), '5');
  assert.equal(surface('1. one', TEXT_PROFILES.note).childNodes[0]!.getAttribute('start'), null);
});

test('code and links are atomic chips; an empty line holds a break', () => {
  const root = surface('`x` [y](https://y.example)\n', TEXT_PROFILES.note);
  const [code, , link] = root.childNodes[0]!.childNodes;
  assert.equal(code!.nodeName, 'CODE');
  assert.equal(code!.getAttribute('contenteditable'), 'false');
  assert.equal(link!.nodeName, 'A');
  assert.equal(link!.getAttribute('data-href'), 'https://y.example');
  assert.equal(surface('', TEXT_PROFILES.note).childNodes[0]!.childNodes[0]!.nodeName, 'BR');
});

test('marks the browser makes become Markdown', () => {
  const root = el('div', el('div', 'a ', el('b', 'bold'), ' and ', el('i', 'it'), ' and ', el('strong', el('em', 'both'))));
  assert.equal(serializeEditorText(root, TEXT_PROFILES.note), 'a **bold** and *it* and ***both***');
  // Spaces inside a mark move outside it; an empty mark is dropped.
  assert.equal(serializeEditorText(el('div', el('div', 'x', el('b', ' y '), 'z', el('i', ''))), TEXT_PROFILES.note), 'x **y** z');
  // A bold span from inline styles.
  const span = make.element('span', { style: 'font-weight: bold;' }, [make.text('heavy')]);
  assert.equal(serializeEditorText(el('div', el('div', span)), TEXT_PROFILES.note), '**heavy**');
});

test('browser line breaks, paragraphs and list items become lines', () => {
  assert.equal(serializeEditorText(el('div', 'one', el('br'), 'two'), TEXT_PROFILES.note), 'one\ntwo');
  assert.equal(serializeEditorText(el('div', el('div', 'one'), el('div', el('br')), el('div', 'two')), TEXT_PROFILES.note), 'one\n\ntwo');
  assert.equal(serializeEditorText(el('div', el('ol', el('li', 'a'), el('li', 'b')), el('div', 'c')), TEXT_PROFILES.note), '1. a\n2. b\nc');
  // A paragraph that reads like a list keeps its marker escaped; trailing empty items go.
  assert.equal(serializeEditorText(el('div', el('div', '- dash')), TEXT_PROFILES.note), '\\- dash');
  assert.equal(serializeEditorText(el('div', el('ul', el('li', 'a'), el('li', el('br')))), TEXT_PROFILES.note), '- a');
  // Nesting deeper than a level below its parent is pulled in.
  assert.equal(serializeEditorText(el('div', el('ul', el('li', 'a'), el('ul', el('ul', el('li', 'b'))))), TEXT_PROFILES.note), '- a\n  - b');
});

test('without lists, list items are plain lines', () => {
  assert.equal(serializeNoteMarkdown(el('div', el('ul', el('li', 'a'))), { lists: false }), 'a');
});

test('one-line fields join lines and labels keep plain characters', () => {
  assert.equal(roundTrip('one\ntwo', TEXT_PROFILES.title), 'one two');
  assert.equal(serializeEditorText(el('div', el('div', 'one'), el('div', 'two')), TEXT_PROFILES.title), 'one two');
  assert.equal(roundTrip('a*b* [c](https://c.example)', TEXT_PROFILES.label), 'a*b* [c](https://c.example)');
  assert.equal(serializeEditorText(el('div', el('div', 'x', el('b', 'y'))), TEXT_PROFILES.label), 'x**y**');
});

test('list shortcuts', () => {
  assert.equal(listShortcutOf('- '), 'ul');
  assert.equal(listShortcutOf('* '), 'ul');
  assert.equal(listShortcutOf('1. '), 'ol');
  assert.equal(listShortcutOf('1.\u00A0'), 'ol');
  assert.equal(listShortcutOf('2. '), null);
  assert.equal(listShortcutOf('-'), null);
  assert.equal(listShortcutOf('# '), null);
  assert.equal(listShortcutOf('2. ', true), 'ol');
  assert.equal(listShortcutOf('• ', true), 'ul');
  assert.equal(listShortcutOf('  - ', true), 'ul');
  assert.equal(listShortcutStart('7. '), 7);
  assert.equal(listShortcutStart('- '), 1);
});

test('the bullets button on a whole text', () => {
  assert.equal(toggleBulletLines('a\n\n  b'), '- a\n\n- b');
  assert.equal(toggleBulletLines('- a\n  1. b\nc'), '- a\n  - b\n- c');
  assert.equal(toggleBulletLines('- a\n  - b'), 'a\nb');
  assert.equal(toggleBulletLines('[x](https://x.example)'), '- [x](https://x.example)');
  assert.equal(toggleBulletLines(''), '');
});

test('typed arrows are drawn in two undo steps', () => {
  const plan = planArrowInput({ before: 'a -', lead: '', line: 'a -' }, { typed: '>', deleting: false }, null);
  assert.deepEqual(plan.steps, [
    [1, '-\u200C>'],
    [3, '→'],
  ]);
  assert.equal(plan.made?.raw, '->');
  assert.equal(plan.made?.drawn, '→');
  // Nothing to draw.
  assert.deepEqual(planArrowInput({ before: 'a', lead: '', line: 'a' }, { typed: '>', deleting: false }, null).steps, []);
  // Not in right-to-left text.
  assert.deepEqual(planArrowInput({ before: 'שלום -', lead: '', line: 'שלום -' }, { typed: '>', deleting: false }, null).steps, []);
  // Not across runs (the lead ends with a run separator).
  assert.deepEqual(planArrowInput({ before: '', lead: '-\uFDD5', line: '-' }, { typed: '>', deleting: false }, null).steps, []);
});

test('a drawn arrow grows, gives way or comes apart', () => {
  const left = { raw: '<-', drawn: '←', rule: ARROW_TEXT_TRANSFORM };
  const grown = planArrowInput({ before: '←', lead: '', line: '←' }, { typed: '>', deleting: false }, left);
  assert.deepEqual(grown.steps, [
    [1, '<\u200C-\u200C>'],
    [5, '←→'],
  ]);
  const right = { raw: '->', drawn: '→', rule: ARROW_TEXT_TRANSFORM };
  assert.deepEqual(planArrowInput({ before: '→', lead: '', line: '→' }, { typed: '>', deleting: false }, right).steps, [[1, '->>']]);
  assert.deepEqual(planArrowInput({ before: '→', lead: '', line: '→' }, { typed: null, deleting: true }, right).steps, [[1, '-\u200C>']]);
  // Backspace after a kept-apart arrow takes its joiner too.
  assert.deepEqual(planArrowInput({ before: 'x-\u200C>', lead: '', line: 'x-\u200C>' }, { typed: null, deleting: true }, null).steps, [[3, '-']]);
});

test('pasted text is cut to the room left, as stored', () => {
  assert.equal(storedTextCost('a*b', TEXT_PROFILES.note), 4);
  assert.equal(storedTextCost('a*b', TEXT_PROFILES.label), 3);
  assert.equal(fitTextToRoom('ab*cd', 3, TEXT_PROFILES.note), 'ab');
  assert.equal(fitTextToRoom('😀😀', 1, TEXT_PROFILES.note), '😀');

  const lists = planPaste('- a\r\n- b', TEXT_PROFILES.note, 100, true);
  assert.equal(lists.text, '- a\n- b');
  assert.equal(lists.blocks?.[0]?.kind, 'ul');
  assert.equal(lists.cut, false);

  const words = planPaste('x -> y', TEXT_PROFILES.note, 100, false);
  assert.equal(words.text, 'x → y');
  assert.equal(words.blocks, undefined);

  // A single list line typed into a line keeps its marker as text.
  assert.equal(planPaste('- a', TEXT_PROFILES.note, 100, false).blocks, undefined);
  assert.equal(planPaste('- a', TEXT_PROFILES.note, 100, true).blocks?.[0]?.kind, 'ul');

  const title = planPaste('one\ntwo  three', TEXT_PROFILES.title, 100, true);
  assert.equal(title.text, 'one two  three');
  assert.equal(title.blocks, undefined);

  const cut = planPaste('abcdef', TEXT_PROFILES.note, 3, true);
  assert.equal(cut.text, 'abc');
  assert.equal(cut.cut, true);
});

test('copied text loses link syntax and arrow joiners', () => {
  assert.equal(plainCopyText('[a](https://a.example)'), '[a] (https://a.example)');
  assert.equal(plainCopyText('-\u200C> x'), '-> x');
});

test('web links typed into the link field', () => {
  assert.equal(normalizeTextLinkUrl('example.com'), 'https://example.com');
  assert.equal(normalizeTextLinkUrl('  HTTP://Example.com/a  '), 'http://Example.com/a');
  assert.equal(normalizeTextLinkUrl('https://example.com/a(b)'), 'https://example.com/a%28b%29');
  assert.equal(normalizeTextLinkUrl('javascript://alert(1)'), null);
  assert.equal(normalizeTextLinkUrl('ftp://example.com'), null);
  assert.equal(normalizeTextLinkUrl('https://user:pw@example.com'), null);
  assert.equal(normalizeTextLinkUrl('https://example.com.'), null);
  assert.equal(normalizeTextLinkUrl('two words'), null);
  assert.equal(normalizeTextLinkUrl(''), null);
  assert.equal(normalizeTextLinkUrl(`https://example.com/${'a'.repeat(2048)}`), null);
  assert.equal(visibleLinkHref('https://a‮b'), 'https://a\uFFFDb');
});
