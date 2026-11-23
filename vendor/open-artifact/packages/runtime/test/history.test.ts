/**
 * The `history` capability from the page side: the local provider's routes,
 * and the Shell broker forwarding every method and event.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BROKERED_EVENTS, BROKERED_METHODS } from '../src/broker.ts';
import { isArtifactError } from '../src/capabilities.ts';
import { API } from '../src/http-api.ts';
import { createLocalProvider } from '../src/local-provider.ts';

const calls: { url: URL; init?: RequestInit }[] = [];
let stores: Record<string, boolean> = { history: true };
const realFetch = globalThis.fetch;
const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

before(() => {
  Object.defineProperty(globalThis, 'location', { value: { href: 'http://127.0.0.1:9/a/b/index.html' }, configurable: true });
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, ...(init ? { init } : {}) });
    const route = url.pathname.replace('/a/b/', '');
    const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    switch (route) {
      case API.session:
        return reply({ artifact: { id: 'x', title: 'X' }, stores });
      case API.history:
        return reply({ versions: [{ n: 1, first: 't', at: 't', author: { kind: 'system', id: 'system', name: '' }, files: [], current: true }], notices: [], canRestore: true });
      case API.historyFile:
        return url.searchParams.get('n') === '1' ? new Response('hello') : reply({ code: 'not_found', message: 'gone' }, 404);
      case API.historyDiff:
        return reply({ path: url.searchParams.get('path'), n: 1, op: 'added', before: null, after: 'hello' });
      case API.historyRestore:
        return reply({ version: 2, changed: ['project/a'] });
      case API.historyDismiss:
        return reply({ ok: true });
      default:
        return reply({ code: 'not_found', message: route }, 404);
    }
  };
});

after(() => {
  globalThis.fetch = realFetch;
  if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
  else delete (globalThis as { location?: unknown }).location;
});

test('the local provider speaks the history routes', async () => {
  const history = await createLocalProvider().get('history');
  assert.ok(history);
  assert.equal((await history.list()).versions[0]?.current, true);
  assert.equal(await history.read(1, 'project/a'), 'hello');
  await assert.rejects(history.read(2, 'project/a'), (e: unknown) => isArtifactError(e, 'not_found'));
  assert.equal((await history.diff(1, 'project/a')).after, 'hello');
  assert.deepEqual(await history.restore(1, ['project/a']), { version: 2, changed: ['project/a'] });
  const restore = calls.find((c) => c.url.pathname.endsWith(API.historyRestore))!;
  const body = JSON.parse(String(restore.init?.body)) as { n: number; paths: string[]; client: string };
  assert.deepEqual([body.n, body.paths, typeof body.client], [1, ['project/a'], 'string']);
  await history.dismissNotice('abc');
  assert.equal(calls.find((c) => c.url.pathname.endsWith(API.historyDiff))!.url.searchParams.get('path'), 'project/a');
});

test('no history capability when the host keeps none', async () => {
  stores = {};
  assert.equal(await createLocalProvider().get('history'), null);
  stores = { history: true };
});

test('the broker forwards every history method and event', async () => {
  const history = (await createLocalProvider().get('history'))!;
  const listeners = Object.keys(BROKERED_EVENTS.history);
  assert.deepEqual([...BROKERED_METHODS.history, ...listeners].sort(), Object.keys(history).sort());
});
