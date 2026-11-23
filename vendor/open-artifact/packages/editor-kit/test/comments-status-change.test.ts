/**
 * Tests of resolving and reopening: the new status shows before the host
 * answers, goes back when the host refuses, and one change waits for the last.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommentsCapability, CommentThread } from '@open-artifact/runtime';
import { createComments, withStatusChange, type CommentsAdapter } from '../src/index.ts';

const thread = (id: string, status: CommentThread['status'] = 'open', text = 'hi'): CommentThread => ({
  id,
  anchor: id,
  label: id,
  location: {},
  status,
  ...(status === 'resolved' ? { resolvedBy: { name: 'Ana', kind: 'person' } } : {}),
  messages: [{ id: `${id}m`, author: { name: 'Ana', kind: 'person' }, at: new Date(0).toISOString(), text }],
});

/** A host whose answers to `setResolved` wait until the test settles them. */
function slowHost(initial: CommentThread[]) {
  const waiting: { id: string; resolved: boolean; answer(): void; refuse(message: string): void }[] = [];
  let listener: ((threads: CommentThread[]) => void) | null = null;
  const capability: Pick<CommentsCapability, 'list' | 'setResolved' | 'onChange'> = {
    list: async () => initial,
    setResolved: (id, resolved) =>
      new Promise<CommentThread>((resolve, reject) => {
        waiting.push({
          id,
          resolved,
          answer: () => resolve(thread(id, resolved ? 'resolved' : 'open')),
          refuse: (message) => reject(new Error(message)),
        });
      }),
    onChange: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
  return { capability: capability as CommentsCapability, waiting, change: (threads: CommentThread[]) => listener?.(threads) };
}

function adapter(notices: string[]): CommentsAdapter<string> {
  return {
    parse: (text) => text,
    serialize: (anchor) => anchor,
    label: (anchor) => anchor,
    canComment: () => true,
    canSendToAgent: () => false,
    notify: (message) => notices.push(message.description ?? message.title),
  };
}

const statusOf = (comments: { store: { getState(): { threads: CommentThread[] } } }, id: string) =>
  comments.store.getState().threads.find((t) => t.id === id)?.status;

describe('resolving and reopening', () => {
  it('shows a resolve at once and closes its card, before the host answers', async () => {
    const host = slowHost([thread('a'), thread('b')]);
    const comments = createComments(adapter([]));
    await comments.start(host.capability);
    comments.store.getState().setActive('a');
    const done = comments.resolve('a', true);
    assert.equal(statusOf(comments, 'a'), 'resolved');
    assert.equal(comments.store.getState().active, null);
    assert.deepEqual(comments.store.getState().statusChange, { id: 'a', status: 'resolved' });
    host.waiting[0]!.answer();
    await done;
    assert.equal(statusOf(comments, 'a'), 'resolved');
    assert.equal(comments.store.getState().statusChange, null);
  });

  it('keeps the new status over changes heard while it waits, and takes newer messages from them', async () => {
    const host = slowHost([thread('a')]);
    const comments = createComments(adapter([]));
    await comments.start(host.capability);
    const done = comments.resolve('a', true);
    host.change([thread('a', 'open', 'edited meanwhile')]);
    assert.equal(statusOf(comments, 'a'), 'resolved');
    host.waiting[0]!.answer();
    await done;
    const shown = comments.store.getState().threads[0]!;
    assert.equal(shown.status, 'resolved');
    assert.equal(shown.messages[0]!.text, 'edited meanwhile');
  });

  it('puts a refused resolve back, reopens its card and says why', async () => {
    const notices: string[] = [];
    const host = slowHost([thread('a')]);
    const comments = createComments(adapter(notices));
    await comments.start(host.capability);
    comments.store.getState().setActive('a');
    const done = comments.resolve('a', true);
    host.waiting[0]!.refuse('Not allowed');
    await done;
    assert.equal(statusOf(comments, 'a'), 'open');
    assert.equal(comments.store.getState().active, 'a');
    assert.equal(comments.store.getState().statusChange, null);
    assert.deepEqual(notices, ['Not allowed']);
  });

  it('does not reopen the card when the person has started a new comment meanwhile', async () => {
    const host = slowHost([thread('a')]);
    const comments = createComments(adapter([]));
    await comments.start(host.capability);
    comments.store.getState().setActive('a');
    const done = comments.resolve('a', true);
    comments.store.getState().setDraft('elsewhere');
    host.waiting[0]!.refuse('No');
    await done;
    assert.equal(comments.store.getState().active, null);
  });

  it('shows a reopen at once and puts it back when refused', async () => {
    const host = slowHost([thread('a', 'resolved')]);
    const comments = createComments(adapter([]));
    await comments.start(host.capability);
    const done = comments.resolve('a', false);
    assert.equal(statusOf(comments, 'a'), 'open');
    assert.equal(comments.store.getState().threads[0]!.resolvedBy, undefined);
    host.waiting[0]!.refuse('No');
    await done;
    assert.equal(statusOf(comments, 'a'), 'resolved');
  });

  it('takes one change at a time and skips a thread already in that status', async () => {
    const host = slowHost([thread('a'), thread('b'), thread('c', 'resolved')]);
    const comments = createComments(adapter([]));
    await comments.start(host.capability);
    const first = comments.resolve('a', true);
    await comments.resolve('b', true);
    assert.equal(statusOf(comments, 'b'), 'open');
    assert.equal(host.waiting.length, 1);
    host.waiting[0]!.answer();
    await first;
    await comments.resolve('c', true);
    assert.equal(host.waiting.length, 1);
  });

  it('leaves threads alone without a change', () => {
    const threads = [thread('a')];
    assert.equal(withStatusChange(threads, null), threads);
    assert.equal(withStatusChange(threads, { id: 'a', status: 'resolved' })[0]!.status, 'resolved');
    assert.equal(threads[0]!.status, 'open');
  });
});
