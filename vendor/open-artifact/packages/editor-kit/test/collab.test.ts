import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommentsCapability, CommentThread, HistoryCapability, Peer, RoomCapability } from '@open-artifact/runtime';
import { collabAside, createCollab } from '../src/collab/collab.ts';
import { createComments, openCount, type CommentsAdapter } from '../src/collab/comments.ts';
import { createHistory } from '../src/collab/history.ts';
import { cardPosition, screenBox, toScreenPoint, toWorldPoint } from '../src/collab/pins.ts';
import { AGENT_COLOR, createPresence, peerViews, peerValue } from '../src/collab/presence.ts';

describe('pin geometry', () => {
  it('maps world to screen and back', () => {
    const camera = { x: 40, y: -20, zoom: 2 };
    const world = { x: 15, y: 30 };
    assert.deepEqual(toScreenPoint(camera, world), { x: 70, y: 40 });
    assert.deepEqual(toWorldPoint(camera, toScreenPoint(camera, world)), world);
    assert.deepEqual(screenBox(camera, { x: 0, y: 0, w: 10, h: 5 }), { left: 40, top: -20, width: 20, height: 10 });
  });

  it('opens a card to the right of its pin, or to the left near the edge', () => {
    const viewport = { width: 1000, height: 800 };
    assert.deepEqual(cardPosition({ x: 100, y: 100 }, viewport), { x: 118, y: 92 });
    assert.equal(cardPosition({ x: 900, y: 100 }, viewport).x, 900 - 14 - 288);
    // Kept inside vertically.
    assert.equal(cardPosition({ x: 100, y: 790 }, viewport).y, 800 - 320);
    assert.equal(cardPosition({ x: 100, y: 0 }, viewport).y, 8);
  });
});

/* -------------------------------------------------------------------------- */

const thread = (id: string, anchor: string, status: 'open' | 'resolved' = 'open'): CommentThread => ({
  id,
  anchor,
  label: anchor,
  location: {},
  status,
  messages: [{ id: `${id}m`, author: { id: 'u', name: 'Ana', kind: 'person' }, at: new Date(0).toISOString(), text: 'hi' }],
} as unknown as CommentThread);

/** A fake comments capability that records calls. */
function fakeComments(initial: CommentThread[]) {
  const calls: string[] = [];
  let listener: ((threads: CommentThread[]) => void) | null = null;
  const capability = {
    list: async () => initial,
    create: async (input: { anchor: string; label: string; location?: unknown; text: string }) => {
      calls.push(`create ${input.anchor} ${input.label} ${JSON.stringify(input.location)} ${input.text}`);
      return thread('new', input.anchor);
    },
    reply: async (id: string, text: string) => (calls.push(`reply ${id} ${text}`), thread(id, 'x')),
    setResolved: async (id: string, resolved: boolean) => (calls.push(`resolve ${id} ${resolved}`), thread(id, 'x', resolved ? 'resolved' : 'open')),
    move: async (id: string, anchor: string) => (calls.push(`move ${id} ${anchor}`), thread(id, anchor)),
    remove: async (id: string) => void calls.push(`remove ${id}`),
    sendToAgent: async (id: string) => (calls.push(`send ${id}`), thread(id, 'x')),
    onChange: (fn: (threads: CommentThread[]) => void) => {
      listener = fn;
      return () => undefined;
    },
  } as unknown as CommentsCapability;
  return { capability, calls, change: (threads: CommentThread[]) => listener?.(threads) };
}

type Anchor = { at: string };

function adapter(overrides: Partial<CommentsAdapter<Anchor>> = {}) {
  const log: string[] = [];
  let parses = 0;
  const a: CommentsAdapter<Anchor> = {
    parse: (text) => (parses++, { at: text }),
    serialize: (anchor) => anchor.at,
    label: (anchor) => `on ${anchor.at}`,
    location: (anchor) => ({ at: anchor.at }),
    reveal: (anchor) => void log.push(`reveal ${anchor.at}`),
    canComment: () => true,
    canSendToAgent: () => false,
    notify: (m) => void log.push(`notify ${m.title}`),
    onModeChange: (on) => void log.push(`mode ${on}`),
    ...overrides,
  };
  return { adapter: a, log, parses: () => parses };
}

describe('comments controller', () => {
  it('loads threads, parses each anchor once and reveals ?comment=', async () => {
    const { adapter: a, log, parses } = adapter();
    const comments = createComments(a);
    assert.equal(comments.canComment(), false, 'no capability yet');
    const fake = fakeComments([thread('t1', 'A'), thread('t2', 'B', 'resolved')]);
    await comments.start(fake.capability, 't2');
    assert.equal(comments.store.getState().available, true);
    assert.equal(comments.store.getState().active, 't2');
    assert.deepEqual(log, ['reveal B']);
    assert.equal(openCount(comments.store.getState().threads), 1);
    const before = parses();
    comments.anchorOf({ anchor: 'A' });
    comments.anchorOf({ anchor: 'A' });
    assert.equal(parses() - before, 1);
    // A change that drops the open thread closes its card.
    fake.change([thread('t1', 'A')]);
    assert.equal(comments.store.getState().active, null);
  });

  it('creates through the adapter and keeps permissions', async () => {
    const { adapter: a, log } = adapter({ maxThreads: 2 });
    const comments = createComments(a);
    const fake = fakeComments([thread('t1', 'A')]);
    await comments.start(fake.capability);
    await comments.create({ at: 'P' }, '  hello  ');
    assert.deepEqual(fake.calls, ['create P on P {"at":"P"} hello']);
    assert.equal(comments.store.getState().active, 'new');
    // At the cap: nothing is sent, the adapter is told.
    await comments.create({ at: 'Q' }, 'again');
    assert.equal(fake.calls.length, 1);
    assert.match(log.at(-1)!, /already has 2 comments/);
    // Sending to the agent is the adapter's call.
    await comments.sendToAgent('t1');
    assert.equal(fake.calls.length, 1);
    comments.store.getState().setOn(true);
    assert.equal(log.includes('mode true'), true);
  });
});

describe('collab glue', () => {
  const setup = (opts: { surface?: boolean; canComment?: boolean } = {}) => {
    const comments = createComments(adapter({ canComment: () => opts.canComment ?? true }).adapter);
    const history = createHistory<string>({ loadPreview: async (_h, n) => `v${n}` });
    let surface = opts.surface ?? true;
    const collab = createCollab({ comments, history, adapter: { onSurface: () => surface, showSurface: () => void (surface = true), readOnly: () => false } });
    return { comments, history, collab };
  };
  const key = (k: string) => ({ key: k, code: `Key${k.toUpperCase()}`, meta: false, shift: false, alt: false });

  it('C toggles comment mode on the surface; Esc closes draft, card, then the mode', async () => {
    const { comments, collab } = setup();
    assert.equal(collab.runShortcut(key('c')), false, 'not available yet');
    await comments.start(fakeComments([]).capability);
    assert.equal(collab.runShortcut(key('c')), true);
    assert.equal(comments.store.getState().on, true);
    comments.store.getState().setDraft({ at: 'x' });
    assert.equal(collab.runShortcut({ ...key('Escape'), code: 'Escape' }), true);
    assert.equal(comments.store.getState().draft, null);
    assert.equal(comments.store.getState().on, true);
    assert.equal(collab.runShortcut({ ...key('Escape'), code: 'Escape' }), true);
    assert.equal(comments.store.getState().on, false);
    assert.equal(collab.runShortcut({ ...key('Escape'), code: 'Escape' }), false);
    assert.equal(collab.runShortcut({ key: 'Delete', meta: false, shift: false, alt: false }), false);
  });

  it('viewers and other surfaces leave C alone', async () => {
    const viewer = setup({ canComment: false });
    await viewer.comments.start(fakeComments([]).capability);
    assert.equal(viewer.collab.runShortcut(key('c')), false);
    const elsewhere = setup({ surface: false });
    await elsewhere.comments.start(fakeComments([]).capability);
    assert.equal(elsewhere.collab.runShortcut(key('c')), false);
    // The Shell's comment mode brings the surface up.
    assert.equal(elsewhere.collab.handleCommand({ cmd: 'comments_mode', on: true } as never), true);
    assert.equal(elsewhere.comments.store.getState().on, true);
  });

  it('one panel at a time, and a history preview swallows keys', async () => {
    const { comments, history, collab } = setup();
    await comments.start(fakeComments([]).capability);
    history.start({ list: async () => ({ canRestore: true }), onChange: () => () => undefined } as unknown as HistoryCapability);
    // The All comments panel floats over the surface: it is not an aside.
    collab.toggleCommentList(true);
    assert.equal(comments.store.getState().listOpen, true);
    assert.equal(collabAside(comments.store.getState(), history.store.getState()), null);
    collab.handleCommand({ cmd: 'history' } as never);
    assert.equal(comments.store.getState().listOpen, false);
    assert.equal(collabAside(comments.store.getState(), history.store.getState()), 'history');
    assert.deepEqual(collab.chromeReport(), { comments: { available: true, on: false, open: false, count: 0, pageButton: false }, history: true });
    await history.preview(3);
    assert.equal(history.store.getState().preview, 'v3');
    assert.equal(collab.runShortcut(key('x')), true);
  });
});

describe('history controller', () => {
  it('keeps only the latest preview request', async () => {
    let release: (() => void) | null = null;
    const history = createHistory<string>({
      loadPreview: (_h, n) => (n === 1 ? new Promise<string>((resolve) => (release = () => resolve('v1'))) : Promise.resolve(`v${n}`)),
    });
    history.start({ list: async () => ({ canRestore: false }), onChange: () => () => undefined } as unknown as HistoryCapability);
    const first = history.preview(1);
    await history.preview(2);
    release!();
    await first;
    assert.equal(history.store.getState().preview, 'v2');
    await history.preview(null);
    assert.equal(history.store.getState().previewing, null);
  });
});

describe('presence', () => {
  it('reads peers: drops itself, checks values, colors the agent', () => {
    const peers = [
      { id: 'me', name: 'Me', kind: 'person', state: {} },
      { id: 'p1', name: 'Ana', kind: 'person', state: { design: { cursor: { x: 1, y: 2 }, page: 'a' } } },
      { id: 'p2', name: '', kind: 'agent', state: { design: 'garbage' } },
      { id: 'p3', name: 'Bo', kind: 'person', state: { design: { cursor: { x: 'no' } } } },
    ] as Peer[];
    const views = peerViews(peers, 'me', 'design', (v) => ({ page: peerValue.str(v.page) }));
    assert.deepEqual(
      views.map((v) => [v.id, v.name, v.cursor, v.state]),
      [
        ['p1', 'Ana', { x: 1, y: 2 }, { page: 'a' }],
        ['p3', 'Bo', null, { page: null }],
        ['p2', 'Agent', null, null],
      ],
    );
    assert.equal(views[2]!.color, AGENT_COLOR);
    assert.deepEqual(peerValue.strList(['a', 1, 'b'], 1), ['a']);
  });

  it('without a pointer, sends the snapshot alone at its own pace and hands raw peers on', async () => {
    const sent: Record<string, unknown>[] = [];
    const peers = [
      { id: 'me', name: 'Me', kind: 'person', state: {} },
      { id: 'p1', name: 'Ana', kind: 'person', state: { deck: { slide: 's2' }, lead: true } },
    ] as unknown as Peer[];
    const room = {
      self: async () => 'me',
      presence: async (value: Record<string, unknown>) => void sent.push(value),
      peers: async () => peers,
      onPeers: () => () => undefined,
    } as unknown as RoomCapability;
    let slide = 's1';
    let changed = (): void => undefined;
    const heard: [readonly Peer[], string | null, number][] = [];
    const presence = createPresence<{ slide: string | null }>({
      key: 'deck',
      snapshot: () => ({ slide }),
      parse: (v) => ({ slide: peerValue.str(v.slide) }),
      watch: (fn) => ((changed = fn), () => undefined),
      sendMs: 5,
      onPeers: (raw, self) => void heard.push([raw, self, presence.store.getState().peers.length]),
    });
    const stop = await presence.start({ room });
    assert.deepEqual(sent, [{ deck: { slide: 's1' } }]);
    slide = 's2';
    changed();
    changed();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(sent, [{ deck: { slide: 's1' } }, { deck: { slide: 's2' } }]);
    // The store already holds the peers (itself left out) when the editor hears them.
    assert.equal(heard.length, 1);
    assert.equal(heard[0]![0], peers);
    assert.equal(heard[0]![1], 'me');
    assert.equal(heard[0]![2], 1);
    assert.deepEqual(presence.store.getState().peers[0]!.state, { slide: 's2' });
    stop();
    assert.deepEqual(sent.at(-1), { deck: null });
  });
});
