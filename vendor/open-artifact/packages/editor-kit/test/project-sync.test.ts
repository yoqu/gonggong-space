/** Tests of the project save engine: debounce, one save at a time, conflicts, remote changes held by a text edit, and loading. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArtifactError, type FilesChangedEvent, type PublishBatch, type PublishResult } from '@open-artifact/runtime';
import { createProjectSync, readProject, type ProjectSaveState } from '../src/project-sync.ts';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Timers driven by hand. */
function fakeTimers() {
  let now = 0;
  let next = 0;
  const queue: Array<{ id: number; at: number; run: () => void }> = [];
  return {
    set(run: () => void, ms: number) {
      queue.push({ id: ++next, at: now + ms, run });
      return next;
    },
    clear(handle: unknown) {
      const at = queue.findIndex((t) => t.id === handle);
      if (at >= 0) queue.splice(at, 1);
    },
    /** Moves the clock, running what falls due. */
    advance(ms: number) {
      now += ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const due = queue[0];
        if (!due || due.at > now) break;
        queue.shift();
        due.run();
      }
    },
    pending: () => queue.map((t) => t.at - now),
  };
}

/** A host holding files by hash, checking `ifMatch`. `gate` holds publishes until released. */
function fakeHost(initial: Record<string, string>) {
  let version = 0;
  const files = new Map<string, { text: string; hash: string }>();
  const write = (path: string, text: string) => {
    const hash = `h${++version}`;
    files.set(path, { text, hash });
    return hash;
  };
  for (const [path, text] of Object.entries(initial)) write(path, text);
  const listeners = new Set<(event: FilesChangedEvent) => void>();
  const published: PublishBatch[] = [];
  const reads: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let gate: Promise<void> | null = null;
  let refuse: 'not_writer' | 'offline' | null = null;
  const artifact = {
    id: 'a',
    title: async () => 'Title',
    list: async () => Object.fromEntries([...files].map(([path, file]) => [path, { sha256: file.hash, size: file.text.length }])),
    readText: async (path: string) => {
      reads.push(path);
      const file = files.get(path);
      if (!file) throw new ArtifactError('not_found', path);
      return file.text;
    },
    readBytes: async () => new Uint8Array(),
    async publish(batch: PublishBatch): Promise<PublishResult> {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      published.push(batch);
      try {
        if (gate) await gate;
        if (refuse === 'not_writer') throw new ArtifactError('not_writer', 'no');
        if (refuse === 'offline') throw new ArtifactError('unavailable', 'offline');
        const conflicts = Object.entries(batch)
          .filter(([path, file]) => file?.ifMatch !== undefined && (files.get(path)?.hash ?? null) !== file?.ifMatch)
          .map(([path, file]) => ({ path, expected: file?.ifMatch ?? null, actual: files.get(path)?.hash ?? null }));
        if (conflicts.length) throw new ArtifactError('conflict', 'stale', conflicts);
        const hashes: Record<string, string | null> = {};
        for (const [path, file] of Object.entries(batch)) {
          if (file) hashes[path] = write(path, file.content);
          else {
            files.delete(path);
            hashes[path] = null;
          }
        }
        return { hashes };
      } finally {
        inFlight--;
      }
    },
    onChange(listener: (event: FilesChangedEvent) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    artifact,
    files,
    published,
    reads,
    maxInFlight: () => maxInFlight,
    /** Someone else writes `path`; the host tells the page. */
    theirs(path: string, text: string, notify = true) {
      const hash = write(path, text);
      if (notify) for (const listener of listeners) listener({ changes: { [path]: hash } });
      return hash;
    },
    hold() {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
    refuse(kind: 'not_writer' | 'offline' | null) {
      refuse = kind;
    },
  };
}

/** A toy editor: each file is a text; a remote change to a dirty file merges as `theirs+mine`. */
function toyEditor(host: ReturnType<typeof fakeHost>, options: { maxRetries?: number } = {}) {
  const docs = new Map<string, { text: string; saved: string; hash: string | null }>();
  for (const [path, file] of host.files) docs.set(path, { text: file.text, saved: file.text, hash: file.hash });
  let save: ProjectSaveState = 'saved';
  let readOnly = false;
  let held: string | null = null;
  let changed: () => void = () => undefined;
  let ended: () => void = () => undefined;
  const log: string[] = [];
  const timers = fakeTimers();
  const sync = createProjectSync<Record<string, string>, { applied: string[] }>({
    artifact: () => host.artifact,
    saveDelay: 700,
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    readOnly: () => readOnly,
    isDirty: () => !readOnly && [...docs.values()].some((doc) => doc.text !== doc.saved),
    save: () => save,
    setSave(next) {
      save = next;
      log.push(`save:${next}`);
    },
    collect() {
      const batch: PublishBatch = {};
      const sent: Record<string, string> = {};
      for (const [path, doc] of docs) {
        if (doc.text === doc.saved) continue;
        batch[path] = { content: doc.text, ifMatch: doc.hash };
        sent[path] = doc.text;
      }
      return { batch, sent };
    },
    acknowledge(sent, hashes) {
      for (const [path, text] of Object.entries(sent)) {
        const doc = docs.get(path)!;
        docs.set(path, { ...doc, saved: text, hash: hashes[path] ?? null });
      }
    },
    saved: () => log.push('saved'),
    lostWriteAccess() {
      readOnly = true;
      save = 'readonly';
      log.push('lost');
    },
    remote: {
      begin: () => ({ applied: [] }),
      file(path, _hash, run) {
        const doc = docs.get(path);
        return {
          hash: doc?.hash,
          held: held === path,
          apply(text, hash) {
            const current = docs.get(path);
            const dirty = current && current.text !== current.saved;
            const mine = dirty ? current.text.slice(current.saved.length) : '';
            docs.set(path, { text: (text ?? '') + mine, saved: text ?? '', hash });
            run.applied.push(path);
          },
        };
      },
      end: (run) => void (run.applied.length && log.push(`remote:${run.applied.join(',')}`)),
    },
    watchChanges: (listener) => void (changed = listener),
    watchTextEdit: (listener) => void (ended = listener),
    timers,
    window: null,
  });
  sync.start();
  return {
    sync,
    docs,
    log,
    timers,
    /** A local edit: appends `more` to the file. */
    edit(path: string, more: string) {
      const doc = docs.get(path)!;
      docs.set(path, { ...doc, text: doc.text + more });
      changed();
    },
    holdEdit(path: string | null) {
      const was = held;
      held = path;
      if (was && !path) ended();
    },
    save: () => save,
  };
}

describe('createProjectSync', () => {
  it('debounces saves: one publish after the last change', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    editor.edit('project/a.txt', '1');
    assert.equal(editor.save(), 'dirty');
    editor.timers.advance(500);
    editor.edit('project/a.txt', '2');
    editor.timers.advance(500);
    editor.edit('project/a.txt', '3');
    assert.deepEqual(editor.timers.pending(), [700]);
    editor.timers.advance(699);
    await settle();
    assert.equal(host.published.length, 0);
    editor.timers.advance(1);
    await settle();
    assert.equal(host.published.length, 1);
    assert.equal(host.files.get('project/a.txt')?.text, 'a123');
    assert.deepEqual(editor.log.slice(-3), ['save:saving', 'save:saved', 'saved']);
  });

  it('never overlaps saves; a change during a save saves again after it', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    const release = host.hold();
    editor.edit('project/a.txt', '1');
    editor.timers.advance(700);
    await settle();
    assert.equal(host.published.length, 1);
    // A change and an explicit flush while the save is out: no second publish yet.
    editor.edit('project/a.txt', '2');
    await editor.sync.flush();
    editor.timers.advance(700);
    await settle();
    assert.equal(host.published.length, 1);
    release();
    await settle();
    // Still dirty after the save landed: saved again after the delay.
    assert.deepEqual(editor.timers.pending(), [700]);
    editor.timers.advance(700);
    await settle();
    assert.equal(host.published.length, 2);
    assert.equal(host.maxInFlight(), 1);
    assert.equal(host.files.get('project/a.txt')?.text, 'a12');
    assert.equal(editor.save(), 'saved');
  });

  it('re-saves right away when a flush was asked for during a clean save', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    const release = host.hold();
    editor.edit('project/a.txt', '1');
    editor.timers.advance(700);
    await settle();
    void editor.sync.flush();
    release();
    await settle();
    assert.deepEqual(editor.timers.pending(), [0]);
  });

  it('on a conflict reads theirs, lets the editor merge, and retries', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    editor.edit('project/a.txt', '+mine');
    host.theirs('project/a.txt', 'theirs', false);
    editor.timers.advance(700);
    await settle();
    assert.equal(host.published.length, 2);
    assert.equal(host.published[1]!['project/a.txt']?.content, 'theirs+mine');
    assert.equal(host.files.get('project/a.txt')?.text, 'theirs+mine');
    assert.ok(editor.log.includes('remote:project/a.txt'));
    assert.equal(editor.save(), 'saved');
  });

  it('gives up after the retry bound and backs off as offline', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host, { maxRetries: 2 });
    // Someone writes again every time we read: every attempt conflicts.
    const readText = host.artifact.readText;
    host.artifact.readText = async (path) => {
      const text = await readText(path);
      host.theirs(path, `${text}!`, false);
      return text;
    };
    editor.edit('project/a.txt', '1');
    host.theirs('project/a.txt', 'b', false);
    editor.timers.advance(700);
    await settle();
    assert.equal(host.published.length, 3);
    assert.equal(editor.save(), 'offline');
    assert.deepEqual(editor.timers.pending(), [4000]);
  });

  it('backs off while offline and resets on retryNow', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    host.refuse('offline');
    editor.edit('project/a.txt', '1');
    editor.timers.advance(700);
    await settle();
    assert.deepEqual(editor.timers.pending(), [4000]);
    editor.timers.advance(4000);
    await settle();
    assert.deepEqual(editor.timers.pending(), [8000]);
    // A new change keeps the offline badge.
    editor.edit('project/a.txt', '2');
    assert.equal(editor.save(), 'offline');
    host.refuse(null);
    editor.sync.retryNow();
    editor.timers.advance(0);
    await settle();
    assert.equal(editor.save(), 'saved');
  });

  it('goes read-only when write access is lost and stops saving', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    host.refuse('not_writer');
    editor.edit('project/a.txt', '1');
    editor.timers.advance(700);
    await settle();
    assert.ok(editor.log.includes('lost'));
    assert.deepEqual(editor.timers.pending(), []);
    editor.edit('project/a.txt', '2');
    assert.deepEqual(editor.timers.pending(), []);
  });

  it('applies remote changes, skipping known hashes', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    host.theirs('project/a.txt', 'theirs');
    await settle();
    assert.equal(editor.docs.get('project/a.txt')?.text, 'theirs');
    const reads = host.reads.length;
    await editor.sync.applyRemote({ 'project/a.txt': editor.docs.get('project/a.txt')!.hash });
    assert.equal(host.reads.length, reads);
  });

  it('defers a remote change to a file held by a text edit until the edit ends', async () => {
    const host = fakeHost({ 'project/a.txt': 'a', 'project/b.txt': 'b' });
    const editor = toyEditor(host);
    editor.holdEdit('project/a.txt');
    host.theirs('project/a.txt', 'A');
    host.theirs('project/b.txt', 'B');
    await settle();
    assert.equal(editor.docs.get('project/a.txt')?.text, 'a');
    assert.equal(editor.docs.get('project/b.txt')?.text, 'B');
    assert.deepEqual(host.reads, ['project/b.txt']);
    editor.holdEdit(null);
    await settle();
    assert.equal(editor.docs.get('project/a.txt')?.text, 'A');
  });

  it('does not defer while resolving a conflict (forced)', async () => {
    const host = fakeHost({ 'project/a.txt': 'a' });
    const editor = toyEditor(host);
    editor.edit('project/a.txt', '+mine');
    editor.holdEdit('project/a.txt');
    host.theirs('project/a.txt', 'theirs', false);
    editor.timers.advance(700);
    await settle();
    assert.equal(host.files.get('project/a.txt')?.text, 'theirs+mine');
  });
});

describe('readProject', () => {
  it('reads the named files and every item file', async () => {
    const host = fakeHost({ 'project/index.json': '{}', 'project/items/x.html': 'X', 'project/items/y.html': 'Y', 'project/other.png': '' });
    const read = await readProject(host.artifact, {
      files: ['project/index.json', 'project/missing.css'],
      item: (path) => /^project\/items\/(\w+)\.html$/.exec(path)?.[1],
    });
    assert.equal(read.title, 'Title');
    assert.deepEqual(read.files, { 'project/index.json': { text: '{}', hash: 'h1' }, 'project/missing.css': null });
    assert.deepEqual(read.items, { x: { text: 'X', hash: 'h2' }, y: { text: 'Y', hash: 'h3' } });
    // Item files are read first, then the named ones.
    assert.deepEqual(host.reads, ['project/items/x.html', 'project/items/y.html', 'project/index.json']);
  });

  it('rejects when a read fails', async () => {
    const host = fakeHost({ 'project/items/x.html': 'X' });
    host.artifact.readText = async () => {
      throw new ArtifactError('unavailable', 'down');
    };
    await assert.rejects(readProject(host.artifact, { files: [], item: () => 'x' }));
  });
});
