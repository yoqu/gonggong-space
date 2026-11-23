/**
 * Tests of past board versions (decoding a history version's documents,
 * restoring some elements from it), the store's document hash, the
 * conditional delete of a saved idea, and the sticker categories.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { ICON_STICKERS, STICKER_CATEGORIES, STICKER_EMOJI, normalizeStickerGlyph } from '../src/stickers.ts';
import { documentSha256 } from '../src/sync/doc-hash.ts';
import type { SyncTimers, SyncTransport, SyncWrite } from '../src/sync/transport.ts';
import { savedIdeaPath, watchSavedIdea } from '../src/ideas.ts';
import type { BoardContent, NoteElement } from '../src/schema.ts';
import { boardFromHistoryFiles, boardHistoryPaths, formatBoardHistoryPath, restoreElementsFrom } from '../src/version-board.ts';

const note = (id: string, x: number, text: string): NoteElement => ({ type: 'note', id, x, y: 0, w: 100, h: 100, color: 'yellow', text, tilt: 0 });
const stored = (element: NoteElement): string => {
  const { id: _id, ...rest } = element;
  return JSON.stringify(rest);
};
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('boardFromHistoryFiles', () => {
  it('decodes element and meta documents in the stored order', () => {
    const board = boardFromHistoryFiles([
      ['db/elements/b', stored(note('b', 200, 'Second'))],
      ['db/elements/a', stored(note('a', 0, 'First'))],
      ['db/board/meta', JSON.stringify({ v: 1, title: 'Retro', order: ['a', 'b'] })],
    ]);
    assert.equal(board.title, 'Retro');
    assert.deepEqual(
      board.content.elements.map((element) => element.id),
      ['a', 'b'],
    );
    assert.equal((board.content.elements[1] as NoteElement).text, 'Second');
  });

  it('skips live state, other files and text that is not a JSON object', () => {
    const board = boardFromHistoryFiles([
      ['db/elements/a', stored(note('a', 0, 'Kept'))],
      ['db/elements/bad', 'not json'],
      ['db/elements/arr', '[1,2]'],
      ['db/board/claim-x', JSON.stringify({ x: 0, y: 0, w: 10, h: 10 })],
      ['db/board/timer', JSON.stringify({ durationMs: 60000 })],
      ['db/data/users/u/idea', JSON.stringify({ about: 'x' })],
      ['project/notes.md', '# hi'],
    ]);
    assert.deepEqual(
      board.content.elements.map((element) => element.id),
      ['a'],
    );
    assert.equal(board.content.timer, undefined);
    assert.deepEqual(board.content.claimed, []);
  });

  it('keeps only board paths and names them readably', () => {
    assert.deepEqual(boardHistoryPaths(['db/elements/a', 'db/board/meta', 'db/data/users/u/idea', 'project/x.md']), ['db/elements/a', 'db/board/meta']);
    assert.equal(formatBoardHistoryPath('db/elements/a1'), 'Element a1');
    assert.equal(formatBoardHistoryPath('db/board/meta'), 'Board title and order');
    assert.equal(formatBoardHistoryPath('project/x.md'), 'x.md');
  });
});

describe('restoreElementsFrom', () => {
  const past: BoardContent = { elements: [note('a', 0, 'Old A'), note('b', 200, 'Old B'), note('c', 400, 'Old C')] };

  it('brings back the picked elements only: changed and deleted ones', () => {
    const current: BoardContent = { elements: [note('a', 0, 'New A'), note('c', 400, 'New C'), note('d', 600, 'Added')] };
    const restored = restoreElementsFrom(current, past, ['a', 'b']);
    const byId = new Map(restored.elements.map((element) => [element.id, element as NoteElement]));
    assert.equal(byId.get('a')?.text, 'Old A');
    assert.equal(byId.get('b')?.text, 'Old B');
    assert.equal(byId.get('c')?.text, 'New C');
    assert.equal(byId.get('d')?.text, 'Added');
    assert.ok(restored.elements.findIndex((element) => element.id === 'b') < restored.elements.findIndex((element) => element.id === 'c'));
  });

  it('returns the same content when nothing differs', () => {
    assert.equal(restoreElementsFrom(past, past, ['a']), past);
  });
});

describe('documentSha256', () => {
  it('matches the store hash: SHA-256 of compact JSON', () => {
    for (const value of [{}, { a: 1 }, { text: 'héllo 👋', list: [1, 2, { b: null }] }, { long: 'x'.repeat(1000) }]) {
      assert.equal(documentSha256(value), createHash('sha256').update(JSON.stringify(value)).digest('hex'));
    }
  });
});

describe('watchSavedIdea conditional delete', () => {
  /** Timers that never fire on their own (retries stay pending). */
  const timers: SyncTimers = { setTimeout: () => 0, clearTimeout: () => {}, now: () => 1_000_000, random: () => 0.5 };
  /** An idea store that refuses every offer, so the reader drops the idea at once. */
  const ideas = { now: () => undefined, offer: () => undefined, settle: () => {}, subscribe: () => () => {} };

  function transport(doc: Record<string, unknown>, fail?: { code: string }) {
    const writes: SyncWrite[][] = [];
    let gets = 0;
    const t: SyncTransport = {
      get: async () => {
        gets += 1;
        return doc;
      },
      list: async () => [],
      write: async (batch) => {
        writes.push(batch);
        if (fail) throw Object.assign(new Error('moved'), fail);
      },
      onChange: () => () => {},
    };
    return { t, writes, gets: () => gets };
  }

  it('deletes the idea only while it is the one read (ifMatch)', async () => {
    const doc = { about: 'board', versions: 'nonsense' };
    const { t, writes } = transport(doc);
    const watch = watchSavedIdea({ transport: t, userId: 'u1', ideas, held: () => false, ready: () => true, seen: () => true, timers });
    await settle();
    await settle();
    assert.deepEqual(writes, [[{ op: 'delete', path: savedIdeaPath('u1'), ifMatch: documentSha256(doc) }]]);
    watch.dispose();
  });

  it('on a conflict (a replacement arrived) reads again instead of retrying the delete', async () => {
    const { t, writes, gets } = transport({ about: 'board' }, { code: 'conflict' });
    const watch = watchSavedIdea({ transport: t, userId: 'u2', ideas, held: () => false, ready: () => true, seen: () => true, timers });
    await settle();
    await settle();
    await settle();
    assert.ok(writes.length >= 1);
    assert.ok(gets() >= 2, 'the idea is read again');
    watch.dispose();
  });
});

describe('sticker categories', () => {
  it('put every icon and emoji sticker in exactly one category', () => {
    const icons = STICKER_CATEGORIES.flatMap((category) => category.icons);
    const emoji = STICKER_CATEGORIES.flatMap((category) => category.emoji);
    assert.deepEqual([...icons].sort(), ICON_STICKERS.map((sticker) => sticker.icon).sort());
    assert.deepEqual([...emoji].sort(), Object.keys(STICKER_EMOJI).sort());
    assert.equal(new Set(STICKER_CATEGORIES.map((category) => category.id)).size, STICKER_CATEGORIES.length);
  });

  it('grew the catalog, every glyph a valid sticker', () => {
    assert.ok(ICON_STICKERS.length >= 250);
    assert.ok(Object.keys(STICKER_EMOJI).length >= 280);
    for (const sticker of ICON_STICKERS) assert.ok(normalizeStickerGlyph(sticker.glyph), sticker.key);
    for (const [key, glyph] of Object.entries(STICKER_EMOJI)) assert.ok(normalizeStickerGlyph(glyph), key);
  });
});
