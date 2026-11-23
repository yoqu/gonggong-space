/**
 * Pasting: how far repeated pastes step, the shape plain text becomes,
 * what a paste carries, and the words people read when a copy, cut or
 * paste goes wrong.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_CLIPBOARD_KIND, MAX_ELEMENT_SIZE, artifactClipboardHtml } from '@open-artifact/whiteboard-core';
import {
  INTERNAL_PASTE_ONLY_MESSAGE,
  PASTED_TEXT_WIDTH,
  TABLE_PASTE_MESSAGES,
  classifyPaste,
  clipboardCommandFailedMessage,
  isWebAddress,
  leftOutMessage,
  pasteStep,
  pastedTextShape,
} from '../src/services/clipboard.ts';

describe('paste steps', () => {
  it('steps 24 screen pixels, never less than 24 board units', () => {
    assert.equal(pasteStep(1), 24);
    assert.equal(pasteStep(0.5), 48);
    assert.equal(pasteStep(0.1), 240);
    assert.equal(pasteStep(4), 24);
  });
});

describe('pasted text', () => {
  it('becomes a white rounded shape centered on the point', () => {
    const shape = pastedTextShape('Hello', { x: 500, y: 300 }, 'p1');
    assert.equal(shape.type, 'shape');
    assert.equal(shape.id, 'p1');
    assert.equal(shape.kind, 'rounded');
    assert.equal(shape.color, 'white');
    assert.equal(shape.size, 'body');
    assert.equal(shape.text, 'Hello');
    assert.ok(shape.w >= PASTED_TEXT_WIDTH - 1, `width ${shape.w}`);
    assert.equal(shape.x, 500 - PASTED_TEXT_WIDTH / 2);
    assert.ok(shape.y < 300 && shape.y + shape.h > 300);
  });

  it('grows with the lines it holds, up to the largest element', () => {
    const one = pastedTextShape('one line', { x: 0, y: 0 }, 'p1');
    const many = pastedTextShape(Array.from({ length: 12 }, (_, index) => 'line ' + index).join('\n'), { x: 0, y: 0 }, 'p2');
    assert.ok(many.h > one.h);
    const huge = pastedTextShape(Array.from({ length: 4000 }, () => 'x').join('\n'), { x: 0, y: 0 }, 'p3');
    assert.ok(huge.h <= MAX_ELEMENT_SIZE);
  });
});

describe('web addresses', () => {
  it('takes one http(s) address and nothing else', () => {
    assert.equal(isWebAddress('https://example.com/a?b=c'), true);
    assert.equal(isWebAddress('  http://example.com  '), true);
    assert.equal(isWebAddress('example.com'), false);
    assert.equal(isWebAddress('see https://example.com'), false);
    assert.equal(isWebAddress('ftp://example.com'), false);
  });
});

describe('what a paste carries', () => {
  const picture = { name: 'photo.png', type: 'image/png' };

  it('prefers board items copied from a board', () => {
    const html = artifactClipboardHtml({ kind: BOARD_CLIPBOARD_KIND, data: [] }, 'a note');
    assert.equal(classifyPaste({ html, text: 'a note', files: [] }), 'board');
  });

  it('ignores clipboard HTML of other kinds', () => {
    const html = artifactClipboardHtml({ kind: 'slides', data: [] }, 'a slide');
    assert.equal(classifyPaste({ html, text: 'a slide', files: [] }), 'text');
  });

  it('takes pictures when the text only names them', () => {
    assert.equal(classifyPaste({ html: '', text: 'photo.png', files: [picture] }), 'files');
    assert.equal(classifyPaste({ html: '', text: '', files: [picture] }), 'files');
  });

  it('takes the text when it says more than the file names', () => {
    assert.equal(classifyPaste({ html: '', text: 'A caption for the team', files: [picture] }), 'text');
  });

  it('has nothing for an empty clipboard or unsupported files', () => {
    assert.equal(classifyPaste({ html: '', text: '', files: [] }), 'none');
    assert.equal(classifyPaste({ html: '', text: '', files: [{ name: 'notes.pdf', type: 'application/pdf' }] }), 'none');
  });
});

describe('clipboard messages', () => {
  it('says which shortcut to use when the menu cannot copy or cut', () => {
    assert.match(clipboardCommandFailedMessage('copy'), /could not be copied\. Press (⌘|Ctrl\+)C instead\./);
    assert.match(clipboardCommandFailedMessage('cut'), /could not be cut\. Press (⌘|Ctrl\+)X instead\./);
  });

  it('counts what a paste left out, by kind', () => {
    assert.equal(leftOutMessage(1, 0), 'One image was left out. It lives in another board’s asset store.');
    assert.equal(leftOutMessage(1, 1), 'One video was left out. It lives in another board’s asset store.');
    assert.equal(leftOutMessage(3, 0), '3 images were left out. They live in another board’s asset store.');
    assert.equal(leftOutMessage(2, 2), '2 videos were left out. They live in another board’s asset store.');
    assert.equal(leftOutMessage(3, 1), '3 items were left out. They live in another board’s asset store.');
  });

  it('explains refused table pastes and the menu paste', () => {
    assert.match(TABLE_PASTE_MESSAGES.cells, /^A table holds at most [\d,]+ cells, so nothing was pasted\./);
    assert.match(TABLE_PASTE_MESSAGES.bytes, /nothing was pasted/);
    assert.match(INTERNAL_PASTE_ONLY_MESSAGE, /right after you copy or cut here/);
  });
});
