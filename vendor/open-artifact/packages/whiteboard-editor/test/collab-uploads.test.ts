/**
 * Tests of upload placeholders: the message telling where uploads will
 * land (rounded, capped, read back defensively) and how a page keeps the
 * placeholders it hears (replaced by each message, kept while a saved one
 * waits for its element, hidden once it arrives, expired in time).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_UPLOAD_PLACEHOLDERS,
  UPLOAD_KEEP_MS,
  UPLOAD_STORED_KEEP_MS,
  encodeUploads,
  hearUploads,
  nextUploadExpiry,
  readUploads,
  sweepUploads,
  visibleUploads,
  type HeardUploads,
} from '../src/collab/upload-wire.ts';

const box = (id: string, stored?: string) => ({ id, x: 10.4, y: -20.6, w: 300, h: 200, ...(stored ? { stored } : {}) });

describe('upload placeholders on the wire', () => {
  it('rounds boxes, names stored elements and caps the list', () => {
    assert.deepEqual(encodeUploads([box('a'), box('b', 'b')]), { uploads: [['a', 10, -21, 300, 200], ['b', 10, -21, 300, 200, 'b']] });
    const many = Array.from({ length: MAX_UPLOAD_PLACEHOLDERS + 3 }, (_, i) => box(`u${i}`));
    assert.equal(encodeUploads(many).uploads.length, MAX_UPLOAD_PLACEHOLDERS);
  });

  it('reads rows back and skips bad ones', () => {
    assert.deepEqual(readUploads(encodeUploads([box('a', 'a')])), [{ id: 'a', x: 10, y: -21, w: 300, h: 200, stored: 'a' }]);
    assert.equal(readUploads({ n: 1, end: 1 }), undefined, 'not an uploads message');
    assert.deepEqual(
      readUploads({ uploads: [['bad id!', 0, 0, 10, 10], ['a', 0, 0, 0, 10], ['b', 0, 0, 1e9, 10], ['c', 'x', 0, 10, 10], 'row', ['d', 0, 0, 10, 10, 'not ok!']] }),
      [{ id: 'd', x: 0, y: 0, w: 10, h: 10 }],
    );
  });
});

describe('hearing upload placeholders', () => {
  it('replaces a page\'s boxes with each message and keeps saved ones waiting', () => {
    let heard: HeardUploads = hearUploads(new Map(), 'p', [box('a'), box('b')], 0);
    assert.deepEqual([...heard.keys()], ['p a', 'p b']);
    assert.equal(heard.get('p a')?.until, UPLOAD_KEEP_MS);
    heard = hearUploads(heard, 'p', [box('a', 'a')], 100);
    assert.deepEqual([...heard.keys()], ['p a'], 'b was dropped (it failed)');
    assert.equal(heard.get('p a')?.until, 100 + UPLOAD_STORED_KEEP_MS);
    heard = hearUploads(heard, 'p', [], 200);
    assert.deepEqual([...heard.keys()], ['p a'], 'a saved box waits for its element');
    heard = hearUploads(heard, 'q', [box('a')], 200);
    assert.deepEqual([...heard.keys()], ['p a', 'q a'], 'pages are kept apart');
    assert.equal(nextUploadExpiry(heard), 200 + UPLOAD_KEEP_MS);
  });

  it('hides a box once its element arrives and drops expired ones', () => {
    const heard = hearUploads(new Map(), 'p', [box('a', 'a'), box('b')], 0);
    const swept = sweepUploads(heard, 10, (id) => id === 'a');
    assert.deepEqual(
      visibleUploads(swept).map((upload) => upload.id),
      ['b'],
    );
    assert.equal(sweepUploads(swept, 10, () => false), swept, 'nothing changed keeps the map');
    assert.deepEqual([...sweepUploads(swept, UPLOAD_KEEP_MS, () => false).keys()], ['p a']);
    const again = hearUploads(swept, 'p', [], 20);
    assert.deepEqual([...again.keys()], [], 'the next message drops a landed box and an unlisted one');
  });
});
