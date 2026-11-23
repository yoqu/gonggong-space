import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleAbilities } from '@open-artifact/editor-kit';
import { ArtifactError, createRuntime, type CapabilityMap, type CapabilityName, type DbCapability, type DbChangeEvent, type UserCapability } from '@open-artifact/runtime';
import { DISPLAY_INLINE_ATTR, displayMode, isFramedInlineView, isInlineDisplay, type DisplayView } from '../src/host/display-mode.ts';
import { readOnlyReasonFor, viewOnlyProvider } from '../src/host/view-only.ts';
import { EDITING_UNAVAILABLE, EMBEDDED_VIEW_ONLY, READ_ONLY_VIEWER } from '../src/host/words.ts';
import { registerUndoKeys } from '../src/engine/undo-keys.ts';
import { createKeyRegistry, type KeyPress } from '../src/keyboard/registry.ts';

interface FakeView extends DisplayView {
  location: { hash: string };
  attributes: Set<string>;
}

/** A window: framed (its parent another window) or opened on its own. */
function view(hash: string, framed: boolean): FakeView {
  const attributes = new Set<string>();
  const self: FakeView = {
    parent: null,
    location: { hash },
    attributes,
    document: {
      documentElement: {
        toggleAttribute(name: string, force?: boolean) {
          const on = force ?? !attributes.has(name);
          if (on) attributes.add(name);
          else attributes.delete(name);
          return on;
        },
      },
    },
  };
  (self as { parent: unknown }).parent = framed ? {} : self;
  return self;
}

test('only a framed page with #view-inline is inline', () => {
  assert.equal(isFramedInlineView(view('#view-inline', true)), true);
  assert.equal(isFramedInlineView(view('', true)), false);
  assert.equal(isFramedInlineView(view('#view-inline-x', true)), false);
  assert.equal(isFramedInlineView(view('#tools', true)), false);
  // Opened on its own the address does not matter.
  assert.equal(isFramedInlineView(view('#view-inline', false)), false);
  assert.equal(isFramedInlineView({ parent: {}, location: null }), false);
});

test('the mode is read once per window and marks the root', () => {
  const inline = view('#view-inline', true);
  assert.equal(displayMode(inline), 'inline');
  assert.equal(inline.attributes.has(DISPLAY_INLINE_ATTR), true);
  // A later address change does not flip it.
  inline.location.hash = '';
  assert.equal(isInlineDisplay(inline), true);

  const standalone = view('#view-inline', false);
  standalone.attributes.add(DISPLAY_INLINE_ATTR);
  assert.equal(displayMode(standalone), 'full');
  assert.equal(standalone.attributes.has(DISPLAY_INLINE_ATTR), false);
  standalone.location.hash = '#view-inline';
  assert.equal(isInlineDisplay(standalone), false);

  const framedFull = view('', true);
  assert.equal(displayMode(framedFull), 'full');
  framedFull.location.hash = '#view-inline';
  assert.equal(displayMode(framedFull), 'full');

  // No window (a worker, Node): full.
  assert.equal(displayMode(null), 'full');
});

/** A host that answers everything and records what was asked. */
function fullHost() {
  const asked: CapabilityName[] = [];
  const writes: unknown[] = [];
  const listeners: ((event: DbChangeEvent) => void)[] = [];
  const db: DbCapability = {
    get: async (path) => (path === 'film/meta' ? { title: 'Smoke film' } : null),
    list: async () => [{ path: 'film/meta', data: { title: 'Smoke film' } }] as Awaited<ReturnType<DbCapability['list']>>,
    write: async (batch) => {
      writes.push(batch);
    },
    onChange: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
  };
  const user: UserCapability = { me: async () => ({ id: 'u1', name: 'Owner', role: 'owner' }) };
  const others = { comments: {}, assets: {}, agent: {}, room: {}, downloads: {}, history: {}, artifact: {}, mcp: {} };
  return {
    asked,
    writes,
    listeners,
    provider: {
      get<K extends CapabilityName>(name: K): CapabilityMap[K] | null {
        asked.push(name);
        if (name === 'db') return db as CapabilityMap[K];
        if (name === 'user') return user as CapabilityMap[K];
        return (others as Record<string, unknown>)[name] as CapabilityMap[K];
      },
    },
  };
}

test('an inline page reads the store live but cannot write', async () => {
  const host = fullHost();
  const runtime = createRuntime(viewOnlyProvider(host.provider));
  const db = await runtime.use('db');
  assert.ok(db);
  assert.deepEqual(await db.get('film/meta'), { title: 'Smoke film' });
  assert.equal((await db.list('film')).length, 1);
  db.onChange(() => undefined);
  assert.equal(host.listeners.length, 1);
  await assert.rejects(
    db.write([{ op: 'update', path: 'film/meta', patch: { title: 'Unexpected edit' } }]),
    (error: unknown) => error instanceof ArtifactError && error.code === 'not_granted' && error.message === EMBEDDED_VIEW_ONLY,
  );
  assert.deepEqual(host.writes, []);
});

test('an inline page watches: no edits, comments, requests or downloads', async () => {
  const host = fullHost();
  const runtime = createRuntime(viewOnlyProvider(host.provider));
  const me = await (await runtime.use('user'))!.me();
  assert.deepEqual(me, { id: 'u1', name: 'Owner', role: 'viewer' });
  assert.deepEqual(roleAbilities(me.role), {
    canEdit: false,
    canComment: false,
    canRemoveComments: false,
    canRestore: false,
    canAsk: false,
    canSaveToHost: false,
    canUseConnectors: false,
  });
  for (const name of ['comments', 'assets', 'agent', 'room', 'downloads', 'history', 'artifact', 'mcp'] as const)
    assert.equal(await runtime.use(name), null, name);
  // The full host is never asked for them.
  assert.deepEqual(host.asked.sort(), ['user']);
});

test('the inline host passes on a missing store', async () => {
  const runtime = createRuntime(viewOnlyProvider({ get: () => null }));
  assert.equal(await runtime.use('db'), null);
  assert.equal(await runtime.use('user'), null);
});

test('inline, the page says editing is not available here', () => {
  assert.equal(readOnlyReasonFor(true, true), EDITING_UNAVAILABLE);
  assert.equal(readOnlyReasonFor(true, false), EDITING_UNAVAILABLE);
  assert.equal(EDITING_UNAVAILABLE, 'Editing isn’t available in this view.');
  assert.equal(readOnlyReasonFor(false, true), null);
  assert.equal(readOnlyReasonFor(false, false), READ_ONLY_VIEWER);
});

const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...extra });

test('inline, the undo keys stay the host’s', () => {
  const ran: string[] = [];
  const actions = { undo: () => ran.push('undo'), redo: () => ran.push('redo'), inTextField: () => false };

  const inline = createKeyRegistry();
  registerUndoKeys(inline, actions, true);
  assert.equal(inline.match(press('z', { metaKey: true }), false), null);
  assert.equal(inline.match(press('z', { ctrlKey: true, shiftKey: true }), true), null);
  assert.equal(inline.match(press('y', { ctrlKey: true }), false), null);
  assert.deepEqual(inline.list(), []);

  const full = createKeyRegistry();
  const stop = registerUndoKeys(full, actions, false);
  full.match(press('z', { metaKey: true }), true)?.run(press('z', { metaKey: true }));
  full.match(press('z', { metaKey: true, shiftKey: true }), false)?.run(press('z'));
  full.match(press('y', { ctrlKey: true }), false)?.run(press('y'));
  assert.deepEqual(ran, ['undo', 'redo', 'redo']);
  stop();
  assert.deepEqual(full.list(), []);
});

test('the undo keys leave a text field its own undo', () => {
  const registry = createKeyRegistry();
  registerUndoKeys(registry, { undo: () => undefined, redo: () => undefined, inTextField: () => true }, false);
  assert.equal(registry.match(press('z', { metaKey: true }), true), null);
});
