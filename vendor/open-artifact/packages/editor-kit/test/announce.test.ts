/** Tests of the text an announcement reads out. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANNOUNCE_LIMIT, announcementText } from '../src/announce.ts';

describe('announcementText', () => {
  it('collapses whitespace and keeps a message within the limit whole', () => {
    assert.equal(announcementText('  Saved \n\t two   files  '), 'Saved two files');
    assert.equal(announcementText('   '), '');
    const full = 'x'.repeat(ANNOUNCE_LIMIT);
    assert.equal(announcementText(full), full);
  });

  it('cuts a longer message at the last word break, then adds an ellipsis', () => {
    const words = Array.from({ length: 60 }, (_, k) => `word${k}`).join(' ');
    const read = announcementText(words);
    assert.ok(read.endsWith('…'));
    assert.ok(read.length <= ANNOUNCE_LIMIT);
    const kept = read.slice(0, -1);
    assert.ok(words.startsWith(kept + ' '), 'ends on a whole word');
    assert.ok(!kept.endsWith(' '));
    // The next word would not have fitted within the limit.
    assert.ok(words.indexOf(' ', kept.length + 1) > ANNOUNCE_LIMIT);
  });

  it('cuts before the last word even when the limit falls just after it', () => {
    // Characters 0–199 end with a whole word, and a space follows: that word still goes, as the break search sees no further.
    const text = 'a'.repeat(150) + ' ' + 'b'.repeat(49) + ' tail';
    assert.equal(announcementText(text), 'a'.repeat(150) + '…');
  });

  it('cuts mid-word when the last word break would keep fewer than 119 characters', () => {
    const early = 'a'.repeat(118) + ' ' + 'b'.repeat(200);
    assert.equal(announcementText(early), 'a'.repeat(118) + ' ' + 'b'.repeat(80) + '…');
    assert.equal(announcementText(early).length, ANNOUNCE_LIMIT);
    const justEnough = 'a'.repeat(119) + ' ' + 'b'.repeat(200);
    assert.equal(announcementText(justEnough), 'a'.repeat(119) + '…');
    assert.equal(announcementText('c'.repeat(300)), 'c'.repeat(ANNOUNCE_LIMIT - 1) + '…');
  });

  it('never leaves half of a surrogate pair before the ellipsis', () => {
    const text = 'a'.repeat(198) + '😀'.repeat(10);
    const read = announcementText(text);
    assert.equal(read, 'a'.repeat(198) + '…');
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(read));
  });
});
