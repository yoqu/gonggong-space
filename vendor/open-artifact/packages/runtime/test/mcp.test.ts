/**
 * The `mcp` capability from the page side: the local provider's routes
 * (owner only, codes kept, cancellation), and the Shell broker carrying it.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BROKERED_METHODS, createShellProvider } from '../src/broker.ts';
import { isArtifactError, type McpCapability } from '../src/capabilities.ts';
import type { CapabilityProvider } from '../src/client.ts';
import { API } from '../src/http-api.ts';
import { createLocalProvider } from '../src/local-provider.ts';

const calls: { url: URL; init?: RequestInit }[] = [];
let role = 'owner';
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
        return reply({ artifact: { id: 'x', title: 'X', type: 'data' }, viewer: { id: 'v', name: 'V', role } });
      case API.mcpTools:
        return reply({ servers: [{ server: 'files', kind: 'connector', authStatus: 'connected', tools: [{ name: 'read' }] }] });
      case API.mcpCall: {
        const body = JSON.parse(String(init?.body)) as { tool: string };
        if (body.tool === 'busy') return reply({ code: 'upstream_error', message: 'too slow', retryable: true }, 502);
        if (body.tool === 'wait') {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        }
        return reply({ content: [{ type: 'text', text: 'ok' }] });
      }
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

test('the local provider speaks the mcp routes', async () => {
  const mcp = await createLocalProvider().get('mcp');
  assert.ok(mcp);
  assert.equal((await mcp.listTools('files')).servers[0]?.authStatus, 'connected');
  assert.equal(calls.find((c) => c.url.pathname.endsWith(API.mcpTools))!.url.searchParams.get('server'), 'files');
  assert.deepEqual(await mcp.callTool('files', 'read', { path: 'a.csv' }, { timeoutMs: 5000 }), { content: [{ type: 'text', text: 'ok' }] });
  const sent = calls.find((c) => c.url.pathname.endsWith(API.mcpCall))!;
  assert.deepEqual(JSON.parse(String(sent.init?.body)), { server: 'files', tool: 'read', args: { path: 'a.csv' }, timeoutMs: 5000 });
  await assert.rejects(mcp.callTool('files', 'busy', {}), (e: unknown) => isArtifactError(e, 'upstream_error') && (e as { retryable?: boolean }).retryable === true);
  const controller = new AbortController();
  const waiting = mcp.callTool('files', 'wait', {}, { signal: controller.signal });
  controller.abort(new Error('stop'));
  await assert.rejects(waiting, /stop/);
});

test('only the owner gets mcp', async () => {
  role = 'editor';
  assert.equal(await createLocalProvider().get('mcp'), null);
  role = 'owner';
});

test('the Shell broker carries mcp, its timeout and its signal', async () => {
  assert.deepEqual([...BROKERED_METHODS.mcp].sort(), ['callTool', 'listTools']);
  const posted: { openArtifact: string; id?: string; cap?: string; method?: string; args?: unknown[] }[] = [];
  const handlers: ((event: MessageEvent) => void)[] = [];
  const parent = { postMessage: (message: (typeof posted)[number]) => posted.push(message) } as unknown as Window;
  const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    value: { parent, addEventListener: (_: string, fn: (event: MessageEvent) => void) => handlers.push(fn) },
    configurable: true,
  });
  try {
    const fallback: CapabilityProvider = { get: () => null };
    const provider = createShellProvider({ origin: 'http://shell.test', target: parent, fallback, wantTimeoutMs: 1000 });
    const answer = (data: unknown): void => {
      for (const fn of handlers) fn({ source: parent, origin: 'http://shell.test', data } as MessageEvent);
    };
    const pendingNs = provider.get('mcp') as Promise<McpCapability | null>;
    await new Promise((done) => setTimeout(done, 0));
    answer({ openArtifact: 'cap_grant', cap: 'mcp', ok: true, gen: 0 });
    const mcp = (await pendingNs)!;
    const call = mcp.callTool('files', 'read', { a: 1 }, { timeoutMs: 1000 });
    const sent = posted.find((m) => m.openArtifact === 'cap')!;
    assert.deepEqual([sent.cap, sent.method, sent.args], ['mcp', 'callTool', ['files', 'read', { a: 1 }, { timeoutMs: 1000 }]]);
    answer({ openArtifact: 'cap_r', id: sent.id, error: { code: 'needs_reauth', message: 'log in again', retryable: false } });
    await assert.rejects(call, (e: unknown) => isArtifactError(e, 'needs_reauth'));
    const controller = new AbortController();
    const cut = mcp.callTool('files', 'read', {}, { signal: controller.signal });
    const second = posted.filter((m) => m.openArtifact === 'cap')[1]!;
    assert.equal((second.args as unknown[]).length, 3);
    controller.abort(new Error('gone'));
    await assert.rejects(cut, /gone/);
  } finally {
    if (realWindow) Object.defineProperty(globalThis, 'window', realWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});
