/**
 * The page side of the Shell's capability broker.
 *
 * Inside the Open Artifact Shell, `window.openartifact` does not call its
 * backend itself: every call goes to the Shell by `postMessage`, the Shell
 * runs it and answers, and it lets
 * the Shell see and mediate what a page does: an agent turn needs a click,
 * one event connection serves the page, and a page whose broker was
 * rewired learns which calls may not have run.
 *
 * The messages are `cap_*` in `@open-artifact/protocol`'s `shell.ts`:
 *
 *   page → Shell  cap_want {cap, protocol, base}         once per capability
 *   Shell → page  cap_grant {cap, ok, gen, config?}
 *   page → Shell  cap {id, cap, method, args, gen}       every call
 *   Shell → page  cap_r {id, result | error}  ·  cap_ack {id}  ·  cap_ev {cap, event, data}  ·  cap_rewired {gen, caps?}
 *
 * A Shell that does not answer the first `cap_want` (an older daemon, or a
 * page framed by something else under the Shell's frame name) leaves the
 * page on its fallback provider, the local type server.
 */

import {
  CAP_NAME,
  CAP_PROTOCOL,
  REWIRED_MESSAGE,
  type CapError,
  type CapToPage,
  type CapToShell,
} from '@open-artifact/protocol';
import {
  ArtifactError,
  type AgentCapability,
  type ArtifactCapability,
  type ArtifactErrorCode,
  type AssetsCapability,
  type CapabilityMap,
  type CapabilityName,
  type CommentsCapability,
  type ConflictPath,
  type DbCapability,
  type DocCapability,
  type DownloadsCapability,
  type HistoryCapability,
  MCP_CALL_TIMEOUT,
  type McpCapability,
  type RoomCapability,
  type SheetCapability,
  type UserCapability,
  type Viewer,
} from './capabilities.ts';
import type { CapabilityProvider } from './client.ts';
import { createLocalProvider } from './local-provider.ts';
import { shellOrigin } from './shell.ts';

/**
 * The methods the broker carries, per capability. The Shell runs nothing
 * else: a name outside this table is refused before it reaches a backend.
 * Listener methods (`onChange`, `onStatus`, `onPeers`) are not calls; they
 * listen to `cap_ev`.
 */
export const BROKERED_METHODS: { readonly [K in CapabilityName]: readonly string[] } = {
  artifact: ['title', 'list', 'readText', 'readBytes', 'publish'],
  assets: ['upload'],
  user: ['me'],
  agent: ['send', 'status'],
  room: ['self', 'presence', 'peers', 'emit'],
  downloads: ['save', 'check'],
  db: ['get', 'list', 'write'],
  comments: ['list', 'create', 'reply', 'edit', 'react', 'setResolved', 'move', 'remove', 'sendToAgent'],
  history: ['list', 'files', 'read', 'readBytes', 'diff', 'restore', 'dismissNotice'],
  doc: ['session', 'read', 'call', 'history', 'version', 'restore', 'importFile', 'exportFile'],
  mcp: ['callTool', 'listTools'],
  sheet: ['read', 'send', 'widget', 'importFile'],
};

/**
 * The `cap_ev` event each listener method follows, per capability
 * (`room.onPeers` → `peers`). The Shell subscribes to every listener method
 * named here once per granted capability and forwards its events.
 */
export const BROKERED_EVENTS = {
  artifact: { onChange: 'files' },
  agent: { onStatus: 'status' },
  room: { onPeers: 'peers', onMessage: 'message' },
  db: { onChange: 'change' },
  comments: { onChange: 'threads' },
  history: { onChange: 'change' },
  sheet: { onFrame: 'frame', onWalkthrough: 'walkthrough' },
  doc: { onFrame: 'frame' },
} as const satisfies Partial<Record<CapabilityName, Readonly<Record<string, string>>>>;

const CALL_TIMEOUT: Partial<Record<CapabilityName, number>> = { downloads: 150_000, assets: 272_000, user: 20_000 };
const DEFAULT_CALL_TIMEOUT = 130_000;
/** After `cap_ack` (a consent prompt, a queue): the long deadline. */
const ACKED_TIMEOUT = 900_000;
/** Capabilities whose calls resolve `null` instead of rejecting when cut or timed out. */
const RESOLVES_NULL = new Set<string>(['user']);

/** Options of {@link createShellProvider}. */
export interface ShellProviderOptions {
  /** The Shell's origin; defaults to {@link shellOrigin}. */
  origin?: string;
  /** The window the Shell is in; defaults to `window.parent`. */
  target?: Window;
  /** The page's API base sent with `cap_want`; defaults to the page's directory. */
  base?: string;
  /** Used when the Shell does not broker capabilities. Default: {@link createLocalProvider}. */
  fallback?: CapabilityProvider;
  /** Milliseconds to wait for the first `cap_grant` before falling back. Default 1500. */
  wantTimeoutMs?: number;
}

interface Pending {
  cap: string;
  gen: number;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Rebuilds the error a Shell sent. */
function toArtifactError(error: CapError | undefined): ArtifactError {
  const code = (error?.code ?? 'unavailable') as ArtifactErrorCode;
  const retryable = (error as { retryable?: unknown } | undefined)?.retryable === true;
  return new ArtifactError(code, error?.message ?? 'The Shell refused the call.', error?.paths as ConflictPath[] | undefined, retryable);
}

/** A per-load prefix plus a counter, like the frame runtime's call ids. */
function idMaker(): () => string {
  const prefix = Math.random().toString(36).slice(2, 10);
  let seq = 0;
  return () => `${prefix}${(++seq).toString(36)}`;
}

/**
 * A provider that brokers every capability through the Shell, falling back
 * to `options.fallback` when the Shell never grants.
 */
export function createShellProvider(options: ShellProviderOptions = {}): CapabilityProvider {
  const origin = options.origin ?? shellOrigin();
  const fallback = options.fallback ?? createLocalProvider();
  if (!origin || typeof window === 'undefined') return fallback;
  const target = options.target ?? window.parent;
  const base = new URL(options.base ?? './', location.href).toString();
  const wantTimeoutMs = options.wantTimeoutMs ?? 1500;
  const nextId = idMaker();

  /** `true` once a grant arrived, `false` once the first want timed out. */
  let brokered: boolean | null = null;
  let gen = 0;
  const pending = new Map<string, Pending>();
  const grants = new Map<string, Array<(grant: Extract<CapToPage, { openArtifact: 'cap_grant' }> | null) => void>>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  const post = (message: CapToShell, gesture = false): void => {
    // `includeUserActivation` lets the Shell see a click behind the call
    // (Chromium); other browsers ignore the option.
    target.postMessage(message, gesture ? ({ targetOrigin: origin, includeUserActivation: true } as WindowPostMessageOptions) : { targetOrigin: origin });
  };

  /** Ends a call that will get no answer. */
  const cut = (id: string, entry: Pending, message: string): void => {
    pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (RESOLVES_NULL.has(entry.cap)) entry.resolve(null);
    else entry.reject(new ArtifactError('unavailable', message));
  };

  const armTimer = (id: string, entry: Pending, ms: number): void => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (pending.get(id) === entry) cut(id, entry, 'The Shell did not answer in time.');
    }, ms);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== target || event.origin !== origin) return;
    const data = event.data as CapToPage | null;
    if (!data || typeof data !== 'object' || typeof data.openArtifact !== 'string' || !data.openArtifact.startsWith('cap_')) return;
    switch (data.openArtifact) {
      case 'cap_grant': {
        brokered = true;
        if (typeof data.gen === 'number' && Number.isInteger(data.gen) && data.gen >= 0) gen = data.gen;
        const waiting = grants.get(data.cap);
        grants.delete(data.cap);
        for (const done of waiting ?? []) done(data);
        break;
      }
      case 'cap_r': {
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (entry.timer) clearTimeout(entry.timer);
        if (data.error) entry.reject(toArtifactError(data.error));
        else entry.resolve(data.result);
        break;
      }
      case 'cap_ack': {
        // Consent or slow work: the call gets the long deadline.
        const entry = pending.get(data.id);
        if (entry) armTimer(data.id, entry, ACKED_TIMEOUT);
        break;
      }
      case 'cap_ev':
        for (const listener of listeners.get(`${data.cap}:${data.event}`) ?? []) {
          try {
            listener(data.data);
          } catch (error) {
            queueMicrotask(() => {
              throw error;
            });
          }
        }
        break;
      case 'cap_rewired': {
        // As the frame runtime's modules do: a new generation cuts every call sent
        // under another one, and `caps` (when given) lists what the broker
        // still serves, so calls to anything else are cut too.
        if (typeof data.gen !== 'number' || !Number.isInteger(data.gen) || data.gen < 0) return;
        const caps = Array.isArray(data.caps) ? new Set(data.caps) : null;
        for (const [id, entry] of [...pending]) {
          if (entry.gen !== data.gen || (caps && !caps.has(entry.cap))) cut(id, entry, REWIRED_MESSAGE);
        }
        gen = data.gen;
        break;
      }
      default:
        break;
    }
  };
  window.addEventListener('message', onMessage);

  const want = (cap: CapabilityName): Promise<Extract<CapToPage, { openArtifact: 'cap_grant' }> | null> =>
    new Promise((resolve) => {
      const list = grants.get(cap) ?? [];
      list.push(resolve);
      grants.set(cap, list);
      post({ openArtifact: 'cap_want', cap, protocol: CAP_PROTOCOL, base });
      setTimeout(() => {
        const waiting = grants.get(cap);
        if (!waiting?.includes(resolve)) return;
        waiting.splice(waiting.indexOf(resolve), 1);
        if (brokered === null) brokered = false;
        resolve(null);
      }, wantTimeoutMs);
    });

  const call = (cap: CapabilityName, method: string, args: unknown[], gesture = false, timeoutMs?: number, signal?: AbortSignal): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId();
      const entry: Pending = { cap, gen, resolve, reject, timer: null };
      pending.set(id, entry);
      armTimer(id, entry, timeoutMs ?? CALL_TIMEOUT[cap] ?? DEFAULT_CALL_TIMEOUT);
      if (signal) {
        // A signal cannot cross postMessage: the call is dropped here and its answer ignored.
        const abort = (): void => {
          if (pending.get(id) !== entry) return;
          pending.delete(id);
          if (entry.timer) clearTimeout(entry.timer);
          reject(signal.reason);
        };
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
      }
      post({ openArtifact: 'cap', id, cap, method, args, gen }, gesture);
    });

  const listen = (cap: CapabilityName, event: string, listener: (data: never) => void): (() => void) => {
    const key = `${cap}:${event}`;
    const set = listeners.get(key) ?? new Set();
    set.add(listener as (data: unknown) => void);
    listeners.set(key, set);
    return () => void set.delete(listener as (data: unknown) => void);
  };

  /** Builds the page's namespace for a granted capability. */
  const build = (cap: CapabilityName, config: Record<string, unknown>): CapabilityMap[CapabilityName] | null => {
    const c = <T>(method: string, args: unknown[] = [], gesture = false) => call(cap, method, args, gesture) as Promise<T>;
    switch (cap) {
      case 'artifact': {
        const ns: ArtifactCapability = {
          id: String(config.id ?? ''),
          title: () => c('title'),
          list: () => c('list'),
          readText: (path) => c('readText', [path]),
          readBytes: (path) => c('readBytes', [path]),
          publish: (batch) => c('publish', [batch]),
          onChange: (listener) => listen('artifact', BROKERED_EVENTS.artifact.onChange, listener),
        };
        return ns;
      }
      case 'assets': {
        const ns: AssetsCapability = { upload: (data, opts) => c('upload', opts ? [data, opts] : [data]) };
        return ns;
      }
      case 'user': {
        // Answered from the grant, like the frame runtime's `user.config`.
        const viewer = config.me as Viewer | undefined;
        const ns: UserCapability = { me: () => (viewer ? Promise.resolve({ ...viewer }) : c('me')) };
        return ns;
      }
      case 'agent': {
        const ns: AgentCapability = {
          send: (request, opts) => c('send', opts ? [request, opts] : [request], true),
          status: () => c('status'),
          onStatus: (listener) => listen('agent', BROKERED_EVENTS.agent.onStatus, listener),
        };
        return ns;
      }
      case 'room': {
        let self: Promise<string> | null = null;
        const ns: RoomCapability = {
          self: () => (self ??= c<string>('self')),
          presence: (patch) => c('presence', [patch]),
          peers: () => c('peers'),
          onPeers: (listener) => listen('room', BROKERED_EVENTS.room.onPeers, listener),
          emit: (topic, data) => c('emit', [topic, data]),
          onMessage: (listener) => listen('room', BROKERED_EVENTS.room.onMessage, listener),
        };
        return ns;
      }
      case 'db': {
        const ns: DbCapability = {
          get: (path) => c('get', [path]),
          list: (collection) => c('list', [collection]),
          write: (writes) => c('write', [writes]),
          onChange: (listener) => listen('db', BROKERED_EVENTS.db.onChange, listener),
        };
        return ns;
      }
      case 'comments': {
        const ns: CommentsCapability = {
          list: () => c('list'),
          create: (input) => c('create', [input]),
          reply: (threadId, text, options) => c('reply', options ? [threadId, text, options] : [threadId, text]),
          edit: (threadId, messageId, text, options) => c('edit', options ? [threadId, messageId, text, options] : [threadId, messageId, text]),
          react: (threadId, messageId, emoji, on) => c('react', [threadId, messageId, emoji, on]),
          setResolved: (threadId, resolved) => c('setResolved', [threadId, resolved]),
          move: (threadId, anchor, location) => c('move', location ? [threadId, anchor, location] : [threadId, anchor]),
          remove: (threadId, messageId) => c('remove', messageId ? [threadId, messageId] : [threadId]),
          // A host hears only threads people send: one the page would send unasked is not handed over there.
          sendToAgent: (threadId, options) => (options?.unasked ? Promise.reject(new Error('This host takes only threads that ask the agent.')) : c('sendToAgent', [threadId], true)),
          onChange: (listener) => listen('comments', BROKERED_EVENTS.comments.onChange, listener),
        };
        return ns;
      }
      case 'sheet': {
        const ns: SheetCapability = {
          read: (request) => c('read', [request]),
          send: (request) => c('send', [request]),
          widget: (request) => c('widget', [request]),
          importFile: (file, name) => c('importFile', [file, name], true),
          onFrame: (listener) => listen('sheet', BROKERED_EVENTS.sheet.onFrame, listener),
          onWalkthrough: (listener) => listen('sheet', BROKERED_EVENTS.sheet.onWalkthrough, listener),
        };
        return ns;
      }
      case 'history': {
        const ns: HistoryCapability = {
          list: () => c('list'),
          files: (n) => c('files', [n]),
          read: (n, path) => c('read', [n, path]),
          readBytes: (n, path) => c('readBytes', [n, path]),
          diff: (n, path) => c('diff', [n, path]),
          restore: (n, paths) => c('restore', paths ? [n, paths] : [n]),
          dismissNotice: (id) => c('dismissNotice', [id]),
          onChange: (listener) => listen('history', BROKERED_EVENTS.history.onChange, listener),
        };
        return ns;
      }
      case 'doc': {
        const ns: DocCapability = {
          session: () => c('session'),
          read: (tab) => c('read', [tab]),
          call: (request) => c('call', [request]),
          history: (tab) => c('history', [tab]),
          version: (tab, rev) => c('version', [tab, rev]),
          restore: (request) => c('restore', [request]),
          importFile: (name, bytes, tabName) => c('importFile', tabName === undefined ? [name, bytes] : [name, bytes, tabName], true),
          exportFile: (query) => c('exportFile', [query], true),
          onFrame: (listener) => listen('doc', BROKERED_EVENTS.doc.onFrame, listener),
        };
        return ns;
      }
      case 'downloads': {
        // The Shell says when its host saves in this browser (a cloud host): the page then sends every role's files.
        const ns: DownloadsCapability = { save: (file) => c('save', [file], true), ...(config.browser === true ? { browser: true, check: () => c('check') } : {}) };
        return ns;
      }
      case 'mcp': {
        const ns: McpCapability = {
          callTool: (server, tool, args, opts) => {
            const timeoutMs = opts?.timeoutMs;
            const wire = timeoutMs === undefined ? [server, tool, args] : [server, tool, args, { timeoutMs }];
            // The page waits a little longer than the host does, so the host's own timeout error arrives.
            const budget = Math.min(timeoutMs ?? MCP_CALL_TIMEOUT.defaultMs, MCP_CALL_TIMEOUT.maxMs) + 15_000;
            return call('mcp', 'callTool', wire, false, budget, opts?.signal) as ReturnType<McpCapability['callTool']>;
          },
          listTools: (server) => c('listTools', server === undefined ? [] : [server]),
        };
        return ns;
      }
      default:
        return null;
    }
  };

  return {
    async get(name) {
      if (!CAP_NAME.test(name) || !(name in BROKERED_METHODS)) return null;
      if (brokered === false) return fallback.get(name);
      const grant = await want(name);
      if (!grant) return brokered ? null : fallback.get(name);
      if (!grant.ok) return null;
      return build(name, grant.config ?? {}) as CapabilityMap[typeof name] | null;
    },
  };
}

/**
 * The provider a page should use: brokered through the Shell when it is in
 * one, otherwise the local type server.
 */
export function createPageProvider(options: { base?: string } = {}): CapabilityProvider {
  const fallback = createLocalProvider(options);
  return shellOrigin() ? createShellProvider({ ...options, fallback }) : fallback;
}
