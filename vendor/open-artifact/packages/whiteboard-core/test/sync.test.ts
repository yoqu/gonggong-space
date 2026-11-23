import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyJsonMergePatch } from '../src/json.ts';
import type { Board, BoardContent, NoteElement } from '../src/schema.ts';
import {
  ACKNOWLEDGED_WRITE_GRACE_MS,
  LIVE_CACHE_WRITE_DELAY_MS,
  LIVE_EDIT_DEBOUNCE_MS,
  LIVE_MESSAGES,
  LIVE_RECONNECT_BACKOFF_MS,
  LIVE_SNAPSHOT_TIMEOUT_MS,
  type LiveCache,
} from '../src/sync/engine.ts';
import { createLiveBoardDocument, type LiveBoardDocument } from '../src/sync/live-board.ts';
import { collectionOfPath, type SyncChangeEvent, type SyncDocument, type SyncTimers, type SyncTransport, type SyncWrite } from '../src/sync/transport.ts';

/* ------------------------------------------------------------------ fakes */

/** Lets pending promise callbacks run. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Manual timers: nothing fires until {@link FakeTimers.advance}. */
class FakeTimers implements SyncTimers {
  time = 1_000_000;
  private nextId = 1;
  private queue = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, ms: number): number => {
    const id = this.nextId++;
    this.queue.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.queue.delete(handle as number);
  };

  now = (): number => this.time;

  random = (): number => 0;

  /** Moves the clock forward, firing due timers in order and letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await settle();
    for (;;) {
      let soonest: [number, { at: number; callback: () => void }] | undefined;
      for (const item of this.queue) if (item[1].at <= target && (soonest === undefined || item[1].at < soonest[1].at)) soonest = item;
      if (soonest === undefined) break;
      this.queue.delete(soonest[0]);
      this.time = Math.max(this.time, soonest[1].at);
      soonest[1].callback();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

/** An in-memory store: writes apply at once and are never echoed. */
class FakeTransport implements SyncTransport {
  docs = new Map<string, Record<string, unknown>>();
  batches: SyncWrite[][] = [];
  /** Codes the next write calls fail with, in order. */
  failures: string[] = [];
  /** Codes the next list calls fail with, in order. */
  listFailures: string[] = [];
  private listeners = new Set<(event: SyncChangeEvent) => void>();

  constructor(docs: Record<string, Record<string, unknown>> = {}) {
    for (const [path, data] of Object.entries(docs)) this.docs.set(path, structuredClone(data));
  }

  async get(path: string): Promise<Record<string, unknown> | null> {
    return structuredClone(this.docs.get(path) ?? null);
  }

  async list(collection: string): Promise<SyncDocument[]> {
    const code = this.listFailures.shift();
    if (code !== undefined) throw Object.assign(new Error(code), { code });
    return [...this.docs].filter(([path]) => collectionOfPath(path) === collection).map(([path, data]) => ({ path, data: structuredClone(data) }));
  }

  async write(writes: SyncWrite[]): Promise<void> {
    this.batches.push(structuredClone(writes));
    const code = this.failures.shift();
    if (code !== undefined) throw Object.assign(new Error(code), { code });
    for (const write of writes) {
      if (write.op === 'delete') this.docs.delete(write.path);
      else if (write.op === 'set') this.docs.set(write.path, structuredClone(write.data));
      else this.docs.set(write.path, applyJsonMergePatch(this.docs.get(write.path), write.patch));
    }
  }

  onChange(listener: (event: SyncChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Someone else changes documents. */
  remote(changes: Record<string, Record<string, unknown> | null>): void {
    for (const [path, data] of Object.entries(changes)) {
      if (data === null) this.docs.delete(path);
      else this.docs.set(path, structuredClone(data));
    }
    this.emit(changes);
  }

  /** Delivers a change event without touching the store (one the last read already missed). */
  emit(changes: Record<string, Record<string, unknown> | null>): void {
    for (const listener of [...this.listeners]) listener({ changes: structuredClone(changes) });
  }

  /** Every write of every batch, flattened. */
  writes(): SyncWrite[] {
    return this.batches.flat();
  }
}

/* ---------------------------------------------------------------- helpers */

const note = (id: string, text: string, x = 0): NoteElement => ({ type: 'note', id, x, y: 0, w: 180, h: 180, color: 'yellow', text, tilt: 0 });

const stored = (element: NoteElement): Record<string, unknown> => {
  const { id: _id, ...rest } = element;
  return rest;
};

const seedDocs = (...notes: NoteElement[]): Record<string, Record<string, unknown>> => ({
  'board/meta': { v: 1, title: 'Board', order: notes.map((element) => element.id) },
  'board/inks': { colors: {} },
  ...Object.fromEntries(notes.map((element) => [`elements/${element.id}`, stored(element)])),
});

const textOf = (doc: LiveBoardDocument, id: string): string | undefined => {
  const element = doc.content().elements.find((item) => item.id === id);
  return element?.type === 'note' ? element.text : undefined;
};

const withText = (content: BoardContent, id: string, text: string): BoardContent => ({
  ...content,
  elements: content.elements.map((element) => (element.id === id && element.type === 'note' ? { ...element, text } : element)),
});

async function open(docs = seedDocs(note('n1', 'a')), options: { readOnly?: boolean } = {}) {
  const transport = new FakeTransport(docs);
  const timers = new FakeTimers();
  const doc = createLiveBoardDocument({ transport, timers, ...options });
  await timers.advance(0);
  return { transport, timers, doc };
}

/* ------------------------------------------------------------------ tests */

describe('live board sync', () => {
  it('loads the documents and reports ready', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a'), note('n2', 'b')));
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    assert.equal(doc.getSnapshot().status, 'loading');
    assert.equal(doc.canEdit(), false);
    await timers.advance(0);
    const snapshot = doc.getSnapshot();
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.loadState, 'live');
    assert.equal(doc.title(), 'Board');
    assert.deepEqual(
      doc.content().elements.map((element) => element.id),
      ['n1', 'n2'],
    );
    assert.equal(doc.getSnapshot(), snapshot, 'the snapshot keeps its identity while nothing changes');
    assert.equal(transport.batches.length, 0, 'loading writes nothing');
  });

  it('debounces local edits into one patch of the changed document', async () => {
    const { transport, timers, doc } = await open();
    const seen: boolean[] = [];
    doc.subscribe((change) => seen.push(change.remote));
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'ab')), true);
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'abc')), true);
    assert.equal(textOf(doc, 'n1'), 'abc', 'edits show at once');
    assert.deepEqual(seen, [false, false]);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS - 100);
    assert.equal(transport.batches.length, 0, 'still debouncing');
    assert.equal(doc.getSnapshot().status, 'dirty');
    assert.equal(doc.getSnapshot().pending, 1);
    await timers.advance(200);
    assert.deepEqual(transport.writes(), [{ op: 'update', path: 'elements/n1', patch: { text: 'abc' } }]);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(doc.getSnapshot().pending, 0);
    assert.equal(transport.docs.get('elements/n1')?.text, 'abc');
  });

  it('clears the pending count when an edit changes no document', async () => {
    const { transport, timers, doc } = await open();
    const original = doc.content();
    assert.equal(doc.setContent(withText(original, 'n1', 'a')), true);
    assert.equal(doc.getSnapshot().pending, 1);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 100);
    assert.equal(transport.batches.length, 0, 'nothing to write');
    assert.equal(doc.getSnapshot().pending, 0);
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('writes new elements before the order and deletes after it', async () => {
    const { transport, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    doc.setContent({ ...doc.content(), elements: [doc.content().elements[0]!, note('n3', 'c')] });
    await doc.flush();
    const paths = transport.writes().map((write) => `${write.op} ${write.path}`);
    assert.deepEqual(paths, ['set elements/n3', 'update board/meta', 'delete elements/n2']);
    assert.deepEqual(transport.docs.get('board/meta')?.order, ['n1', 'n3']);
  });

  it('merges a concurrent remote edit of another field', async () => {
    const { transport, timers, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    transport.remote({ 'elements/n1': stored(note('n1', 'a', 500)) });
    const element = doc.content().elements[0];
    assert.equal(element?.type === 'note' && element.x, 500, 'the remote move shows');
    assert.equal(textOf(doc, 'n1'), 'mine', 'the local text survives');
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.deepEqual(transport.writes(), [{ op: 'update', path: 'elements/n1', patch: { text: 'mine' } }]);
    assert.deepEqual(transport.docs.get('elements/n1'), stored({ ...note('n1', 'mine', 500) }));
  });

  it('rebases pending edits over a remote change of the same field (last writer wins locally)', async () => {
    const { transport, timers, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    transport.remote({ 'elements/n1': stored(note('n1', 'theirs')) });
    assert.equal(textOf(doc, 'n1'), 'mine');
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(transport.docs.get('elements/n1')?.text, 'mine');
  });

  it('merges fills and heat maps set by two people cell by cell (the later write wins a cell)', async () => {
    const tableDoc = { type: 'table', x: 0, y: 0, head: true, color: 'white', cols: { c1: { at: 1 }, c2: { at: 2 } }, rows: { r1: { at: 1, c1: 'h', c2: 'h' }, r2: { at: 2, c1: '1', c2: '2' } } };
    const { transport, timers, doc } = await open({ 'board/meta': { v: 1, title: 'Board', order: ['t1'] }, 'board/inks': { colors: {} }, 'elements/t1': tableDoc });
    const withTints = (fields: Record<string, unknown>): BoardContent => ({
      ...doc.content(),
      elements: doc.content().elements.map((element) => (element.id === 't1' && element.type === 'table' ? { ...element, ...fields } : element)),
    });
    doc.setContent(withTints({ fills: { r1: { c1: 'blue' }, r2: { c2: 'peach' } } }));
    transport.remote({ 'elements/t1': { ...tableDoc, fills: { r2: { c1: 'pink', c2: 'green' } }, heat: { cols: { c2: 'purple' } } } });
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    const stored = transport.docs.get('elements/t1');
    assert.deepEqual(stored?.fills, { r1: { c1: 'blue' }, r2: { c1: 'pink', c2: 'peach' } });
    assert.deepEqual(stored?.heat, { cols: { c2: 'purple' } });
    const table = doc.content().elements[0];
    assert.deepEqual(table?.type === 'table' && table.fills, stored?.fills);
  });

  it('keeps a drawing style set by someone else while the drawing moves', async () => {
    const src = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
    const drawingDoc = { type: 'image', x: 0, y: 0, w: 100, h: 100, src };
    const { transport, timers, doc } = await open({ 'board/meta': { v: 1, title: 'Board', order: ['d1'] }, 'board/inks': { colors: {} }, 'elements/d1': drawingDoc });
    doc.setContent({ ...doc.content(), elements: doc.content().elements.map((element) => ({ ...element, x: 250 })) });
    transport.remote({ 'elements/d1': { ...drawingDoc, style: 'watercolor' } });
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.deepEqual(transport.docs.get('elements/d1'), { ...drawingDoc, x: 250, style: 'watercolor' });
  });

  it('applies remote changes with remote: true and keeps unchanged elements identical', async () => {
    const { transport, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    const before = doc.content().elements;
    const changes: boolean[] = [];
    doc.subscribe((change) => changes.push(change.remote));
    transport.remote({ 'elements/n2': stored(note('n2', 'B')) });
    assert.deepEqual(changes, [true]);
    assert.equal(doc.content().elements[0], before[0], 'n1 keeps its object');
    assert.equal(textOf(doc, 'n2'), 'B');
  });

  it('drops a pending edit when someone else deletes the element', async () => {
    const { transport, timers, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    doc.setContent(withText(doc.content(), 'n2', 'edit'));
    transport.remote({ 'elements/n2': null, 'board/meta': { v: 1, title: 'Board', order: ['n1'] } });
    assert.deepEqual(
      doc.content().elements.map((element) => element.id),
      ['n1'],
    );
    assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(transport.docs.has('elements/n2'), false, 'no stub is written back');
  });

  it('keeps acknowledged writes over stale remote snapshots during the grace period', async () => {
    const { transport, timers, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await doc.flush();
    // A change made before ours arrives late.
    transport.remote({ 'elements/n1': stored(note('n1', 'old', 40)) });
    assert.equal(textOf(doc, 'n1'), 'mine', 'our acknowledged text still shows');
    const element = doc.content().elements[0];
    assert.equal(element?.type === 'note' && element.x, 40, 'their other fields show');
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS + 50);
    assert.equal(textOf(doc, 'n1'), 'old', 'after the grace period the store wins');
  });

  it('parks a document the codec refuses and resumes once it fits', async () => {
    const { transport, timers, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    doc.setContent(withText(doc.content(), 'n1', 'x'.repeat(210_000)));
    doc.setContent(withText(doc.content(), 'n2', 'fine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    const snapshot = doc.getSnapshot();
    assert.equal(snapshot.status, 'error');
    assert.match(snapshot.refusal ?? '', /too large to sync/);
    assert.equal(snapshot.retryable, false);
    assert.deepEqual(
      transport.writes().map((write) => write.path),
      ['elements/n2'],
      'other documents keep syncing',
    );
    doc.setContent(withText(doc.content(), 'n1', 'short'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(doc.getSnapshot().refusal, undefined);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(transport.docs.get('elements/n1')?.text, 'short');
  });

  it('retries failed writes and reports offline meanwhile', async () => {
    const { transport, timers, doc } = await open();
    transport.failures.push('unavailable', 'unavailable');
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(doc.getSnapshot().status, 'offline');
    assert.equal(doc.getSnapshot().retryable, true);
    assert.equal(textOf(doc, 'n1'), 'mine', 'edits stay on screen');
    // First retry: 300–800 ms of jitter (random() = 0), but never before the edit debounce.
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(transport.batches.length, 2);
    assert.equal(doc.getSnapshot().status, 'offline');
    await timers.advance(2000); // second retry: 2 s
    assert.equal(transport.batches.length, 3);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(transport.docs.get('elements/n1')?.text, 'mine');
  });

  it('keeps edits made while a failed write waits and sends them together', async () => {
    const { transport, timers, doc } = await open();
    transport.failures.push('unavailable');
    doc.setContent(withText(doc.content(), 'n1', 'one'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    doc.setContent(withText(doc.content(), 'n1', 'two'));
    await timers.advance(1000);
    assert.equal(transport.docs.get('elements/n1')?.text, 'two');
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('stops writing when access ends', async () => {
    const { transport, timers, doc } = await open();
    transport.failures.push('not_writer');
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    const snapshot = doc.getSnapshot();
    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.message, LIVE_MESSAGES.accessEnded);
    assert.equal(doc.canEdit(), false);
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'more')), false);
    await timers.advance(60_000);
    assert.equal(transport.batches.length, 1, 'no more writes');
  });

  it('never writes in read-only mode but still follows remote edits', async () => {
    const { transport, timers, doc } = await open(undefined, { readOnly: true });
    assert.equal(doc.getSnapshot().status, 'readonly');
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'mine')), false);
    transport.remote({ 'elements/n1': stored(note('n1', 'theirs')) });
    assert.equal(textOf(doc, 'n1'), 'theirs');
    doc.setReadOnly(false);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(doc.setTitle('Renamed'), true);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(transport.docs.get('board/meta')?.title, 'Renamed');
  });

  it('flush sends pending edits at once', async () => {
    const { transport, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'now'));
    await doc.flush();
    assert.equal(transport.docs.get('elements/n1')?.text, 'now');
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('retries a failed load with backoff', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().status, 'error');
    assert.equal(doc.getSnapshot().loadState, 'failed');
    assert.equal(doc.getSnapshot().retryable, true);
    await timers.advance(LIVE_RECONNECT_BACKOFF_MS[0]!);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(textOf(doc, 'n1'), 'a');
  });

  it('applies changes heard while loading over the loaded documents', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    transport.emit({ 'elements/n1': stored(note('n1', 'newer')) });
    await timers.advance(0);
    assert.equal(textOf(doc, 'n1'), 'newer');
    assert.equal(transport.batches.length, 0);
  });

  it('does not retry a load the viewer may not read', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('not_granted');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    await timers.advance(120_000);
    assert.equal(doc.getSnapshot().loadState, 'failed');
    assert.equal(doc.getSnapshot().retryable, false);
  });

  it('stops listening after dispose', async () => {
    const { transport, doc } = await open();
    const value: Board = doc.value();
    doc.dispose();
    transport.remote({ 'elements/n1': stored(note('n1', 'later')) });
    assert.equal(doc.value(), value);
  });
});

/** A saved copy kept in memory, holding `docs` to start with. */
class MemoryCache implements LiveCache {
  saved: SyncDocument[] | undefined;
  writes = 0;

  constructor(docs?: Record<string, Record<string, unknown>>) {
    this.saved = docs && Object.entries(docs).map(([path, data]) => ({ path, data: structuredClone(data) }));
  }

  read(): SyncDocument[] | undefined {
    return structuredClone(this.saved);
  }

  write(documents: SyncDocument[]): void {
    this.writes += 1;
    this.saved = structuredClone(documents);
  }

  text(id: string): unknown {
    return this.saved?.find((document) => document.path === `elements/${id}`)?.data.text;
  }
}

describe('saved copy', () => {
  it('shows the saved copy while the store is out of reach, and sends edits once it is back', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().loadState, 'cached');
    assert.equal(doc.getSnapshot().status, 'cached');
    assert.equal(doc.getSnapshot().message, LIVE_MESSAGES.cached);
    assert.equal(doc.getSnapshot().retryable, true);
    assert.equal(textOf(doc, 'n1'), 'saved');

    assert.equal(doc.canEdit(), true);
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(doc.getSnapshot().message, LIVE_MESSAGES.cachedEdits);
    assert.equal(transport.batches.length, 0);

    await timers.advance(LIVE_RECONNECT_BACKOFF_MS[0]!);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(doc.getSnapshot().loadState, 'live');
    assert.equal(textOf(doc, 'n1'), 'mine');
    assert.equal(transport.docs.get('elements/n1')?.text, 'mine');
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('drops a waiting edit to an element deleted meanwhile', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, cache: new MemoryCache(seedDocs(note('n1', 'a'), note('n2', 'b'))) });
    await timers.advance(0);
    assert.equal(textOf(doc, 'n2'), 'b');
    doc.setContent(withText(doc.content(), 'n2', 'gone soon'));
    await timers.advance(LIVE_RECONNECT_BACKOFF_MS[0]!);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(textOf(doc, 'n2'), undefined);
    assert.equal(transport.docs.has('elements/n2'), false);
    assert.equal(doc.getSnapshot().pending, 0);
  });

  it('shows the saved copy when loading is slow', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.list = () => new Promise<SyncDocument[]>(() => {});
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().loadState, 'loading');
    await timers.advance(LIVE_SNAPSHOT_TIMEOUT_MS);
    assert.equal(doc.getSnapshot().loadState, 'cached');
    assert.equal(textOf(doc, 'n1'), 'saved');
  });

  it('shows a saved copy read-only to viewers', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, readOnly: true, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().status, 'readonly');
    assert.equal(doc.getSnapshot().message, LIVE_MESSAGES.cachedReadOnly);
    assert.equal(doc.canEdit(), false);
  });

  it('fails the load without a saved copy, or when the viewer may not read', async () => {
    const empty = new FakeTransport(seedDocs(note('n1', 'a')));
    empty.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport: empty, timers, cache: new MemoryCache() });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().loadState, 'failed');

    const denied = new FakeTransport(seedDocs(note('n1', 'a')));
    denied.listFailures.push('not_granted');
    const other = createLiveBoardDocument({ transport: denied, timers, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(other.getSnapshot().loadState, 'failed');
    assert.equal(textOf(other, 'n1'), undefined);
  });

  it('keeps the saved copy up to date once live', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    const timers = new FakeTimers();
    const cache = new MemoryCache();
    const doc = createLiveBoardDocument({ transport, timers, cache });
    await timers.advance(0);
    assert.equal(cache.writes, 0);
    await timers.advance(LIVE_CACHE_WRITE_DELAY_MS);
    assert.equal(cache.writes, 1);
    assert.equal(cache.text('n1'), 'a');

    doc.setContent(withText(doc.content(), 'n1', 'b'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    await timers.advance(LIVE_CACHE_WRITE_DELAY_MS);
    assert.equal(cache.text('n1'), 'b');

    // Someone else's edit lands; leaving writes the copy at once.
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS);
    transport.remote({ 'elements/n1': stored(note('n1', 'theirs')) });
    assert.equal(textOf(doc, 'n1'), 'theirs');
    doc.dispose();
    assert.equal(cache.text('n1'), 'theirs');
  });
});

describe('stickers on hosts', () => {
  const docs = (): Record<string, Record<string, unknown>> => ({
    'board/meta': { v: 1, title: 'Board', order: ['n1', 's1'] },
    'board/inks': { colors: {} },
    'elements/n1': stored(note('n1', 'host')),
    'elements/s1': { type: 'sticker', x: 100, y: 20, w: 40, h: 40, glyph: '👍', on: ['n1', 0, 0, 100, 20] },
  });
  const stickerX = (doc: LiveBoardDocument): number | undefined => {
    const sticker = doc.content().elements.find((element) => element.id === 's1');
    return sticker?.type === 'sticker' ? sticker.x : undefined;
  };

  it('follows a host someone else moved, then stores where the sticker went', async () => {
    const { transport, timers, doc } = await open(docs());
    assert.equal(stickerX(doc), 100);
    transport.remote({ 'elements/n1': stored(note('n1', 'host', 300)) });
    await timers.advance(0);
    // Shown moved with its host, still stored where it was.
    assert.equal(stickerX(doc), 400);
    assert.equal(transport.docs.get('elements/s1')?.x, 100);
    await timers.advance(5000);
    assert.equal(transport.docs.get('elements/s1')?.x, 400);
    assert.equal(stickerX(doc), 400);
  });

  it('does not store followed stickers from a read-only page', async () => {
    const { transport, timers, doc } = await open(docs(), { readOnly: true });
    transport.remote({ 'elements/n1': stored(note('n1', 'host', 300)) });
    await timers.advance(5000);
    assert.equal(stickerX(doc), 400);
    assert.equal(transport.docs.get('elements/s1')?.x, 100);
  });
});
